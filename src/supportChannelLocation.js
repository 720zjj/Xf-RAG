const CHANNEL_CODE_PATTERN = /^[A-Za-z0-9_-]{20,80}$/

export function getSupportChannelCode(locationLike) {
  const pathname = typeof locationLike?.pathname === 'string' ? locationLike.pathname : ''
  const match = pathname.match(/^\/support\/([^/]+)\/?$/)
  if (!match || !CHANNEL_CODE_PATTERN.test(match[1])) return null
  return match[1]
}
