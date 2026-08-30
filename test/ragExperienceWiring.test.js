import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const read = path => fs.readFileSync(new URL(path, import.meta.url), 'utf8')

test('所有问答链路统一使用增强视频推荐并返回 qaId', () => {
  const source = read('../server/routes/rag.js')
  const toolAgentSource = read('../server/services/toolAgent.js')

  assert.match(source, /findVideoRecommendations/)
  assert.match(source, /buildVideoGuidance/)
  assert.match(source, /videoGuidance/)
  assert.match(source, /runTrustedRagRequest/)
  assert.match(source, /qaId/)
  assert.match(source, /recommendedVideos/)
  assert.match(toolAgentSource, /findVideoRecommendations/)
})

test('SOP 快速路径也返回视频推荐，不能只返回文字步骤', () => {
  const source = read('../server/routes/rag.js')

  assert.match(source, /findFastPathVideoRecommendations\(question, fastPathFilters\)/)
  assert.match(source, /recommendedVideos: recommendedVideos\.length > 0 \? recommendedVideos : undefined/)
  assert.match(source, /videoGuidance: videoGuidance \|\| undefined/)
})

test('回答提示词要求使用无 Markdown 符号的中文段落标签', () => {
  for (const path of ['../server/services/ragEngine.js', '../server/services/ragAgent.js', '../server/services/toolAgent.js']) {
    const source = read(path)
    assert.match(source, /问题结论：/)
    assert.doesNotMatch(source, /\*\*问题结论\*\*/)
  }
})

test('前端使用结构化答案阅读器和视频解决反馈', () => {
  const source = read('../src/App.jsx')

  assert.match(source, /parseAnswerSections/)
  assert.match(source, /toStreamingPlainText/)
  assert.match(source, /handleVideoResolve/)
  assert.match(source, /ragQaId/)
  assert.match(source, /\/video\/\$\{video\.id\}\/resolve/)
  assert.match(source, /qaId:\s*ragQaId/)
  assert.match(source, /videoGuidance/)
  assert.match(source, /handleTryNextVideo/)
  assert.match(source, /未解决，换一个方案/)
  assert.match(source, /source\.images/)
  assert.match(source, /ragStreamingDone && ragThinking\.length > 0/)
  assert.match(source, /trustedAnswerPresentation/)
  assert.match(source, /answerBlocks/)
  assert.match(source, /ragTraceId/)
  assert.match(source, /\/rag\/feedback/)
  assert.match(source, /已解决/)
  assert.match(source, /未解决/)
  assert.match(source, /getSourcePresentation/)
  assert.match(source, /查看原文/)
  assert.match(source, /检索详情/)
})

test('所有前端问答请求保留产品过滤契约', () => {
  const source = read('../src/App.jsx')

  for (const [endpoint, start, end] of [
    ['ask-stream', 'const handleRagAskStream', '// SSE 多工具智能体'],
    ['ask-agent', 'const handleRagAskAgent', 'const handleRagAsk = async'],
    ['ask', 'const handleRagAsk = async', 'const handleLogout = async']
  ]) {
    const request = source.slice(source.indexOf(start), source.indexOf(end))
    assert.match(request, new RegExp(`/rag/${endpoint}`))
    assert.match(request, /productLine: effectiveProductLine/)
    assert.match(request, /productModel: effectiveProductModel/)
  }
})
