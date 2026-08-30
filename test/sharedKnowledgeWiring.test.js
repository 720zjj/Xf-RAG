import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const read = path => fs.readFileSync(new URL(path, import.meta.url), 'utf8')

test('文档与检索读取链路统一使用公共知识库范围', () => {
  const sources = [
    read('../server/services/chunkStore.js'),
    read('../server/routes/documents.js'),
    read('../server/routes/uploadAssets.js'),
    read('../server/routes/rag.js'),
    read('../server/services/toolAgent.js'),
    read('../server/mcpServer.js')
  ]

  for (const source of sources) {
    assert.match(source, /buildKnowledgeScope/)
  }
})

test('文档删除与重新解析仍然要求当前用户是所有者', () => {
  const routes = read('../server/routes/documents.js')
  const jobService = read('../server/services/documentJobService.js')

  assert.match(routes, /DELETE FROM documents WHERE id = \? AND user_id = \?/)
  assert.match(routes, /createReparseJob\(\{ userId: req\.user\.id, documentId: req\.params\.id \}\)/)
  assert.match(routes, /createRetryJob\(\{ userId: req\.user\.id, documentId: req\.params\.id \}\)/)
  assert.match(routes, /requestDocumentJobCancel\(\{ userId: req\.user\.id, documentId: req\.params\.id \}\)/)
  assert.match(jobService, /WHERE d\.id = \? AND d\.user_id = \? LIMIT 1/)
})

test('公共文档索引变化会清空所有用户的检索缓存', () => {
  const chunkStore = read('../server/services/chunkStore.js')
  const jobService = read('../server/services/documentJobService.js')
  assert.match(chunkStore, /export function invalidateAllChunks/)
  assert.match(chunkStore, /invalidateAllChunks\(\)/)
  assert.match(
    jobService,
    /async function markCompleted[\s\S]*?await connection\.commit\(\)[\s\S]*?invalidate\(\)/
  )
  assert.match(jobService, /async function markFailed[\s\S]*?invalidate\(\)/)
})

test('MCP 发现知识库版本变化时强制绕过进程缓存', () => {
  const source = read('../server/mcpServer.js')
  assert.match(source, /loadUserChunks\(MCP_USER_ID,\s*\{\s*forceRefresh:\s*true\s*\}\)/)
  assert.match(source, /doc_checksum/)
})

test('前端标识公共文档并仅向所有者展示管理操作', () => {
  const source = read('../src/App.jsx')
  assert.match(source, /documentScopeLabel/)
  assert.match(source, /canManageDocument\(doc\)/)
  assert.match(source, /公共知识库/)
})
