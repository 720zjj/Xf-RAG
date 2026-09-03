import test from 'node:test'
import assert from 'node:assert/strict'
import { buildAssistantIdentityAnswer, isAssistantIdentityQuestion } from '../server/services/assistantIdentity.js'

test('身份问题不受产品型号限制', () => {
  for (const question of ['你是什么？', '你是谁', '你是干嘛的', '你能做什么？', '介绍一下你自己']) {
    assert.equal(isAssistantIdentityQuestion(question), true, question)
  }
  assert.equal(isAssistantIdentityQuestion('翻译机是什么产品？'), false)
})

test('身份回答明确能力、型号边界和安全边界', () => {
  const result = buildAssistantIdentityAnswer()
  assert.equal(result.answerSource, 'assistant-identity')
  assert.equal(result.trust.level, 'answer')
  assert.match(result.answer, /科大讯飞翻译机智能售后助手/)
  assert.match(result.answer, /型号专属的菜单路径、按键操作、功能规格和视频准确匹配/)
  assert.match(result.answer, /通用问题仍会优先给出/)
  assert.match(result.answer, /冒烟、起火、进水/)
  assert.deepEqual(result.sources, [])
})
