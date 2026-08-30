import { parsePublicAppUrl } from '../services/supportChannelService.js'

const PLACEHOLDER_JWT_SECRETS = new Set([
  'your_jwt_secret',
  'change_me',
  'change-me',
  'replace_me',
  'replace-me',
  'placeholder',
  'example'
])

const PLACEHOLDER_DATABASE_PASSWORDS = new Set([
  'your_db_password',
  'replace-with-local-app-password',
  'replace-with-local-root-password',
  'change_me',
  'change-me',
  'replace_me',
  'replace-me',
  'placeholder',
  'example'
])

function text(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function isPort(value) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 65_535
}

function isPlaceholderJwtSecret(value) {
  const normalized = text(value).toLowerCase()
  return !normalized || PLACEHOLDER_JWT_SECRETS.has(normalized) || /^(your|change|replace|example|placeholder)[_-]/.test(normalized)
}

function isPlaceholderDatabasePassword(value) {
  const normalized = text(value).toLowerCase()
  return PLACEHOLDER_DATABASE_PASSWORDS.has(normalized) || /^(your|change|replace|example|placeholder)[_-]/.test(normalized)
}

function hasCorsOrigin(value, expectedOrigin) {
  return text(value).split(',').map(text).includes(expectedOrigin)
}

function validRedisUrl(value) {
  try {
    const url = new URL(text(value))
    return ['redis:', 'rediss:'].includes(url.protocol)
  } catch {
    return false
  }
}

export function validateRuntimeConfig(env = process.env) {
  const errors = []
  if (!isPort(env.PORT)) errors.push('PORT 必须是 1 到 65535 之间的整数')
  if (!isPort(env.DB_PORT)) errors.push('DB_PORT 必须是 1 到 65535 之间的整数')
  if (!text(env.DB_HOST)) errors.push('DB_HOST 不能为空')
  if (!text(env.DB_USER)) errors.push('DB_USER 不能为空')
  if (!text(env.DB_PASSWORD)) errors.push('DB_PASSWORD 不能为空')
  if (!text(env.DB_NAME)) errors.push('DB_NAME 不能为空')
  if (!text(env.UPLOAD_DIR)) errors.push('UPLOAD_DIR 不能为空')
  if (!validRedisUrl(env.REDIS_URL)) errors.push('REDIS_URL 必须使用 redis:// 或 rediss:// 协议')
  if (isPlaceholderJwtSecret(env.JWT_SECRET)) errors.push('JWT_SECRET 未配置或仍为示例值')

  if (env.NODE_ENV === 'production') {
    if (text(env.DB_PASSWORD) && isPlaceholderDatabasePassword(env.DB_PASSWORD)) {
      errors.push('生产环境 DB_PASSWORD 不能使用示例值')
    }
    if (text(env.JWT_SECRET).length < 32 && !isPlaceholderJwtSecret(env.JWT_SECRET)) {
      errors.push('生产环境 JWT_SECRET 至少需要 32 个字符')
    }
    try {
      const publicAppUrl = parsePublicAppUrl(env.PUBLIC_APP_URL, { production: true })
      if (!hasCorsOrigin(env.CORS_ORIGINS, new URL(publicAppUrl).origin)) {
        errors.push('生产环境 CORS_ORIGINS 必须包含与 PUBLIC_APP_URL 相同的公开来源')
      }
    } catch (error) {
      errors.push(`PUBLIC_APP_URL 配置无效：${error.message}`)
    }
  }

  return { ok: errors.length === 0, errors }
}

export function assertRuntimeConfig(env = process.env) {
  const result = validateRuntimeConfig(env)
  if (!result.ok) throw new Error(`运行环境配置无效：${result.errors.join('；')}`)
}
