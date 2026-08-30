import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import pool from '../db.js'
import { invalidateAllChunks } from './chunkStore.js'
import { enqueueDocumentJob, getDocumentQueueJobId, removeQueuedDocumentJob } from '../queues/documentQueue.js'
import {
  DOCUMENT_STATUS,
  clampProgress,
  getDocumentStatusName,
  sanitizeDocumentJobError
} from './documentJobState.js'

const ACTIVE_JOB_STATUSES = ['queued', 'processing']
const TERMINAL_JOB_STATUSES = ['completed', 'failed', 'cancelled']
const QUEUE_UNAVAILABLE_MESSAGE = '队列暂时不可用，系统将自动恢复任务'

export function hashDocumentFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256')
    const input = fs.createReadStream(filePath)
    input.on('error', reject)
    input.on('data', chunk => hash.update(chunk))
    input.on('end', () => resolve(hash.digest('hex')))
  })
}

function normalizeFile(file) {
  const filePath = String(file?.path || '')
  const originalName = String(file?.originalName || file?.originalname || file?.filename || '')
  const fileType = String(file?.fileType || path.extname(originalName).slice(1)).toLowerCase()
  if (!filePath || !originalName || !fileType) throw new Error('上传文件信息不完整')
  return {
    filename: String(file.filename || path.basename(filePath)),
    originalName,
    fileType,
    size: Math.max(0, Number(file.size) || 0),
    path: filePath
  }
}

function mapDocument(row) {
  return {
    id: Number(row.id),
    filename: row.filename || row.original_name,
    originalName: row.original_name || row.originalName,
    fileType: row.file_type || row.fileType,
    size: Number(row.file_size ?? row.size ?? 0),
    status: Number(row.status),
    statusName: getDocumentStatusName(row.status)
  }
}

function mapJob(row, fallback = {}) {
  // 当查询同时包含 documents 与 document_jobs 时，任务列使用 job_* 别名，必须优先读取它们。
  const id = Number(row.job_id ?? row.id ?? fallback.id)
  const status = String(row.job_status ?? row.status ?? fallback.status ?? 'queued')
  return {
    id,
    documentId: Number(row.document_id ?? fallback.documentId),
    status,
    progress: clampProgress(row.job_progress ?? row.progress ?? fallback.progress ?? 0),
    stage: String(row.job_stage ?? row.stage ?? fallback.stage ?? 'queued'),
    attemptsMade: Number(row.job_attempts_made ?? row.attempts_made ?? fallback.attemptsMade ?? 0),
    maxAttempts: Number(row.job_max_attempts ?? row.max_attempts ?? fallback.maxAttempts ?? 3),
    cancelRequested: Boolean(Number(row.cancel_requested ?? fallback.cancelRequested ?? 0)),
    errorMessage: row.error_message ?? row.job_error_message ?? fallback.errorMessage ?? null,
    queueJobId: String(row.queue_job_id ?? fallback.queueJobId ?? getDocumentQueueJobId(id))
  }
}

function maxAttempts() {
  const value = Number(process.env.DOCUMENT_JOB_MAX_ATTEMPTS)
  return Number.isInteger(value) && value > 0 ? value : 3
}

function isSafeUploadPath(filePath, uploadDir) {
  const root = path.resolve(uploadDir)
  const target = path.resolve(filePath)
  return target.startsWith(root + path.sep)
}

async function removeDuplicateUpload(filePath, uploadDir) {
  if (!isSafeUploadPath(filePath, uploadDir)) return false
  try {
    await fs.promises.unlink(filePath)
    return true
  } catch (error) {
    if (error?.code === 'ENOENT') return false
    throw error
  }
}

