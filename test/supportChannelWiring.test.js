import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const source = fs.readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8')
const managerSource = fs.readFileSync(new URL('../src/SupportChannelManager.jsx', import.meta.url), 'utf8')

function ragRequestSections() {
  return [
    ['ask-stream', 'const handleRagAskStream', '// SSE 多工具智能体'],
    ['ask-agent', 'const handleRagAskAgent', 'const handleRagAsk = async'],
    ['ask', 'const handleRagAsk = async', 'const handleLogout = async']
  ].map(([endpoint, start, end]) => [endpoint, source.slice(source.indexOf(start), source.indexOf(end))])
}

test('扫码模式无需账号即可解析固定产品支持渠道', () => {
  assert.match(source, /import \{ getSupportChannelCode \} from '\.\/supportChannelLocation\.js'/)
  assert.match(source, /import \{ SupportExperience \} from '\.\/SupportExperience\.jsx'/)
  assert.match(source, /import \{ SupportChannelManager \} from '\.\/SupportChannelManager\.jsx'/)
  assert.match(source, /const supportChannelCode = getSupportChannelCode\(window\.location\)/)
  assert.match(source, /const supportMode = supportRouteIntent/)
  assert.match(source, /if \(!supportMode\) return undefined/)
  assert.match(source, /if \(!supportChannelCode\) \{/)
  assert.match(source, /\$\{API\}\/support-channels\/resolve\/\$\{encodeURIComponent\(supportChannelCode\)\}/)
  assert.match(source, /let active = true/)
  assert.match(source, /return \(\) => \{ active = false \}/)
})

test('直接但格式错误的支持路径保持在不可用支持模式', () => {
  assert.match(source, /const supportRouteIntent = window\.location\.pathname === '\/support' \|\| window\.location\.pathname\.startsWith\('\/support\/'\)/)
  assert.match(source, /const supportMode = supportRouteIntent/)
  assert.match(source, /const \[supportChannelLoading, setSupportChannelLoading\] = useState\(Boolean\(supportChannelCode\)\)/)
  assert.match(source, /setSupportChannelError\('商品二维码格式无效，请重新扫描'\)/)
  assert.match(source, /if \(supportMode && \(supportChannelLoading \|\| supportChannelError \|\| !supportChannel\)\) return \([\s\S]*?<SupportExperience/)
})

test('扫码模式仅开放已解析渠道的问答，并锁定问答标签', () => {
  assert.match(source, /if \(supportMode && \(supportChannelLoading \|\| supportChannelError \|\| !supportChannel\)\) return \([\s\S]*?<SupportExperience/)
  assert.match(source, /const tabs = supportMode \|\| !isAdminUser\s+\? \[\{ key: 'rag', label: '智能问答', icon: '🤖' \}\]/)
  assert.match(source, /if \(supportMode && supportChannel\) setActiveTab\('rag'\)/)

  const gateIndex = source.indexOf('if (supportMode && (supportChannelLoading || supportChannelError || !supportChannel))')
  assert.ok(gateIndex >= 0)
  assert.ok(gateIndex < source.indexOf('<div className="tab-bar">'))
  assert.ok(gateIndex < source.indexOf('<label>提问</label>'))
})

test('扫码渠道码覆盖全部现有问答端点，管理入口只向普通模式管理员展示', () => {
  assert.match(source, /const ragScopePayload = supportMode\s+\? \{ supportChannelCode \}/)
  for (const [endpoint, requestSource] of ragRequestSections()) {
    assert.match(requestSource, new RegExp(`/rag/${endpoint}`))
    assert.match(requestSource, /\.\.\.ragScopePayload/)
    assert.doesNotMatch(requestSource, /productLine:\s*effectiveProductLine/)
    assert.doesNotMatch(requestSource, /productModel:\s*effectiveProductModel/)
  }
  assert.match(source, /const canUseAdminRagControls = isAdminUser && !supportMode/)
  assert.match(source, /if \(!canUseAdminRagControls \|\| !ragQuestion\.trim\(\)\) return/)
  assert.match(source, /if \(canUseAdminRagControls\) body\.mode = ragMode/)
  assert.match(source, /const handleRagAsk = async \(\) => \{\s+if \(supportMode && !supportChannel\) return/)
  assert.match(source, /user\?\.role === 'admin' && !supportMode && <SupportChannelManager apiFetch=\{supportApiFetch\} publicAppUrl=\{window\.location\.origin\} \/>/)
  assert.match(source, /const supportApiFetch = \(path, options\) => fetch\(path, options\)/)
  assert.match(source, /'X-Support-Channel': supportChannelCode/)
  assert.match(source, /if \(!user && !supportMode\) return <AuthPage/)
  assert.match(source, /const customerKnowledgeReady = supportMode \? Boolean\(supportChannel\) : documents\.length > 0/)
})

test('管理员复制和失效判断优先使用服务端返回的规范支持链接', () => {
  assert.match(managerSource, /channelValue\(channel, 'supportUrl', 'support_url'\)/)
  assert.match(managerSource, /if \(canonical\) return canonical/)
  assert.match(managerSource, /const url = channelUrl\(publicAppUrl, channel\)/)
  assert.match(managerSource, /if \(!nextActive && copyUrl === channelUrl\(publicAppUrl, channel\)\) setCopyUrl\(''\)/)
  assert.match(managerSource, /if \(copyUrl === channelUrl\(publicAppUrl, channel\)\) setCopyUrl\(''\)/)
})
