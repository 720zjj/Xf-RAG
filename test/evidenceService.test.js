import test from 'node:test'
import assert from 'node:assert/strict'
import { selectEvidence, toPublicSources } from '../server/services/evidenceService.js'

const duplicateWifi = {
  docId: 1,
  chunkId: 11,
  docName: '售后FAQ',
  text: '先核对密码和网络本身是否可用，再重新连接 WiFi。',
  score: 0.9,
  bm25Score: 1.2,
  factors: { coverage: 0.8 },
  metadata: { productLine: '翻译机', productModel: '讯飞翻译机4.0', effectiveStatus: 'active', riskLevel: 'low' }
}

const safetyChunk = {
  docId: 2,
  chunkId: 21,
  docName: '安全说明',
  text: '设备进水后应立即停止使用，避免充电和反复开机。',
  score: 0.7,
  bm25Score: 0.8,
  factors: { coverage: 0.9 },
  metadata: { productLine: '翻译机', productModel: '讯飞翻译机4.0', effectiveStatus: 'active', riskLevel: 'high' }
}

test('证据选择去除近似重复片段并编号', () => {
  const evidence = selectEvidence([
    duplicateWifi,
    { ...duplicateWifi, chunkId: 12, score: 0.8 },
    safetyChunk
  ])

  assert.deepEqual(evidence.map(item => item.evidenceId), ['E1', 'E2'])
  assert.equal(evidence[0].chunkId, 11)
  assert.equal(evidence[1].chunkId, 21)
})

test('安全问题优先选择高风险安全资料', () => {
  const evidence = selectEvidence([duplicateWifi, safetyChunk], { question: '翻译机进水后该怎么做？' })

  assert.equal(evidence[0].title, '安全说明')
  assert.equal(evidence[0].selectionReason, 'safety')
})

test('失效资料不会进入证据集合，公开来源不泄露内部因素', () => {
  const evidence = selectEvidence([{ ...duplicateWifi, metadata: { ...duplicateWifi.metadata, effectiveStatus: 'deprecated' } }, safetyChunk])
  const sources = toPublicSources(evidence)

  assert.equal(sources.length, 1)
  assert.equal(sources[0].evidenceId, 'E1')
  assert.equal('factors' in sources[0], false)
  assert.equal(sources[0].sourceType, 'document_chunk')
})
