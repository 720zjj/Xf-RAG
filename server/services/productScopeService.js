import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { getConfiguredAdminUsernames } from './knowledgeAccess.js'

const SUPPORT_CHANNEL_CODE_PATTERN = /^[A-Za-z0-9_-]{20,80}$/

export const FIRST_RELEASE_PRODUCTS = Object.freeze([
  Object.freeze({
    productLine: '翻译机',
    productModel: '翻译机4.0',
    displayName: '讯飞翻译机普通版 4.0',
    metadataVersion: '4.0'
  }),
  Object.freeze({
    productLine: '翻译机',
    productModel: '翻译机2.0',
    displayName: '讯飞翻译机双屏版 2.0',
    metadataVersion: '2.0'
  })
])

function cleanText(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function rowsFrom(result) {
  return Array.isArray(result) && Array.isArray(result[0]) ? result[0] : result
}

export function parseProductFrontMatter(text) {
  const match = String(text || '').match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/)
  if (!match) return {}
  const metadata = {}
  for (const line of match[1].split(/\r?\n/)) {
    const separator = line.indexOf(':')
    if (separator <= 0) continue
    const key = line.slice(0, separator).trim()
    const value = line.slice(separator + 1).trim()
    if (key && value) metadata[key] = value
  }
  return metadata
}

export function productKeyFor(productLine, productModel) {
  const canonical = `${cleanText(productLine)}\u0000${cleanText(productModel)}`
  const digest = crypto.createHash('sha256').update(canonical).digest('base64url').slice(0, 24)
  return `product_${digest}`
}

export function supportedProductsForMetadata({ productLine = '', productModel = '', effectiveStatus = 'active' } = {}) {
  if (cleanText(effectiveStatus).toLowerCase() === 'deprecated') return []
  const line = cleanText(productLine)
  if (line && !line.includes('翻译机')) return []
  const model = cleanText(productModel)
  if (!model) return []
  return FIRST_RELEASE_PRODUCTS.filter(product => new RegExp(`(^|[^0-9])${product.metadataVersion.replace('.', '\\.')}(?![0-9])`).test(model))
}

export function isPathInside(directory, candidate) {
  const base = path.resolve(directory)
  const target = path.resolve(candidate)
  const relative = path.relative(base, target)
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
}

export class ProductScopeError extends Error {
  constructor(message, { code = 'INVALID_PRODUCT_SCOPE', status = 400 } = {}) {
    super(message)
    this.name = 'ProductScopeError'
    this.code = code
    this.status = status
  }
}

export function createProductScopeService({
  query,
  readFile = fs.readFile,
  uploadDir = process.env.UPLOAD_DIR || './uploads',
  adminUsernames = getConfiguredAdminUsernames()
} = {}) {
  if (typeof query !== 'function') throw new Error('product scope query 未配置')
  const trustedUploadDir = path.resolve(uploadDir)
  const trustedAdmins = [...new Set((adminUsernames || []).map(cleanText).filter(Boolean))]

  async function readLegacyMetadata(document) {
    const filePath = cleanText(document.file_path)
    if (document.file_type !== 'md' || !filePath || !isPathInside(trustedUploadDir, filePath)) return {}
    try {
      return parseProductFrontMatter(await readFile(filePath, 'utf8'))
    } catch {
      return {}
    }
  }

  async function eligibleDocuments() {
    if (trustedAdmins.length === 0) return []
    const result = await query(
      `SELECT d.id, d.original_name, d.file_type, d.file_path,
              GROUP_CONCAT(DISTINCT NULLIF(dc.product_line, '') SEPARATOR '||') AS product_lines,
              GROUP_CONCAT(DISTINCT NULLIF(dc.product_model, '') SEPARATOR '||') AS product_models
       FROM documents d
       JOIN users owner ON owner.id = d.user_id
       JOIN document_chunks dc ON dc.document_id = d.id
       WHERE owner.username IN (?) AND d.status = 1
         AND COALESCE(dc.effective_status, 'active') <> 'deprecated'
       GROUP BY d.id, d.original_name, d.file_type, d.file_path
       HAVING COUNT(dc.id) > 0
       ORDER BY d.id`,
      [trustedAdmins]
    )
    return rowsFrom(result) || []
  }

  async function listProducts() {
    const documents = await eligibleDocuments()
    const documentsByProduct = new Map(FIRST_RELEASE_PRODUCTS.map(product => [product.productModel, new Set()]))

    for (const document of documents) {
      const chunkMetadata = {
        productLine: cleanText(document.product_lines).split('||').filter(Boolean).join('/'),
        productModel: cleanText(document.product_models).split('||').filter(Boolean).join('/'),
        effectiveStatus: 'active'
      }
      let matchedProducts = supportedProductsForMetadata(chunkMetadata)
      if (matchedProducts.length === 0 && !chunkMetadata.productModel) {
        const frontMatter = await readLegacyMetadata(document)
        matchedProducts = supportedProductsForMetadata({
          productLine: frontMatter.product_line,
          productModel: frontMatter.product_model,
          effectiveStatus: frontMatter.effective_status || 'active'
        })
      }
      for (const product of matchedProducts) documentsByProduct.get(product.productModel)?.add(Number(document.id))
    }

    return FIRST_RELEASE_PRODUCTS.flatMap(product => {
      const documentIds = [...(documentsByProduct.get(product.productModel) || [])].filter(Number.isSafeInteger).sort((a, b) => a - b)
      if (documentIds.length === 0) return []
      return [{
        productKey: productKeyFor(product.productLine, product.productModel),
        productLine: product.productLine,
        productModel: product.productModel,
        displayName: product.displayName,
        documentIds,
        documentCount: documentIds.length
      }]
    })
  }

  async function resolveProduct(productKey) {
    const key = cleanText(productKey)
    if (!key) return null
    return (await listProducts()).find(product => product.productKey === key) || null
  }

  async function resolveStoredProduct(productLine, productModel) {
    const line = cleanText(productLine)
    const model = cleanText(productModel)
    return (await listProducts()).find(product => product.productLine === line && product.productModel === model) || null
  }

  async function resolveChannelScope(channelCode) {
    const code = cleanText(channelCode)
    if (!SUPPORT_CHANNEL_CODE_PATTERN.test(code)) return null
    const result = await query(
      `SELECT display_name, product_line, product_model, channel_code
       FROM support_channels WHERE channel_code = ? AND is_active = 1 LIMIT 1`,
      [code]
    )
    const channel = rowsFrom(result)?.[0]
    if (!channel) return null
    const product = await resolveStoredProduct(channel.product_line, channel.product_model)
    return product ? { ...product, channelCode: code, channelDisplayName: channel.display_name } : null
  }

  async function resolveRequestScope({ productKey = '', supportChannelCode = '', allowUnscoped = false } = {}) {
    if (cleanText(supportChannelCode)) {
      const scope = await resolveChannelScope(supportChannelCode)
      if (!scope) throw new ProductScopeError('产品支持入口不存在、已停用或资料已失效', { code: 'SUPPORT_CHANNEL_UNAVAILABLE', status: 404 })
      return scope
    }
    if (cleanText(productKey)) {
      const scope = await resolveProduct(productKey)
      if (!scope) throw new ProductScopeError('产品型号不存在或暂无有效资料', { code: 'PRODUCT_UNAVAILABLE', status: 400 })
      return scope
    }
    if (allowUnscoped) return null
    throw new ProductScopeError('请先选择产品型号', { code: 'PRODUCT_REQUIRED', status: 400 })
  }

  return { listProducts, resolveProduct, resolveStoredProduct, resolveChannelScope, resolveRequestScope }
}
