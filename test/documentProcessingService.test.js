import test from 'node:test'
import assert from 'node:assert/strict'
import { createDocumentProcessor } from '../server/services/documentProcessingService.js'

function createDependencies(overrides = {}) {
  return {
    parseDocument: async () => '正文',
    parseWithMineru: async () => { throw new Error('unused') },
    readTextFile: async () => '正文',
    parseFrontMatter: text => ({ body: text, metadata: {} }),
    chunkDocument: () => ['正文'],
    storeDocumentChunks: async () => 1,
    invalidateAllChunks: () => {},
    reportProgress: async () => {},
    isCancelRequested: async () => false,
    ...overrides
  }
}

test('处理器按 parse、chunk、embed 顺序记录真实进度', async () => {
  const calls = []
  const processor = createDocumentProcessor(createDependencies({
    reportProgress: async ({ stage, progress }) => calls.push([stage, progress])
  }))

  const result = await processor.process({
    jobId: 1, documentId: 9, userId: 2, filePath: 'fixture.docx', fileType: 'docx'
  })

  assert.equal(result.content, '正文')
  assert.equal(result.chunkCount, 1)
  assert.deepEqual(calls, [['parsing', 20], ['chunking', 55], ['embedding', 75], ['finalizing', 100]])
})

test('取消请求会在下一安全边界阻止写入向量', async () => {
  let checks = 0
  let writes = 0
  const processor = createDocumentProcessor(createDependencies({
    isCancelRequested: async () => ++checks >= 2,
    storeDocumentChunks: async () => { writes++; return 1 }
  }))

  await assert.rejects(
    processor.process({ jobId: 2, documentId: 10, userId: 2, filePath: 'fixture.docx', fileType: 'docx' }),
    error => error.code === 'DOCUMENT_JOB_CANCELLED'
  )
  assert.equal(writes, 0)
})

test('空文本会停止任务并给出可分类错误', async () => {
  const processor = createDocumentProcessor(createDependencies({ parseDocument: async () => '   ' }))
  await assert.rejects(
    processor.process({ jobId: 3, documentId: 11, userId: 2, filePath: 'fixture.docx', fileType: 'docx' }),
    error => error.code === 'DOCUMENT_EMPTY' && error.retryable === false
  )
})
