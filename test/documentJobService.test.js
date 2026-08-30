import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createDocumentJobService } from '../server/services/documentJobService.js'

function createConnection(responses = []) {
  const queries = []
  return {
    queries,
    async beginTransaction() { queries.push(['begin']) },
    async commit() { queries.push(['commit']) },
    async rollback() { queries.push(['rollback']) },
    release() { queries.push(['release']) },
    async query(sql, params = []) {
      queries.push([sql, params])
      const next = responses.shift()
      if (!next) throw new Error(`未预期 SQL: ${sql}`)
      return next
    }
  }
}

async function createFixtureFile() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'xf-rag-document-job-'))
  const filePath = path.join(dir, 'guide.md')
  await fs.writeFile(filePath, '# 翻译机说明\n正文', 'utf8')
  return { dir, filePath }
}

test('新文件会在提交后用数据库任务 ID 入队', async () => {
  const fixture = await createFixtureFile()
  const connection = createConnection([
    [[]],
    [{ insertId: 11 }],
    [{ insertId: 21 }],
    [{ affectedRows: 1 }]
  ])
  const enqueued = []
  const service = createDocumentJobService({
    pool: { getConnection: async () => connection },
    enqueueDocumentJob: async job => { enqueued.push(job) }
  })

  try {
    const result = await service.createUploadJob({
      userId: 7,
      file: { filename: 'guide.md', originalName: 'guide.md', fileType: 'md', size: 20, path: fixture.filePath }
    })
    assert.equal(result.duplicated, false)
    assert.equal(result.document.id, 11)
    assert.equal(result.job.id, 21)
    assert.deepEqual(enqueued, [{ id: 21, documentId: 11, userId: 7, jobType: 'parse' }])
    assert.equal(connection.queries.filter(([sql]) => sql === 'commit').length, 1)
  } finally {
    await fs.rm(fixture.dir, { recursive: true, force: true })
  }
})

test('同一用户的相同文件返回已有任务且不重复入队', async () => {
  const fixture = await createFixtureFile()
  const existing = {
    id: 8, original_name: 'guide.md', file_type: 'md', file_size: 20, status: 1,
    job_id: 15, job_status: 'completed', job_progress: 100, job_stage: 'finalizing'
  }
  const connection = createConnection([[[existing]]])
  const enqueued = []
  const service = createDocumentJobService({
    pool: { getConnection: async () => connection },
    enqueueDocumentJob: async job => { enqueued.push(job) }
  })

  try {
    const result = await service.createUploadJob({
      userId: 7,
      file: { filename: 'guide-copy.md', originalName: 'guide-copy.md', fileType: 'md', size: 20, path: fixture.filePath }
    })
    assert.equal(result.duplicated, true)
    assert.equal(result.document.id, 8)
    assert.equal(result.job.id, 15)
    assert.equal(result.job.status, 'completed')
    assert.equal(result.job.queueJobId, 'document-15')
    assert.deepEqual(enqueued, [])
    assert.equal(connection.queries.filter(([sql]) => sql === 'rollback').length, 1)
  } finally {
    await fs.rm(fixture.dir, { recursive: true, force: true })
  }
})

test('Worker 只能读取仍有效的任务及其所属原始文件', async () => {
  const service = createDocumentJobService({
    pool: {
      query: async () => [[{
        id: 21, document_id: 8, user_id: 7, job_type: 'parse', cancel_requested: 0,
        file_path: 'D:/uploads/guide.md', file_type: 'md'
      }]]
    }
  })

  assert.deepEqual(await service.getProcessingInput({ jobId: 21 }), {
    jobId: 21,
    documentId: 8,
    userId: 7,
    jobType: 'parse',
    cancelRequested: false,
    filePath: 'D:/uploads/guide.md',
    fileType: 'md'
  })
})

test('取消与领取任务竞争时，不会把文档重新标记为处理中', async () => {
  const queries = []
  const service = createDocumentJobService({
    pool: {
      query: async (sql, params) => {
        queries.push([sql, params])
        return [{ affectedRows: 0 }]
      }
    }
  })

  const claimed = await service.markProcessing({ jobId: 21, documentId: 8, attemptsMade: 1 })
  assert.equal(claimed, false)
  assert.equal(queries.length, 1)
})

test('完成写入未领取到处理中任务时不会覆盖已请求的取消', async () => {
  const connection = createConnection([[{ affectedRows: 0 }]])
  const service = createDocumentJobService({
    pool: { getConnection: async () => connection }
  })

  const completed = await service.markCompleted({
    jobId: 21,
    documentId: 8,
    content: '不应写入的正文',
    chunkCount: 1
  })

  assert.equal(completed, false)
  assert.match(connection.queries[1][0], /status = 'processing' AND cancel_requested = 0/)
  assert.equal(connection.queries.filter(([sql]) => /UPDATE documents SET content/.test(sql)).length, 0)
})

test('重试状态未领取到任务时不会把已取消文档写回排队', async () => {
  const connection = createConnection([[{ affectedRows: 0 }]])
  const service = createDocumentJobService({
    pool: { getConnection: async () => connection }
  })

  const queued = await service.markRetrying({ jobId: 22, documentId: 9, error: new Error('temporary error') })

  assert.equal(queued, false)
  assert.match(connection.queries[1][0], /status = 'processing' AND cancel_requested = 0/)
  assert.equal(connection.queries.filter(([sql]) => /UPDATE documents d/.test(sql)).length, 0)
})
