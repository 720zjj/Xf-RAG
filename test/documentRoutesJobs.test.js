import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const source = fs.readFileSync(new URL('../server/routes/documents.js', import.meta.url), 'utf8')

test('上传路由创建后台任务并以 202 返回，不在 HTTP 进程中解析', () => {
  assert.match(source, /createUploadJob/)
  assert.match(source, /res\.status\(202\)\.json/)
  assert.doesNotMatch(source, /parsePromise/)
  assert.doesNotMatch(source, /reparsePromise/)
  assert.doesNotMatch(source, /storeDocumentChunks/)
})

test('文档任务 API 提供读取、重试和取消入口', () => {
  assert.match(source, /router\.get\('\/:id\/job'/)
  assert.match(source, /router\.post\('\/:id\/retry'/)
  assert.match(source, /router\.post\('\/:id\/cancel'/)
  assert.match(source, /createRetryJob/)
  assert.match(source, /requestDocumentJobCancel/)
})

test('仍在排队或处理的文档必须先取消才能删除', () => {
  assert.match(source, /DOCUMENT_STATUS\.queued/)
  assert.match(source, /DOCUMENT_STATUS\.processing/)
  assert.match(source, /请先取消任务/)
})
