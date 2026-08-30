/**
 * 轻量级单进程限流。生产多实例部署时应替换为 Redis 等共享存储。
 */
export function createRateLimit({ windowMs = 15 * 60 * 1000, max = 20 } = {}) {
  const buckets = new Map()
  return (req, res, next) => {
    const now = Date.now()
    if (buckets.size > 10000) {
      for (const [bucketKey, bucket] of buckets) {
        if (bucket.resetAt <= now) buckets.delete(bucketKey)
      }
    }
    const key = req.ip || req.socket.remoteAddress || 'unknown'
    const current = buckets.get(key)
    if (!current || current.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + windowMs })
      return next()
    }
    current.count += 1
    if (current.count > max) {
      res.setHeader('Retry-After', Math.ceil((current.resetAt - now) / 1000))
      return res.status(429).json({ ok: false, error: '请求过于频繁，请稍后再试' })
    }
    next()
  }
}
