import pool from '../db.js'

const STOP_WORDS = new Set([
  '的', '了', '是', '在', '我', '有', '和', '就', '不', '人', '都', '一个', '上', '也', '很', '到', '说', '要', '去', '你', '会', '着',
  '没有', '看', '好', '自己', '这', '他', '她', '它', '怎么', '如何', '什么', '为什么', '可以', '能', '吗', '呢', '吧', '啊', '请问', '一下',
  '怎样', '哪个', '哪些', '翻译机', '使用', '操作', '功能', '问题', '需要', '时候', '已经', '正常', '设备'
])

const TROUBLESHOOT_PATTERNS = ['连不上', '无法', '失败', '异常', '错误', '搜不到', '没反应', '不能', '掉线', '排查', '修复', '重置']
const LEARN_PATTERNS = ['怎么', '如何', '教程', '步骤', '操作', '使用', '设置', '演示', '入门']
const TROUBLESHOOT_VIDEO_TERMS = ['排查', '失败', '异常', '无法', '错误', '重置', '修复', '解决', '故障']
const LEARN_VIDEO_TERMS = ['教程', '演示', '操作', '入门', '基础', '使用', '设置', '连接']

function textIncludes(value, keyword) {
  return String(value || '').toLocaleLowerCase().includes(String(keyword || '').toLocaleLowerCase())
}

