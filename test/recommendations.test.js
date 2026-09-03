import test from 'node:test'
import assert from 'node:assert/strict'
import { rankVideos, buildVideoGuidance, extractRecommendationKeywords, filterSopRecommendationsForQuestion } from '../server/services/recommendations.js'

const videos = [
  {
    id: 1,
    title: '翻译机连接 WiFi 操作演示',
    description: '演示如何连接无线网络。',
    category: '网络设置',
    tags: ['WiFi', '无线网络'],
    product_model: '翻译机4.0',
    resolve_count: 1,
    view_count: 2,
    chapters: []
  },
  {
    id: 2,
    title: '设备基础使用',
    description: '常见功能说明。',
    category: '基础操作',
    tags: ['WiFi'],
    product_model: '翻译机4.0',
    resolve_count: 999,
    view_count: 9999,
    chapters: []
  },
  {
    id: 3,
    title: '其他型号连接 WiFi',
    description: '网络连接教程。',
    category: '网络设置',
    tags: ['WiFi'],
    product_model: '翻译机5.0',
    resolve_count: 500,
    view_count: 5000,
    chapters: []
  }
]

test('标题精确命中优先于单纯高热度的视频', () => {
  const ranked = rankVideos(videos, { keywords: ['WiFi'], productModel: '翻译机4.0' })

  assert.equal(ranked[0].id, 1)
  assert.deepEqual(ranked[0].matchedKeywords, ['WiFi'])
  assert.match(ranked[0].matchReasons.join(' '), /标题匹配/)
  assert.equal(typeof ranked[0].relevance, 'number')
})

test('型号过滤保留精确型号和通用视频，排除其他型号', () => {
  const ranked = rankVideos([
    ...videos,
    { ...videos[1], id: 4, title: '通用 WiFi 教程', product_model: '' }
  ], { keywords: ['WiFi'], productModel: '翻译机4.0' })

  assert.deepEqual(ranked.map(video => video.id).sort((a, b) => a - b), [1, 2, 4])
})

test('问题中的型号会作为可靠匹配信号参与推荐', () => {
  const ranked = rankVideos([
    { ...videos[0], id: 10, title: '连接教程', tags: [] },
    { ...videos[1], id: 11, product_model: '翻译机5.0', tags: [] }
  ], { keywords: ['4.0'] })

  assert.deepEqual(ranked.map(video => video.id), [10])
  assert.match(ranked[0].matchReasons.join(' '), /型号匹配/)
})

test('没有关键词命中时不返回凑数推荐', () => {
  assert.deepEqual(rankVideos(videos, { keywords: ['蓝牙'] }), [])
})

test('联网问题不会用“翻译机”中的泛化翻译词推荐语音翻译视频', () => {
  const keywords = extractRecommendationKeywords('翻译机怎么连接 Wi-Fi？')
  const ranked = rankVideos([{
    id: 50,
    title: '语音翻译',
    description: '科大讯飞官方使用指南视频：语音翻译。适用于讯飞双屏翻译机 2.0。',
    category: '翻译功能',
    tags: ['语音翻译', '翻译'],
    product_model: '翻译机2.0',
    chapters: []
  }], { keywords, productModel: '翻译机2.0', guidanceKind: 'learn' })

  assert.ok(keywords.includes('WiFi'))
  assert.ok(keywords.includes('连接'))
  assert.ok(!keywords.includes('翻译'))
  assert.deepEqual(ranked, [])
})

test('连接失败时优先推荐排障视频，而不是通用教程', () => {
  const guidance = buildVideoGuidance('WiFi 连不上怎么办', [
    { id: 10, title: '翻译机 WiFi 连接教程', description: '演示连接无线网络。', tags: ['WiFi', '连接'], relevance: 40, resolve_count: 0 },
    { id: 11, title: '翻译机 WiFi 连接失败排查', description: '排查无法连接网络的问题。', tags: ['WiFi', '连接', '排查'], relevance: 32, resolve_count: 0 }
  ])

  assert.equal(guidance.diagnosis.kind, 'troubleshoot')
  assert.equal(guidance.primaryVideo.id, 11)
  assert.equal(guidance.fallbackVideos[0].id, 10)
  assert.match(guidance.primaryVideo.guidanceReason, /故障排查/)
})

