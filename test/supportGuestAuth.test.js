import test from 'node:test'
import assert from 'node:assert/strict'
import jwt from 'jsonwebtoken'

process.env.JWT_SECRET = 'test-only-support-guest-secret-at-least-32-chars'
process.env.ADMIN_USERNAMES = 'admin'

const auth = await import('../server/middleware/auth.js')

function responseRecorder() {
  return {
    statusCode: 200,
    body: null,
    cookies: [],
    cookie(name, value, options) { this.cookies.push({ name, value, options }); return this },
    status(code) { this.statusCode = code; return this },
    json(value) { this.body = value; return this }
  }
}

function runMiddleware(middleware, req) {
  const res = responseRecorder()
  let nextCalled = false
  middleware(req, res, () => { nextCalled = true })
  return { req, res, nextCalled }
}

test('valid QR exchange issues a short-lived HttpOnly guest cookie scoped to APIs', () => {
  const res = responseRecorder()
  const result = auth.issueSupportGuestSession(res, {
    channelCode: 'abcdefghijklmnopqrstuv',
    ownerUserId: 7,
    guestId: '3ec47a68-d9fb-4fe0-9bb7-2f174eb276ee'
  })
  assert.equal(result.expiresInSeconds, 12 * 60 * 60)
  assert.equal(res.cookies.length, 1)
  assert.equal(res.cookies[0].name, auth.supportGuestCookieName)
  assert.equal(res.cookies[0].options.httpOnly, true)
  assert.equal(res.cookies[0].options.sameSite, 'lax')
  assert.equal(res.cookies[0].options.path, '/api')
})

test('support middleware selects the matching guest session without overwriting admin auth', () => {
  const guestResponse = responseRecorder()
  auth.issueSupportGuestSession(guestResponse, {
    channelCode: 'abcdefghijklmnopqrstuv',
    ownerUserId: 7,
    guestId: '3ec47a68-d9fb-4fe0-9bb7-2f174eb276ee'
  })
  const guestCookie = guestResponse.cookies[0]
  const adminToken = jwt.sign({ id: 1, username: 'admin' }, auth.getJwtSecret(), { expiresIn: '1h' })
  const cookie = `${auth.authCookieName}=${adminToken}; ${guestCookie.name}=${guestCookie.value}`

  const guestRun = runMiddleware(auth.supportGuestOrAuthMiddleware, {
    headers: { cookie, 'x-support-channel': 'abcdefghijklmnopqrstuv' }
  })
  assert.equal(guestRun.nextCalled, true)
  assert.deepEqual(guestRun.req.user, {
    id: 7,
    role: 'guest',
    guestId: '3ec47a68-d9fb-4fe0-9bb7-2f174eb276ee',
    supportChannelCode: 'abcdefghijklmnopqrstuv'
  })

  const adminRun = runMiddleware(auth.supportGuestOrAuthMiddleware, { headers: { cookie } })
  assert.equal(adminRun.nextCalled, true)
  assert.equal(adminRun.req.user.role, 'admin')
  assert.equal(adminRun.req.user.id, 1)
})

test('guest header cannot switch to another channel or access without a guest cookie', () => {
  const guestResponse = responseRecorder()
  auth.issueSupportGuestSession(guestResponse, {
    channelCode: 'abcdefghijklmnopqrstuv',
    ownerUserId: 7,
    guestId: '3ec47a68-d9fb-4fe0-9bb7-2f174eb276ee'
  })
  const guestCookie = guestResponse.cookies[0]
  const mismatch = runMiddleware(auth.supportGuestOrAuthMiddleware, {
    headers: {
      cookie: `${guestCookie.name}=${guestCookie.value}`,
      'x-support-channel': 'zyxwvutsrqponmlkjihgfe'
    }
  })
  assert.equal(mismatch.nextCalled, false)
  assert.equal(mismatch.res.statusCode, 401)

  const missing = runMiddleware(auth.supportGuestOrAuthMiddleware, {
    headers: { 'x-support-channel': 'abcdefghijklmnopqrstuv' }
  })
  assert.equal(missing.nextCalled, false)
  assert.equal(missing.res.statusCode, 401)

  const malformed = runMiddleware(auth.supportGuestOrAuthMiddleware, {
    headers: { 'x-support-channel': '../admin' }
  })
  assert.equal(malformed.nextCalled, false)
  assert.equal(malformed.res.statusCode, 401)
})

test('support session input is strictly validated', () => {
  const res = responseRecorder()
  assert.throws(() => auth.issueSupportGuestSession(res, {
    channelCode: '../admin', ownerUserId: 1
  }), /二维码入口编号格式无效/)
  assert.throws(() => auth.issueSupportGuestSession(res, {
    channelCode: 'abcdefghijklmnopqrstuv', ownerUserId: 0
  }), /二维码所属账号无效/)
})
