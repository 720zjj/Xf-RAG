import test from 'node:test'
import assert from 'node:assert/strict'
import {
  getHistory,
  addToHistory,
  clearSession,
  rewriteWithContext,
  stableQuestionIntent,
  isSelfContainedProductQuestion,
  shouldResolveWithContext,
  formatHistoryForPrompt,
  getActiveSessionCount
} from '../server/services/memoryAgent.js'

test.beforeEach(() => {
  delete process.env.LLM_BASE_URL
  delete process.env.LLM_API_KEY
  delete process.env.LLM_MODEL
})

test('会话历史：未知或空会话返回空数组', () => {
  assert.deepEqual(getHistory(''), [])
  assert.deepEqual(getHistory('missing-session'), [])
})

test('会话历史：添加轮次后可读取并计数', () => {
  addToHistory('s1', '翻译机支持方言吗', '支持粤语、四川话等')
  assert.equal(getHistory('s1').length, 1)
  assert.equal(getHistory('s1')[0].question, '翻译机支持方言吗')
  assert.equal(getActiveSessionCount(), 1)
  clearSession('s1')
  assert.equal(getActiveSessionCount(), 0)
})

test('会话历史：超过 8 轮时裁剪最旧轮次', () => {
  for (let i = 0; i < 12; i++) {
    addToHistory('s-cap', `问题${i}`, `回答${i}`)
  }
  const history = getHistory('s-cap')
  assert.equal(history.length, 8)
  assert.equal(history[0].question, '问题4')
  assert.equal(history[7].question, '问题11')
})

test('重写：无历史时原样返回且未消解', async () => {
  const result = await rewriteWithContext('empty', '那续航呢')
  assert.deepEqual(result, { rewritten: '那续航呢', resolved: false })
})

test('重写：有历史但 LLM 不可用时原样返回', async () => {
  addToHistory('s-llm-off', '翻译机电池续航多久', '续航约 8 小时')
  const result = await rewriteWithContext('s-llm-off', '那续航呢')
  assert.deepEqual(result, { rewritten: '那续航呢', resolved: false })
})

test('历史格式化：无历史返回 null', () => {
  assert.equal(formatHistoryForPrompt('no-history'), null)
})

test('历史格式化：包含对话轮次并限制轮数', () => {
  addToHistory('s-fmt', '如何连接WiFi', '进入设置菜单')
  addToHistory('s-fmt', '支持蓝牙吗', '支持蓝牙 5.0')
  addToHistory('s-fmt', '怎么开机', '长按电源键')
  const prompt = formatHistoryForPrompt('s-fmt', 2)
  assert.match(prompt, /支持蓝牙吗/)
  assert.match(prompt, /怎么开机/)
  assert.doesNotMatch(prompt, /如何连接WiFi/)
  assert.match(prompt, /共2轮/)
})

test('历史格式化：回答超 200 字符时截断并加省略号', () => {
  const longAnswer = '很'.repeat(300)
  addToHistory('s-long', '问题', longAnswer)
  const prompt = formatHistoryForPrompt('s-long', 1)
  assert.ok(prompt.length < 500)
  assert.match(prompt, /\.\.\./)
})

test('重写判定：完整的翻译机问题不会被上一轮话题带偏', () => {
  const standaloneQuestions = [
    '具体怎么使用这个翻译机',
    '第一次使用这台翻译机怎么操作？',
    '设备无法开机怎么办？',
    '英语能翻译吗？',
    '这个翻译机也支持英语吗？',
    '翻译机怎么连接 Wi-Fi？'
  ]
  for (const question of standaloneQuestions) {
    assert.equal(shouldResolveWithContext(question), false, question)
  }
  assert.equal(stableQuestionIntent('具体怎么使用这个翻译机'), 'getting-started')
  assert.equal(isSelfContainedProductQuestion('设备无法开机怎么办？'), true)
})

test('重写判定：真正省略主语或动作的追问仍使用对话历史', () => {
  for (const question of ['那怎么操作？', '它呢？', '这个翻译机也可以吗？', '还是不行']) {
    assert.equal(shouldResolveWithContext(question), true, question)
  }
})
