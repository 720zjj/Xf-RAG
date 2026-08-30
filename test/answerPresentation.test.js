import test from 'node:test'
import assert from 'node:assert/strict'
import { parseAnswerSections, toStreamingPlainText } from '../src/answerPresentation.js'

test('旧 Markdown 回答会被拆分为结论、步骤和注意事项', () => {
  const sections = parseAnswerSections(`**问题结论**\n可以连接 WiFi。\n\n**操作步骤**\n1. 打开设置。\n2. 选择 WiFi。\n\n**注意事项**\n- 请确认网络密码正确。`)

  assert.deepEqual(sections, [
    { key: 'conclusion', title: '问题结论', type: 'paragraphs', content: ['可以连接 WiFi。'] },
    { key: 'steps', title: '操作步骤', type: 'steps', content: ['打开设置。', '选择 WiFi。'] },
    { key: 'notice', title: '注意事项', type: 'bullets', content: ['请确认网络密码正确。'] }
  ])
})

test('无固定标题的旧回答会作为说明段落安全展示', () => {
  const sections = parseAnswerSections('先确认设备已开机。\n\n<script>alert(1)</script>\n\n再检查网络。')

  assert.deepEqual(sections, [
    { key: 'details', title: '说明', type: 'paragraphs', content: ['先确认设备已开机。', '再检查网络。'] }
  ])
})

test('固定标签与正文写在同一行时也能保留正文', () => {
  const sections = parseAnswerSections('问题结论：先检查 WiFi 开关。\n操作步骤：（如适用）\n1. 打开设置。')

  assert.deepEqual(sections, [
    { key: 'conclusion', title: '问题结论', type: 'paragraphs', content: ['先检查 WiFi 开关。'] },
    { key: 'steps', title: '操作步骤', type: 'steps', content: ['打开设置。'] }
  ])
})

test('无标题旧 Markdown 的井号和列表符不会直接显示', () => {
  const sections = parseAnswerSections('## 使用建议\n- 先打开 WiFi 开关。')

  assert.deepEqual(sections, [
    { key: 'details', title: '说明', type: 'paragraphs', content: ['使用建议 先打开 WiFi 开关。'] }
  ])
})

test('流式回答会去掉 Markdown 符号与 HTML 标签', () => {
  const value = toStreamingPlainText('**问题结论**\n# 可以使用\n- 打开设置\n<script>alert(1)</script>')

  assert.equal(value.includes('**'), false)
  assert.equal(value.includes('<script>'), false)
  assert.match(value, /问题结论/)
  assert.match(value, /打开设置/)
})
