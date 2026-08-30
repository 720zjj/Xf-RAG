import { Router } from 'express'
import path from 'path'
import fs from 'fs'
import crypto from 'crypto'
import { authMiddleware, isAdmin } from '../middleware/auth.js'
import { createRateLimit } from '../middleware/rateLimit.js'
import pool from '../db.js'

const router = Router()
const uploadRateLimit = createRateLimit({ windowMs: 60 * 60 * 1000, max: 20 })
const MAX_VIDEO_BYTES = Math.max(1, Number(process.env.MAX_VIDEO_UPLOAD_MB) || 100) * 1024 * 1024

function canManage(req, row) {
  return isAdmin(req) || Number(row.created_by) === Number(req.user.id)
}

// POST /api/video/upload-file - 保存生成的视频文件到 uploads/videos/（原始二进制流）
router.post('/upload-file', authMiddleware, uploadRateLimit, (req, res) => {
  const { filename } = req.query
  if (!filename || !/^[\w\u4e00-\u9fa5.-]+\.webm$/.test(filename)) {
    return res.status(400).json({ ok: false, error: '非法文件名' })
  }
  const contentLength = Number(req.headers['content-length'] || 0)
  const contentType = String(req.headers['content-type'] || '').split(';')[0].toLowerCase()
  if (!['video/webm', 'application/octet-stream'].includes(contentType)) {
    return res.status(415).json({ ok: false, error: '仅支持 WebM 视频流' })
  }
  if (contentLength > MAX_VIDEO_BYTES) {
    return res.status(413).json({ ok: false, error: `视频不能超过 ${MAX_VIDEO_BYTES / 1024 / 1024}MB` })
  }
  const dir = path.resolve(process.env.UPLOAD_DIR || './uploads', 'videos')
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  const storedName = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}.webm`
  const filePath = path.join(dir, storedName)
  const ws = fs.createWriteStream(filePath, { flags: 'wx' })
  let received = 0
  let failed = false
  const cleanup = () => { try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath) } catch {} }

  req.on('data', chunk => {
    received += chunk.length
    if (received > MAX_VIDEO_BYTES && !failed) {
      failed = true
      req.unpipe(ws)
      ws.destroy()
      cleanup()
      if (!res.headersSent) res.status(413).json({ ok: false, error: `视频不能超过 ${MAX_VIDEO_BYTES / 1024 / 1024}MB` })
    }
  })
  req.on('aborted', () => { failed = true; ws.destroy(); cleanup() })
  ws.on('finish', () => {
    if (!failed) res.json({ ok: true, url: `/uploads/videos/${storedName}`, originalName: filename })
  })
  ws.on('close', () => { if (failed) cleanup() })
  ws.on('error', (e) => {
    cleanup()
    if (!res.headersSent) res.status(500).json({ ok: false, error: '视频保存失败' })
    console.error('[video/upload]', e)
  })
  req.pipe(ws)
})

// GET /api/video/list - 视频列表（支持筛选）
router.get('/list', authMiddleware, async (req, res) => {
  try {
    const { productLine, productModel, category, keyword } = req.query
    const page = Math.max(1, Number(req.query.page) || 1)
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 20))
    let sql = 'SELECT * FROM videos WHERE publish_status = "published"'
    const params = []

    if (productLine) { sql += ' AND product_line = ?'; params.push(productLine) }
    if (productModel) { sql += ' AND (product_model = ? OR product_model = "")'; params.push(productModel) }
    if (category) { sql += ' AND category = ?'; params.push(category) }
    if (keyword) { sql += ' AND (title LIKE ? OR description LIKE ?)'; params.push(`%${keyword}%`, `%${keyword}%`) }

    const countSql = sql.replace('SELECT *', 'SELECT COUNT(*) as total')
    const [countRows] = await pool.query(countSql, params)
    const total = countRows[0].total

    sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?'
    params.push(pageSize, (page - 1) * pageSize)
    const [rows] = await pool.query(sql, params)

    res.json({ ok: true, data: { list: rows, total, page, pageSize } })
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message })
  }
})

// GET /api/video/search - 视频检索（关键词匹配标题/标签/章节关键词）
router.get('/search', authMiddleware, async (req, res) => {
  try {
    const { q, productLine, productModel } = req.query
    if (!q) return res.json({ ok: true, data: [] })

    let sql = `
      SELECT DISTINCT v.*, vc.title as matched_chapter, vc.start_time as chapter_start
      FROM videos v
      LEFT JOIN video_chapters vc ON v.id = vc.video_id
      WHERE v.publish_status = 'published'
        AND (v.title LIKE ? OR v.description LIKE ? OR JSON_SEARCH(v.tags, 'one', ?) IS NOT NULL OR vc.keywords LIKE ?)
    `
    const params = [`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`]

    if (productLine) { sql += ' AND (v.product_line = ? OR v.product_line = "翻译机")'; params.push(productLine) }
    if (productModel) { sql += ' AND (v.product_model = ? OR v.product_model = "")'; params.push(productModel) }

    sql += ' ORDER BY v.view_count DESC LIMIT 10'
    const [rows] = await pool.query(sql, params)
    res.json({ ok: true, data: rows })
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message })
  }
})

// GET /api/video/:id - 视频详情（含章节）
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const [videos] = await pool.query('SELECT * FROM videos WHERE id = ? AND publish_status = "published"', [req.params.id])
    if (!videos.length) return res.status(404).json({ ok: false, error: '视频不存在' })

    const [chapters] = await pool.query('SELECT * FROM video_chapters WHERE video_id = ? ORDER BY chapter_index', [req.params.id])
    const video = videos[0]
    video.chapters = chapters

    // 自增播放次数
    pool.query('UPDATE videos SET view_count = view_count + 1 WHERE id = ?', [req.params.id]).catch(() => {})

    res.json({ ok: true, data: video })
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message })
  }
})

// POST /api/video - 创建视频记录（管理端）
router.post('/', authMiddleware, async (req, res) => {
  let conn
  try {
    const { title, description, brand, productLine, productModel, firmwareVersion, category, tags, durationSeconds, videoUrl, thumbnailUrl, sourceSopId, chapters } = req.body
    if (typeof title !== 'string' || !title.trim() || title.length > 255) return res.status(400).json({ ok: false, error: '标题需为 1-255 个字符' })
    if (tags !== undefined && !Array.isArray(tags)) return res.status(400).json({ ok: false, error: 'tags 必须是数组' })
    if (chapters !== undefined && !Array.isArray(chapters)) return res.status(400).json({ ok: false, error: 'chapters 必须是数组' })

    conn = await pool.getConnection()
    await conn.beginTransaction()
    const [result] = await conn.query(
      `INSERT INTO videos (title, description, brand, product_line, product_model, firmware_version, category, tags, duration_seconds, video_url, thumbnail_url, source_sop_id, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [title.trim(), description || '', brand || '科大讯飞', productLine || '翻译机', productModel || '', firmwareVersion || '', category || '', JSON.stringify(tags || []), durationSeconds || 0, videoUrl || '', thumbnailUrl || '', sourceSopId || null, req.user.id]
    )

    const videoId = result.insertId

    // 批量插入章节
    if (chapters && chapters.length > 0) {
      for (let i = 0; i < chapters.length; i++) {
        const ch = chapters[i]
        await conn.query(
          'INSERT INTO video_chapters (video_id, chapter_index, title, start_time, end_time, step_number, keywords) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [videoId, i + 1, ch.title || `第${i + 1}步`, ch.startTime || 0, ch.endTime || null, ch.stepNumber || null, ch.keywords || '']
        )
      }
    }

    await conn.commit()
    res.status(201).json({ ok: true, data: { id: videoId } })
  } catch (err) {
    if (conn) await conn.rollback().catch(() => {})
    console.error('[video/create]', err)
    res.status(500).json({ ok: false, error: '创建视频失败' })
  } finally {
    conn?.release()
  }
})

