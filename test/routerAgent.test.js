import test from 'node:test'
import assert from 'node:assert/strict'
import { routeQuestion } from '../server/services/routerAgent.js'

test('简单 SOP 操作在自动模式下跳过 LLM 路由', async () => {
  const route = await routeQuestion('如何连接 WiFi？')

  assert.deepEqual(route, {
    mode: 'sop-direct',
    confidence: 'high',
    reason: '简单操作问题，优先查询标准 SOP',
    enableReflection: false,
    routedBy: 'rule'
  })
})

test('SOP 未命中后自动路由不再标记为 SOP 直达', async () => {
  const route = await routeQuestion('如何连接 WiFi？', { skipSop: true })

  assert.notEqual(route.mode, 'sop-direct')
})

test('故障排查仍使用现有推理路由', async () => {
  const route = await routeQuestion('WiFi 连不上怎么办？')

  assert.equal(route.mode, 'react')
})
