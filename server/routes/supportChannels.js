import { Router } from 'express'
import dotenv from 'dotenv'
import QRCode from 'qrcode'
import pool from '../db.js'
import { authMiddleware, issueSupportGuestSession, requireAdmin } from '../middleware/auth.js'
import { createRateLimit } from '../middleware/rateLimit.js'
import { createSupportChannelService } from '../services/supportChannelService.js'
import { createProductScopeService } from '../services/productScopeService.js'

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

const productScopeService = createProductScopeService({ query: pool.query.bind(pool) })
const service = createSupportChannelService({
  query: pool.query.bind(pool),
  publicAppUrl: supportChannelPublicAppUrl(),
  resolveProduct: productScopeService.resolveProduct
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
  if (['请输入展示名称', '请选择产品型号', '产品型号不存在或暂无有效资料'].includes(error?.message) || /不能超过/.test(error?.message || '')) {
    return res.status(400).json({ ok: false, error: error.message })
  }
  console.error('[support-channels/mutation]', stableErrorCode(error))
  return res.status(500).json({ ok: false, error: '服务器内部错误' })
}

router.get('/products', authMiddleware, async (req, res) => {
  try {
    const products = await productScopeService.listProducts()
    res.json({
      ok: true,
      data: products.map(({ productKey, productLine, productModel, displayName, documentCount }) => ({
        productKey,
        productLine,
        productModel,
        displayName,
        documentCount
      }))
    })
  } catch (error) {
    console.error('[support-channels/products]', stableErrorCode(error))
    res.status(500).json({ ok: false, error: '无法获取产品型号' })
  }
})

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

router.get('/resolve/:channelCode', resolveRateLimit, async (req, res) => {
  try {
    const channel = await service.resolve(req.params.channelCode)
    if (!channel) return res.status(404).json({ ok: false, error: '支持渠道不存在或已停用' })
    const product = await productScopeService.resolveStoredProduct(channel.product_line, channel.product_model)
    if (!product) return res.status(404).json({ ok: false, error: '该产品资料已失效，请联系管理员' })
    const guestSession = issueSupportGuestSession(res, {
      channelCode: channel.channel_code,
      ownerUserId: channel.created_by
    })
    res.setHeader('Cache-Control', 'no-store')
    res.json({
      ok: true,
      data: {
        displayName: channel.display_name,
        productKey: product.productKey,
        productLine: product.productLine,
        productModel: product.productModel,
        sessionExpiresInSeconds: guestSession.expiresInSeconds
      }
    })
  } catch (error) {
    console.error('[support-channels/resolve]', stableErrorCode(error))
    res.status(500).json({ ok: false, error: '服务器内部错误' })
  }
})

export default router