test('学习操作时优先推荐教程视频，而不是故障排查视频', () => {
  const guidance = buildVideoGuidance('怎么连接 WiFi', [
    { id: 20, title: '翻译机 WiFi 连接教程', description: '演示连接无线网络。', tags: ['WiFi', '连接'], relevance: 32, resolve_count: 0 },
    { id: 21, title: '翻译机 WiFi 连接失败排查', description: '排查无法连接网络的问题。', tags: ['WiFi', '连接', '排查'], relevance: 36, resolve_count: 0 }
  ])

  assert.equal(guidance.diagnosis.kind, 'learn')
  assert.equal(guidance.primaryVideo.id, 20)
})

test('相关度相同时优先推荐官方视频，不让历史热度覆盖可信来源', () => {
  const guidance = buildVideoGuidance('怎么使用拍照翻译', [
    { id: 30, title: '拍照翻译', tags: ['拍照翻译'], relevance: 40, source_priority: 0, resolve_count: 500, view_count: 5000 },
    { id: 31, title: '拍照翻译', tags: ['拍照翻译'], relevance: 40, source_priority: 100, resolve_count: 0, view_count: 0 }
  ])

  assert.equal(guidance.primaryVideo.id, 31)
})

test('同一功能同时存在本地和官方视频时给予有限官方来源加分', () => {
  const ranked = rankVideos([
    { id: 40, title: '拍照翻译', description: '', category: '拍照翻译', tags: ['拍照翻译'], product_model: '翻译机4.0', source_priority: 0, chapters: [] },
    { id: 41, title: '拍照翻译', description: '', category: '拍照翻译', tags: ['拍照翻译'], product_model: '翻译机4.0', source_priority: 100, chapters: [] }
  ], { keywords: ['拍照翻译'], productModel: '翻译机4.0' })

  assert.equal(ranked[0].id, 41)
  assert.match(ranked[0].matchReasons.join(' '), /官方视频来源/)
})

test('切换翻译语言不会推荐只提到语言包、多语言或首次语言选择的视频', () => {
  const question = '翻译机怎么切换翻译语言？'
  const keywords = extractRecommendationKeywords(question)
  const ranked = rankVideos([
    { id: 50, title: '离线翻译包下载与管理', description: '下载离线翻译语言包', category: '翻译功能', tags: ['语言包'], product_model: '翻译机4.0', chapters: [] },
    { id: 51, title: '多语言对话翻译模式', description: '支持多人多语言实时互译', category: '翻译功能', tags: ['多语言'], product_model: '翻译机4.0', chapters: [] },
    { id: 52, title: '开机与首次设置指南', description: '首次开机设置流程，包括语言选择', category: '基础操作', tags: ['首次设置'], product_model: '翻译机4.0', chapters: [] }
  ], { question, keywords, productModel: '翻译机4.0', guidanceKind: 'learn' })

  assert.deepEqual(ranked, [])
})

test('切换翻译语言仍可推荐明确覆盖动作和对象的专用视频', () => {
  const question = '翻译机怎么切换翻译语种？'
  const keywords = extractRecommendationKeywords(question)
  const ranked = rankVideos([
    { id: 60, title: '翻译语种切换教程', description: '选择源语言和目标语言', category: '翻译设置', tags: ['翻译语种', '切换'], product_model: '翻译机2.0', chapters: [] },
    { id: 61, title: '语音翻译', description: '使用语音翻译功能', category: '翻译功能', tags: ['语音翻译'], product_model: '翻译机4.0', chapters: [] }
  ], { question, keywords, productModel: '翻译机2.0', guidanceKind: 'learn' })

  assert.deepEqual(ranked.map(video => video.id), [60])
})

