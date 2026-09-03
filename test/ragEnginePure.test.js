import test from 'node:test'
import assert from 'node:assert/strict'
import {
  anchorGettingStartedResults,
  BM25Index,
  SemanticIndex,
  expandQueries,
  rewriteQuery,
  rewriteQueryVariants,
  generateHyDE,
  generateHyDEPassage,
  rerank,
  generateAnswer
} from '../server/services/ragEngine.js'

test('BM25：构建后按相关度返回命中文档', () => {
  const idx = new BM25Index()
  idx.build([
    '翻译机支持中英日韩多语言互译',
    '翻译机电池续航时间约八小时',
    '翻译机无法连接WiFi时请重启设备'
  ])
  const results = idx.search('翻译机如何连接WiFi', 2)
  assert.equal(results.length, 2)
  assert.equal(results[0].index, 2)
  assert.ok(results[0].score > 0)
})

test('BM25：同义词概念归一化使不同表述互相命中', () => {
  const idx = new BM25Index()
  idx.build([
    '本机支持多种方言识别，包括粤语和四川话',
    '设备外观颜色为黑色'
  ])
  const results = idx.search('翻译机支持地方话吗', 1)
  assert.equal(results.length, 1)
  assert.equal(results[0].index, 0)
})

test('SemanticIndex：语义检索返回相似文本', () => {
  const sidx = new SemanticIndex()
  sidx.build([
    '翻译机离线翻译需要先下载语言包',
    '翻译机支持拍照翻译功能',
    '设备附赠充电线一条'
  ])
  const results = sidx.search('离线翻译怎么使用', 2)
  assert.equal(results.length, 2)
  assert.equal(results[0].index, 0)
})

test('expandQueries：始终包含原始查询', () => {
  const queries = expandQueries('翻译机支持方言吗')
  assert.ok(queries.includes('翻译机支持方言吗'))
  assert.ok(queries.length >= 2)
})

test('expandQueries：生成同义词替换与短语变体', () => {
  const queries = expandQueries('翻译机电池续航多久')
  const joined = queries.join('|')
  assert.match(joined, /续航/)
  assert.ok(queries.some(q => q.includes('翻译机')))
})

test('expandQueries：宽泛新手问题补充首次语音翻译检索锚点', () => {
  const queries = expandQueries('我不知道怎么用这个翻译机')
  const quickQuestionQueries = expandQueries('第一次使用怎么操作？')

  assert.ok(queries.some(query => query.includes('解锁') && query.includes('语音翻译界面')))
  assert.ok(quickQuestionQueries.some(query => query.includes('解锁') && query.includes('语音翻译界面')))
  assert.ok(queries.every(query => !query.includes('中文键') && !query.includes('外文键')))
  assert.equal(expandQueries('翻译机怎么使用拍照翻译').some(query => query.includes('语音翻译界面')), false)
})

test('宽泛新手问题在候选截断后仍锚定同型号官方入门片段', () => {
  const chunks = [
    '首次翻译操作：长按左侧中文键，松开后播报。',
    '翻译机 4.0 怎么使用语音翻译？开机后向上轻滑解锁，解锁后直接进入语音翻译界面并设置语种。'
  ]
  const sources = [{ docId: 1, docName: '快速入门指南.md' }, { docId: 2, docName: '讯飞翻译机4.0官方常见问题.md' }]
  const metadata = [{ productModel: '' }, { productModel: '翻译机4.0' }]
  const result = anchorGettingStartedResults('翻译机第一次使用怎么操作？', [
    { index: 0, text: chunks[0], docId: 1, docName: sources[0].docName, metadata: metadata[0] }
  ], chunks, sources, metadata, '翻译机4.0')
  assert.equal(result[0].index, 1)
  assert.equal(result[0].metadata.productModel, '翻译机4.0')
})

test('rewriteQuery：生成检索友好的核心词查询', () => {
  const rewritten = rewriteQuery('翻译机怎么连接WiFi？')
  assert.match(rewritten, /翻译机/)
  assert.match(rewritten, /WiFi|wifi/i)
  assert.ok(rewritten.length >= 4)
})

test('rewriteQuery：操作类问题追加使用方法关键词', () => {
  const rewritten = rewriteQuery('WiFi连不上怎么办')
  assert.match(rewritten, /使用方法|操作步骤|流程|故障|解决|修复/)
})

test('rewriteQueryVariants：返回多个不同角度的变体', () => {
  const variants = rewriteQueryVariants('翻译机电池续航多久')
  assert.ok(Array.isArray(variants))
  assert.ok(variants.length >= 1)
  assert.ok(!variants.includes('翻译机电池续航多久'))
})

test('generateHyDE：生成含核心词的伪文档', () => {
  const hyde = generateHyDE('翻译机电池续航多久')
  assert.ok(hyde.length > 0)
  assert.match(hyde, /电池|续航/)
})

test('generateHyDEPassage：生成贴近文档风格的段落', () => {
  const passage = generateHyDEPassage('翻译机支持方言吗')
  assert.ok(passage.length > 20)
  assert.match(passage, /方言|粤语|四川话|地方话|口音|普通话/)
})

