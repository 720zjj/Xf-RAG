import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const appSource = await readFile(new URL('../src/App.jsx', import.meta.url), 'utf8')
const styleSource = await readFile(new URL('../src/authPage.css', import.meta.url), 'utf8')

test('登录设计继续调用真实登录与注册接口', () => {
  assert.match(appSource, /isLogin \? '\/auth\/login' : '\/auth\/register'/)
  assert.match(appSource, /onLogin\(data\.data\.user\)/)
  assert.match(appSource, /username: username\.trim\(\), password/)
})

test('登录页提供真实表单状态与密码显示控制', () => {
  assert.match(appSource, /autoComplete="username"/)
  assert.match(appSource, /autoComplete=\{isLogin \? 'current-password' : 'new-password'\}/)
  assert.match(appSource, /aria-label=\{passwordVisible \? '隐藏密码' : '显示密码'\}/)
  assert.match(appSource, /disabled=\{loading \|\| !username\.trim\(\) \|\| !password\}/)
})

test('登录页不允许手工选择角色且未合入设计稿模拟功能', () => {
  assert.match(appSource, /账号权限由系统自动识别/)
  assert.doesNotMatch(appSource, /demo1234|状态预览|kb-mock|demo-root/)
  assert.doesNotMatch(appSource, /选择角色|role-select|value="admin"/)
})

test('登录页同时具备桌面双栏和手机单栏布局', () => {
  assert.match(styleSource, /\.auth-page__shell\s*\{[\s\S]*grid-template-columns: minmax\(0, 1fr\) 420px/)
  assert.match(styleSource, /@media \(max-width: 880px\)/)
  assert.match(styleSource, /\.auth-page__mobile-brand\s*\{[\s\S]*display: flex/)
  assert.match(styleSource, /height: 48px/)
})
