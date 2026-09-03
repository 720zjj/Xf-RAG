import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const read = path => fs.readFileSync(new URL(path, import.meta.url), 'utf8')

test('三个 RAG 入口都接入统一可信回答服务和追溯记录', () => {
  const source = read('../server/routes/rag.js')

  assert.match(source, /runTrustedRagRequest/)
  assert.match(source, /trustedRagService/)
  assert.match(source, /persistTrace/)
  assert.equal((source.match(/runTrustedRagRequest\(/g) || []).length >= 4, true)
})

test('SOP 快速路径和工具智能体都构建标准化证据来源', () => {
  const source = read('../server/routes/rag.js')

  assert.match(source, /sourceType:\s*'sop'/)
  assert.match(source, /buildSopRetrieved/)
  assert.doesNotMatch(source, /answerSource:\s*'sop-fast-path'[\s\S]{0,220}sources:\s*\[\]/)
})

test('问答反馈和知识缺口接口使用 trace 服务并校验管理权限', () => {
  const source = read('../server/routes/rag.js')

  assert.match(source, /router\.post\('\/feedback'/)
  assert.match(source, /saveFeedback/)
  assert.match(source, /router\.get\('\/knowledge-gaps'/)
  assert.match(source, /listKnowledgeGaps/)
  assert.match(source, /router\.get\('\/feedback-summary'/)
  assert.match(source, /listFeedbackSummary/)
  assert.match(source, /isAdmin/)
})

test('资料为空或型号过滤为空时三个入口仍返回可追溯的可信拒答', () => {
  const source = read('../server/routes/rag.js')

  assert.match(source, /answerWithoutMaterial/)
  assert.doesNotMatch(source, /没有已解析的文档，请先上传文档/)
  assert.doesNotMatch(source, /send\('error', \{ message: '请先上传文档' \}\)/)
})

test('工具模式先执行安全和型号预检，且 SSE 不发送未校验的工具正文', () => {
  const source = read('../server/routes/rag.js')

  assert.match(source, /const toolPreflight = await runTrustedRagRequest/)
  assert.match(source, /toolPreflight\.trust\.reasonCode === 'unsafe-request'/)
  assert.doesNotMatch(source, /send\('tool_result', \{ tool: evt\.tool, result: evt\.result \}\)/)
})

test('审计写入失败不会伪装成已可追溯的可信回答', () => {
  const source = read('../server/routes/rag.js')

  assert.doesNotMatch(source, /保存可信回答追溯失败：[\s\S]{0,180}return undefined/)
  assert.match(source, /DELETE FROM rag_qa WHERE id = \?/)
})

test('SOP 证据与展示块采用相同的步骤、前置条件和警告顺序', () => {
  const source = read('../server/routes/rag.js')

  assert.match(source, /\.\.\.steps, \.\.\.prerequisites, \.\.\.warnings, sop\.completion_check/)
  assert.match(source, /parseJsonList\(sop\.steps\)\.map\(formatSopStep\)\.filter\(Boolean\)/)
})

test('普通问答和流式问答都在型号检索前处理助手身份问题', () => {
  const source = read('../server/routes/rag.js')

  assert.match(source, /isAssistantIdentityQuestion/)
  assert.match(source, /answerAssistantIdentity/)
  assert.equal((source.match(/if \(isAssistantIdentityQuestion\(question\)\)/g) || []).length, 2)
  assert.match(source, /retrievalMode:\s*'系统能力说明'/)
})
