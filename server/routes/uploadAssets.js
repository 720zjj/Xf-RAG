import { Router } from 'express'
import fs from 'fs'
import path from 'path'
import pool from '../db.js'
import { authMiddleware, isAdmin } from '../middleware/auth.js'
import { buildKnowledgeScope } from '../services/knowledgeAccess.js'

const router = Router()
const uploadDir = path.resolve(process.env.UPLOAD_DIR || './uploads')
const imageExtensions = new Set(['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.tiff'])

export function isVideoAssetFilename(filename) {
  return typeof filename === 'string' && /^[a-zA-Z0-9_-]+\.webm$/.test(filename)
}

router.get('/images/:docId/:filename', authMiddleware, async (req, res) => {
  try {
    const docId = Number(req.params.docId)
    const filename = path.basename(req.params.filename)
    if (!Number.isInteger(docId) || docId <= 0 || filename !== req.params.filename) {
      return res.status(400).json({ ok: false, error: '非法资源路径' })
    }
    if (!imageExtensions.has(path.extname(filename).toLowerCase())) {
      return res.status(400).json({ ok: false, error: '不支持的图片类型' })
    }

    const scope = buildKnowledgeScope(req.user.id, { documentAlias: 'd', ownerAlias: 'owner' })
    const [docs] = await pool.query(
      `SELECT d.id FROM documents d JOIN users owner ON d.user_id = owner.id WHERE d.id = ? AND ${scope.where}`,
      [docId, ...scope.params]
    )
    if (docs.length === 0) return res.status(404).json({ ok: false, error: '资源不存在' })

    const imageDir = path.resolve(uploadDir, 'images', String(docId))
    const filePath = path.resolve(imageDir, filename)
    if (!filePath.startsWith(imageDir + path.sep) || !fs.existsSync(filePath)) {
      return res.status(404).json({ ok: false, error: '资源不存在' })
    }
    res.setHeader('Cache-Control', 'private, max-age=3600')
    res.sendFile(filePath)
  } catch (err) {
    console.error('[uploads/image]', err)
    res.status(500).json({ ok: false, error: '读取图片失败' })
  }
})

// 已发布视频面向已登录用户；草稿仅管理员可读，避免猜测文件名直接访问未审核素材。
router.get('/videos/:filename', authMiddleware, async (req, res) => {
  try {
    const filename = path.basename(req.params.filename)
    if (!filename || filename !== req.params.filename || !isVideoAssetFilename(filename)) return res.status(404).end()

    if (!isAdmin(req)) {
      const [rows] = await pool.query(
        "SELECT id FROM videos WHERE video_url = ? AND review_status = 'approved' AND publish_status = 'published' LIMIT 1",
        [`/uploads/videos/${filename}`]
      )
      if (!rows.length) return res.status(404).end()
    }

    const videoDir = path.resolve(uploadDir, 'videos')
    const filePath = path.resolve(videoDir, filename)
    if (!filePath.startsWith(videoDir + path.sep) || !fs.existsSync(filePath)) return res.status(404).end()
    res.setHeader('Cache-Control', 'private, max-age=3600')
    res.sendFile(filePath)
  } catch (err) {
    console.error('[uploads/video]', err)
    res.status(500).json({ ok: false, error: '读取视频失败' })
  }
})

export default router
