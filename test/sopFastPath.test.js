import test from 'node:test'
import assert from 'node:assert/strict'
import { classifySopFastPath, rankSops, formatSopAnswer, resolveSopFastPath } from '../server/services/sopFastPath.js'

const sops = [
  {
    id: 1,
    title: '连接 WiFi',
    category: '网络设置',
    product_line: '翻译机',
    product_model: '翻译机4.0',
    difficulty: 'easy',
    estimated_duration: 60,
    prerequisites: ['设备已开机'],
    warnings: ['请确认网络密码正确'],
    steps: ['打开设置', '选择 WiFi', '输入密码并连接'],
    completion_check: '状态栏显示 WiFi 图标'
  },
  {
    id: 2,
    title: '蓝牙配对',
    category: '连接设置',
    product_line: '翻译机',
    product_model: '',
    difficulty: 'easy',
    estimated_duration: 90,
    prerequisites: [],
    warnings: [],
    steps: ['打开蓝牙'],
    completion_check: ''
  }
]

test('简单单一操作问题进入 SOP 快速路径', () => {
  const result = classifySopFastPath('如何连接 WiFi？')

  assert.deepEqual(result, {
    eligible: true,
    keywords: ['连接', 'WiFi'],
    reason: '简单操作问题，优先查询标准 SOP'
  })
})

test('故障排查和多问题不进入 SOP 快速路径', () => {
  assert.equal(classifySopFastPath('WiFi 连不上怎么办？').eligible, false)
  assert.equal(classifySopFastPath('怎么连接 WiFi，蓝牙怎么配对？').eligible, false)
})

test('SOP 排序优先选择标题精确匹配和当前型号', () => {
  const ranked = rankSops(sops, { keywords: ['连接', 'WiFi'], productLine: '翻译机', productModel: '翻译机4.0' })

  assert.equal(ranked[0].id, 1)
  assert.ok(ranked[0].relevance > ranked[1].relevance)
})

test('快速路径直接将审核 SOP 格式化为操作答案', () => {
  const answer = formatSopAnswer(sops[0])

  assert.match(answer, /问题结论：/)
  assert.match(answer, /1\. 打开设置/)
  assert.match(answer, /前置条件：设备已开机/)
  assert.match(answer, /请确认网络密码正确/)
  assert.match(answer, /完成检查：状态栏显示 WiFi 图标/)
  assert.match(answer, /适用产品和版本：翻译机4\.0。/)
})

test('快速路径把对象式 SOP 步骤渲染成操作和补充说明', () => {
  const answer = formatSopAnswer({
    ...sops[0],
    steps: [
      { step: 1, action: '从主屏幕向下滑动，打开快捷设置面板', detail: '也可进入 设置 > WLAN' },
      { step: 2, action: '点击 WLAN 开关，开启 WiFi 功能', detail: '图标变为蓝色表示已开启' }
    ]
  })

  assert.match(answer, /1\. 从主屏幕向下滑动，打开快捷设置面板（也可进入 设置 > WLAN）/)
  assert.match(answer, /2\. 点击 WLAN 开关，开启 WiFi 功能（图标变为蓝色表示已开启）/)
  assert.doesNotMatch(answer, /\[object Object\]/)
})

test('命中 SOP 时生成无需思考的直接响应', async () => {
  const result = await resolveSopFastPath('如何连接 WiFi？', { productLine: '翻译机', productModel: '翻译机4.0' }, {
    findSop: async () => ({ intent: { eligible: true, reason: '简单操作问题，优先查询标准 SOP' }, sop: sops[0] })
  })

  assert.equal(result.router.mode, 'sop-direct')
  assert.equal(result.router.routedBy, 'rule')
  assert.equal(result.sop.id, 1)
  assert.match(result.answer, /操作步骤：/)
})

test('SOP 查询不可用时返回空结果以回退常规检索', async () => {
  const result = await resolveSopFastPath('如何连接 WiFi？', {}, {
    findSop: async () => { throw new Error('database unavailable') }
  })

  assert.equal(result, null)
})
