import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { checkRedisReadiness, createRedisReadinessConnection } from '../server/queues/documentQueue.js'

test('Redis 就绪探针完成 ping 后主动断开临时连接', async () => {
  const events = []
  const connection = {
    async connect() { events.push('connect') },
    async ping() { events.push('ping'); return 'PONG' },
    disconnect() { events.push('disconnect') }
  }

  const ready = await checkRedisReadiness({
    createConnection: () => connection,
    timeoutMs: 20
  })

  assert.equal(ready, true)
  assert.deepEqual(events, ['connect', 'ping', 'disconnect'])
})

test('Redis 就绪探针失败时仍会断开临时连接', async () => {
  const events = []
  const connection = {
    async connect() { events.push('connect') },
    async ping() { events.push('ping'); throw new Error('Redis unavailable') },
    disconnect() { events.push('disconnect') }
  }

  await assert.rejects(
    checkRedisReadiness({ createConnection: () => connection, timeoutMs: 20 }),
    /Redis unavailable/
  )
  assert.deepEqual(events, ['connect', 'ping', 'disconnect'])
})

test('Redis 就绪探针使用单次连接策略，不会持续重连', () => {
  let options = null
  const client = createRedisReadinessConnection((url, receivedOptions) => {
    options = { url, ...receivedOptions }
    return { connect() {}, ping() {}, disconnect() {} }
  })

  assert.ok(client)
  assert.equal(options.url, 'redis://127.0.0.1:6379')
  assert.equal(options.maxRetriesPerRequest, 0)
  assert.equal(options.lazyConnect, true)
  assert.equal(options.retryStrategy(1), null)
})

test('健康检查路由同时依赖 MySQL 与 Redis', () => {
  const source = readFileSync(new URL('../server/index.js', import.meta.url), 'utf8')

  assert.match(source, /checkRedisReadiness/)
  assert.match(source, /redis = await checkRedisReadiness\(\)/)
  assert.match(source, /Boolean\(database && redis\)/)
})
