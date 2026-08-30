import { Router } from 'express'
import path from 'path'
import fs from 'fs'
import crypto from 'crypto'
import { authMiddleware, isAdmin } from '../middleware/auth.js'
import { createRateLimit } from '../middleware/rateLimit.js'
import pool from '../db.js'
import { buildSopVideoStoryboard } from '../services/sopVideoStoryboard.js'

const router = Router()
const uploadRateLimit = createRateLimit({ windowMs: 60 * 60 * 1000, max: 20 })
const MAX_VIDEO_BYTES = Math.max(1, Number(process.env.MAX_VIDEO_UPLOAD_MB) || 100) * 1024 * 1024

function canManage(req) {
  return isAdmin(req)
}

function requireAdmin(req, res, next) {
  if (!isAdmin(req)) return res.status(403).json({ ok: false, error: '仅管理员可以制作和管理视频' })
  next()
}

export function localVideoPath(videoUrl) {
  if (typeof videoUrl !== 'string') return null
  const match = /^\/uploads\/videos\/([a-zA-Z0-9_-]+\.webm)$/.exec(videoUrl)
  if (!match) return null
  const dir = path.resolve(process.env.UPLOAD_DIR || './uploads', 'videos')
  const filePath = path.resolve(dir, match[1])
  return filePath.startsWith(dir + path.sep) ? filePath : null
}

function looksLikeWebm(filePath) {
  let descriptor
  try {
    descriptor = fs.openSync(filePath, 'r')
    const header = Buffer.alloc(4096)
    const bytesRead = fs.readSync(descriptor, header, 0, header.length, 0)
    const content = header.subarray(0, bytesRead)
    return bytesRead > 4 && content[0] === 0x1a && content[1] === 0x45 && content[2] === 0xdf && content[3] === 0xa3 && content.includes(Buffer.from('webm'))
  } catch {
    return false
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor)
  }
}