export function createDocumentJobService({
  pool: databasePool = pool,
  enqueueDocumentJob: enqueue = enqueueDocumentJob,
  removeQueuedDocumentJob: removeQueued = removeQueuedDocumentJob,
  invalidateAllChunks: invalidate = invalidateAllChunks,
  uploadDir = path.resolve(process.env.UPLOAD_DIR || './uploads'),
  hashFile = hashDocumentFile
} = {}) {
  async function enqueuePersistedJob(job) {
    try {
      await enqueue({ id: job.id, documentId: job.documentId, userId: job.userId, jobType: job.jobType })
      return { queued: true }
    } catch {
      await databasePool.query(
        `UPDATE document_jobs SET error_message = ? WHERE id = ? AND status = 'queued'`,
        [QUEUE_UNAVAILABLE_MESSAGE, job.id]
      ).catch(() => {})
      return { queued: false, error: QUEUE_UNAVAILABLE_MESSAGE }
    }
  }

  async function createUploadJob({ userId, file }) {
    const normalizedFile = normalizeFile(file)
    const fileHash = await hashFile(normalizedFile.path)
    const connection = await databasePool.getConnection()
    let transactionOpen = false
    try {
      await connection.beginTransaction()
      transactionOpen = true
      const [duplicates] = await connection.query(
        `SELECT d.id, d.original_name, d.file_type, d.file_size, d.status,
                j.id AS job_id, j.status AS job_status, j.progress AS job_progress,
                j.stage AS job_stage, j.error_message AS job_error_message, j.queue_job_id
         FROM documents d
         LEFT JOIN document_jobs j ON j.id = (
           SELECT latest.id FROM document_jobs latest
           WHERE latest.document_id = d.id ORDER BY latest.id DESC LIMIT 1
         )
         WHERE d.user_id = ? AND d.file_hash = ?
         LIMIT 1 FOR UPDATE`,
        [userId, fileHash]
      )
      if (duplicates.length > 0) {
        await connection.rollback()
        transactionOpen = false
        await removeDuplicateUpload(normalizedFile.path, uploadDir)
        const duplicate = duplicates[0]
        return {
          duplicated: true,
          document: mapDocument(duplicate),
          job: mapJob(duplicate, { documentId: duplicate.id })
        }
      }

      const [documentResult] = await connection.query(
        `INSERT INTO documents
         (user_id, filename, original_name, file_type, file_size, file_path, file_hash, status, processing_started_at, error_message)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)`,
        [userId, normalizedFile.filename, normalizedFile.originalName, normalizedFile.fileType, normalizedFile.size, normalizedFile.path, fileHash, DOCUMENT_STATUS.queued]
      )
      const documentId = Number(documentResult.insertId)
      const [jobResult] = await connection.query(
        `INSERT INTO document_jobs
         (document_id, user_id, job_type, status, progress, stage, max_attempts)
         VALUES (?, ?, 'parse', 'queued', 0, 'queued', ?)`,
        [documentId, userId, maxAttempts()]
      )
      const jobId = Number(jobResult.insertId)
      await connection.query('UPDATE document_jobs SET queue_job_id = ? WHERE id = ?', [getDocumentQueueJobId(jobId), jobId])
      await connection.commit()
      transactionOpen = false

      const document = {
        id: documentId,
        filename: normalizedFile.filename,
        originalName: normalizedFile.originalName,
        fileType: normalizedFile.fileType,
        size: normalizedFile.size,
        status: DOCUMENT_STATUS.queued,
        statusName: 'queued'
      }
      const job = {
        id: jobId,
        documentId,
        userId: Number(userId),
        jobType: 'parse',
        status: 'queued',
        progress: 0,
        stage: 'queued',
        attemptsMade: 0,
        maxAttempts: maxAttempts(),
        cancelRequested: false,
        errorMessage: null,
        queueJobId: getDocumentQueueJobId(jobId)
      }
      const enqueueResult = await enqueuePersistedJob(job)
      return { duplicated: false, document, job: { ...job, queueAvailable: enqueueResult.queued }, queueError: enqueueResult.error }
    } catch (error) {
      if (transactionOpen) await connection.rollback()
      throw error
    } finally {
      connection.release()
    }
  }

  async function getOwnedDocument(connection, userId, documentId, { lock = false } = {}) {
    const [rows] = await connection.query(
      `SELECT d.id, d.user_id, d.original_name, d.file_type, d.file_size, d.file_path, d.status,
              j.id AS job_id, j.status AS job_status, j.progress AS job_progress, j.stage AS job_stage,
              j.cancel_requested, j.error_message AS job_error_message, j.queue_job_id, j.attempts_made, j.max_attempts
       FROM documents d
       LEFT JOIN document_jobs j ON j.id = (
         SELECT latest.id FROM document_jobs latest WHERE latest.document_id = d.id ORDER BY latest.id DESC LIMIT 1
       )
       WHERE d.id = ? AND d.user_id = ? LIMIT 1${lock ? ' FOR UPDATE' : ''}`,
      [documentId, userId]
    )
    return rows[0] || null
  }

  async function createReparseJob({ userId, documentId, jobType = 'reparse', retry = false }) {
    const connection = await databasePool.getConnection()
    let transactionOpen = false
    try {
      await connection.beginTransaction()
      transactionOpen = true
      const document = await getOwnedDocument(connection, userId, documentId, { lock: true })
      if (!document) {
        await connection.rollback()
        transactionOpen = false
        return null
      }
      if (ACTIVE_JOB_STATUSES.includes(String(document.job_status))) {
        const error = new Error('文档正在处理中，请勿重复提交')
        error.code = 'DOCUMENT_JOB_ACTIVE'
        throw error
      }
      if (retry && ![DOCUMENT_STATUS.failed, DOCUMENT_STATUS.cancelled].includes(Number(document.status))) {
        const error = new Error('仅失败或已取消的文档可以重试')
        error.code = 'DOCUMENT_NOT_RETRYABLE'
        throw error
      }
      if (!fs.existsSync(document.file_path)) {
        const error = new Error('原始文件已不存在，无法重新解析')
        error.code = 'DOCUMENT_SOURCE_MISSING'
        throw error
      }
      await connection.query(
        'UPDATE documents SET status = ?, processing_started_at = NULL, error_message = NULL WHERE id = ?',
        [DOCUMENT_STATUS.queued, document.id]
      )
      const [jobResult] = await connection.query(
        `INSERT INTO document_jobs
         (document_id, user_id, job_type, status, progress, stage, max_attempts)
         VALUES (?, ?, ?, 'queued', 0, 'queued', ?)`,
        [document.id, userId, jobType, maxAttempts()]
      )
      const jobId = Number(jobResult.insertId)
      await connection.query('UPDATE document_jobs SET queue_job_id = ? WHERE id = ?', [getDocumentQueueJobId(jobId), jobId])
      await connection.commit()
      transactionOpen = false
      invalidate()

      const job = {
        id: jobId,
        documentId: Number(document.id),
        userId: Number(userId),
        jobType,
        status: 'queued',
        progress: 0,
        stage: 'queued',
        attemptsMade: 0,
        maxAttempts: maxAttempts(),
        cancelRequested: false,
        errorMessage: null,
        queueJobId: getDocumentQueueJobId(jobId)
      }
      const enqueueResult = await enqueuePersistedJob(job)
      return { document: mapDocument({ ...document, status: DOCUMENT_STATUS.queued }), job: { ...job, queueAvailable: enqueueResult.queued }, queueError: enqueueResult.error }
    } catch (error) {
      if (transactionOpen) await connection.rollback()
      throw error
    } finally {
      connection.release()
    }
  }

  async function createRetryJob(input) {
    return createReparseJob({ ...input, jobType: 'retry', retry: true })
  }

  async function getLatestJob({ userId, documentId }) {
    const [rows] = await databasePool.query(
      `SELECT j.* FROM document_jobs j
       JOIN documents d ON d.id = j.document_id
       WHERE j.document_id = ? AND d.user_id = ?
       ORDER BY j.id DESC LIMIT 1`,
      [documentId, userId]
    )
    return rows[0] ? mapJob(rows[0]) : null
  }

  async function getProcessingInput({ jobId }) {
    const [rows] = await databasePool.query(
      `SELECT j.id, j.document_id, j.user_id, j.job_type, j.cancel_requested,
              d.file_path, d.file_type
       FROM document_jobs j
       JOIN documents d ON d.id = j.document_id
       WHERE j.id = ? AND j.status IN ('queued', 'processing')
       LIMIT 1`,
      [jobId]
    )
    const row = rows[0]
    if (!row) return null
    return {
      jobId: Number(row.id),
      documentId: Number(row.document_id),
      userId: Number(row.user_id),
      jobType: row.job_type,
      cancelRequested: Boolean(Number(row.cancel_requested || 0)),
      filePath: row.file_path,
      fileType: row.file_type
    }
  }

  async function requestCancel({ userId, documentId }) {
    const connection = await databasePool.getConnection()
    let transactionOpen = false
    try {
      await connection.beginTransaction()
      transactionOpen = true
      const document = await getOwnedDocument(connection, userId, documentId, { lock: true })
      if (!document || !document.job_id) {
        await connection.rollback()
        transactionOpen = false
        return null
      }
      const job = mapJob(document, { documentId: document.id })
      if (TERMINAL_JOB_STATUSES.includes(job.status)) {
        await connection.rollback()
        transactionOpen = false
        return { document: mapDocument(document), job, pending: false }
      }
      const immediatelyCancelled = job.status === 'queued'
      await connection.query(
        `UPDATE document_jobs
         SET cancel_requested = 1, status = ?, stage = ?, progress = ?, finished_at = CASE WHEN ? THEN NOW() ELSE finished_at END
         WHERE id = ?`,
        [immediatelyCancelled ? 'cancelled' : 'processing', immediatelyCancelled ? 'cancelled' : job.stage, immediatelyCancelled ? job.progress : job.progress, immediatelyCancelled, job.id]
      )
      if (immediatelyCancelled) {
        await connection.query(
          'UPDATE documents SET status = ?, processing_started_at = NULL, error_message = NULL WHERE id = ?',
          [DOCUMENT_STATUS.cancelled, document.id]
        )
      }
      await connection.commit()
      transactionOpen = false
      invalidate()
      if (immediatelyCancelled) {
        // 数据库中的取消结果已经提交；Redis 暂不可用时由后续协调清理旧队列项。
        await removeQueued(job.queueJobId).catch(() => {})
      }
      return {
        document: mapDocument({ ...document, status: immediatelyCancelled ? DOCUMENT_STATUS.cancelled : document.status }),
        job: { ...job, status: immediatelyCancelled ? 'cancelled' : 'processing', cancelRequested: true },
        pending: !immediatelyCancelled
      }
    } catch (error) {
      if (transactionOpen) await connection.rollback()
      throw error
    } finally {
      connection.release()
    }
  }

  async function isCancelRequested(jobId) {
    const [rows] = await databasePool.query('SELECT cancel_requested FROM document_jobs WHERE id = ? LIMIT 1', [jobId])
    return Boolean(Number(rows[0]?.cancel_requested || 0))
  }

  async function markProcessing({ jobId, documentId, attemptsMade = 0 }) {
    const [jobResult] = await databasePool.query(
      `UPDATE document_jobs SET status = 'processing', stage = 'parsing', progress = GREATEST(progress, 5),
       attempts_made = ?, started_at = COALESCE(started_at, NOW()), error_message = NULL WHERE id = ? AND cancel_requested = 0`,
      [attemptsMade, jobId]
    )
    if (!jobResult.affectedRows) return false
    await databasePool.query(
      'UPDATE documents SET status = ?, processing_started_at = NOW(), error_message = NULL WHERE id = ?',
      [DOCUMENT_STATUS.processing, documentId]
    )
    return true
  }

  async function reportProgress({ jobId, stage, progress }) {
    await databasePool.query(
      `UPDATE document_jobs SET stage = ?, progress = GREATEST(progress, ?) WHERE id = ? AND cancel_requested = 0`,
      [stage, clampProgress(progress), jobId]
    )
  }

  async function markCompleted({ jobId, documentId, content, chunkCount, metadata = null }) {
    const connection = await databasePool.getConnection()
    let transactionOpen = false
    try {
      await connection.beginTransaction()
      transactionOpen = true
      // 先原子领取“完成”状态。取消若已提交，就绝不能被完成写入覆盖。
      const [jobResult] = await connection.query(
        `UPDATE document_jobs SET status = 'completed', stage = 'finalizing', progress = 100, finished_at = NOW(), error_message = NULL
         WHERE id = ? AND status = 'processing' AND cancel_requested = 0`,
        [jobId]
      )
      if (!jobResult.affectedRows) {
        await connection.rollback()
        transactionOpen = false
        return false
      }
      if (metadata) {
        await connection.query(
          `UPDATE documents SET content = ?, chunk_count = ?, status = ?, processing_started_at = NULL, error_message = NULL,
           mineru_task_id = ?, mineru_batch_id = ?, mineru_zip_url = ?, mineru_pages = ?, mineru_model = ? WHERE id = ?`,
          [content, chunkCount, DOCUMENT_STATUS.completed, metadata.task_id, metadata.batch_id, metadata.zip_url, metadata.pages, metadata.model, documentId]
        )
      } else {
        await connection.query(
          'UPDATE documents SET content = ?, chunk_count = ?, status = ?, processing_started_at = NULL, error_message = NULL WHERE id = ?',
          [content, chunkCount, DOCUMENT_STATUS.completed, documentId]
        )
      }
      await connection.commit()
      transactionOpen = false
      invalidate()
      return true
    } catch (error) {
      if (transactionOpen) await connection.rollback()
      throw error
    } finally {
      connection.release()
    }
  }

  async function markFailed({ jobId, documentId, error }) {
    const safeError = sanitizeDocumentJobError(error)
    const [jobResult] = await databasePool.query(
      `UPDATE document_jobs SET status = 'failed', stage = 'failed', finished_at = NOW(), error_message = ?
       WHERE id = ? AND status IN ('queued', 'processing') AND cancel_requested = 0`,
      [safeError, jobId]
    )
    if (!jobResult.affectedRows) return false
    await databasePool.query(
      'UPDATE documents SET status = ?, processing_started_at = NULL, error_message = ? WHERE id = ?',
      [DOCUMENT_STATUS.failed, safeError, documentId]
    )
    invalidate()
    return true
  }

  async function markRetrying({ jobId, documentId, error }) {
    const safeError = sanitizeDocumentJobError(error)
    const connection = await databasePool.getConnection()
    let transactionOpen = false
    try {
      await connection.beginTransaction()
      transactionOpen = true
      const [jobResult] = await connection.query(
        `UPDATE document_jobs SET status = 'queued', stage = 'queued', progress = 0, error_message = ?
         WHERE id = ? AND status = 'processing' AND cancel_requested = 0`,
        [safeError, jobId]
      )
      if (!jobResult.affectedRows) {
        await connection.rollback()
        transactionOpen = false
        return false
      }
      await connection.query(
        `UPDATE documents d
         JOIN document_jobs j ON j.document_id = d.id
         SET d.status = ?, d.processing_started_at = NULL, d.error_message = ?
         WHERE d.id = ? AND j.id = ? AND j.status = 'queued' AND j.cancel_requested = 0`,
        [DOCUMENT_STATUS.queued, safeError, documentId, jobId]
      )
      await connection.commit()
      transactionOpen = false
      invalidate()
      return true
    } catch (error) {
      if (transactionOpen) await connection.rollback()
      throw error
    } finally {
      connection.release()
    }
  }

  async function markCancelled({ jobId, documentId }) {
    const [jobResult] = await databasePool.query(
      `UPDATE document_jobs SET status = 'cancelled', stage = 'cancelled', finished_at = NOW(), error_message = NULL
       WHERE id = ? AND status IN ('queued', 'processing') AND cancel_requested = 1`,
      [jobId]
    )
    if (!jobResult.affectedRows) return false
    await databasePool.query(
      'UPDATE documents SET status = ?, processing_started_at = NULL, error_message = NULL WHERE id = ?',
      [DOCUMENT_STATUS.cancelled, documentId]
    )
    invalidate()
    return true
  }

  async function reconcileQueuedJobs() {
    const [rows] = await databasePool.query(
      `SELECT id, document_id, user_id, job_type
       FROM document_jobs WHERE status = 'queued' AND cancel_requested = 0 ORDER BY id ASC`
    )
    const results = []
    for (const row of rows) {
      const job = { id: Number(row.id), documentId: Number(row.document_id), userId: Number(row.user_id), jobType: row.job_type }
      await databasePool.query(
        `UPDATE document_jobs SET queue_job_id = ? WHERE id = ? AND (queue_job_id IS NULL OR queue_job_id = ?)`,
        [getDocumentQueueJobId(job.id), job.id, String(job.id)]
      )
      results.push({ id: job.id, ...(await enqueuePersistedJob(job)) })
    }
    return results
  }

  return {
    createUploadJob,
    createReparseJob,
    createRetryJob,
    getLatestJob,
    getProcessingInput,
    requestCancel,
    isCancelRequested,
    markProcessing,
    reportProgress,
    markCompleted,
    markFailed,
    markRetrying,
    markCancelled,
    reconcileQueuedJobs
  }
}

const documentJobService = createDocumentJobService()

export const createUploadJob = documentJobService.createUploadJob
export const createReparseJob = documentJobService.createReparseJob
export const createRetryJob = documentJobService.createRetryJob
export const getLatestDocumentJob = documentJobService.getLatestJob
export const getDocumentJobProcessingInput = documentJobService.getProcessingInput
export const requestDocumentJobCancel = documentJobService.requestCancel
export const isDocumentJobCancelRequested = documentJobService.isCancelRequested
export const markDocumentJobProcessing = documentJobService.markProcessing
export const reportDocumentJobProgress = documentJobService.reportProgress
export const completeDocumentJob = documentJobService.markCompleted
export const failDocumentJob = documentJobService.markFailed
export const retryDocumentJob = documentJobService.markRetrying
export const cancelDocumentJob = documentJobService.markCancelled
export const reconcileQueuedDocumentJobs = documentJobService.reconcileQueuedJobs
