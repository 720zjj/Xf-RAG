import jwt from 'jsonwebtoken'
import dotenv from 'dotenv'
import { getConfiguredAdminUsernames } from '../services/knowledgeAccess.js'
dotenv.config()

const AUTH_COOKIE = 'iflytek_session'

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

function readCookie(req, name) {
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

export function requireAdmin(req, res, next) {
  if (!isAdmin(req)) return res.status(403).json({ ok: false, error: '仅管理员可执行此操作' })
  next()
}

export const authCookieName = AUTH_COOKIE

export function authMiddleware(req, res, next) {
  const token = getAuthToken(req)
  if (!token) {
    return res.status(401).json({ ok: false, error: '未登录，请先登录' })
  }
  try {
    const decoded = jwt.verify(token, getJwtSecret())
    req.user = { ...decoded, role: roleForUsername(decoded.username) }
    next()
  } catch (err) {
    return res.status(401).json({ ok: false, error: 'Token 无效或已过期' })
  }
}
