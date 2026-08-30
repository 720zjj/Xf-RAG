import test from 'node:test'
import assert from 'node:assert/strict'
import { detectExplicitModel, runTrustedRagRequest } from '../server/services/trustedRagService.js'

const retrieved = [{
  docId: 1,
  chunkId: 1,
  docName: '用户操作手册',
  text: '已下载的离线包可在无网络时使用对应离线翻译能力。',
  score: 0.88,
  bm25Score: 1.4,
  factors: { coverage: 1, phraseMatch: true },
  metadata: { effectiveStatus: 'active', productModel: '讯飞翻译机4.0' }
}]

test('提取问题中的明确型号，未知型号在生成前拒答', async () => {
  let calls = 0
  const result = await runTrustedRagRequest({
    endpoint: 'ask',
    question: 'ZY-T9 怎样恢复出厂设置？',
    retrieved,
    availableModels: ['讯飞翻译机4.0'],
    generate: async () => { calls += 1; return '{}' }
  })

  assert.equal(detectExplicitModel('ZY-T9 怎样恢复出厂设置？'), 'ZY-T9')
  assert.equal(result.trust.reasonCode, 'model-not-covered')
  assert.equal(calls, 0)
})

test('有效检索统一生成结构化回答并返回证据快照', async () => {
  const result = await runTrustedRagRequest({
    endpoint: 'ask-stream',
    question: '没有网络时还能翻译吗？',
    retrieved,
    availableModels: ['讯飞翻译机4.0'],
    generate: async () => JSON.stringify({
      blocks: [{ kind: 'conclusion', text: '已下载的离线包可在无网络时使用对应离线翻译能力。', evidenceIds: ['E1'] }]
    })
  })

  assert.equal(result.trust.level, 'answer')
  assert.equal(result.evidence[0].evidenceId, 'E1')
  assert.equal(result.answerBlocks[0].evidenceIds[0], 'E1')
})

test('明确型号会排除其他型号的检索片段，不因全库存在该型号而混用资料', async () => {
  let calls = 0
  const result = await runTrustedRagRequest({
    endpoint: 'ask',
    question: '翻译机 4.0 怎样恢复出厂设置？',
    retrieved: [{ ...retrieved[0], metadata: { ...retrieved[0].metadata, productModel: '讯飞翻译机3.0' } }],
    availableModels: ['讯飞翻译机3.0', '讯飞翻译机4.0标准版/星火版（中国大陆）'],
    generate: async () => { calls += 1; return '{}' }
  })

  assert.equal(result.trust.reasonCode, 'model-not-covered')
  assert.equal(result.evidence.length, 0)
  assert.equal(calls, 0)
})

test('无连接符的常见型号代码也会被当作显式型号处理', () => {
  assert.equal(detectExplicitModel('T9 怎么连 WiFi？'), 'T9')
  assert.equal(detectExplicitModel('t9 怎么连 WiFi？'), 't9')
  assert.equal(detectExplicitModel('X1 如何恢复出厂？'), 'X1')
  assert.equal(detectExplicitModel('V2.0 的说明书在哪里？'), 'V2.0')
})