test('切换翻译语言只把同型号官方语音翻译视频作为通用演示补充', () => {
  const question = '翻译机怎么切换翻译语言？'
  const keywords = extractRecommendationKeywords(question)
  const ranked = rankVideos([
    { id: 70, title: '语音翻译', description: '科大讯飞官方使用指南视频', category: '翻译功能', tags: ['语音翻译', '官方视频'], product_model: '翻译机2.0', source_provider: 'iflytek-h5', source_priority: 100, chapters: [] },
    { id: 71, title: '语音翻译快速上手', description: '本地生成视频', category: '翻译功能', tags: ['语音翻译'], product_model: '翻译机2.0', source_provider: 'local', source_priority: 0, chapters: [] },
    { id: 72, title: '语音翻译', description: '其他型号官方视频', category: '翻译功能', tags: ['语音翻译', '官方视频'], product_model: '翻译机4.0', source_provider: 'iflytek-h5', source_priority: 100, chapters: [] }
  ], { question, keywords, productModel: '翻译机2.0', guidanceKind: 'learn' })

  assert.deepEqual(ranked.map(video => video.id), [70])
  assert.match(ranked[0].matchReasons.join(' '), /同型号官方语音翻译教程补充/)
})

test('中英语音翻译的切换问法也使用严格的视频门槛', () => {
  const question = '怎样切换中英语音翻译？'
  const keywords = extractRecommendationKeywords(question)
  const ranked = rankVideos([
    { id: 80, title: '离线翻译包下载与管理', description: '下载中英文语言包', category: '翻译功能', tags: ['离线翻译'], product_model: '翻译机4.0', source_provider: 'local', source_priority: 0, chapters: [] },
    { id: 81, title: '语音翻译', description: '科大讯飞官方使用指南视频', category: '翻译功能', tags: ['语音翻译', '官方视频'], product_model: '翻译机4.0', source_provider: 'iflytek-h5', source_priority: 100, chapters: [] }
  ], { question, keywords, productModel: '翻译机4.0', guidanceKind: 'learn' })

  assert.deepEqual(ranked.map(video => video.id), [81])
})

test('重新播放问题不推荐泛化语音翻译视频，只保留直接复听教程', () => {
  const question = '翻译结果可以重新播放吗？'
  const keywords = extractRecommendationKeywords(question)
  const ranked = rankVideos([
    { id: 90, title: '语音翻译', description: '演示语音翻译功能', category: '翻译功能', tags: ['语音翻译'], product_model: '翻译机4.0', chapters: [] },
    { id: 91, title: '翻译结果复听教程', description: '演示如何点读复听翻译结果', category: '翻译功能', tags: ['复听'], product_model: '翻译机4.0', chapters: [] }
  ], { question, keywords, productModel: '翻译机4.0', guidanceKind: 'learn' })

  assert.deepEqual(ranked.map(video => video.id), [91])
})

test('重新播放问题过滤不含复听操作的 SOP', () => {
  const filtered = filterSopRecommendationsForQuestion([
    { id: 1, title: '使用语音翻译功能', steps: '["说话后自动翻译"]' },
    { id: 2, title: '翻译结果复听', steps: '["点按翻译结果进行复听"]' }
  ], '翻译结果可以重新播放吗？')

  assert.deepEqual(filtered.map(item => item.id), [2])
})

test('恢复出厂和进水问题不推荐仅有宽泛设备关键词的内容', () => {
  const videos = [
    { id: 1, title: '开机与首次设置指南', description: '翻译机设备教程', product_model: '翻译机4.0', tags: ['设置'] },
    { id: 2, title: '恢复出厂设置操作', description: '恢复出厂', product_model: '翻译机4.0', tags: ['恢复出厂'] }
  ]
  assert.deepEqual(rankVideos(videos, {
    question: '如何恢复出厂设置？', keywords: ['恢复出厂', '设置'], productModel: '翻译机4.0'
  }).map(item => item.id), [2])
  assert.deepEqual(rankVideos(videos, {
    question: '翻译机进水了怎么办？', keywords: ['进水'], productModel: '翻译机4.0'
  }), [])
})

test('语种支持范围问题不附带无关视频或 SOP', () => {
  const videos = [
    { id: 1, title: '语音翻译', description: '支持英语翻译', product_model: '翻译机2.0', tags: ['英语'] },
    { id: 2, title: '会议翻译', description: '英语会议翻译演示', product_model: '翻译机2.0', tags: ['英语'] }
  ]
  const sops = [
    { id: 1, title: '使用语音翻译功能', steps: '["选择英语"]' }
  ]

  assert.deepEqual(rankVideos(videos, {
    question: '英语能翻译吗？', keywords: ['英语'], productModel: '翻译机2.0'
  }), [])
  assert.deepEqual(filterSopRecommendationsForQuestion(sops, '支持英语翻译吗？'), [])
})