// PUT /api/video/:id - 更新视频
router.put('/:id', authMiddleware, async (req, res) => {
  try {
    const { title, description, category, tags, durationSeconds, videoUrl, thumbnailUrl, reviewStatus, publishStatus } = req.body
    const [existing] = await pool.query('SELECT id, created_by FROM videos WHERE id = ?', [req.params.id])
    if (!existing.length) return res.status(404).json({ ok: false, error: '视频不存在' })
    if (!canManage(req, existing[0])) return res.status(403).json({ ok: false, error: '无权修改该视频' })
    if ((reviewStatus !== undefined || publishStatus !== undefined) && !isAdmin(req)) {
      return res.status(403).json({ ok: false, error: '只有管理员可以审核或发布视频' })
    }
    if (tags !== undefined && !Array.isArray(tags)) return res.status(400).json({ ok: false, error: 'tags 必须是数组' })
    if (reviewStatus !== undefined && !['draft', 'pending', 'approved', 'rejected'].includes(reviewStatus)) return res.status(400).json({ ok: false, error: '非法审核状态' })
    if (publishStatus !== undefined && !['unpublished', 'published', 'archived'].includes(publishStatus)) return res.status(400).json({ ok: false, error: '非法发布状态' })
    const fields = []
    const params = []

    if (title !== undefined) { fields.push('title = ?'); params.push(title) }
    if (description !== undefined) { fields.push('description = ?'); params.push(description) }
    if (category !== undefined) { fields.push('category = ?'); params.push(category) }
    if (tags !== undefined) { fields.push('tags = ?'); params.push(JSON.stringify(tags)) }
    if (durationSeconds !== undefined) { fields.push('duration_seconds = ?'); params.push(durationSeconds) }
    if (videoUrl !== undefined) { fields.push('video_url = ?'); params.push(videoUrl) }
    if (thumbnailUrl !== undefined) { fields.push('thumbnail_url = ?'); params.push(thumbnailUrl) }
    if (reviewStatus !== undefined) { fields.push('review_status = ?'); params.push(reviewStatus) }
    if (publishStatus !== undefined) { fields.push('publish_status = ?'); params.push(publishStatus) }

    if (fields.length === 0) return res.status(400).json({ ok: false, error: '无更新字段' })

    params.push(req.params.id)
    const [result] = await pool.query(`UPDATE videos SET ${fields.join(', ')} WHERE id = ?`, params)
    if (!result.affectedRows) return res.status(404).json({ ok: false, error: '视频不存在' })
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message })
  }
})

