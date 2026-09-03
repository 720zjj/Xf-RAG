import jwt from 'jsonwebtoken'
import { randomUUID } from 'node:crypto'
import dotenv from 'dotenv'
import { getConfiguredAdminUsernames } from '../services/knowledgeAccess.js'
dotenv.config()

const AUTH_COOKIE = 'iflytek_session'
const SUPPORT_GUEST_COOKIE = 'iflytek_support_guest'
const SUPPORT_CHANNEL_CODE_PATTERN = /^[A-Za-z0-9_-]{20,80}$/
const SUPPORT_GUEST_HEADER = 'x-support-channel'
const SUPPORT_GUEST_MAX_AGE_MS = 12 * 60 * 60 * 1000
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function getJwtSecret() {
  const secret = process.env.JWT_SECRET
  if (!secret || secret === 'your_jwt_secret') {
    throw new Error('JWT_SECRET 未配置或仍为示例值')
  }
  if (process.env.NODE_ENV === 'production' && secret.length < 32) {
    throw new Error('生产环境 JWT_SECRET 至少需要 32 个字符')
  }
  return secret
}

export function readCookie(req, name) {
  const header = req.headers.cookie || ''
  for (const item of header.split(';')) {
    const idx = item.indexOf('=')
    if (idx < 0) continue
    const key = item.slice(0, idx).trim()
    if (key === name) {
      try { return decodeURIComponent(item.slice(idx + 1).trim()) } catch { return null }
    }
  }
  return null
}

export function getAuthToken(req) {
  const header = req.headers.authorization || ''
  if (header.startsWith('Bearer ')) return header.slice(7).trim()
  return readCookie(req, AUTH_COOKIE)
}

export function roleForUsername(username) {
  return getConfiguredAdminUsernames().includes(username) ? 'admin' : 'user'
}

export function isAdmin(req) {
  return req.user?.role === 'admin'
}

export function isSupportGuest(req) {
  return req.user?.role === 'guest' && Boolean(req.user.supportChannelCode)
}

export function requireAdmin(req, res, next) {
  if (!isAdmin(req)) return res.status(403).json({ ok: false, error: '仅管理员可执行此操作' })
  next()
}

export const authCookieName = AUTH_COOKIE
export const supportGuestCookieName = SUPPORT_GUEST_COOKIE

export function supportGuestCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/api',
    maxAge: SUPPORT_GUEST_MAX_AGE_MS
  }
}

export function issueSupportGuestSession(res, { channelCode, ownerUserId, guestId = randomUUID() } = {}) {
  const normalizedChannelCode = String(channelCode || '').trim()
  const normalizedOwnerUserId = Number(ownerUserId)
  if (!SUPPORT_CHANNEL_CODE_PATTERN.test(normalizedChannelCode)) throw new Error('二维码入口编号格式无效')
  if (!Number.isSafeInteger(normalizedOwnerUserId) || normalizedOwnerUserId <= 0) throw new Error('二维码所属账号无效')
  if (!UUID_PATTERN.test(String(guestId))) throw new Error('顾客会话编号无效')

  const token = jwt.sign(
    {
      kind: 'support_guest',
      ownerUserId: normalizedOwnerUserId,
      supportChannelCode: normalizedChannelCode,
      guestId: String(guestId)
    },
    getJwtSecret(),
    { expiresIn: '12h' }
  )
  res.cookie(SUPPORT_GUEST_COOKIE, token, supportGuestCookieOptions())
  return { guestId: String(guestId), expiresInSeconds: SUPPORT_GUEST_MAX_AGE_MS / 1000 }
}

function readSupportChannelHeader(req) {
  const raw = req.headers?.[SUPPORT_GUEST_HEADER]
  if (raw === undefined || raw === null || String(raw).trim() === '') return null
  const value = String(raw).trim()
  return SUPPORT_CHANNEL_CODE_PATTERN.test(value) ? value : ''
}

function decodeSupportGuest(req, requestedChannelCode) {
  const token = readCookie(req, SUPPORT_GUEST_COOKIE)
  if (!token) return null
  const decoded = jwt.verify(token, getJwtSecret())
  const ownerUserId = Number(decoded.ownerUserId)
  if (
    decoded.kind !== 'support_guest'
    || decoded.supportChannelCode !== requestedChannelCode
    || !Number.isSafeInteger(ownerUserId)
    || ownerUserId <= 0
    || !UUID_PATTERN.test(String(decoded.guestId || ''))
  ) return null
  return {
    id: ownerUserId,
    role: 'guest',
    guestId: String(decoded.guestId),
    supportChannelCode: decoded.supportChannelCode
  }
}

// 仅当顾客页面显式携带已解析渠道编号时使用独立顾客 Cookie。
// 没有该请求头的后台请求继续走管理员登录 Cookie，二者互不覆盖。
export function supportGuestOrAuthMiddleware(req, res, next) {
  const requestedChannelCode = readSupportChannelHeader(req)
  if (requestedChannelCode === null) return authMiddleware(req, res, next)
  if (!requestedChannelCode) return res.status(401).json({ ok: false, error: '顾客会话无效，请重新扫描商品二维码' })
  try {
    const guest = decodeSupportGuest(req, requestedChannelCode)
    if (!guest) return res.status(401).json({ ok: false, error: '顾客会话无效，请重新扫描商品二维码' })
    req.user = guest
    next()
  } catch {
    return res.status(401).json({ ok: false, error: '顾客会话已过期，请重新扫描商品二维码' })
  }
}

export function authMiddleware(req, res, next) {
  const token = getAuthToken(req)
  if (!token) {
    return res.status(401).json({ ok: false, error: '未登录，请先登录' })
  }
  try {
    const decoded = jwt.verify(token, getJwtSecret())
    req.user = { ...decoded, role: roleForUsername(decoded.username) }
    next()
  } catch {
    return res.status(401).json({ ok: false, error: 'Token 无效或已过期' })
  }
}
