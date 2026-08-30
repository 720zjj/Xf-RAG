import test from 'node:test'
import assert from 'node:assert/strict'
import { buildDocumentJobOptions, getDocumentQueueJobId, parseRedisUrl, withDocumentQueueTimeout } from '../server/queues/documentQueue.js'

test('文档任务使用数据库 ID、三次重试和指数退避', () => {
  assert.deepEqual(buildDocumentJobOptions(42), {
    jobId: 'document-42',
    attempts: 3,
    backoff: { type: 'exponential', delay: 10_000 },
    removeOnComplete: 1000,
    removeOnFail: false
  })
  assert.equal(getDocumentQueueJobId(42), 'document-42')
  assert.equal(getDocumentQueueJobId('document-42'), 'document-42')
})

test('Redis 连接只接受 redis 协议且默认地址是本机', () => {
  assert.equal(parseRedisUrl('redis://127.0.0.1:6379').hostname, '127.0.0.1')
  assert.equal(parseRedisUrl('').hostname, '127.0.0.1')
  assert.throws(() => parseRedisUrl('https://example.com'), /REDIS_URL/)
})

test('不可用 Redis 的队列操作会在等待上限后失败而不是永久挂起', async () => {
  await assert.rejects(
    withDocumentQueueTimeout(new Promise(() => {}), 5),
    /Redis 队列响应超时/
  )
})
