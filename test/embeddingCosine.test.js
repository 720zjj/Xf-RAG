import test from 'node:test'
import assert from 'node:assert/strict'
import { cosine } from '../server/services/embedding.js'

test('cosine：相同向量相似度为 1', () => {
  assert.equal(cosine([1, 0, 0], [1, 0, 0]), 1)
})

test('cosine：正交向量相似度为 0', () => {
  assert.equal(cosine([1, 0], [0, 1]), 0)
})

test('cosine：空输入返回 0', () => {
  assert.equal(cosine(null, [1]), 0)
  assert.equal(cosine([1], undefined), 0)
})

test('cosine：不同长度按较短者计算', () => {
  const score = cosine([1, 1], [1, 1, 0])
  assert.equal(score, 2)
})