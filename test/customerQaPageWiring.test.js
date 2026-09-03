import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const appSource = await readFile(new URL('../src/App.jsx', import.meta.url), 'utf8')
const pageSource = await readFile(new URL('../src/CustomerQaPage.jsx', import.meta.url), 'utf8')
const styleSource = await readFile(new URL('../src/customerQaPage.css', import.meta.url), 'utf8')

test('普通顾客使用独立问答外壳且管理员继续沿用原后台', () => {
  assert.match(appSource, /const isCustomerExperience = supportMode \|\| !isAdminUser/)
  assert.match(appSource, /if \(isCustomerExperience\) \{[\s\S]*<CustomerQaPage/)
  assert.match(appSource, /return \(\s*<div className="app-container">/)
  assert.match(pageSource, /supportMode && supportChannel/)
  assert.doesNotMatch(pageSource, /ragMode|reflection|tool-agent|检索策略|推理方式/)
})

test('管理员打开顾客链接时仍进入顾客界面且不能带入后台推理方式', () => {
  assert.match(appSource, /const canUseAdminRagControls = isAdminUser && !supportMode/)
  assert.match(appSource, /if \(canUseAdminRagControls && \(ragMode === 'react'/)
  assert.match(appSource, /if \(canUseAdminRagControls\) body\.mode = ragMode/)
  assert.match(appSource, /if \(isCustomerExperience\) setRagQuestion\(''\)/)
  assert.match(pageSource, /\{!supportMode && <span className="customer-account-name">/)
})

test('扫码入口展示服务端解析型号并且不提供切换型号操作', () => {
  assert.match(pageSource, /customerProductDisplayName\(supportChannel \|\| selectedProduct\)/)
  assert.match(pageSource, /型号已锁定/)
  assert.doesNotMatch(pageSource, /手动选择其他型号|切换型号/)
})

test('顾客页提供响应式布局、居中的横滑项和手机底部输入区', () => {
  assert.match(styleSource, /@media \(max-width: 880px\)/)
  assert.match(styleSource, /\.customer-quick-list--centered\s*\{[\s\S]*justify-content: center/)
  assert.match(styleSource, /\.customer-composer\s*\{[\s\S]*position: fixed/)
  assert.match(styleSource, /\.customer-chat-scroll\s*\{[\s\S]*padding: 24px 16px 28px/)
})

test('设计稿中的状态预览与辅助线不会进入生产页面', () => {
  assert.doesNotMatch(pageSource, /状态预览|辅助线|demo-root|guide-overlay/)
})