// POST /api/video/upload-file - 保存生成的视频文件到 uploads/videos/（原始二进制流）
router.post('/upload-file', authMiddleware, requireAdmin, uploadRateLimit, (req, res) => {
  const { filename } = req.query
  if (!filename || !/^[\w\u4e00-\u9fa5.-]+\.webm$/.test(filename)) {
    return res.status(400).json({ ok: false, error: '非法文件名' })
  }
  const contentLength = Number(req.headers['content-length'] || 0)
  const contentType = String(req.headers['content-type'] || '').split(';')[0].toLowerCase()
  if (contentType !== 'video/webm') {
    return res.status(415).json({ ok: false, error: '仅支持 WebM 视频流' })
  }
  if (contentLength > MAX_VIDEO_BYTES) {
    return res.status(413).json({ ok: false, error: `视频不能超过 ${MAX_VIDEO_BYTES / 1024 / 1024}MB` })
  }
  const dir = path.resolve(process.env.UPLOAD_DIR || './uploads', 'videos')
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  const storedName = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}.webm`
  const filePath = path.join(dir, storedName)
  const ws = fs.createWriteStream(filePath, { flags: 'wx' })
  let received = 0
  let failed = false
  const cleanup = () => { try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath) } catch {} }

  req.on('data', chunk => {
    received += chunk.length
    if (received > MAX_VIDEO_BYTES && !failed) {
      failed = true
      req.unpipe(ws)
      ws.destroy()
      cleanup()
      if (!res.headersSent) res.status(413).json({ ok: false, error: `视频不能超过 ${MAX_VIDEO_BYTES / 1024 / 1024}MB` })
    }
  })
  req.on('aborted', () => { failed = true; ws.destroy(); cleanup() })
  ws.on('finish', () => {
    if (failed) return
    if (received <= 0 || !looksLikeWebm(filePath)) {
      failed = true
      cleanup()
      return res.status(415).json({ ok: false, error: '上传文件不是有效的 WebM 视频' })
    }
    res.json({ ok: true, url: `/uploads/videos/${storedName}`, originalName: filename })
  })
  ws.on('close', () => { if (failed) cleanup() })
  ws.on('error', (e) => {
    cleanup()
    if (!res.headersSent) res.status(500).json({ ok: false, error: '视频保存失败' })
    console.error('[video/upload]', e)
  })
  req.pipe(ws)
})

// GET /api/video/studio/sops - 视频工坊只读取已审核 SOP 的摘要
router.get('/studio/sops', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const keyword = String(req.query.q || '').trim().slice(0, 100)
    let sql = `SELECT id, title, brand, product_line, product_model, firmware_version, category,
      difficulty, estimated_duration, completion_check, updated_at
      FROM sops WHERE review_status = 'approved'`
    const params = []
    if (keyword) {
      sql += ' AND (title LIKE ? OR product_model LIKE ? OR category LIKE ?)'
      const pattern = `%${keyword}%`
      params.push(pattern, pattern, pattern)
    }
    sql += ' ORDER BY updated_at DESC, id DESC LIMIT 100'
    const [rows] = await pool.query(sql, params)
    res.json({ ok: true, data: rows })
  } catch (err) {
    console.error('[video/studio/sops]', err)
    res.status(500).json({ ok: false, error: '读取 SOP 列表失败' })
  }
})

// POST /api/video/studio/storyboard - 从服务端已审核 SOP 生成确定性分镜
router.post('/studio/storyboard', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const sopId = Number(req.body?.sopId)
    if (!Number.isInteger(sopId) || sopId <= 0) return res.status(400).json({ ok: false, error: '请选择有效的 SOP' })
    const [rows] = await pool.query("SELECT * FROM sops WHERE id = ? AND review_status = 'approved'", [sopId])
    if (!rows.length) return res.status(404).json({ ok: false, error: 'SOP 不存在或尚未审核通过' })
    res.json({ ok: true, data: buildSopVideoStoryboard(rows[0]) })
  } catch (err) {
    const status = err instanceof TypeError ? 422 : 500
    console.error('[video/studio/storyboard]', err)
    res.status(status).json({ ok: false, error: status === 422 ? err.message : '生成视频分镜失败' })
  }
})

// POST /api/video/studio/publish - 只发布与已审核 SOP 严格对应的本地 WebM
router.post('/studio/publish', authMiddleware, requireAdmin, async (req, res) => {
  let conn
  try {
    const sopId = Number(req.body?.sopId)
    const videoUrl = String(req.body?.videoUrl || '')
    const storyboardFingerprint = String(req.body?.storyboardFingerprint || '')
    if (!Number.isInteger(sopId) || sopId <= 0) return res.status(400).json({ ok: false, error: '请选择有效的 SOP' })
    const filePath = localVideoPath(videoUrl)
    if (!filePath || !fs.existsSync(filePath) || !looksLikeWebm(filePath)) return res.status(400).json({ ok: false, error: '请先上传本次生成的有效 WebM 视频' })

    const [rows] = await pool.query("SELECT * FROM sops WHERE id = ? AND review_status = 'approved'", [sopId])
    if (!rows.length) return res.status(404).json({ ok: false, error: 'SOP 不存在或尚未审核通过' })
    const storyboard = buildSopVideoStoryboard(rows[0])
    if (!/^[a-f0-9]{64}$/.test(storyboardFingerprint) || storyboardFingerprint !== storyboard.fingerprint) {
      return res.status(409).json({ ok: false, error: 'SOP 在生成期间发生变化，请重新生成视频分镜' })
    }
    const title = `${storyboard.title}｜操作指引`.slice(0, 255)
    const description = `由已审核 SOP 自动生成的无声字幕教学视频。完成确认：${rows[0].completion_check || '请按 SOP 核验。'}`
    const tags = [...new Set([storyboard.category, storyboard.productModel, 'SOP 自动生成', '无声字幕'].filter(Boolean))]

    conn = await pool.getConnection()
    await conn.beginTransaction()
    const [result] = await conn.query(
      `INSERT INTO videos (title, description, brand, product_line, product_model, firmware_version, category, tags,
        duration_seconds, video_url, source_sop_id, review_status, publish_status, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'approved', 'published', ?)`,
      [title, description, rows[0].brand || '科大讯飞', storyboard.productLine, storyboard.productModel,
        rows[0].firmware_version || '', storyboard.category, JSON.stringify(tags), storyboard.durationSeconds,
        videoUrl, sopId, req.user.id]
    )
    const videoId = result.insertId
    for (const chapter of storyboard.chapters) {
      await conn.query(
        'INSERT INTO video_chapters (video_id, chapter_index, title, start_time, end_time, step_number, keywords) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [videoId, chapter.chapterIndex, chapter.title, chapter.startTime, chapter.endTime, chapter.stepNumber, chapter.keywords]
      )
    }
    await conn.commit()
    res.status(201).json({ ok: true, data: { id: videoId, title, durationSeconds: storyboard.durationSeconds, chapters: storyboard.chapters } })
  } catch (err) {
    if (conn) await conn.rollback().catch(() => {})
    console.error('[video/studio/publish]', err)
    res.status(500).json({ ok: false, error: '发布视频失败' })
  } finally {
    conn?.release()
  }
})

// GET /api/video/list - 视频列表（支持筛选）
router.get('/list', authMiddleware, async (req, res) => {
  try {
    const { productLine, productModel, category, keyword } = req.query
    const page = Math.max(1, Number(req.query.page) || 1)
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 20))
    let sql = 'SELECT * FROM videos WHERE publish_status = "published" AND review_status = "approved"'
    const params = []

    if (productLine) { sql += ' AND product_line = ?'; params.push(productLine) }
    if (productModel) { sql += ' AND (product_model = ? OR product_model = "")'; params.push(productModel) }
    if (category) { sql += ' AND category = ?'; params.push(category) }
    if (keyword) { sql += ' AND (title LIKE ? OR description LIKE ?)'; params.push(`%${keyword}%`, `%${keyword}%`) }

    const countSql = sql.replace('SELECT *', 'SELECT COUNT(*) as total')
    const [countRows] = await pool.query(countSql, params)
    const total = countRows[0].total

    sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?'
    params.push(pageSize, (page - 1) * pageSize)
    const [rows] = await pool.query(sql, params)

    res.json({ ok: true, data: { list: rows, total, page, pageSize } })
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message })
  }
})

// GET /api/video/search - 视频检索（关键词匹配标题/标签/章节关键词）
router.get('/search', authMiddleware, async (req, res) => {
  try {
    const { q, productLine, productModel } = req.query
    if (!q) return res.json({ ok: true, data: [] })

    let sql = `
      SELECT DISTINCT v.*, vc.title as matched_chapter, vc.start_time as chapter_start
      FROM videos v
      LEFT JOIN video_chapters vc ON v.id = vc.video_id
      WHERE v.publish_status = 'published' AND v.review_status = 'approved'
        AND (v.title LIKE ? OR v.description LIKE ? OR JSON_SEARCH(v.tags, 'one', ?) IS NOT NULL OR vc.keywords LIKE ?)
    `
    const params = [`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`]

    if (productLine) { sql += ' AND (v.product_line = ? OR v.product_line = "翻译机")'; params.push(productLine) }
    if (productModel) { sql += ' AND (v.product_model = ? OR v.product_model = "")'; params.push(productModel) }

    sql += ' ORDER BY v.view_count DESC LIMIT 10'
    const [rows] = await pool.query(sql, params)
    res.json({ ok: true, data: rows })
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message })
  }
})

// GET /api/video/:id - 视频详情（含章节）
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const [videos] = await pool.query('SELECT * FROM videos WHERE id = ? AND publish_status = "published" AND review_status = "approved"', [req.params.id])
    if (!videos.length) return res.status(404).json({ ok: false, error: '视频不存在' })

    const [chapters] = await pool.query('SELECT * FROM video_chapters WHERE video_id = ? ORDER BY chapter_index', [req.params.id])
    const video = videos[0]
    video.chapters = chapters

    // 自增播放次数
    pool.query('UPDATE videos SET view_count = view_count + 1 WHERE id = ?', [req.params.id]).catch(() => {})

    res.json({ ok: true, data: video })
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message })
  }
})

// POST /api/video - 创建视频记录（管理端）
router.post('/', authMiddleware, requireAdmin, async (req, res) => {
  let conn
  try {
    const { title, description, brand, productLine, productModel, firmwareVersion, category, tags, durationSeconds, videoUrl, thumbnailUrl, sourceSopId, chapters } = req.body
    if (typeof title !== 'string' || !title.trim() || title.length > 255) return res.status(400).json({ ok: false, error: '标题需为 1-255 个字符' })
    if (tags !== undefined && !Array.isArray(tags)) return res.status(400).json({ ok: false, error: 'tags 必须是数组' })
    if (chapters !== undefined && !Array.isArray(chapters)) return res.status(400).json({ ok: false, error: 'chapters 必须是数组' })

    if (sourceSopId !== undefined && sourceSopId !== null) {
      const sopId = Number(sourceSopId)
      if (!Number.isInteger(sopId) || sopId <= 0) return res.status(400).json({ ok: false, error: '非法 SOP 标识' })
      const [sops] = await pool.query("SELECT id FROM sops WHERE id = ? AND review_status = 'approved'", [sopId])
      if (!sops.length) return res.status(400).json({ ok: false, error: '关联 SOP 不存在或尚未审核通过' })
    }
    if (videoUrl) {
      const filePath = localVideoPath(videoUrl)
      if (!filePath || !fs.existsSync(filePath) || !looksLikeWebm(filePath)) return res.status(400).json({ ok: false, error: '视频必须是已上传的有效本地 WebM 文件' })
    }

    conn = await pool.getConnection()
    await conn.beginTransaction()
    const [result] = await conn.query(
      `INSERT INTO videos (title, description, brand, product_line, product_model, firmware_version, category, tags, duration_seconds, video_url, thumbnail_url, source_sop_id, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [title.trim(), description || '', brand || '科大讯飞', productLine || '翻译机', productModel || '', firmwareVersion || '', category || '', JSON.stringify(tags || []), durationSeconds || 0, videoUrl || '', thumbnailUrl || '', sourceSopId || null, req.user.id]
    )

    const videoId = result.insertId

    // 批量插入章节
    if (chapters && chapters.length > 0) {
      for (let i = 0; i < chapters.length; i++) {
        const ch = chapters[i]
        await conn.query(
          'INSERT INTO video_chapters (video_id, chapter_index, title, start_time, end_time, step_number, keywords) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [videoId, i + 1, ch.title || `第${i + 1}步`, ch.startTime || 0, ch.endTime || null, ch.stepNumber || null, ch.keywords || '']
        )
      }
    }

    await conn.commit()
    res.status(201).json({ ok: true, data: { id: videoId } })
  } catch (err) {
    if (conn) await conn.rollback().catch(() => {})
    console.error('[video/create]', err)
    res.status(500).json({ ok: false, error: '创建视频失败' })
  } finally {
    conn?.release()
  }
})

