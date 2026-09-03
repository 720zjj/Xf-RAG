import pool from '../db.js'
import {
  getDirectSupportIntent,
  isGettingStartedQuestion,
  isTranslationLanguageSwitchQuestion,
  isFactoryResetQuestion,
  isLiquidDamageQuestion,
  isOfflinePackageQuestion,
  isTranslationReplayEvidence,
  isTranslationReplayQuestion
} from './questionIntent.js'

const STOP_WORDS = new Set([
  '的', '了', '是', '在', '我', '有', '和', '就', '不', '人', '都', '一个', '上', '也', '很', '到', '说', '要', '去', '你', '会', '着',
  '没有', '看', '好', '自己', '这', '他', '她', '它', '怎么', '如何', '什么', '为什么', '可以', '能', '吗', '呢', '吧', '啊', '请问', '一下',
  '怎样', '哪个', '哪些', '翻译机', '使用', '操作', '功能', '问题', '需要', '时候', '已经', '正常', '设备',
  '翻译', '译机'
])

const TROUBLESHOOT_PATTERNS = ['连不上', '无法', '失败', '异常', '错误', '搜不到', '没反应', '不能', '掉线', '排查', '修复', '重置']
const LEARN_PATTERNS = ['怎么', '如何', '教程', '步骤', '操作', '使用', '设置', '演示', '入门']
const TROUBLESHOOT_VIDEO_TERMS = ['排查', '失败', '异常', '无法', '错误', '重置', '修复', '解决', '故障']
const LEARN_VIDEO_TERMS = ['教程', '演示', '操作', '入门', '基础', '使用', '设置', '连接']
const TRANSLATION_LANGUAGE_ACTION_TERMS = ['切换', '更换', '修改', '选择', '设置', '调整']
const TRANSLATION_LANGUAGE_OBJECT_TERMS = ['翻译语言', '翻译语种', '互译语言', '互译语种', '语言对', '源语言', '目标语言']
const INFORMATION_ONLY_INTENTS = new Set([
  'supported-language-capability',
  'offline-translation-capability'
])

