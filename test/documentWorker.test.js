import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createDocumentWorkerFailureHandler,
  createDocumentWorkerProcessor,
  getDocumentWorkerConcurrency,
  shouldDiscardDocumentJobFailure
} from '../server/workers/documentWorker.js'

test('Worker 先把数据库状态设为处理中，再完成文档任务', async () => {
  const calls = []
  const processor = createDocumentWorkerProcessor({
    jobService: {
      getProcessingInput: async () => ({ jobId: 12, documentId: 5, userId: 3, filePath: 'fixture.md', fileType: 'md', cancelRequested: false }),
      markProcessing: async input => calls.push(['processing', input]),
      isCancelRequested: async () => false,
      markCompleted: async input => calls.push(['completed', input]),
      markCancelled: async input => calls.push(['cancelled', input]),
      markFailed: async input => calls.push(['failed', input])
    },
    processor: { process: async () => ({ content: '正文', chunkCount: 1, metadata: null }) }
  })

  await processor({ data: { documentJobId: 12 }, attemptsMade: 1, discard: () => calls.push(['discard']) })
  assert.equal(calls[0][0], 'processing')
  assert.equal(calls[1][0], 'completed')
})

test('Worker 未领取到已取消任务时不再启动解析', async () => {
  let processCalls = 0
  const calls = []
  const workerProcessor = createDocumentWorkerProcessor({
    jobService: {
      getProcessingInput: async () => ({ jobId: 13, documentId: 6, userId: 3, filePath: 'fixture.md', fileType: 'md', cancelRequested: false }),
      markProcessing: async () => false,
      isCancelRequested: async () => false,
      markCancelled: async input => calls.push(input),
      markCompleted: async () => { throw new Error('不应完成已取消任务') },
      markFailed: async () => { throw new Error('不应标记失败') }
    },
    processor: { process: async () => { processCalls++; return { content: '正文', chunkCount: 1 } } }
  })

  await workerProcessor({ data: { documentJobId: 13 }, attemptsMade: 0, discard: () => {} })
  assert.equal(processCalls, 0)
  assert.deepEqual(calls, [{ jobId: 13, documentId: 6 }])
})

test('完成落库遇到取消竞争时，Worker 保留取消结果', async () => {
  const calls = []
  const workerProcessor = createDocumentWorkerProcessor({
    jobService: {
      getProcessingInput: async () => ({ jobId: 14, documentId: 7, userId: 3, filePath: 'fixture.md', fileType: 'md', cancelRequested: false }),
      markProcessing: async () => true,
      isCancelRequested: async () => false,
      markCompleted: async () => false,
      markCancelled: async input => calls.push(input),
      markFailed: async () => { throw new Error('不应标记失败') }
    },
    processor: { process: async () => ({ content: '正文', chunkCount: 1 }) }
  })

  await workerProcessor({ data: { documentJobId: 14 }, attemptsMade: 0, discard: () => {} })
  assert.deepEqual(calls, [{ jobId: 14, documentId: 7 }])
})

test('BullMQ 最终失败事件会把仍活跃的数据库任务收敛为失败', async () => {
  const calls = []
  const handleFailure = createDocumentWorkerFailureHandler({
    markFailed: async input => calls.push(input)
  })

  await handleFailure({
    data: { documentJobId: 15, documentId: 8 },
    getState: async () => 'failed'
  }, new Error('worker exited'))
  await handleFailure({
    data: { documentJobId: 16, documentId: 9 },
    getState: async () => 'delayed'
  }, new Error('will retry'))

  assert.equal(calls.length, 1)
  assert.equal(calls[0].jobId, 15)
  assert.equal(calls[0].documentId, 8)
})

test('失败写入与取消竞争时，Worker 最终收敛为已取消', async () => {
  const calls = []
  let cancelChecks = 0
  const workerProcessor = createDocumentWorkerProcessor({
    jobService: {
      getProcessingInput: async () => ({ jobId: 17, documentId: 10, userId: 3, filePath: 'fixture.md', fileType: 'md', cancelRequested: false }),
      markProcessing: async () => true,
      isCancelRequested: async () => ++cancelChecks >= 3,
      markCompleted: async () => { throw new Error('不应完成失败任务') },
      markFailed: async () => false,
      markCancelled: async input => calls.push(input),
      markRetrying: async () => { throw new Error('不应重试已取消任务') }
    },
    processor: { process: async () => { throw new Error('parser failed') } }
  })

  await workerProcessor({ data: { documentJobId: 17 }, attemptsMade: 2, opts: { attempts: 3 }, discard: () => {} })
  assert.deepEqual(calls, [{ jobId: 17, documentId: 10 }])
})

test('最终失败同步若发现取消请求，也会收敛为已取消', async () => {
  const calls = []
  const handleFailure = createDocumentWorkerFailureHandler({
    markFailed: async () => false,
    isCancelRequested: async () => true,
    markCancelled: async input => calls.push(input)
  })

  await handleFailure({
    data: { documentJobId: 18, documentId: 11 },
    getState: async () => 'failed'
  }, new Error('worker exited'))

  assert.deepEqual(calls, [{ jobId: 18, documentId: 11 }])
})

test('自动重试未领取到任务且检测到取消时，Worker 收敛为已取消', async () => {
  const calls = []
  let cancelChecks = 0
  const workerProcessor = createDocumentWorkerProcessor({
    jobService: {
      getProcessingInput: async () => ({ jobId: 19, documentId: 12, userId: 3, filePath: 'fixture.md', fileType: 'md', cancelRequested: false }),
      markProcessing: async () => true,
      isCancelRequested: async () => ++cancelChecks >= 3,
      markCompleted: async () => { throw new Error('不应完成失败任务') },
      markFailed: async () => { throw new Error('不应进入最终失败') },
      markRetrying: async () => false,
      markCancelled: async input => calls.push(input)
    },
    processor: { process: async () => { throw new Error('temporary parser error') } }
  })

  await workerProcessor({ data: { documentJobId: 19 }, attemptsMade: 0, opts: { attempts: 3 }, discard: () => {} })
  assert.deepEqual(calls, [{ jobId: 19, documentId: 12 }])
})

test('Worker 配置至少保留一个并发，确定性错误不重试', () => {
  assert.equal(getDocumentWorkerConcurrency(), 2)
  assert.equal(getDocumentWorkerConcurrency('0'), 1)
  assert.equal(getDocumentWorkerConcurrency('3'), 3)
  assert.equal(shouldDiscardDocumentJobFailure({ code: 'DOCUMENT_EMPTY' }), true)
  assert.equal(shouldDiscardDocumentJobFailure({ code: 'ECONNRESET' }), false)
})
