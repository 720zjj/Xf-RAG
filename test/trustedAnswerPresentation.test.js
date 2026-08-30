import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeAnswerBlocks, sourceIdSet, trustBadge } from '../src/trustedAnswerPresentation.js'

test('有效引用会保留并指向已知来源', () => {
  const blocks = normalizeAnswerBlocks([
    { kind: 'conclusion', text: '可使用离线包。', evidenceIds: ['E1', 'E1'] }
  ], '')

  assert.deepEqual(sourceIdSet(blocks[0]), ['E1'])
  assert.equal(blocks[0].kind, 'conclusion')
})

test('旧回答仍会回退成说明块', () => {
  assert.deepEqual(normalizeAnswerBlocks([], '请先连接 WiFi。'), [
    { kind: 'details', text: '请先连接 WiFi。', evidenceIds: [] }
  ])
})

test('拒答状态显示资料边界而不是空来源列表', () => {
  assert.deepEqual(
    trustBadge({ level: 'refuse', message: '资料未覆盖' }),
    { tone: 'warning', label: '暂不能确认', message: '资料未覆盖' }
  )
})
