import dotenv from 'dotenv'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { Worker } from 'bullmq'
import { DOCUMENT_QUEUE_NAME, createRedisConnection } from '../queues/documentQueue.js'
import { assertRuntimeConfig } from '../config/runtimeConfig.js'
import { parseWithMineru } from '../services/mineruParser.js'
import { parseDocument } from '../services/documentParser.js'
import { chunkDocument, invalidateAllChunks, parseFrontMatter, storeDocumentChunks } from '../services/chunkStore.js'
import {
  cancelDocumentJob,
  completeDocumentJob,
  failDocumentJob,
  getDocumentJobProcessingInput,
  isDocumentJobCancelRequested,
  markDocumentJobProcessing,
  reportDocumentJobProgress,
  retryDocumentJob
} from '../services/documentJobService.js'
import { createDocumentProcessor } from '../services/documentProcessingService.js'

dotenv.config()

const DETERMINISTIC_ERROR_CODES = new Set([
  'DOCUMENT_EMPTY',
  'DOCUMENT_UNSUPPORTED',
  'DOCUMENT_JOB_CANCELLED',
  'DOCUMENT_SOURCE_MISSING'
])

export function getDocumentWorkerConcurrency(value = process.env.DOCUMENT_WORKER_CONCURRENCY) {
  if (value === undefined || value === null || value === '') return 2
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1
}

export function shouldDiscardDocumentJobFailure(error) {
  return DETERMINISTIC_ERROR_CODES.has(String(error?.code || '')) || error?.retryable === false
}

function isLastAttempt(job) {
  const configuredAttempts = Math.max(1, Number(job?.opts?.attempts) || 1)
  return Number(job?.attemptsMade || 0) + 1 >= configuredAttempts
}

export function createDocumentWorkerFailureHandler({
  markFailed,
  isCancelRequested = async () => false,
  markCancelled = async () => false
}) {
  return async function handleBullJobFailure(bullJob, error) {
    const jobId = Number(bullJob?.data?.documentJobId)
    const documentId = Number(bullJob?.data?.documentId)
    if (!Number.isSafeInteger(jobId) || jobId <= 0 || !Number.isSafeInteger(documentId) || documentId <= 0) return
    const state = await bullJob.getState()
    if (state !== 'failed') return
    const failed = await markFailed({ jobId, documentId, error })
    if (!failed && await isCancelRequested(jobId)) {
      await markCancelled({ jobId, documentId })
    }
  }
}

export function createDocumentWorkerProcessor({ jobService, processor }) {
  return async function processBullJob(bullJob) {
    const jobId = Number(bullJob?.data?.documentJobId)
    if (!Number.isSafeInteger(jobId) || jobId <= 0) throw new Error('队列任务缺少 documentJobId')

    const input = await jobService.getProcessingInput({ jobId })
    if (!input) return
    if (input.cancelRequested || await jobService.isCancelRequested(jobId)) {
      await jobService.markCancelled({ jobId, documentId: input.documentId })
      return
    }

    const claimed = await jobService.markProcessing({ jobId, documentId: input.documentId, attemptsMade: Number(bullJob.attemptsMade || 0) + 1 })
    if (!claimed) {
      await jobService.markCancelled({ jobId, documentId: input.documentId })
      return
    }
    try {
      const result = await processor.process(input)
      if (await jobService.isCancelRequested(jobId)) {
        await jobService.markCancelled({ jobId, documentId: input.documentId })
        return
      }
      const completed = await jobService.markCompleted({ jobId, documentId: input.documentId, ...result })
      if (!completed) await jobService.markCancelled({ jobId, documentId: input.documentId })
    } catch (error) {
      if (error?.code === 'DOCUMENT_JOB_CANCELLED' || await jobService.isCancelRequested(jobId)) {
        await jobService.markCancelled({ jobId, documentId: input.documentId })
        return
      }
      if (shouldDiscardDocumentJobFailure(error)) bullJob.discard()
      if (shouldDiscardDocumentJobFailure(error) || isLastAttempt(bullJob)) {
        const failed = await jobService.markFailed({ jobId, documentId: input.documentId, error })
        if (!failed && await jobService.isCancelRequested(jobId)) {
          await jobService.markCancelled({ jobId, documentId: input.documentId })
          return
        }
      } else {
        const queued = await jobService.markRetrying({ jobId, documentId: input.documentId, error })
        if (!queued && await jobService.isCancelRequested(jobId)) {
          await jobService.markCancelled({ jobId, documentId: input.documentId })
          return
        }
      }
      throw error
    }
  }
}

const defaultJobService = {
  getProcessingInput: getDocumentJobProcessingInput,
  markProcessing: markDocumentJobProcessing,
  isCancelRequested: isDocumentJobCancelRequested,
  markCompleted: completeDocumentJob,
  markCancelled: cancelDocumentJob,
  markFailed: failDocumentJob,
  markRetrying: retryDocumentJob
}

const defaultProcessor = createDocumentProcessor({
  parseWithMineru,
  parseDocument,
  readTextFile: fs.promises.readFile,
  parseFrontMatter,
  chunkDocument,
  storeDocumentChunks,
  invalidateAllChunks,
  reportProgress: reportDocumentJobProgress,
  isCancelRequested: isDocumentJobCancelRequested
})

export async function startDocumentWorker() {
  assertRuntimeConfig()
  const connection = createRedisConnection()
  const worker = new Worker(
    DOCUMENT_QUEUE_NAME,
    createDocumentWorkerProcessor({ jobService: defaultJobService, processor: defaultProcessor }),
    { connection, concurrency: getDocumentWorkerConcurrency(), maxStalledCount: 1 }
  )
  const handleFinalFailure = createDocumentWorkerFailureHandler({
    markFailed: failDocumentJob,
    isCancelRequested: isDocumentJobCancelRequested,
    markCancelled: cancelDocumentJob
  })
  worker.on('failed', (job, error) => {
    handleFinalFailure(job, error).catch(syncError => console.error('[document-worker] 失败状态同步失败:', syncError.message))
  })
  worker.on('error', error => console.error('[document-worker]', error.message))
  await worker.waitUntilReady()
  return worker
}

async function runWorkerProcess() {
  const worker = await startDocumentWorker()
  console.log(`[document-worker] 已连接队列 ${DOCUMENT_QUEUE_NAME}，并发数 ${getDocumentWorkerConcurrency()}`)
  let closing = false
  const close = async signal => {
    if (closing) return
    closing = true
    console.log(`[document-worker] 收到 ${signal}，正在停止接收新任务...`)
    await worker.close()
    await worker.opts.connection.quit()
    process.exit(0)
  }
  process.on('SIGINT', () => close('SIGINT').catch(error => { console.error(error); process.exit(1) }))
  process.on('SIGTERM', () => close('SIGTERM').catch(error => { console.error(error); process.exit(1) }))
}

const invokedAsScript = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
if (invokedAsScript) {
  runWorkerProcess().catch(error => {
    console.error('[document-worker] 启动失败:', error.message)
    process.exit(1)
  })
}
