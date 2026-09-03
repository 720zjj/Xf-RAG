import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const routeSource = fs.readFileSync(new URL('../server/routes/rag.js', import.meta.url), 'utf8')
const appSource = fs.readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8')

test('普通用户的问答模式由服务端固定，不能提交高级模式越权', () => {
  assert.match(routeSource, /const adminRequest = isAdmin\(req\)/)
  assert.match(routeSource, /const customerExperience = isCustomerExperienceRequest\(req\)/)
  assert.match(routeSource, /const requestedMode = customerExperience \? 'default' : \(req\.body\.mode \|\| 'auto'\)/)
  assert.match(routeSource, /if \(adminRequest && !customerExperience && isLLMEnabled\(\)\)/)
  assert.match(routeSource, /router\.post\('\/ask', supportGuestOrAuthMiddleware, ragRateLimit/)
  assert.match(routeSource, /router\.post\('\/ask-stream', authMiddleware, requireAdmin, ragRateLimit/)
  assert.match(routeSource, /router\.post\('\/ask-agent', authMiddleware, requireAdmin, ragRateLimit/)
  assert.match(routeSource, /const guestChannelCode = isSupportGuest\(req\) \? req\.user\.supportChannelCode : ''/)
  assert.match(routeSource, /productKey: guestChannelCode \? '' : req\.body\.productKey/)
  assert.match(routeSource, /supportChannelCode: guestChannelCode \|\| req\.body\.supportChannelCode/)
  assert.match(routeSource, /const doReflection = adminRequest && !customerExperience/)
  assert.doesNotMatch(routeSource, /req\.body\.productLine|req\.body\.productModel/)
  assert.match(routeSource, /allowedDocumentIds: requestScope\?\.documentIds/)
})

test('普通顾客跳过预检式 GLM 扩写但仍保留可信回答生成', () => {
  const customerExpansionGuards = routeSource.match(/if \(adminRequest && !customerExperience && isLLMEnabled\(\)\)/g) || []
  assert.equal(customerExpansionGuards.length, 2)
  assert.match(routeSource, /generate: generateTrustedBlocks/)
  assert.match(routeSource, /retrievalMs: generationStartedAt - requestStartedAt/)
  assert.match(routeSource, /totalMs: Date\.now\(\) - requestStartedAt/)
})

test('管理员从二维码进入顾客页时也使用顾客管线并隐藏后台诊断字段', async () => {
  const { isCustomerExperienceRequest } = await import('../server/routes/rag.js')
  assert.equal(isCustomerExperienceRequest({ user: { role: 'admin' }, body: { supportChannelCode: 'stable-channel' } }), true)
  assert.equal(isCustomerExperienceRequest({ user: { role: 'admin' }, body: { productKey: 'admin-test' } }), false)
  assert.equal(isCustomerExperienceRequest({ user: { role: 'user' }, body: { productKey: 'customer-product' } }), true)
  assert.match(routeSource, /admin: isAdmin\(req\) && !isCustomerExperienceRequest\(req\)/)
})

test('普通用户响应会裁掉检索策略、Agent、路由和思维诊断字段', async () => {
  const { presentRagData } = await import('../server/routes/rag.js')
  const source = {
    answer: '回答',
    sources: [],
    trust: { level: 'grounded' },
    agent: { mode: 'react' },
    router: { mode: 'react' },
    memory: { resolved: true },
    reflection: { applied: true },
    queryEnhancement: { rewrittenQuery: '内部改写' },
    rerankInfo: { method: '内部排序' }
  }
  const customer = presentRagData(source)
  assert.equal(customer.answer, '回答')
  for (const key of ['agent', 'router', 'memory', 'reflection', 'queryEnhancement', 'rerankInfo']) {
    assert.equal(Object.hasOwn(customer, key), false)
  }
  assert.equal(presentRagData(source, { admin: true }).agent.mode, 'react')
})

test('普通用户界面隐藏推理设置、资料管理和统计入口', () => {
  assert.match(appSource, /const tabs = supportMode \|\| !isAdminUser/)
  assert.match(appSource, /\{isAdminUser && <div className="form-row"/)
  assert.match(appSource, /\{isAdminUser && <RetrievalInsight/)
  assert.match(appSource, /activeTab === 'start' && isAdminUser/)
  assert.match(appSource, /activeTab === 'stats' && isAdminUser/)
  assert.match(appSource, /isAdminUser \? '🧹 清除记忆' : '新对话'/)
})

test('扫码顾客页面不显示登录账号与退出入口', () => {
  const customerSource = fs.readFileSync(new URL('../src/CustomerQaPage.jsx', import.meta.url), 'utf8')
  assert.match(customerSource, /!supportMode && <span className="customer-account-name"/)
  assert.match(customerSource, /!supportMode && <button type="button" className="customer-text-button"/)
})

test('管理员自动模式与顾客端共用普通问答管线，显式深度模式才走流式端点', () => {
  const askHandler = appSource.slice(
    appSource.indexOf('const handleRagAsk = async'),
    appSource.indexOf('const handleLogout = async')
  )

  assert.match(askHandler, /ragMode === 'react' \|\| ragMode === 'plan-solve'/)
  assert.doesNotMatch(askHandler, /ragMode === 'plan-solve' \|\| ragMode === 'auto'/)
  assert.match(askHandler, /supportApiFetch\(`\$\{API\}\/rag\/ask`/)
})
