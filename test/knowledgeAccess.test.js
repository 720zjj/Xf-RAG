import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildKnowledgeScope,
  canReadKnowledgeDocument,
  getConfiguredAdminUsernames
} from '../server/services/knowledgeAccess.js'

test('管理员用户名配置会去空格、去空值并去重', () => {
  assert.deepEqual(getConfiguredAdminUsernames(' admin,ops, admin, ,'), ['admin', 'ops'])
})

test('当前用户可读取自己的文档和管理员公共文档', () => {
  assert.equal(canReadKnowledgeDocument(
    { userId: 3, ownerId: 3, ownerUsername: 'zjj2026', status: 0 },
    'admin'
  ), true)
  assert.equal(canReadKnowledgeDocument(
    { userId: 3, ownerId: 1, ownerUsername: 'admin', status: 1 },
    'admin'
  ), true)
})

test('管理员文档只有解析就绪后才作为公共知识库开放', () => {
  assert.equal(canReadKnowledgeDocument(
    { userId: 3, ownerId: 1, ownerUsername: 'admin', status: 0 },
    'admin'
  ), false)
  assert.equal(canReadKnowledgeDocument(
    { userId: 3, ownerId: 1, ownerUsername: 'admin', status: 2 },
    'admin'
  ), false)
})

test('当前用户不能读取其他普通用户的私有文档', () => {
  assert.equal(canReadKnowledgeDocument(
    { userId: 3, ownerId: 2, ownerUsername: 'testuser' },
    'admin'
  ), false)
})

test('SQL 范围同时包含当前用户和配置的管理员', () => {
  assert.deepEqual(
    buildKnowledgeScope(3, { documentAlias: 'd', ownerAlias: 'owner' }, 'admin,ops'),
    {
      where: '(d.user_id = ? OR (owner.username IN (?) AND d.status = 1))',
      params: [3, ['admin', 'ops']]
    }
  )
})

test('未配置管理员时知识库严格限定当前用户', () => {
  assert.deepEqual(
    buildKnowledgeScope(3, { documentAlias: 'd', ownerAlias: 'owner' }, ''),
    { where: 'd.user_id = ?', params: [3] }
  )
})
