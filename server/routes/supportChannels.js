import { Router } from 'express'
import dotenv from 'dotenv'
import QRCode from 'qrcode'
import pool from '../db.js'
import { authMiddleware, requireAdmin } from '../middleware/auth.js'
import { createRateLimit } from '../middleware/rateLimit.js'
import { createSupportChannelService } from '../services/supportChannelService.js'

dotenv.config()

const router = Router()
const mutationRateLimit = createRateLimit({ windowMs: 60_000, max: 30 })
const resolveRateLimit = createRateLimit({ windowMs: 60_000, max: 120 })

export function supportQrContentDisposition() {
  return 'attachment; filename="support-qrcode.svg"'
}

export function supportChannelPublicAppUrl() {
  const configured = String(process.env.PUBLIC_APP_URL || '').trim()
  if (configured) return configured
  if (process.env.NODE_ENV === 'production') return configured
  const port = Number(process.env.PORT)
  const localPort = Number.isInteger(port) && port > 0 && port <= 65_535 ? port : 3000
  return `http://localhost:${localPort}`
}

const service = createSupportChannelService({
  query: pool.query.bind(pool),
  publicAppUrl: supportChannelPublicAppUrl()
})

function channelId(rawId) {
  if (!/^[1-9]\d*$/.test(String(rawId))) return null
  const id = Number(rawId)
  return Number.isSafeInteger(id) ? id : null
}

async function findAdminChannel(req, id) {
  const channels = await service.list(req.user.id)
  return channels.find(channel => Number(channel.id) === id) || null
}

function invalidChannelId(res) {
  return res.status(400).json({ ok: false, error: '渠道编号无效' })
}

function unknownChannel(res) {
  return res.status(404).json({ ok: false, error: '支持渠道不存在' })
}

export function stableErrorCode(error) {
  const code = String(error?.code || 'UNKNOWN').slice(0, 64)
  return /^[A-Z0-9_]+$/.test(code) ? code : 'UNKNOWN'
}

export function sendMutationError(res, error) {
  if (error?.code === 'ER_DUP_ENTRY') {
    return res.status(409).json({ ok: false, error: '该产品型号已有启用的支持渠道' })
  }
  if (['请输入展示名称', '请输入产品线', '请输入产品型号'].includes(error?.message) || /不能超过/.test(error?.message || '')) {
    return res.status(400).json({ ok: false, error: error.message })
  }
  console.error('[support-channels/mutation]', stableErrorCode(error))
  return res.status(500).json({ ok: false, error: '服务器内部错误' })
}

router.get('/', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const channels = await service.list(req.user.id)
    res.json({
      ok: true,
      data: channels.map(channel => ({
        ...channel,
        supportUrl: service.buildSupportUrl(channel.channel_code)
      }))
    })
  } catch (error) {
    console.error('[support-channels/list]', stableErrorCode(error))
    res.status(500).json({ ok: false, error: '服务器内部错误' })
  }
})

router.post('/', authMiddleware, requireAdmin, mutationRateLimit, async (req, res) => {
  try {
    const channel = await service.create({ ...req.body, createdBy: req.user.id })
    res.status(201).json({ ok: true, data: channel })
  } catch (error) {
    sendMutationError(res, error)
  }
})

router.put('/:id', authMiddleware, requireAdmin, mutationRateLimit, async (req, res) => {
  const id = channelId(req.params.id)
  if (!id) return invalidChannelId(res)
  try {
    if (!(await findAdminChannel(req, id))) return unknownChannel(res)
    const result = await service.update(id, req.body)
    if (!result?.affectedRows) return unknownChannel(res)
    res.json({ ok: true })
  } catch (error) {
    sendMutationError(res, error)
  }
})

router.post('/:id/rotate', authMiddleware, requireAdmin, mutationRateLimit, async (req, res) => {
  const id = channelId(req.params.id)
  if (!id) return invalidChannelId(res)
  try {
    if (!(await findAdminChannel(req, id))) return unknownChannel(res)
    const result = await service.rotate(id)
    if (!result?.affectedRows) return unknownChannel(res)
    res.json({ ok: true, data: { channelCode: result.channelCode } })
  } catch (error) {
    sendMutationError(res, error)
  }
})

router.get('/:id/qrcode.svg', authMiddleware, requireAdmin, async (req, res) => {
  const id = channelId(req.params.id)
  if (!id) return invalidChannelId(res)
  try {
    const channel = await findAdminChannel(req, id)
    if (!channel) return unknownChannel(res)
    const url = service.buildSupportUrl(channel.channel_code)
    res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8')
    res.setHeader('Content-Disposition', supportQrContentDisposition())
    res.send(await QRCode.toString(url, { type: 'svg', errorCorrectionLevel: 'M', margin: 2, width: 360 }))
  } catch (error) {
    console.error('[support-channels/qrcode]', stableErrorCode(error))
    res.status(500).json({ ok: false, error: '服务器内部错误' })
  }
})

router.get('/resolve/:channelCode', authMiddleware, resolveRateLimit, async (req, res) => {
  try {
    const channel = await service.resolve(req.params.channelCode)
    if (!channel) return res.status(404).json({ ok: false, error: '支持渠道不存在或已停用' })
    res.json({
      ok: true,
      data: {
        displayName: channel.display_name,
        productLine: channel.product_line,
        productModel: channel.product_model
      }
    })
  } catch (error) {
    console.error('[support-channels/resolve]', stableErrorCode(error))
    res.status(500).json({ ok: false, error: '服务器内部错误' })
  }
})

export default router