test('rerank：综合因子排序并把最相关候选排前', () => {
  const allChunks = [
    '翻译机支持中英互译与拍照翻译',
    '翻译机电池容量很大',
    '翻译机无法连接WiFi时请检查网络设置并重启'
  ]
  const chunkSources = [
    { docId: 'd1' },
    { docId: 'd1' },
    { docId: 'd2' }
  ]
  const candidates = [
    { index: 2, score: 0.9 },
    { index: 0, score: 0.7 },
    { index: 1, score: 0.2 }
  ]
  const semanticScores = { 0: 0.8, 1: 0.1, 2: 0.6 }
  const ranked = rerank('翻译机连接WiFi失败怎么办', candidates, allChunks, chunkSources, semanticScores)
  assert.equal(ranked.length, 3)
  assert.equal(ranked[0].index, 2)
  assert.ok(ranked.every(r => typeof r.rerankScore === 'number'))
  assert.ok(ranked.every(r => r.factors && typeof r.factors.coverage === 'number'))
})

test('rerank：切换翻译语种教程优先于声音、系统语言、离线包和故障排查', () => {
  const allChunks = [
    '【章节：在线语音翻译】在语音翻译界面点击顶部语言栏，选择源语言和目标语言。',
    '【章节：语音播报】中英互译支持男声/女声切换。',
    '【章节：首次开机】根据屏幕提示选择系统显示语言（中文/English）。',
    '【章节：离线翻译】进入离线翻译管理，选择需要使用的语言并下载语言包。',
    '【章节：无法进行翻译怎么办】确认已选择正确的翻译语种，重启设备后重试。'
  ]
  const chunkSources = allChunks.map((_, index) => ({ docId: `d${index + 1}` }))
  // 故意让相邻资料拥有更高的原始检索分，验证直接操作证据仍能止血置顶。
  const candidates = [
    { index: 0, score: 0.25 },
    { index: 1, score: 1 },
    { index: 2, score: 0.92 },
    { index: 3, score: 0.88 },
    { index: 4, score: 0.95 }
  ]
  const semanticScores = { 0: 0.45, 1: 1, 2: 0.8, 3: 0.85, 4: 0.97 }

  const ranked = rerank(
    '翻译机怎么切换翻译语言？',
    candidates,
    allChunks,
    chunkSources,
    semanticScores
  )

  assert.equal(ranked[0].index, 0)
  assert.equal(ranked[0].factors.intentMatch, true)
  for (const adjacent of ranked.filter(item => item.index !== 0)) {
    assert.equal(adjacent.factors.intentMatch, false)
    assert.ok(adjacent.factors.coverage < 1)
  }
})

test('rerank：重新播放问题优先点读复听说明而不是自动朗读', () => {
  const allChunks = [
    '【章节：语音播报】翻译结果自动朗读，支持调节语速和音量。',
    '【章节：在线语音翻译】翻译结果自动语音播报，支持点读复听。',
    '【章节：翻译记录】可查看、复听历史翻译内容。'
  ]
  const chunkSources = allChunks.map((_, index) => ({ docId: `replay-${index + 1}` }))
  const ranked = rerank(
    '翻译结果可以重新播放吗？',
    [{ index: 0, score: 1 }, { index: 1, score: 0.6 }, { index: 2, score: 0.5 }],
    allChunks,
    chunkSources,
    { 0: 1, 1: 0.7, 2: 0.65 }
  )

  assert.equal(ranked[0].index, 1)
  assert.equal(ranked[0].factors.intentMatch, true)
  assert.equal(ranked.find(item => item.index === 0).factors.intentMatch, false)
  assert.ok(ranked.find(item => item.index === 0).factors.coverage < 1)
})

test('rerank：原子概念拆分后仍保留方言同义词能力', () => {
  const chunks = [
    '设备支持粤语和四川话识别，可用于地方口音交流。',
    '设备支持调整屏幕亮度。'
  ]
  const ranked = rerank(
    '支持地方话吗？',
    [{ index: 0, score: 1 }, { index: 1, score: 1 }],
    chunks,
    [{ docId: 'dialect' }, { docId: 'display' }],
    { 0: 1, 1: 1 }
  )

  assert.equal(ranked[0].index, 0)
  assert.equal(ranked[0].factors.coverage, 1)
})

test('rerank：空候选返回空数组', () => {
  assert.deepEqual(rerank('任何问题', [], [], []), [])
})

test('generateAnswer：无检索内容时给出拒答文案', () => {
  assert.match(generateAnswer('翻译机支持什么', []), /未找到|抱歉/)
})

test('generateAnswer：有相关内容时基于文档组织回答', () => {
  const answer = generateAnswer('翻译机如何连接WiFi', [
    { text: '连接WiFi请在设置中选择网络并输入密码。连接失败时可重启设备。', score: 0.9, docName: '快速入门指南' }
  ])
  assert.match(answer, /根据文档内容/)
  assert.match(answer, /WiFi|设置|网络/)
})
