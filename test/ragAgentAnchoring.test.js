import test from 'node:test'
import assert from 'node:assert/strict'
import { mergeAnchoredResults } from '../server/services/ragAgent.js'

test('Agent 检索保留原始问题结果并对扩展查询结果去重', () => {
  const faq = { index: 7, text: '翻译机进水了怎么办？立即关机。' }
  const expanded = { index: 2, text: '设备过热保护说明。' }

  const merged = mergeAnchoredResults([faq], [expanded, { ...faq, score: 0.5 }])

  assert.deepEqual(merged, [faq, expanded])
})
