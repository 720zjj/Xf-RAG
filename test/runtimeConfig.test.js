import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import express from 'express'
import { assertRuntimeConfig, parseTrustProxyConfig, validateRuntimeConfig } from '../server/config/runtimeConfig.js'
import { createRequestId, requestContextMiddleware, requestLogMiddleware } from '../server/middleware/requestContext.js'
import { configureTransformersRuntime } from '../server/services/transformersRuntime.js'

const validProduction = {
  NODE_ENV: 'production', PORT: '3000', DB_HOST: 'mysql', DB_PORT: '3306',
  DB_USER: 'xf_rag', DB_PASSWORD: 'not-a-placeholder', DB_NAME: 'xf_rag',
  REDIS_URL: 'redis://redis:6379', UPLOAD_DIR: '/data/uploads',
  JWT_SECRET: 'a'.repeat(40), PUBLIC_APP_URL: 'https://help.example.com',
  CORS_ORIGINS: 'https://help.example.com'
}

function createResponse() {
  const response = new EventEmitter()
  response.headers = {}
  response.statusCode = 201
  response.setHeader = (name, value) => { response.headers[name] = value }
  return response
}

test('生产环境完整配置会通过校验', () => {
  assert.deepEqual(validateRuntimeConfig(validProduction), { ok: true, errors: [] })
})

test('反向代理只接受明确地址或受控网段，拒绝信任全部来源', () => {
  assert.equal(parseTrustProxyConfig(''), false)
  assert.deepEqual(parseTrustProxyConfig('loopback, linklocal, uniquelocal'), ['loopback', 'linklocal', 'uniquelocal'])
  assert.deepEqual(parseTrustProxyConfig('127.0.0.1, 172.16.0.0/12'), ['127.0.0.1', '172.16.0.0/12'])
  assert.throws(() => parseTrustProxyConfig('true'), /不能信任所有代理地址/)
  assert.throws(() => parseTrustProxyConfig('0.0.0.0/0'), /不能信任所有代理地址/)
  assert.equal(validateRuntimeConfig({ ...validProduction, TRUST_PROXY: 'not-a-network' }).ok, false)
})

test('受信任的同机代理会让 Express 读取真实顾客 IP', async t => {
  const app = express()
  app.set('trust proxy', parseTrustProxyConfig('loopback'))
  app.get('/ip', (req, res) => res.json({ ip: req.ip }))
  const server = app.listen(0, '127.0.0.1')
  t.after(() => new Promise(resolve => server.close(resolve)))
  await new Promise(resolve => server.once('listening', resolve))
  const { port } = server.address()
  const response = await fetch(`http://127.0.0.1:${port}/ip`, {
    headers: { 'X-Forwarded-For': '203.0.113.25' }
  })
  assert.deepEqual(await response.json(), { ip: '203.0.113.25' })
})

test('生产环境拒绝非 HTTPS 的公开地址', () => {
  const result = validateRuntimeConfig({ ...validProduction, PUBLIC_APP_URL: 'http://localhost:3000' })
  assert.equal(result.ok, false)
  assert.ok(result.errors.some(error => /HTTPS/.test(error)))
})

test('生产环境要求公开地址的来源出现在 CORS_ORIGINS', () => {
  const missing = validateRuntimeConfig({ ...validProduction, CORS_ORIGINS: '' })
  const mismatched = validateRuntimeConfig({ ...validProduction, CORS_ORIGINS: 'https://other.example.com' })
  const matching = validateRuntimeConfig({
    ...validProduction,
    PUBLIC_APP_URL: 'https://help.example.com/support',
    CORS_ORIGINS: 'https://other.example.com, https://help.example.com'
  })

  assert.equal(missing.ok, false)
  assert.ok(missing.errors.some(error => /CORS_ORIGINS/.test(error)))
  assert.equal(mismatched.ok, false)
  assert.ok(mismatched.errors.some(error => /CORS_ORIGINS/.test(error)))
  assert.deepEqual(matching, { ok: true, errors: [] })
})

test('启动前断言会汇总中文配置错误', () => {
  assert.throws(
    () => assertRuntimeConfig({ ...validProduction, PUBLIC_APP_URL: 'http://localhost:3000' }),
    /运行环境配置无效.*HTTPS/
  )
})

