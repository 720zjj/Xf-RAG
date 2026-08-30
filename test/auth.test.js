import test from 'node:test'
import assert from 'node:assert/strict'
import { getAuthToken, requireAdmin, roleForUsername } from '../server/middleware/auth.js'

function createResponseRecorder() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this },
    json(value) { this.body = value; return this }
  }
}

test('Bearer token 优先于 Cookie', () => {
  const req = { headers: { authorization: 'Bearer header-token', cookie: 'iflytek_session=cookie-token' } }
  assert.equal(getAuthToken(req), 'header-token')
})

test('没有 Bearer 时从 HttpOnly Cookie 读取 token', () => {
  const req = { headers: { cookie: 'theme=dark; iflytek_session=cookie-token' } }
  assert.equal(getAuthToken(req), 'cookie-token')
})

test('管理员身份只来自显式配置', () => {
  const previous = process.env.ADMIN_USERNAMES
  process.env.ADMIN_USERNAMES = 'alice,bob'
  assert.equal(roleForUsername('alice'), 'admin')
  assert.equal(roleForUsername('admin'), 'user')
  if (previous === undefined) delete process.env.ADMIN_USERNAMES
  else process.env.ADMIN_USERNAMES = previous
})

test('普通用户会被 requireAdmin 拒绝', () => {
  const response = createResponseRecorder()
  requireAdmin({ user: { role: 'user' } }, response, () => assert.fail('不应继续'))
  assert.equal(response.statusCode, 403)
  assert.deepEqual(response.body, { ok: false, error: '仅管理员可执行此操作' })
})

test('管理员会通过 requireAdmin', () => {
  let called = false
  requireAdmin({ user: { role: 'admin' } }, createResponseRecorder(), () => { called = true })
  assert.equal(called, true)
})
