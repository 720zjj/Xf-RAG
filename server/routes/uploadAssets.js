import { Router } from 'express'
import fs from 'fs'
import path from 'path'
import pool from '../db.js'
import { authMiddleware } from '../middleware/auth.js'
import { buildKnowledgeScope } from '../services/knowledgeAccess.js'

const router = Router()
const uploadDir = path.resolve(process.env.UPLOAD_DIR || './uploads')
const imageExtensions = new Set(['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.tiff'])

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

// 视频内容面向已登录用户；原始文档不再通过静态目录公开。
router.use('/videos', authMiddleware, expressStaticSafe(path.join(uploadDir, 'videos')))

function expressStaticSafe(root) {
  return (req, res, next) => {
    const filename = path.basename(req.path)
    if (!filename || filename !== req.path.replace(/^\//, '') || path.extname(filename).toLowerCase() !== '.webm') {
      return res.status(404).end()
    }
    const filePath = path.resolve(root, filename)
    if (!filePath.startsWith(path.resolve(root) + path.sep) || !fs.existsSync(filePath)) return res.status(404).end()
    res.setHeader('Cache-Control', 'private, max-age=3600')
    res.sendFile(filePath)
  }
}

export default router
