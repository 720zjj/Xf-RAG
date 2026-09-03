import { Router } from 'express'
import multer from 'multer'
import path from 'path'
import fs from 'fs'
import dotenv from 'dotenv'
import { authMiddleware, requireAdmin } from '../middleware/auth.js'
import { createRateLimit } from '../middleware/rateLimit.js'
import pool from '../db.js'
import { invalidateAllChunks } from '../services/chunkStore.js'
import { buildKnowledgeScope } from '../services/knowledgeAccess.js'
import {
  createReparseJob,
  createRetryJob,
  createUploadJob,
  getLatestDocumentJob,
  requestDocumentJobCancel
} from '../services/documentJobService.js'
import { DOCUMENT_STATUS, getDocumentStatusName } from '../services/documentJobState.js'

dotenv.config()

const router = Router()
const documentUploadRateLimit = createRateLimit({ windowMs: 60 * 60 * 1000, max: 20 })
const MAX_DOCUMENT_BYTES = Math.max(1, Number(process.env.MAX_DOCUMENT_UPLOAD_MB) || 20) * 1024 * 1024
const uploadDir = path.resolve(process.env.UPLOAD_DIR || './uploads')
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true })

const storage = multer.diskStorage({
  destination: uploadDir,
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname)
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`)
  }
})

const upload = multer({
  storage,
  limits: { fileSize: MAX_DOCUMENT_BYTES },
  fileFilter: (req, file, cb) => {
    const allowed = ['.pdf', '.docx', '.doc', '.md', '.txt']
    cb(null, allowed.includes(path.extname(file.originalname).toLowerCase()))
  }
})

function hasExpectedSignature(filePath, fileType) {
  if (fileType === 'md' || fileType === 'txt') return true
  const fd = fs.openSync(filePath, 'r')
  try {
    const header = Buffer.alloc(8)
    const bytes = fs.readSync(fd, header, 0, header.length, 0)
    if (fileType === 'pdf') return header.subarray(0, Math.min(bytes, 5)).toString('ascii') === '%PDF-'
    if (fileType === 'docx') return bytes >= 4 && header[0] === 0x50 && header[1] === 0x4b
    if (fileType === 'doc') return bytes >= 8 && header.equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))
    return false
  } finally {
    fs.closeSync(fd)
  }
}

function removeNewUpload(filePath) {
  const resolved = path.resolve(filePath || '')
  if (!resolved.startsWith(uploadDir + path.sep)) return
  try { if (fs.existsSync(resolved)) fs.unlinkSync(resolved) } catch {}
}

function formatJob(job) {
  if (!job) return null
  return {
    id: job.id,
    status: job.status,
    progress: job.progress,
    stage: job.stage,
    attemptsMade: job.attemptsMade,
    maxAttempts: job.maxAttempts,
    cancelRequested: job.cancelRequested,
    errorMessage: job.errorMessage,
    queueAvailable: job.queueAvailable !== false
  }
}

function decorateDocument(row) {
  return {
    ...row,
    status_name: getDocumentStatusName(row.status),
    latest_job_id: row.latest_job_id == null ? null : Number(row.latest_job_id),
    job_progress: row.job_progress == null ? null : Number(row.job_progress),
    job: row.latest_job_id == null ? null : {
      id: Number(row.latest_job_id),
      status: row.job_status,
      progress: Number(row.job_progress || 0),
      stage: row.job_stage,
      attemptsMade: Number(row.job_attempts_made || 0),
      maxAttempts: Number(row.job_max_attempts || 3),
      cancelRequested: Boolean(Number(row.job_cancel_requested || 0)),
      errorMessage: row.job_error_message || null
    }
  }
}

function sendJobCreation(res, result, type) {
  const data = {
    id: result.document.id,
    filename: result.document.originalName,
    size: result.document.size,
    type: type || result.document.fileType,
    status: result.document.status,
    statusName: result.document.statusName,
    duplicated: Boolean(result.duplicated),
    job: formatJob(result.job)
  }
  return res.status(202).json({ ok: true, data, warning: result.queueError || undefined })
}

// 上传只保存文件并创建任务；解析始终由独立 Worker 执行。
router.post('/upload', authMiddleware, requireAdmin, documentUploadRateLimit, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ ok: false, error: '请选择文件' })
    const fileType = path.extname(req.file.originalname).toLowerCase().slice(1)
    if (!hasExpectedSignature(req.file.path, fileType)) {
      removeNewUpload(req.file.path)
      return res.status(415).json({ ok: false, error: '文件内容与扩展名不匹配' })
    }
    if (fileType === 'doc' && !process.env.MINERU_API_KEY) {
      removeNewUpload(req.file.path)
      return res.status(400).json({ ok: false, error: 'DOC 格式需要配置 MinerU；未配置时请转换为 DOCX' })
    }
    const result = await createUploadJob({
      userId: req.user.id,
      file: { ...req.file, originalName: req.file.originalname, fileType }
    })
    return sendJobCreation(res, result, fileType)
  } catch (error) {
    removeNewUpload(req.file?.path)
    console.error('[documents/upload]', error.message)
    return res.status(500).json({ ok: false, error: '上传任务创建失败，请重试' })
  }
})

// 获取文档列表及其最新后台任务摘要。
router.get('/list', authMiddleware, async (req, res) => {
  try {
    const scope = buildKnowledgeScope(req.user.id, { documentAlias: 'd', ownerAlias: 'owner' })
    const [rows] = await pool.query(
      `SELECT d.id, d.original_name, d.file_type, d.file_size, d.chunk_count, d.status,
              d.mineru_task_id, d.mineru_pages, d.error_message, d.created_at,
              d.user_id = ? AS is_owner,
              CASE WHEN d.user_id = ? THEN 'private' ELSE 'public' END AS scope,
              j.id AS latest_job_id, j.status AS job_status, j.progress AS job_progress,
              j.stage AS job_stage, j.attempts_made AS job_attempts_made,
              j.max_attempts AS job_max_attempts, j.cancel_requested AS job_cancel_requested,
              j.error_message AS job_error_message
       FROM documents d
       JOIN users owner ON d.user_id = owner.id
       LEFT JOIN document_jobs j ON j.id = (
         SELECT latest.id FROM document_jobs latest WHERE latest.document_id = d.id ORDER BY latest.id DESC LIMIT 1
       )
       WHERE ${scope.where}
       ORDER BY is_owner DESC, d.created_at DESC`,
      [req.user.id, req.user.id, ...scope.params]
    )
    res.json({ ok: true, data: rows.map(decorateDocument) })
  } catch {
    res.status(500).json({ ok: false, error: '获取文档列表失败' })
  }
})

// 读取最新任务仅限文档所有者，避免向其他用户暴露失败原因。
router.get('/:id/job', authMiddleware, async (req, res) => {
  try {
    const job = await getLatestDocumentJob({ userId: req.user.id, documentId: req.params.id })
    if (!job) return res.status(404).json({ ok: false, error: '文档任务不存在' })
    res.json({ ok: true, data: formatJob(job) })
  } catch {
    res.status(500).json({ ok: false, error: '获取任务状态失败' })
  }
})

router.post('/:id/reparse', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const result = await createReparseJob({ userId: req.user.id, documentId: req.params.id })
    if (!result) return res.status(404).json({ ok: false, error: '文档不存在' })
    return sendJobCreation(res, { ...result, duplicated: false }, result.document.fileType)
  } catch (error) {
    const status = error.code === 'DOCUMENT_JOB_ACTIVE' ? 409 : 400
    return res.status(status).json({ ok: false, error: error.message || '重新解析任务创建失败' })
  }
})

router.post('/:id/retry', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const result = await createRetryJob({ userId: req.user.id, documentId: req.params.id })
    if (!result) return res.status(404).json({ ok: false, error: '文档不存在' })
    return sendJobCreation(res, { ...result, duplicated: false }, result.document.fileType)
  } catch (error) {
    const status = error.code === 'DOCUMENT_JOB_ACTIVE' ? 409 : 400
    return res.status(status).json({ ok: false, error: error.message || '重试任务创建失败' })
  }
})

router.post('/:id/cancel', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const result = await requestDocumentJobCancel({ userId: req.user.id, documentId: req.params.id })
    if (!result) return res.status(404).json({ ok: false, error: '文档任务不存在' })
    res.status(result.pending ? 202 : 200).json({
      ok: true,
      data: { document: result.document, job: formatJob(result.job), pending: result.pending }
    })
  } catch {
    res.status(500).json({ ok: false, error: '取消任务失败' })
  }
})

// 获取文档详情
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const scope = buildKnowledgeScope(req.user.id, { documentAlias: 'd', ownerAlias: 'owner' })
    const [rows] = await pool.query(
      `SELECT d.id, d.original_name, d.file_type, d.file_size, d.content, d.chunk_count, d.status, d.created_at,
              d.user_id = ? AS is_owner,
              CASE WHEN d.user_id = ? THEN 'private' ELSE 'public' END AS scope
       FROM documents d
       JOIN users owner ON d.user_id = owner.id
       WHERE d.id = ? AND ${scope.where}`,
      [req.user.id, req.user.id, req.params.id, ...scope.params]
    )
    if (rows.length === 0) return res.status(404).json({ ok: false, error: '文档不存在' })
    res.json({ ok: true, data: decorateDocument(rows[0]) })
  } catch {
    res.status(500).json({ ok: false, error: '获取文档详情失败' })
  }
})

// 删除终态文档；活跃任务必须先在 Worker 安全边界取消。
router.delete('/:id', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT file_path, status FROM documents WHERE id = ? AND user_id = ?',
      [req.params.id, req.user.id]
    )
    if (rows.length === 0) return res.status(404).json({ ok: false, error: '文档不存在' })
    const document = rows[0]
    if ([DOCUMENT_STATUS.queued, DOCUMENT_STATUS.processing].includes(Number(document.status))) {
      return res.status(409).json({ ok: false, error: '文档任务仍在进行，请先取消任务并等待状态变为已取消' })
    }
    const [result] = await pool.query('DELETE FROM documents WHERE id = ? AND user_id = ?', [req.params.id, req.user.id])
    if (!result.affectedRows) return res.status(404).json({ ok: false, error: '文档不存在' })
    invalidateAllChunks()
    try { if (fs.existsSync(document.file_path)) fs.unlinkSync(document.file_path) } catch (error) {
      console.warn(`[documents/delete] 原始文件清理失败: ${error.message}`)
    }
    const imagesRoot = path.resolve(uploadDir, 'images')
    const imageDir = path.resolve(imagesRoot, String(req.params.id))
    if (imageDir.startsWith(imagesRoot + path.sep)) {
      try { if (fs.existsSync(imageDir)) fs.rmSync(imageDir, { recursive: true, force: true }) } catch (error) {
        console.warn(`[documents/delete] 图片目录清理失败: ${error.message}`)
      }
    }
    res.json({ ok: true })
  } catch {
    res.status(500).json({ ok: false, error: '删除文档失败' })
  }
})

// 获取文档图片列表
router.get('/:id/images', authMiddleware, async (req, res) => {
  try {
    const docId = req.params.id
    const scope = buildKnowledgeScope(req.user.id, { documentAlias: 'd', ownerAlias: 'owner' })
    const [docs] = await pool.query(
      `SELECT d.id FROM documents d JOIN users owner ON d.user_id = owner.id WHERE d.id = ? AND ${scope.where}`,
      [docId, ...scope.params]
    )
    if (!docs.length) return res.status(404).json({ ok: false, error: '文档不存在' })
    const imageDir = path.resolve(process.env.UPLOAD_DIR || './uploads', 'images', String(docId))
    if (!fs.existsSync(imageDir)) return res.json({ ok: true, data: [] })
    const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.tiff']
    const images = fs.readdirSync(imageDir)
      .filter(file => imageExtensions.includes(path.extname(file).toLowerCase()))
      .map(filename => ({
        filename,
        url: `/uploads/images/${docId}/${filename}`,
        size: fs.statSync(path.join(imageDir, filename)).size
      }))
    res.json({ ok: true, data: images })
  } catch {
    res.status(500).json({ ok: false, error: '获取文档图片失败' })
  }
})

export default router
