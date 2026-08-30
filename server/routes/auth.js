import { Router } from 'express'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import pool from '../db.js'
import { authMiddleware, authCookieName, getJwtSecret, roleForUsername } from '../middleware/auth.js'
import { createRateLimit } from '../middleware/rateLimit.js'
import dotenv from 'dotenv'
dotenv.config()

const router = Router()
const authRateLimit = createRateLimit({ windowMs: 15 * 60 * 1000, max: 20 })
const cookieOptions = () => ({
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production',
  path: '/',
  maxAge: 7 * 24 * 60 * 60 * 1000
})

function issueSession(res, user) {
  const role = roleForUsername(user.username)
  const token = jwt.sign(
    { id: user.id, username: user.username, role },
    getJwtSecret(),
    { expiresIn: '7d' }
  )
  res.cookie(authCookieName, token, cookieOptions())
  return { token, role }
}

// 注册
router.post('/register', authRateLimit, async (req, res) => {
  try {
    const username = String(req.body.username || '').trim()
    const password = String(req.body.password || '')
    const nickname = String(req.body.nickname || '').trim()
    if (!username || !password) {
      return res.status(400).json({ ok: false, error: '用户名和密码不能为空' })
    }
    if (!/^[a-zA-Z0-9_\-]{3,50}$/.test(username)) {
      return res.status(400).json({ ok: false, error: '用户名需为 3-50 位字母、数字、下划线或短横线' })
    }
    if (password.length < 8 || password.length > 128) {
      return res.status(400).json({ ok: false, error: '密码长度需为 8-128 位' })
    }
    if (nickname.length > 50) {
      return res.status(400).json({ ok: false, error: '昵称不能超过 50 个字符' })
    }
    if (roleForUsername(username) === 'admin') {
      const expectedKey = process.env.ADMIN_REGISTRATION_KEY
      const suppliedKey = req.headers['x-admin-registration-key'] || req.body.adminRegistrationKey
      if (!expectedKey || suppliedKey !== expectedKey) {
        return res.status(403).json({ ok: false, error: '管理员账号需要有效的注册密钥' })
      }
    }
    // 检查是否已存在
    const [existing] = await pool.query('SELECT id FROM users WHERE username = ?', [username])
    if (existing.length > 0) {
      return res.status(409).json({ ok: false, error: '用户名已存在' })
    }
    const hashedPassword = await bcrypt.hash(password, 10)
    const [result] = await pool.query(
      'INSERT INTO users (username, password, nickname) VALUES (?, ?, ?)',
      [username, hashedPassword, nickname || username]
    )
    const session = issueSession(res, { id: result.insertId, username })
    res.json({
      ok: true,
      data: {
        token: session.token,
        user: { id: result.insertId, username, nickname: nickname || username, role: session.role }
      }
    })
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ ok: false, error: '用户名已存在' })
    console.error('[auth/register]', err)
    res.status(500).json({ ok: false, error: '注册失败，请稍后重试' })
  }
})

// 登录
router.post('/login', authRateLimit, async (req, res) => {
  try {
    const username = String(req.body.username || '').trim()
    const password = String(req.body.password || '')
    if (!username || !password) {
      return res.status(400).json({ ok: false, error: '用户名和密码不能为空' })
    }
    const [rows] = await pool.query('SELECT * FROM users WHERE username = ?', [username])
    if (rows.length === 0) {
      return res.status(401).json({ ok: false, error: '用户名或密码错误' })
    }
    const user = rows[0]
    const valid = await bcrypt.compare(password, user.password)
    if (!valid) {
      return res.status(401).json({ ok: false, error: '用户名或密码错误' })
    }
    const session = issueSession(res, user)
    res.json({
      ok: true,
      data: {
        token: session.token,
        user: { id: user.id, username: user.username, nickname: user.nickname, role: session.role }
      }
    })
  } catch (err) {
    console.error('[auth/login]', err)
    res.status(500).json({ ok: false, error: '登录失败，请稍后重试' })
  }
})

// 获取当前用户信息
router.get('/me', authMiddleware, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT id, username, nickname, created_at FROM users WHERE id = ?', [req.user.id])
    if (rows.length === 0) return res.status(404).json({ ok: false, error: '用户不存在' })
    res.json({ ok: true, data: { ...rows[0], role: req.user.role } })
  } catch (err) {
    console.error('[auth/me]', err)
    res.status(500).json({ ok: false, error: '获取用户信息失败' })
  }
})

router.post('/logout', (req, res) => {
  res.clearCookie(authCookieName, { ...cookieOptions(), maxAge: undefined })
  res.json({ ok: true })
})

export default router
