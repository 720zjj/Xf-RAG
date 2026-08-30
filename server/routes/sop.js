import { Router } from 'express'
import { authMiddleware, isAdmin } from '../middleware/auth.js'
import pool from '../db.js'

const router = Router()

function canManage(req, row) {
  return isAdmin(req) || Number(row.created_by) === Number(req.user.id)
}

// GET /api/sop/list - SOP列表（支持筛选）
router.get('/list', authMiddleware, async (req, res) => {
  try {
    const { productLine, productModel, category, keyword } = req.query
    const page = Math.max(1, Number(req.query.page) || 1)
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 20))
    let sql = "SELECT id, title, brand, product_line, product_model, firmware_version, category, difficulty, estimated_duration, review_status, source_document, created_at FROM sops WHERE review_status = 'approved'"
    const params = []

    if (productLine) { sql += ' AND product_line = ?'; params.push(productLine) }
    if (productModel) { sql += ' AND (product_model = ? OR product_model = "")'; params.push(productModel) }
    if (category) { sql += ' AND category = ?'; params.push(category) }
    if (keyword) { sql += ' AND title LIKE ?'; params.push(`%${keyword}%`) }

    const countSql = sql.replace(/SELECT .* FROM/, 'SELECT COUNT(*) as total FROM')
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

// GET /api/sop/search - SOP检索（匹配标题/步骤内容）
router.get('/search', authMiddleware, async (req, res) => {
  try {
    const { q, productLine, productModel } = req.query
    if (!q) return res.json({ ok: true, data: [] })

    let sql = `
      SELECT id, title, product_line, product_model, category, difficulty, estimated_duration, completion_check
      FROM sops
      WHERE review_status = 'approved' AND (title LIKE ? OR CAST(steps AS CHAR) LIKE ? OR completion_check LIKE ?)
    `
    const params = [`%${q}%`, `%${q}%`, `%${q}%`]

    if (productLine) { sql += ' AND (product_line = ? OR product_line = "翻译机")'; params.push(productLine) }
    if (productModel) { sql += ' AND (product_model = ? OR product_model = "")'; params.push(productModel) }

    sql += ' ORDER BY created_at DESC LIMIT 10'
    const [rows] = await pool.query(sql, params)
    res.json({ ok: true, data: rows })
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message })
  }
})

// GET /api/sop/:id - SOP详情（含完整步骤）
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT * FROM sops WHERE id = ? AND review_status = 'approved'", [req.params.id])
    if (!rows.length) return res.status(404).json({ ok: false, error: 'SOP不存在' })

    const sop = rows[0]
    // 解析 JSON 字段
    sop.prerequisites = safeParse(sop.prerequisites)
    sop.warnings = safeParse(sop.warnings)
    sop.steps = safeParse(sop.steps)
    sop.common_errors = safeParse(sop.common_errors)

    // 查找关联视频
    const [videos] = await pool.query('SELECT id, title, duration_seconds, video_url, thumbnail_url FROM videos WHERE source_sop_id = ? AND publish_status = "published" AND review_status = "approved"', [sop.id])
    sop.related_videos = videos

    res.json({ ok: true, data: sop })
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message })
  }
})

