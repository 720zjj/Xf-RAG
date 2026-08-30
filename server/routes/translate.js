import { Router } from 'express'
import { authMiddleware } from '../middleware/auth.js'
import pool from '../db.js'
import dotenv from 'dotenv'
dotenv.config()

const router = Router()

const LANGUAGES = [
  { code: 'zh', name: '中文' },
  { code: 'en', name: '英语' },
  { code: 'ja', name: '日语' },
  { code: 'ko', name: '韩语' },
  { code: 'fr', name: '法语' },
  { code: 'de', name: '德语' },
  { code: 'ru', name: '俄语' },
  { code: 'es', name: '西班牙语' },
  { code: 'ar', name: '阿拉伯语' },
]

// 翻译（当前为模拟，留好 API 接入接口）
router.post('/translate', authMiddleware, async (req, res) => {
  try {
    const { sourceText, sourceLang, targetLang, documentId } = req.body
    if (!sourceText || !sourceLang || !targetLang) {
      return res.json({ ok: false, error: '请提供源文本、源语言和目标语言' })
    }

    // TODO: 接入科大讯飞翻译 API
    // 当前使用模拟翻译
    const targetText = mockTranslate(sourceText, targetLang)

    // 保存到数据库
    await pool.query(
      `INSERT INTO translations (user_id, source_text, target_text, source_lang, target_lang, document_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [req.user.id, sourceText, targetText, sourceLang, targetLang, documentId || null]
    )

    res.json({
      ok: true,
      data: {
        sourceText,
        targetText,
        sourceLang,
        targetLang,
        sourceLangName: getLangName(sourceLang),
        targetLangName: getLangName(targetLang)
      }
    })
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message })
  }
})

// 获取翻译历史
router.get('/history', authMiddleware, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, source_text, target_text, source_lang, target_lang, created_at
       FROM translations WHERE user_id = ? ORDER BY created_at DESC LIMIT 200`,
      [req.user.id]
    )
    res.json({ ok: true, data: rows })
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message })
  }
})

// 获取语言列表
router.get('/languages', (req, res) => {
  res.json({ ok: true, data: LANGUAGES })
})

// 获取统计
router.get('/stats', authMiddleware, async (req, res) => {
  try {
    const [[{ total: translationCount }]] = await pool.query(
      'SELECT COUNT(*) as total FROM translations WHERE user_id = ?', [req.user.id]
    )
    const [[{ total: ragCount }]] = await pool.query(
      'SELECT COUNT(*) as total FROM rag_qa WHERE user_id = ?', [req.user.id]
    )
    const [[{ total: docCount }]] = await pool.query(
      'SELECT COUNT(*) as total FROM documents WHERE user_id = ?', [req.user.id]
    )
    const [[{ total: charCount }]] = await pool.query(
      'SELECT COALESCE(SUM(CHAR_LENGTH(source_text)), 0) as total FROM translations WHERE user_id = ?', [req.user.id]
    )

    res.json({
      ok: true,
      data: { translationCount, ragCount, docCount, charCount }
    })
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message })
  }
})

// 模拟翻译（待替换为真实 API）
function mockTranslate(text, targetLang) {
  const MOCK = {
    '你好': { en: 'Hello', ja: 'こんにちは', ko: '안녕하세요', fr: 'Bonjour', de: 'Hallo', ru: 'Привет', es: 'Hola', ar: 'مرحبا' },
    '谢谢': { en: 'Thank you', ja: 'ありがとう', ko: '감사합니다', fr: 'Merci', de: 'Danke', ru: 'Спасибо', es: 'Gracias', ar: 'شكرا' },
  }
  if (MOCK[text] && MOCK[text][targetLang]) return MOCK[text][targetLang]
  return `[${targetLang.toUpperCase()}] ${text} 的翻译结果（演示模式，待接入真实 API）`
}

function getLangName(code) {
  return LANGUAGES.find(l => l.code === code)?.name || code
}

export default router
