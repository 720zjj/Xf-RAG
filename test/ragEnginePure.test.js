import test from 'node:test'
import assert from 'node:assert/strict'
import {
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