test('拒绝示例 JWT_SECRET 且不泄露其值', () => {
  const result = validateRuntimeConfig({ ...validProduction, JWT_SECRET: 'your_jwt_secret' })
  assert.equal(result.ok, false)
  assert.ok(result.errors.some(error => /JWT_SECRET/.test(error)))
  assert.ok(result.errors.every(error => !error.includes('your_jwt_secret')))
})

test('校验端口、Redis 和必填部署路径', () => {
  const result = validateRuntimeConfig({
    ...validProduction,
    PORT: '0',
    DB_PORT: 'invalid',
    REDIS_URL: 'http://redis:6379',
    DB_HOST: '',
    UPLOAD_DIR: ''
  })
  assert.equal(result.ok, false)
  assert.ok(result.errors.some(error => /PORT/.test(error)))
  assert.ok(result.errors.some(error => /DB_PORT/.test(error)))
  assert.ok(result.errors.some(error => /REDIS_URL/.test(error)))
  assert.ok(result.errors.some(error => /DB_HOST/.test(error)))
  assert.ok(result.errors.some(error => /UPLOAD_DIR/.test(error)))
})

test('所有环境拒绝空数据库密码，生产环境拒绝示例数据库密码', () => {
  const emptyPassword = validateRuntimeConfig({ ...validProduction, NODE_ENV: 'development', DB_PASSWORD: '  ' })
  const placeholderPassword = validateRuntimeConfig({ ...validProduction, DB_PASSWORD: 'replace-with-local-app-password' })

  assert.equal(emptyPassword.ok, false)
  assert.ok(emptyPassword.errors.some(error => /DB_PASSWORD/.test(error)))
  assert.equal(placeholderPassword.ok, false)
  assert.ok(placeholderPassword.errors.some(error => /DB_PASSWORD/.test(error)))
  assert.ok(placeholderPassword.errors.every(error => !error.includes('replace-with-local-app-password')))
})

test('请求 ID 保留安全值，非法值改用注入的随机值', () => {
  assert.equal(createRequestId('safe-request_01'), 'safe-request_01')
  assert.equal(createRequestId('invalid/request-id', () => 'generated-id'), 'generated-id')
})

test('请求上下文与日志不记录 Cookie 或 Authorization', () => {
  const request = {
    headers: {
      'x-request-id': 'safe-request_01',
      cookie: 'iflytek_session=private-cookie',
      authorization: 'Bearer private-token'
    },
    method: 'POST',
    originalUrl: '/api/rag/ask?token=private-query-value#private-fragment'
  }
  const response = createResponse()
  const lines = []

  requestContextMiddleware(request, response, () => {})
  requestLogMiddleware(line => lines.push(line))(request, response, () => {})
  response.emit('finish')

  assert.equal(request.requestId, 'safe-request_01')
  assert.equal(response.headers['X-Request-ID'], 'safe-request_01')
  assert.equal(lines.length, 1)
  const record = JSON.parse(lines[0])
  assert.deepEqual(Object.keys(record).sort(), ['durationMs', 'event', 'method', 'path', 'requestId', 'status'])
  assert.equal(record.event, 'http_request')
  assert.equal(record.requestId, 'safe-request_01')
  assert.equal(record.method, 'POST')
  assert.equal(record.path, '/api/rag/ask')
  assert.equal(record.status, 201)
  assert.equal(typeof record.durationMs, 'number')
  assert.equal(lines[0].includes('private-cookie'), false)
  assert.equal(lines[0].includes('private-token'), false)
  assert.equal(lines[0].includes('private-query-value'), false)
  assert.equal(lines[0].includes('private-fragment'), false)
})

test('Transformer 模型缓存目录取自部署环境', () => {
  const transformersEnv = {}
  const cacheDir = configureTransformersRuntime({
    runtimeEnv: { MODEL_CACHE_DIR: '/data/models' },
    transformersEnv
  })
  assert.equal(cacheDir, path.resolve('/data/models'))
  assert.equal(transformersEnv.cacheDir, path.resolve('/data/models'))
})

test('未配置模型缓存目录时不会覆盖 Transformers 默认缓存', () => {
  const transformersEnv = { cacheDir: 'existing-cache' }
  configureTransformersRuntime({ runtimeEnv: {}, transformersEnv })
  assert.equal(transformersEnv.cacheDir, 'existing-cache')
})