function textIncludes(value, keyword) {
  const normalize = input => String(input || '').toLocaleLowerCase().replace(/[\s_-]+/g, '')
  return normalize(value).includes(normalize(keyword))
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

function coversTranslationLanguageSwitch(video) {
  const text = videoSearchText(video).replace(/\s+/g, '')
  return TRANSLATION_LANGUAGE_ACTION_TERMS.some(term => text.includes(term)) &&
    TRANSLATION_LANGUAGE_OBJECT_TERMS.some(term => text.includes(term))
}

function isOfficialVoiceTranslationGuide(video, productModel) {
  const exactModel = String(productModel || '').trim()
  if (!exactModel || String(video.product_model || '').trim() !== exactModel) return false
  if (String(video.source_provider || '').trim() !== 'iflytek-h5') return false
  if (Number(video.source_priority || 0) <= 0) return false
  return /语音翻译/.test(videoSearchText(video))
}

function expectedOfficialVideoTitle(question) {
  const text = String(question || '').replace(/\s+/g, '')
  const mappings = [
    [/同声字幕/, '同声字幕'],
    [/会议翻译/, '会议翻译'],
    [/演讲翻译/, '演讲翻译'],
    [/通话翻译/, '通话翻译'],
    [/群组翻译/, '群组翻译'],
    [/(?:翻译|对话|历史)记录.*(?:同步|导出|手机|电脑)/, '记录导出'],
    [/(?:首次|第一次).*(?:激活|使用)/, '快速上手'],
    [/免按键翻译/, '免按键翻译'],
    [/面对面翻译/, '面对面翻译'],
    [/拍照翻译/, '拍照翻译'],
    [/语音翻译/, '语音翻译']
  ]
  return mappings.find(([pattern]) => pattern.test(text))?.[1] || ''
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
      Number(right.source_priority || 0) - Number(left.source_priority || 0) ||
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

  const featureText = source.replace(/(?:科大讯飞)?(?:双屏)?翻译机/gi, '')
  const english = (featureText.match(/[a-zA-Z0-9](?:[a-zA-Z0-9._-]*[a-zA-Z0-9])?/g) || [])
    .map(word => word.replace(/[\s_-]+/g, ''))
    .filter(word => word.length >= 2)
  const chineseSegments = featureText.replace(/[a-zA-Z0-9._-]+|[？?！!。，,、\s]+/g, '|').split('|').filter(segment => segment.length >= 2)
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

export function rankVideos(videos, { question = '', keywords = [], productLine = '', productModel = '', guidanceKind = 'general' } = {}) {
  const normalizedKeywords = [...new Set(keywords.map(keyword => String(keyword || '').trim()).filter(Boolean))]
  if (normalizedKeywords.length === 0) return []
  const needsTranslationLanguageSwitch = isTranslationLanguageSwitchQuestion(question)
  const needsTranslationReplay = isTranslationReplayQuestion(question)
  const needsFactoryReset = isFactoryResetQuestion(question)
  const needsLiquidDamage = isLiquidDamageQuestion(question)
  const needsOfflinePackage = isOfflinePackageQuestion(question)
  const needsGettingStarted = isGettingStartedQuestion(question)
  const directSupportIntent = getDirectSupportIntent(question)
  if (directSupportIntent === 'disassembly' || INFORMATION_ONLY_INTENTS.has(directSupportIntent)) return []
  const expectedOfficialTitle = expectedOfficialVideoTitle(question)

  return videos
    .filter(video => {
      const videoLine = String(video.product_line || '')
      const videoModel = String(video.product_model || '')
      return (!productLine || !videoLine || videoLine === productLine || videoLine === '翻译机') &&
        (!productModel || !videoModel || videoModel === productModel) &&
        (!needsTranslationLanguageSwitch || coversTranslationLanguageSwitch(video) || isOfficialVoiceTranslationGuide(video, productModel)) &&
        (!needsTranslationReplay || isTranslationReplayEvidence(videoSearchText(video))) &&
        (!needsFactoryReset || /(恢复出厂|出厂设置|重置设备)/.test(videoSearchText(video))) &&
        (!needsLiquidDamage || /(进水|浸水|液体接触)/.test(videoSearchText(video)))
        && (!needsOfflinePackage || /(离线(?:语言)?包|离线包管理|离线翻译包)/.test(videoSearchText(video)))
        && (!needsGettingStarted || /(首次|激活|入门|语音翻译|基础操作)/.test(videoSearchText(video)))
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

      if (needsTranslationLanguageSwitch && isOfficialVoiceTranslationGuide(video, productModel)) {
        relevance += 14
        matchedKeywords.push('官方语音翻译教程')
        matchReasons.push('同型号官方语音翻译教程补充')
      }
      if (needsTranslationReplay && isTranslationReplayEvidence(videoSearchText(video))) {
        relevance += 18
        matchedKeywords.push('翻译结果复听')
        matchReasons.push('直接覆盖翻译结果复听')
      }
      if (expectedOfficialTitle && String(video.title || '').trim() === expectedOfficialTitle &&
          String(video.source_provider || '').trim() === 'iflytek-h5' &&
          (!productModel || String(video.product_model || '').trim() === productModel)) {
        relevance += 100
        matchedKeywords.push(`官方${expectedOfficialTitle}`)
        matchReasons.push(`直接匹配同型号官方《${expectedOfficialTitle}》视频`)
      }

      if (productModel && String(video.product_model || '') === productModel) {
        relevance += 4
        matchReasons.push(`适配${productModel}`)
      }
      if (Number(video.source_priority || 0) > 0) {
        relevance += Math.min(8, Math.ceil(Number(video.source_priority) / 20))
        matchReasons.push('科大讯飞官方视频来源')
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
      Number(right.source_priority || 0) - Number(left.source_priority || 0) ||
      Number(right.resolve_count || 0) - Number(left.resolve_count || 0) ||
      Number(right.view_count || 0) - Number(left.view_count || 0) ||
      Number(left.id) - Number(right.id)
    )
}

export function filterSopRecommendationsForQuestion(sops, question) {
  const list = Array.isArray(sops) ? sops : []
  const searchable = sop => [
    sop?.title,
    sop?.steps,
    sop?.completion_check
  ].filter(Boolean).join(' ')
  const directSupportIntent = getDirectSupportIntent(question)
  if (directSupportIntent === 'disassembly' || INFORMATION_ONLY_INTENTS.has(directSupportIntent)) return []
  if (isTranslationReplayQuestion(question)) return list.filter(sop => isTranslationReplayEvidence(searchable(sop)))
  if (isFactoryResetQuestion(question)) return list.filter(sop => /(恢复出厂|出厂设置|重置设备)/.test(searchable(sop)))
  if (isLiquidDamageQuestion(question)) return list.filter(sop => /(进水|浸水|液体接触)/.test(searchable(sop)))
  if (isOfflinePackageQuestion(question)) return list.filter(sop => /(离线(?:语言)?包|离线包管理|离线翻译包)/.test(searchable(sop)))
  if (isGettingStartedQuestion(question)) return list.filter(sop => /(首次|激活|入门|语音翻译|基础操作)/.test(searchable(sop)))
  return list
}

export async function findVideoRecommendations(question, filters = {}) {
  const keywords = extractRecommendationKeywords(question)
  if (keywords.length === 0) return []

  let sql = `SELECT id, title, description, category, duration_seconds, video_url, playback_url, thumbnail_url,
                    product_line, product_model, tags, view_count, resolve_count,
                    source_provider, source_page_url, source_priority
             FROM videos WHERE publish_status = 'published' AND review_status = 'approved'`
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
    { question, keywords, guidanceKind: diagnosis.kind, ...filters }
  ).slice(0, 3)
}