// PUT /api/video/:id - 更新视频
router.put('/:id', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const { title, description, category, tags, durationSeconds, videoUrl, thumbnailUrl, reviewStatus, publishStatus } = req.body
    const [existing] = await pool.query('SELECT id, created_by, review_status, publish_status, video_url, source_sop_id FROM videos WHERE id = ?', [req.params.id])
    if (!existing.length) return res.status(404).json({ ok: false, error: '视频不存在' })
    if (!canManage(req, existing[0])) return res.status(403).json({ ok: false, error: '无权修改该视频' })
    if (tags !== undefined && !Array.isArray(tags)) return res.status(400).json({ ok: false, error: 'tags 必须是数组' })
    if (reviewStatus !== undefined && !['draft', 'pending', 'approved', 'rejected'].includes(reviewStatus)) return res.status(400).json({ ok: false, error: '非法审核状态' })
    if (publishStatus !== undefined && !['unpublished', 'published', 'archived'].includes(publishStatus)) return res.status(400).json({ ok: false, error: '非法发布状态' })
    if (videoUrl !== undefined && videoUrl) {
      const filePath = localVideoPath(videoUrl)
      if (!filePath || !fs.existsSync(filePath) || !looksLikeWebm(filePath)) return res.status(400).json({ ok: false, error: '视频必须是已上传的有效本地 WebM 文件' })
    }
    const effectivePublishStatus = publishStatus ?? existing[0].publish_status
    if (effectivePublishStatus === 'published') {
      const effectiveReviewStatus = reviewStatus ?? existing[0].review_status
      const effectiveVideoUrl = videoUrl ?? existing[0].video_url
      const filePath = localVideoPath(effectiveVideoUrl)
      if (effectiveReviewStatus !== 'approved' || !filePath || !fs.existsSync(filePath) || !looksLikeWebm(filePath)) {
        return res.status(409).json({ ok: false, error: '发布视频前必须审核通过，并关联有效的本地 WebM 文件' })
      }
      if (existing[0].source_sop_id) {
        const [sops] = await pool.query("SELECT id FROM sops WHERE id = ? AND review_status = 'approved'", [existing[0].source_sop_id])
        if (!sops.length) return res.status(409).json({ ok: false, error: '关联 SOP 尚未审核通过，不能发布视频' })
      }
    }
    const fields = []
    const params = []

    if (title !== undefined) { fields.push('title = ?'); params.push(title) }
    if (description !== undefined) { fields.push('description = ?'); params.push(description) }
    if (category !== undefined) { fields.push('category = ?'); params.push(category) }
    if (tags !== undefined) { fields.push('tags = ?'); params.push(JSON.stringify(tags)) }
    if (durationSeconds !== undefined) { fields.push('duration_seconds = ?'); params.push(durationSeconds) }
    if (videoUrl !== undefined) { fields.push('video_url = ?'); params.push(videoUrl) }
    if (thumbnailUrl !== undefined) { fields.push('thumbnail_url = ?'); params.push(thumbnailUrl) }
    if (reviewStatus !== undefined) { fields.push('review_status = ?'); params.push(reviewStatus) }
    if (publishStatus !== undefined) { fields.push('publish_status = ?'); params.push(publishStatus) }

    if (fields.length === 0) return res.status(400).json({ ok: false, error: '无更新字段' })

    params.push(req.params.id)
    const [result] = await pool.query(`UPDATE videos SET ${fields.join(', ')} WHERE id = ?`, params)
    if (!result.affectedRows) return res.status(404).json({ ok: false, error: '视频不存在' })
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message })
  }
})