function toArray(value) {
  if (Array.isArray(value)) return value
  if (!value) return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function chapterText(chapters) {
  return chapters.map(chapter => `${chapter.title || ''} ${chapter.keywords || ''}`).join(' ')
}

function includesAny(value, terms) {
  const text = String(value || '').toLocaleLowerCase()
  return terms.filter(term => text.includes(term.toLocaleLowerCase()))
}

function videoSearchText(video) {
  return [
    video.title,
    video.category,
    toArray(video.tags).join(' '),
    video.description,
    video.product_model,
    chapterText(toArray(video.chapters))
  ].filter(Boolean).join(' ')
}

function getVideoIntentMatch(video, kind) {
  const text = videoSearchText(video)
  const terms = kind === 'troubleshoot' ? TROUBLESHOOT_VIDEO_TERMS : kind === 'learn' ? LEARN_VIDEO_TERMS : []
  const hits = includesAny(text, terms)
  if (hits.length === 0) return { score: 0, terms: [] }
  return { score: 12 + Math.min(6, (hits.length - 1) * 2), terms: hits }
}

export function classifyVideoNeed(question) {
  const text = String(question || '')
  const troubleshootingEvidence = includesAny(text, TROUBLESHOOT_PATTERNS)
  if (troubleshootingEvidence.length > 0) {
    return { kind: 'troubleshoot', label: '故障排查', evidence: troubleshootingEvidence }
  }
  const learningEvidence = includesAny(text, LEARN_PATTERNS)
  if (learningEvidence.length > 0) {
    return { kind: 'learn', label: '操作学习', evidence: learningEvidence }
  }
  return { kind: 'general', label: '相关操作', evidence: [] }
}

export function buildVideoGuidance(question, videos) {
  if (!Array.isArray(videos) || videos.length === 0) return null
  const diagnosis = classifyVideoNeed(question)
  const plannedVideos = videos
    .map(video => {
      const intentMatch = getVideoIntentMatch(video, diagnosis.kind)
      const intentScore = Number.isFinite(Number(video.intentScore)) ? Number(video.intentScore) : intentMatch.score
      return {
        ...video,
        guidanceScore: Number(video.relevance || 0) + intentScore,
        guidanceReason: intentMatch.terms.length > 0
          ? `识别为${diagnosis.label}，这条视频包含${intentMatch.terms.slice(0, 2).join('、')}内容。`
          : `这条视频与当前${diagnosis.label}问题的关键词匹配。`
      }
    })
    .sort((left, right) =>
      right.guidanceScore - left.guidanceScore ||
      Number(right.resolve_count || 0) - Number(left.resolve_count || 0) ||
      Number(right.view_count || 0) - Number(left.view_count || 0) ||
      Number(left.id) - Number(right.id)
    )
    .slice(0, 3)
    .map((video, index) => ({
      ...video,
      guidanceRole: index === 0 ? 'primary' : 'fallback',
      guidancePosition: index + 1
    }))

  return {
    diagnosis,
    primaryVideo: plannedVideos[0],
    fallbackVideos: plannedVideos.slice(1)
  }
}

export function extractRecommendationKeywords(question) {
  const source = String(question || '').trim()
  if (!source) return []

  const english = (source.match(/[a-zA-Z0-9][a-zA-Z0-9.]+/g) || []).filter(word => word.length >= 2)
  const chineseSegments = source.replace(/[a-zA-Z0-9.？?！!。，,、\s]+/g, '|').split('|').filter(segment => segment.length >= 2)
  const chinese = []
  for (const segment of chineseSegments) {
    for (let size = 2; size <= 4; size++) {
      for (let index = 0; index <= segment.length - size; index++) {
        const word = segment.slice(index, index + size)
        if (!STOP_WORDS.has(word)) chinese.push(word)
      }
    }
  }
  return [...new Set([...english, ...chinese])].slice(0, 10)
}

export function rankVideos(videos, { keywords = [], productLine = '', productModel = '', guidanceKind = 'general' } = {}) {
  const normalizedKeywords = [...new Set(keywords.map(keyword => String(keyword || '').trim()).filter(Boolean))]
  if (normalizedKeywords.length === 0) return []

  return videos
    .filter(video => {
      const videoLine = String(video.product_line || '')
      const videoModel = String(video.product_model || '')
      return (!productLine || !videoLine || videoLine === productLine || videoLine === '翻译机') &&
        (!productModel || !videoModel || videoModel === productModel)
    })
    .map(video => {
      const tags = toArray(video.tags)
      const chapters = toArray(video.chapters)
      const sources = {
        title: String(video.title || ''),
        category: String(video.category || ''),
        tags: tags.join(' '),
        description: String(video.description || ''),
        model: String(video.product_model || ''),
        chapters: chapterText(chapters)
      }
      const matchedKeywords = []
      const matchReasons = []
      let relevance = 0

      for (const keyword of normalizedKeywords) {
        let matched = false
        if (textIncludes(sources.title, keyword)) {
          relevance += 10; matched = true
          matchReasons.push(`标题匹配「${keyword}」`)
        }
        if (textIncludes(sources.category, keyword)) {
          relevance += 5; matched = true
          matchReasons.push(`分类匹配「${keyword}」`)
        }
        if (textIncludes(sources.tags, keyword)) {
          relevance += 8; matched = true
          matchReasons.push(`标签匹配「${keyword}」`)
        }
        if (textIncludes(sources.model, keyword)) {
          relevance += 8; matched = true
          matchReasons.push(`型号匹配「${keyword}」`)
        }
        if (textIncludes(sources.chapters, keyword)) {
          relevance += 5; matched = true
          matchReasons.push(`操作步骤匹配「${keyword}」`)
        }
        if (textIncludes(sources.description, keyword)) {
          relevance += 2; matched = true
          matchReasons.push(`简介匹配「${keyword}」`)
        }
        if (matched) matchedKeywords.push(keyword)
      }

      if (productModel && String(video.product_model || '') === productModel) {
        relevance += 4
        matchReasons.push(`适配${productModel}`)
      }
      const intentMatch = getVideoIntentMatch(video, guidanceKind)
      if (intentMatch.score > 0) {
        relevance += intentMatch.score
        matchReasons.push(`${guidanceKind === 'troubleshoot' ? '排障' : '教程'}意图匹配「${intentMatch.terms.slice(0, 2).join('、')}」`)
      }
      return {
        ...video,
        relevance,
        intentScore: intentMatch.score,
        matchedKeywords,
        matchReasons: [...new Set(matchReasons)]
      }
    })
    .filter(video => video.matchedKeywords.length > 0)
    .sort((left, right) =>
      right.relevance - left.relevance ||
      Number(right.resolve_count || 0) - Number(left.resolve_count || 0) ||
      Number(right.view_count || 0) - Number(left.view_count || 0) ||
      Number(left.id) - Number(right.id)
    )
}

export async function findVideoRecommendations(question, filters = {}) {
  const keywords = extractRecommendationKeywords(question)
  if (keywords.length === 0) return []

  let sql = `SELECT id, title, description, category, duration_seconds, video_url, thumbnail_url,
                    product_line, product_model, tags, view_count, resolve_count
             FROM videos WHERE publish_status = 'published'`
  const params = []
  if (filters.productLine) {
    sql += ' AND (product_line = ? OR product_line = "翻译机" OR product_line = "")'
    params.push(filters.productLine)
  }
  if (filters.productModel) {
    sql += ' AND (product_model = ? OR product_model = "")'
    params.push(filters.productModel)
  }
  const [videos] = await pool.query(sql, params)
  if (videos.length === 0) return []

  const ids = videos.map(video => video.id)
  const [chapters] = await pool.query(
    `SELECT video_id, title, keywords, start_time, end_time
     FROM video_chapters WHERE video_id IN (${ids.map(() => '?').join(', ')})
     ORDER BY video_id, chapter_index`,
    ids
  )
  const chaptersByVideo = new Map()
  for (const chapter of chapters) {
    const current = chaptersByVideo.get(chapter.video_id) || []
    current.push(chapter)
    chaptersByVideo.set(chapter.video_id, current)
  }

  const diagnosis = classifyVideoNeed(question)
  return rankVideos(
    videos.map(video => ({ ...video, chapters: chaptersByVideo.get(video.id) || [] })),
    { keywords, guidanceKind: diagnosis.kind, ...filters }
  ).slice(0, 3)
}
