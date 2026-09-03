import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeAnswerBlocks, parseStepPresentation, sourceIdSet, trustBadge } from '../src/trustedAnswerPresentation.js'

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

test('分散的步骤和注意事项会合并成紧凑的编号列表', () => {
  const blocks = normalizeAnswerBlocks([
    { kind: 'step', text: '打开翻译应用。', evidenceIds: ['E1'] },
    { kind: 'step', text: '选择翻译语种。', evidenceIds: ['E1'] },
    { kind: 'notice', text: '保持正常语速。', evidenceIds: ['E2'] },
    { kind: 'step', text: '长按中文键说话。', evidenceIds: ['E2'] },
    { kind: 'notice', text: '等待圆圈出现后再说话。', evidenceIds: ['E2'] }
  ])

  assert.equal(blocks.length, 2)
  assert.equal(blocks[0].kind, 'step')
  assert.equal(blocks[0].text, '1、打开翻译应用。\n2、选择翻译语种。\n3、长按中文键说话。')
  assert.deepEqual(blocks[0].evidenceIds, ['E1', 'E2'])
  assert.equal(blocks[1].text, '• 保持正常语速。\n• 等待圆圈出现后再说话。')
})

test('包含多种方法且编号紧贴句号的回答会拆成方法标题和各自编号步骤', () => {
  const result = parseStepPresentation('1、方法一（设备端）：1. 打开【设置】。2. 点击【WLAN】。3. 选择网络。\n2、方法二（APP 端）：1. 打开 APP。2. 点击“WIFI 设置”。')

  assert.equal(result.type, 'methods')
  assert.deepEqual(result.methods, [
    { title: '方法一（设备端）', steps: ['打开【设置】。', '点击【WLAN】。', '选择网络。'] },
    { title: '方法二（APP 端）', steps: ['打开 APP。', '点击“WIFI 设置”。'] }
  ])
})

test('普通编号步骤会转换为独立列表项', () => {
  assert.deepEqual(parseStepPresentation('1、开机。\n2、选择语言。\n3、开始翻译。'), {
    type: 'steps',
    steps: ['开机。', '选择语言。', '开始翻译。']
  })
})

test('前端步骤展示不会把产品型号 2.0 拆成伪步骤', () => {
  assert.deepEqual(parseStepPresentation('1、科大讯飞官方 H5 为讯飞双屏翻译机 2.0 提供《同声字幕》使用视频。\n2、请播放官方视频。\n3、如果无法播放，请打开官方地址。'), {
    type: 'steps',
    steps: [
      '科大讯飞官方 H5 为讯飞双屏翻译机 2.0 提供《同声字幕》使用视频。',
      '请播放官方视频。',
      '如果无法播放，请打开官方地址。'
    ]
  })
})