// POST /api/video/:id/resolve - 标记视频解决了问题
router.post('/:id/resolve', authMiddleware, async (req, res) => {
  let conn
  try {
    const qaIdValue = req.body?.qaId
    const qaId = qaIdValue === undefined || qaIdValue === null || qaIdValue === '' ? null : Number(qaIdValue)
    if (qaId !== null && (!Number.isInteger(qaId) || qaId <= 0)) return res.status(400).json({ ok: false, error: '非法问答标识' })
    conn = await pool.getConnection()
    await conn.beginTransaction()
    const [videos] = await conn.query('SELECT id FROM videos WHERE id = ? AND publish_status = "published" AND review_status = "approved" FOR UPDATE', [req.params.id])
    if (!videos.length) throw Object.assign(new Error('视频不存在'), { status: 404 })
    if (qaId !== null) {
      const [qas] = await conn.query('SELECT id FROM rag_qa WHERE id = ? AND user_id = ?', [qaId, req.user.id])
      if (!qas.length) throw Object.assign(new Error('问答记录不存在'), { status: 404 })
    }
    const [insert] = await conn.query(
      'INSERT IGNORE INTO video_qa_links (video_id, qa_id, user_id, action) VALUES (?, ?, ?, "resolve")',
      [req.params.id, qaId, req.user.id]
    )
    if (insert.affectedRows) {
      await conn.query('UPDATE videos SET resolve_count = resolve_count + 1 WHERE id = ?', [req.params.id])
    }
    await conn.commit()
    res.json({ ok: true, counted: Boolean(insert.affectedRows) })
  } catch (err) {
    if (conn) await conn.rollback().catch(() => {})
    res.status(err.status || 500).json({ ok: false, error: err.status ? err.message : '记录失败' })
  } finally {
    conn?.release()
  }
})

// DELETE /api/video/:id - 删除视频
router.delete('/:id', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const [existing] = await pool.query('SELECT id, created_by, video_url FROM videos WHERE id = ?', [req.params.id])
    if (!existing.length) return res.status(404).json({ ok: false, error: '视频不存在' })
    if (!canManage(req, existing[0])) return res.status(403).json({ ok: false, error: '无权删除该视频' })
    await pool.query('DELETE FROM videos WHERE id = ?', [req.params.id])
    const filePath = localVideoPath(existing[0].video_url)
    if (filePath) {
      try {
        const [references] = await pool.query('SELECT COUNT(*) AS total FROM videos WHERE video_url = ?', [existing[0].video_url])
        if (Number(references[0].total) === 0 && fs.existsSync(filePath)) fs.unlinkSync(filePath)
      } catch (cleanupError) {
        console.warn('[video/delete] 视频记录已删除，但清理孤儿文件失败', cleanupError)
      }
    }
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message })
  }
})

export default router