// POST /api/sop - 创建SOP
router.post('/', authMiddleware, async (req, res) => {
  try {
    const { title, brand, productLine, productModel, firmwareVersion, category, prerequisites, warnings, steps, completionCheck, commonErrors, sourceDocument, sourcePages, difficulty, estimatedDuration } = req.body
    if (typeof title !== 'string' || !title.trim() || title.length > 255) return res.status(400).json({ ok: false, error: '标题需为 1-255 个字符' })
    if (!Array.isArray(steps) || !steps.length) return res.status(400).json({ ok: false, error: '步骤必须是非空数组' })
    if (prerequisites !== undefined && !Array.isArray(prerequisites)) return res.status(400).json({ ok: false, error: '前置条件必须是数组' })
    if (warnings !== undefined && !Array.isArray(warnings)) return res.status(400).json({ ok: false, error: '警告信息必须是数组' })

    const [result] = await pool.query(
      `INSERT INTO sops (title, brand, product_line, product_model, firmware_version, category, prerequisites, warnings, steps, completion_check, common_errors, source_document, source_pages, difficulty, estimated_duration, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        title.trim(),
        brand || '科大讯飞',
        productLine || '翻译机',
        productModel || '',
        firmwareVersion || '',
        category || '',
        JSON.stringify(prerequisites || []),
        JSON.stringify(warnings || []),
        JSON.stringify(steps),
        completionCheck || '',
        JSON.stringify(commonErrors || []),
        sourceDocument || '',
        sourcePages || '',
        difficulty || 'easy',
        estimatedDuration || 0,
        req.user.id
      ]
    )

    res.status(201).json({ ok: true, data: { id: result.insertId } })
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message })
  }
})

// PUT /api/sop/:id - 更新SOP
router.put('/:id', authMiddleware, async (req, res) => {
  try {
    const { title, category, prerequisites, warnings, steps, completionCheck, commonErrors, difficulty, estimatedDuration, reviewStatus } = req.body
    const [existing] = await pool.query('SELECT id, created_by, review_status FROM sops WHERE id = ?', [req.params.id])
    if (!existing.length) return res.status(404).json({ ok: false, error: 'SOP不存在' })
    if (!canManage(req, existing[0])) return res.status(403).json({ ok: false, error: '无权修改该SOP' })
    if (reviewStatus !== undefined && !isAdmin(req)) {
      return res.status(403).json({ ok: false, error: '只有管理员可以审核SOP' })
    }
    if (steps !== undefined && (!Array.isArray(steps) || !steps.length)) return res.status(400).json({ ok: false, error: '步骤必须是非空数组' })
    if (prerequisites !== undefined && !Array.isArray(prerequisites)) return res.status(400).json({ ok: false, error: '前置条件必须是数组' })
    if (warnings !== undefined && !Array.isArray(warnings)) return res.status(400).json({ ok: false, error: '警告信息必须是数组' })
    if (reviewStatus !== undefined && !['draft', 'pending', 'approved', 'rejected'].includes(reviewStatus)) return res.status(400).json({ ok: false, error: '非法审核状态' })
    const fields = []
    const params = []
    const contentChanged = [title, category, prerequisites, warnings, steps, completionCheck, commonErrors, difficulty, estimatedDuration].some(value => value !== undefined)
    const reviewReset = existing[0].review_status === 'approved' && contentChanged && reviewStatus === undefined

    if (title !== undefined) { fields.push('title = ?'); params.push(title) }
    if (category !== undefined) { fields.push('category = ?'); params.push(category) }
    if (prerequisites !== undefined) { fields.push('prerequisites = ?'); params.push(JSON.stringify(prerequisites)) }
    if (warnings !== undefined) { fields.push('warnings = ?'); params.push(JSON.stringify(warnings)) }
    if (steps !== undefined) { fields.push('steps = ?'); params.push(JSON.stringify(steps)) }
    if (completionCheck !== undefined) { fields.push('completion_check = ?'); params.push(completionCheck) }
    if (commonErrors !== undefined) { fields.push('common_errors = ?'); params.push(JSON.stringify(commonErrors)) }
    if (difficulty !== undefined) { fields.push('difficulty = ?'); params.push(difficulty) }
    if (estimatedDuration !== undefined) { fields.push('estimated_duration = ?'); params.push(estimatedDuration) }
    if (reviewStatus !== undefined) { fields.push('review_status = ?'); params.push(reviewStatus) }
    if (reviewReset) { fields.push('review_status = ?'); params.push('pending') }

    if (fields.length === 0) return res.status(400).json({ ok: false, error: '无更新字段' })

    params.push(req.params.id)
    const [result] = await pool.query(`UPDATE sops SET ${fields.join(', ')} WHERE id = ?`, params)
    if (!result.affectedRows) return res.status(404).json({ ok: false, error: 'SOP不存在' })
    res.json({ ok: true, reviewReset })
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message })
  }
})

// DELETE /api/sop/:id - 删除SOP
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const [existing] = await pool.query('SELECT id, created_by FROM sops WHERE id = ?', [req.params.id])
    if (!existing.length) return res.status(404).json({ ok: false, error: 'SOP不存在' })
    if (!canManage(req, existing[0])) return res.status(403).json({ ok: false, error: '无权删除该SOP' })
    await pool.query('DELETE FROM sops WHERE id = ?', [req.params.id])
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message })
  }
})

function safeParse(val) {
  if (!val) return []
  if (typeof val === 'object') return val
  try { return JSON.parse(val) } catch { return [] }
}

export default router
