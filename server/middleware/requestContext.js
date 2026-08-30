import crypto from 'node:crypto'

const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{8,128}$/

function requestPathname(req) {
  const rawUrl = req.originalUrl || req.url || req.path || '/'
  try {
    return new URL(rawUrl, 'http://request.local').pathname || '/'
  } catch {
    return '/'
  }
}

export function createRequestId(value, randomUuid = crypto.randomUUID) {
  const candidate = typeof value === 'string' ? value.trim() : ''
  return REQUEST_ID_PATTERN.test(candidate) ? candidate : randomUuid()
}

export function requestContextMiddleware(req, res, next) {
  const requestId = createRequestId(req.headers?.['x-request-id'])
  req.requestId = requestId
  res.setHeader('X-Request-ID', requestId)
  next()
}

export function requestLogMiddleware(logger = console.log) {
  return (req, res, next) => {
    const startedAt = Date.now()
    res.on('finish', () => {
      const entry = {
        event: 'http_request',
        requestId: req.requestId || createRequestId(),
        method: req.method,
        path: requestPathname(req),
        status: res.statusCode,
        durationMs: Math.max(0, Date.now() - startedAt)
      }
      logger(JSON.stringify(entry))
    })
    next()
  }
}
