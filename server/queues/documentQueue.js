import IORedis from 'ioredis'
import { Queue } from 'bullmq'

export const DOCUMENT_QUEUE_NAME = 'document-parse'
const DEFAULT_REDIS_URL = 'redis://127.0.0.1:6379'

let queue = null
let queueConnection = null

export function parseRedisUrl(value) {
  const url = new URL(String(value || DEFAULT_REDIS_URL).trim() || DEFAULT_REDIS_URL)
  if (!['redis:', 'rediss:'].includes(url.protocol)) {
    throw new Error('REDIS_URL 必须使用 redis:// 或 rediss:// 协议')
  }
  return url
}

export function getDocumentJobMaxAttempts() {
  const value = Number(process.env.DOCUMENT_JOB_MAX_ATTEMPTS)
  return Number.isInteger(value) && value > 0 ? value : 3
}

export function getDocumentQueueTimeoutMs(value = process.env.DOCUMENT_QUEUE_TIMEOUT_MS) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 5000
}

export async function withDocumentQueueTimeout(operation, timeoutMs = getDocumentQueueTimeoutMs()) {
  let timer = null
  try {
    return await Promise.race([
      Promise.resolve(operation),
      new Promise((resolve, reject) => {
        timer = setTimeout(() => reject(new Error('Redis 队列响应超时')), timeoutMs)
      })
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

// BullMQ 6 不接受纯数字的自定义 jobId；该前缀仍让数据库任务 ID 保持可预测。
export function getDocumentQueueJobId(jobId) {
  const normalized = String(jobId)
  return normalized.startsWith('document-') ? normalized : `document-${normalized}`
}

export function buildDocumentJobOptions(jobId) {
  return {
    jobId: getDocumentQueueJobId(jobId),
    attempts: getDocumentJobMaxAttempts(),
    backoff: { type: 'exponential', delay: 10_000 },
    removeOnComplete: 1000,
    removeOnFail: false
  }
}

export function createRedisConnection() {
  return new IORedis(parseRedisUrl(process.env.REDIS_URL).toString(), {
    maxRetriesPerRequest: null,
    enableReadyCheck: true
  })
}

export function createRedisReadinessConnection(createClient = (url, options) => new IORedis(url, options)) {
  return createClient(parseRedisUrl(process.env.REDIS_URL).toString(), {
    maxRetriesPerRequest: 0,
    enableReadyCheck: true,
    lazyConnect: true,
    retryStrategy: () => null
  })
}

export async function checkRedisReadiness({
  createConnection = createRedisReadinessConnection,
  timeoutMs = getDocumentQueueTimeoutMs()
} = {}) {
  const connection = createConnection()
  try {
    await withDocumentQueueTimeout(connection.connect(), timeoutMs)
    const response = await withDocumentQueueTimeout(connection.ping(), timeoutMs)
    if (response !== 'PONG') throw new Error('Redis 未返回 PONG')
    return true
  } finally {
    try { connection.disconnect() } catch {}
  }
}

export function getDocumentQueue() {
  if (queue) return queue
  queueConnection = createRedisConnection()
  queue = new Queue(DOCUMENT_QUEUE_NAME, { connection: queueConnection })
  return queue
}

export async function enqueueDocumentJob(job) {
  if (!job?.id || !job?.documentId || !job?.userId) {
    throw new Error('文档任务缺少必要信息')
  }
  return withDocumentQueueTimeout(
    getDocumentQueue().add(
      DOCUMENT_QUEUE_NAME,
      {
        documentJobId: Number(job.id),
        documentId: Number(job.documentId),
        userId: Number(job.userId),
        jobType: job.jobType || 'parse'
      },
      buildDocumentJobOptions(job.id)
    )
  )
}

export async function removeQueuedDocumentJob(jobId) {
  const job = await withDocumentQueueTimeout(getDocumentQueue().getJob(getDocumentQueueJobId(jobId)))
  if (!job) return false
  const state = await withDocumentQueueTimeout(job.getState())
  if (!['waiting', 'paused', 'delayed', 'prioritized'].includes(state)) return false
  await withDocumentQueueTimeout(job.remove())
  return true
}

export async function closeDocumentQueue() {
  const closingQueue = queue
  const closingConnection = queueConnection
  queue = null
  queueConnection = null
  if (closingQueue) await closingQueue.close()
  if (closingConnection) await closingConnection.quit()
}
