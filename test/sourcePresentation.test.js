import test from 'node:test'
import assert from 'node:assert/strict'
import { getSourcePresentation } from '../src/sourcePresentation.js'

test('章节化来源会显示章节路径和不带 Markdown 标题的摘要', () => {
  const result = getSourcePresentation('【章节：使用指南 > 充电说明】\n## 充电说明\n使用 5V/1A 适配器充电。')

  assert.equal(result.section, '使用指南 > 充电说明')
  assert.equal(result.body, '## 充电说明\n使用 5V/1A 适配器充电。')
  assert.equal(result.preview, '使用 5V/1A 适配器充电。')
})

test('来源摘要跳过图片 Markdown 并截断超长原文', () => {
  const result = getSourcePresentation('![按键图](/uploads/images/8/power.png)\n长按电源键三秒开机，然后等待系统启动完成。', 14)

  assert.equal(result.section, '')
  assert.equal(result.preview.includes('按键图'), false)
  assert.equal(result.preview.endsWith('…'), true)
  assert.ok(result.preview.length <= 15)
})
