import crypto from 'node:crypto'

export const CHANNEL_CODE_PATTERN = /^[A-Za-z0-9_-]{20,80}$/

function text(value) {
  return typeof value === 'string' ? value.trim() : ''
}

export function parsePublicAppUrl(raw, { production = false } = {}) {
  const value = text(raw)
  let url
  try { url = new URL(value) } catch { throw new Error('PUBLIC_APP_URL 必须是绝对 URL') }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('PUBLIC_APP_URL 必须是绝对 HTTP(S) URL')
  }
  if (!url.hostname) throw new Error('PUBLIC_APP_URL 必须包含域名')
  if (production && (url.protocol !== 'https:' || ['localhost', '127.0.0.1', '::1'].includes(url.hostname.toLowerCase()))) {
    throw new Error('生产环境 PUBLIC_APP_URL 必须使用 HTTPS 且不能是 localhost')
  }
  url.hash = ''
  url.search = ''
  url.pathname = url.pathname.replace(/\/+$/, '')
  return url.toString().replace(/\/$/, '')
}

export function normalizeSupportChannelInput(input = {}) {
  const displayName = text(input.displayName ?? input.display_name)
  const productKey = text(input.productKey ?? input.product_key)
  if (!displayName) throw new Error('请输入展示名称')
  if (!productKey) throw new Error('请选择产品型号')
  if (displayName.length > 100) throw new Error('展示名称不能超过 100 个字符')
  if (productKey.length > 100) throw new Error('产品标识不能超过 100 个字符')
  return { displayName, productKey }
}

export function generateChannelCode(randomBytesFn = crypto.randomBytes) {
  const code = randomBytesFn(18).toString('base64url')
  if (!CHANNEL_CODE_PATTERN.test(code)) throw new Error('无法生成有效二维码入口编号')
  return code
}

function rowsFrom(result) {
  return Array.isArray(result) && Array.isArray(result[0]) ? result[0] : result
}

function dbPayload(result) {
  return Array.isArray(result) && !Array.isArray(result[0]) ? result[0] : result
}

export function createSupportChannelService({ query, publicAppUrl, codeFactory = generateChannelCode, resolveProduct } = {}) {
  if (typeof query !== 'function') throw new Error('support channel query 未配置')
  if (typeof resolveProduct !== 'function') throw new Error('support channel product resolver 未配置')
  const baseUrl = parsePublicAppUrl(publicAppUrl, { production: process.env.NODE_ENV === 'production' })

  async function list(createdBy) {
    const result = await query(
      `SELECT id, display_name, product_line, product_model, channel_code, is_active, created_by, created_at, updated_at
       FROM support_channels WHERE created_by = ? ORDER BY updated_at DESC, id DESC`,
      [createdBy]
    )
    return rowsFrom(result)
  }

  async function create(input) {
    const normalized = normalizeSupportChannelInput(input)
    const product = await resolveProduct(normalized.productKey)
    if (!product) throw new Error('产品型号不存在或暂无有效资料')
    const channelCode = codeFactory()
    if (!CHANNEL_CODE_PATTERN.test(channelCode)) throw new Error('二维码入口编号格式无效')
    const result = await query(
      `INSERT INTO support_channels
       (channel_code, display_name, product_line, product_model, is_active, created_by)
       VALUES (?, ?, ?, ?, 1, ?)`,
      [channelCode, normalized.displayName, product.productLine, product.productModel, input.createdBy]
    )
    const dbResult = dbPayload(result)
    return {
      id: Number(dbResult?.insertId),
      displayName: normalized.displayName,
      productKey: product.productKey,
      productLine: product.productLine,
      productModel: product.productModel,
      channelCode,
      isActive: true,
      createdBy: input.createdBy
    }
  }

  async function update(id, input) {
    const displayName = text(input.displayName ?? input.display_name)
    if (!displayName) throw new Error('请输入展示名称')
    if (displayName.length > 100) throw new Error('展示名称不能超过 100 个字符')
    const isActive = input.isActive ?? input.is_active
    const result = await query(
      `UPDATE support_channels
       SET display_name = ?, is_active = ?
       WHERE id = ?`,
      [displayName, isActive === false ? 0 : 1, id]
    )
    return dbPayload(result)
  }

  async function rotate(id) {
    const channelCode = codeFactory()
    if (!CHANNEL_CODE_PATTERN.test(channelCode)) throw new Error('二维码入口编号格式无效')
    const result = await query('UPDATE support_channels SET channel_code = ? WHERE id = ?', [channelCode, id])
    const dbResult = dbPayload(result)
    return { ...dbResult, channelCode }
  }

  async function resolve(code) {
    if (!CHANNEL_CODE_PATTERN.test(String(code || ''))) return null
    const result = await query(
      `SELECT display_name, product_line, product_model, channel_code, created_by
       FROM support_channels WHERE channel_code = ? AND is_active = 1 LIMIT 1`,
      [code]
    )
    return rowsFrom(result)?.[0] || null
  }

  function buildSupportUrl(channelCode) {
    if (!CHANNEL_CODE_PATTERN.test(String(channelCode || ''))) throw new Error('二维码入口编号格式无效')
    return `${baseUrl}/support/${encodeURIComponent(channelCode)}`
  }

  return { list, create, update, rotate, resolve, buildSupportUrl }
}
