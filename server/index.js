import express from 'express'
import cors from 'cors'
import path from 'path'
import { fileURLToPath } from 'url'
import fs from 'fs'
import dotenv from 'dotenv'
import authRoutes from './routes/auth.js'
import documentRoutes from './routes/documents.js'
import ragRoutes from './routes/rag.js'
import videoRoutes from './routes/video.js'
import sopRoutes from './routes/sop.js'
import uploadAssetRoutes from './routes/uploadAssets.js'
import supportChannelRoutes from './routes/supportChannels.js'
import pool, { checkDatabase, closeDatabase } from './db.js'
import { getJwtSecret } from './middleware/auth.js'
import { assertRuntimeConfig } from './config/runtimeConfig.js'
import { requestContextMiddleware, requestLogMiddleware } from './middleware/requestContext.js'
import { reconcileQueuedDocumentJobs } from './services/documentJobService.js'
import { checkRedisReadiness } from './queues/documentQueue.js'

// 禁用 ONNX Runtime BFC Arena，防止本地 LLM 推理时 OOM（需搭配 --max-old-space-size=8192 启动）
process.env.ORT_DISABLE_ARENA_ALLOCATOR = '1'
import { isLLMEnabled, isAnyLLMAvailable } from './services/ragEngine.js'
import { isAgentEnabled } from './services/ragAgent.js'
import { warmupLocalLLM, isLocalLLMReady } from './services/localLLM.js'
import { warmupEmbedding, EMBED_MODEL_NAME } from './services/embedding.js'

dotenv.config()
assertRuntimeConfig()

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const app = express()
const PORT = process.env.PORT || 3000
app.disable('x-powered-by')
app.use(requestContextMiddleware)
app.use(requestLogMiddleware())

// 中间件
const allowedOrigins = new Set(
  (process.env.CORS_ORIGINS || 'http://localhost:5173,http://127.0.0.1:5173,http://localhost:3000,http://127.0.0.1:3000')
    .split(',').map(v => v.trim()).filter(Boolean)
)
app.use(cors({
  credentials: true,
  origin(origin, callback) {
    if (!origin || allowedOrigins.has(origin)) return callback(null, true)
    callback(new Error('Origin not allowed by CORS'))
  }
}))
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Referrer-Policy', 'no-referrer')
  res.setHeader('X-Frame-Options', 'DENY')
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'")
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers['sec-fetch-site'] === 'cross-site') {
    return res.status(403).json({ ok: false, error: '拒绝跨站请求' })
  }
  next()
})
app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true }))
app.use((req, res, next) => { if (req.body == null) req.body = {}; next() })

// 上传目录只负责落盘；资源通过带鉴权的路由读取，避免整个目录公开。
const uploadDir = path.resolve(process.env.UPLOAD_DIR || './uploads')
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true })
app.use('/uploads', uploadAssetRoutes)

// 静态文件：前端构建产物
const clientDist = path.resolve(__dirname, '../dist')
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist))
}

// API 路由
app.use('/api/auth', authRoutes)
app.use('/api/documents', documentRoutes)
app.use('/api/rag', ragRoutes)
app.use('/api/video', videoRoutes)
app.use('/api/sop', sopRoutes)
app.use('/api/support-channels', supportChannelRoutes)

// 健康检查
app.get('/api/live', (req, res) => res.json({ ok: true }))

app.get('/api/health', async (req, res) => {
  let database = false
  let redis = false
  try { database = await checkDatabase() } catch {}
  try { redis = await checkRedisReadiness() } catch {}
  const ready = Boolean(database && redis)
  res.status(ready ? 200 : 503).json({
    ok: ready,
    message: ready ? '科大讯飞翻译机智能助手 API 已就绪' : '关键依赖尚未就绪',
    database,
    redis,
    llm: {
      external: isLLMEnabled(),
      local: isLocalLLMReady(),
      available: isAnyLLMAvailable()
    },
    agentEnabled: isAgentEnabled()
  })
})

// SPA 回退
app.get('/{*splat}', (req, res) => {
  if (fs.existsSync(clientDist)) {
    res.sendFile(path.join(clientDist, 'index.html'))
  } else {
    res.json({ message: '前端未构建，请执行 npm run build' })
  }
})

app.use((err, req, res, next) => {
  if (res.headersSent) return next(err)
  if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ ok: false, error: '上传文件过大' })
  if (err.message === 'Origin not allowed by CORS') return res.status(403).json({ ok: false, error: '不允许的请求来源' })
  console.error(JSON.stringify({
    requestId: req.requestId || null,
    name: String(err?.name || 'Error').slice(0, 64),
    code: err?.code == null ? null : String(err.code).slice(0, 64)
  }))
  res.status(500).json({ ok: false, error: '服务器内部错误' })
})

getJwtSecret()

const httpServer = app.listen(PORT, async () => {
  console.log(`\n 服务器启动成功！`)
  console.log(`   API 地址: http://localhost:${PORT}/api`)
  console.log(`   健康检查: http://localhost:${PORT}/api/health`)
  console.log(`   上传目录: ${uploadDir}`)
  const extLLM = isLLMEnabled()
  console.log(`   LLM 状态: ${extLLM ? '✅ 外部 (' + process.env.LLM_MODEL + ')' : '⚠️ 外部未配置 → 自动回退本地 Xenova 模型'}`)
  console.log('')

  try {
    await checkDatabase()
    const reconciled = await reconcileQueuedDocumentJobs()
    const restored = reconciled.filter(result => result.queued).length
    if (restored > 0) console.log(`   已恢复投递 ${restored} 个等待中的文档任务`)
  } catch (err) {
    console.error(`   数据库尚未就绪: ${err.message}`)
  }

  // 预热本地 embedding 模型（首次需联网下载并缓存），避免首个问答阻塞过久
  console.log(`   预热向量模型: ${EMBED_MODEL_NAME} ...`)
  warmupEmbedding().then(ok => {
    console.log(ok ? '   ✓ 向量模型就绪' : '   ⚠ 向量模型预热失败，将在首次查询时重试')
  })

  // 预热本地 LLM 模型（后台进行，不阻塞服务启动）
  if (!extLLM) {
    console.log(`   预热本地 LLM: Xenova/Qwen1.5-0.5B-Chat ...`)
    warmupLocalLLM().then(ok => {
      console.log(ok ? '   ✓ 本地 LLM 就绪，Agent 策略可用' : '   ⚠ 本地 LLM 预热失败，将在首次查询时重试')
    })
  }
})

let shuttingDown = false
async function shutdown(signal) {
  if (shuttingDown) return
  shuttingDown = true
  console.log(`[shutdown] 收到 ${signal}，正在关闭服务...`)
  httpServer.close(async () => {
    try { await closeDatabase() } finally { process.exit(0) }
  })
  setTimeout(() => process.exit(1), 10000).unref()
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))

export { app, httpServer, pool }
