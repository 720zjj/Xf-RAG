import test from 'node:test'
import assert from 'node:assert/strict'
import { canManageDocument, documentScopeLabel } from '../src/documentAccess.js'

test('只有文档所有者可以看到管理操作', () => {
  assert.equal(canManageDocument({ is_owner: 1 }), true)
  assert.equal(canManageDocument({ is_owner: 0 }), false)
})

test('管理员共享文档显示公共知识库标签', () => {
  assert.equal(documentScopeLabel({ scope: 'public' }), '公共知识库')
  assert.equal(documentScopeLabel({ scope: 'private' }), '我的文档')
})
