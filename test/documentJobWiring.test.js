import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

test('Web 服务只协调遗漏队列任务，不把处理中任务直接标记失败', () => {
  const source = fs.readFileSync(new URL('../server/index.js', import.meta.url), 'utf8')
  assert.match(source, /reconcileQueuedDocumentJobs/)
  assert.doesNotMatch(source, /recoverStaleDocumentJobs/)
})

test('后台 Worker 有独立启动命令', () => {
  const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  assert.equal(pkg.scripts['worker:documents'], 'node --max-old-space-size=8192 server/workers/documentWorker.js')
})

test('前端使用服务端任务状态轮询，并提供重试和取消操作', () => {
  const app = fs.readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8')
  const styles = fs.readFileSync(new URL('../src/index.css', import.meta.url), 'utf8')
  assert.match(app, /getDocumentJobPresentation, shouldPollDocumentJobs/)
  assert.match(app, /shouldPollDocumentJobs\(documents\)/)
  assert.match(app, /setInterval\([\s\S]*2000/)
  assert.match(app, /\/documents\/\$\{docId\}\/retry/)
  assert.match(app, /\/documents\/\$\{docId\}\/cancel/)
  assert.doesNotMatch(app, /正在解析文档内容/)
  assert.doesNotMatch(app, /构建 BM25 倒排索引/)
  assert.match(app, /document-job-progress/)
  assert.match(styles, /\.document-job-progress/)
})

test('管理员资料上传不依赖重复的前端初始化按钮', () => {
  const app = fs.readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8')
  assert.match(app, /label: '资料管理'/)
  assert.doesNotMatch(app, /初始化助手|初始化状态|handleInit|initialized/)
  assert.match(app, /if \(!uploadedFile\) return/)
  assert.match(app, /disabled=\{!uploadedFile \|\| uploadLoading\}/)
})

test('README 说明 Redis 和独立文档 Worker 的本机启动方式', () => {
  const readme = fs.readFileSync(new URL('../README.md', import.meta.url), 'utf8')
  assert.match(readme, /docker start xf-rag-redis/)
  assert.match(readme, /npm run worker:documents/)
  assert.match(readme, /DOCUMENT_QUEUE_TIMEOUT_MS=5000/)
  assert.doesNotMatch(readme, /当前文档解析任务仍在 Web 进程内/)
})

test('提供只运行文档后台任务覆盖范围的测试命令', () => {
  const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  assert.equal(
    pkg.scripts['test:document-jobs'],
    'node --test test/documentJobState.test.js test/documentQueue.test.js test/documentJobService.test.js test/documentProcessingService.test.js test/documentRoutesJobs.test.js test/documentJobPresentation.test.js test/documentJobWiring.test.js test/documentWorker.test.js'
  )
})
