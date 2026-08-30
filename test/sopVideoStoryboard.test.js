import test from 'node:test'
import assert from 'node:assert/strict'
import { buildSopVideoStoryboard } from '../server/services/sopVideoStoryboard.js'

test('将已审核 SOP 转换为带连续章节的教学视频分镜', () => {
  const storyboard = buildSopVideoStoryboard({
    id: 42,
    title: '连接办公室 Wi-Fi',
    product_line: '翻译机',
    product_model: 'T20',
    category: '网络设置',
    prerequisites: '["设备已开机", "准备好 Wi-Fi 密码"]',
    warnings: '["请确认连接的是受信任网络"]',
    steps: '["打开设置", "选择 WLAN", "输入密码后点击连接"]',
    completion_check: '状态栏显示 Wi-Fi 图标'
  })

  assert.equal(storyboard.sourceSopId, 42)
  assert.equal(storyboard.title, '连接办公室 Wi-Fi')
  assert.equal(storyboard.productModel, 'T20')
  assert.equal(storyboard.scenes[0].kind, 'intro')
  assert.deepEqual(storyboard.scenes.map(scene => scene.kind), ['intro', 'preparation', 'step', 'step', 'step', 'completion'])
  assert.deepEqual(storyboard.scenes.filter(scene => scene.kind === 'step').map(scene => scene.stepNumber), [1, 2, 3])
  assert.deepEqual(storyboard.chapters.map(chapter => chapter.startTime), [0, 4, 9, 13, 17, 22])
  assert.deepEqual(storyboard.chapters.map(chapter => chapter.endTime), [4, 9, 13, 17, 22, 26])
  assert.equal(storyboard.durationSeconds, 26)
  assert.match(storyboard.fingerprint, /^[a-f0-9]{64}$/)
  assert.equal(storyboard.scenes[1].notes[0], '设备已开机')
  assert.equal(storyboard.scenes[1].warnings[0], '请确认连接的是受信任网络')
})

test('分镜兼容对象式步骤，限制过长 SOP 并保留截断提示', () => {
  const storyboard = buildSopVideoStoryboard({
    id: 7,
    title: '批量设置',
    steps: Array.from({ length: 10 }, (_, index) => ({ title: `设置 ${index + 1}`, description: `执行第 ${index + 1} 个设置` }))
  })

  const steps = storyboard.scenes.filter(scene => scene.kind === 'step')
  assert.equal(steps.length, 7)
  assert.equal(steps[0].title, '设置 1')
  assert.equal(steps[0].body, '执行第 1 个设置')
  assert.equal(storyboard.truncatedStepCount, 3)
  assert.match(storyboard.notice, /还有 3 个步骤/)
  assert.ok(storyboard.durationSeconds <= 60)
})

test('对象式 SOP 的 detail 会作为视频步骤提示保留', () => {
  const storyboard = buildSopVideoStoryboard({
    id: 18,
    title: '连接 WiFi',
    steps: [{ action: '打开 WLAN 开关', detail: '图标变为蓝色表示已开启' }]
  })

  const step = storyboard.scenes.find(scene => scene.kind === 'step')
  assert.deepEqual(step.notes, ['图标变为蓝色表示已开启'])
})

test('没有有效步骤的 SOP 不能生成误导性视频', () => {
  assert.throws(
    () => buildSopVideoStoryboard({ id: 3, title: '空步骤 SOP', steps: 'not-json' }),
    /至少需要一个有效步骤/
  )
})

test('SOP 内容变化会改变发布校验用的分镜指纹，并拒绝超长内容', () => {
  const base = { id: 9, title: '网络设置', steps: ['打开设置'] }
  const first = buildSopVideoStoryboard(base)
  const changed = buildSopVideoStoryboard({ ...base, steps: ['打开设置', '选择 WLAN'] })

  assert.notEqual(first.fingerprint, changed.fingerprint)
  assert.throws(
    () => buildSopVideoStoryboard({ ...base, steps: ['x'.repeat(361)] }),
    /步骤内容不能超过 360 个字符/
  )
})