// POST /api/video/:id/resolve - 标记视频解决了问题
router.post('/:id/resolve', authMiddleware, async (req, res) => {
  let conn
  try {
    conn = await pool.getConnection()
    await conn.beginTransaction()
    const [videos] = await conn.query('SELECT id FROM videos WHERE id = ? AND publish_status = "published" FOR UPDATE', [req.params.id])
    if (!videos.length) throw Object.assign(new Error('视频不存在'), { status: 404 })
    const [insert] = await conn.query(
      'INSERT IGNORE INTO video_qa_links (video_id, qa_id, user_id, action) VALUES (?, ?, ?, "resolve")',
      [req.params.id, req.body.qaId || null, req.user.id]
    )
    if (insert.affectedRows) {
      await conn.query('UPDATE videos SET resolve_count = resolve_count + 1 WHERE id = ?', [req.params.id])
    }
    await conn.commit()
    res.json({ ok: true, counted: Boolean(insert.affectedRows) })
  } catch (err) {
    if (conn) await conn.rollback().catch(() => {})
    res.status(err.status || 500).json({ ok: false, error: err.status ? err.message : '记录失败' })
  } finally {
    conn?.release()
  }
})

// DELETE /api/video/:id - 删除视频
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const [existing] = await pool.query('SELECT id, created_by FROM videos WHERE id = ?', [req.params.id])
    if (!existing.length) return res.status(404).json({ ok: false, error: '视频不存在' })
    if (!canManage(req, existing[0])) return res.status(403).json({ ok: false, error: '无权删除该视频' })
    await pool.query('DELETE FROM videos WHERE id = ?', [req.params.id])
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message })
  }
})

export default router
