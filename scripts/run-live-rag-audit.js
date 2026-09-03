import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const workspaceRoot = path.resolve(scriptDirectory, '..')
const defaultFixturePath = path.join(workspaceRoot, 'test', 'fixtures', 'rag-live-audit.json')

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

function includesText(haystack, needle) {
  return cleanText(haystack).toLowerCase().includes(cleanText(needle).toLowerCase())
}

function sourceTitle(source = {}) {
  return cleanText(source.title || source.documentName || source.document_name || source.docName)
}

function recommendationModel(item = {}) {
  return cleanText(item.productModel || item.product_model)
}

function videoProvider(item = {}) {
  return cleanText(item.sourceProvider || item.source_provider)
}

function matchesExpectedModel(actual, expected) {
  if (!actual) return true
  const version = expected.match(/(?:^|[^0-9])(4\.0|2\.0)(?![0-9])/)?.[1]
  return version ? new RegExp(`(?:^|[^0-9])${version.replace('.', '\\.')}(?![0-9])`).test(actual) : actual === expected
}

export function evaluateLiveCase(testCase, response = {}) {
  const failures = []
  const data = response?.data || {}
  const answer = cleanText(data.answer)
  const trustLevel = cleanText(data.trust?.level)
  const expectedLevels = testCase.expectedTrust === 'refuse' ? ['refuse'] : ['answer', 'cautious']

  if (response?.ok !== true) failures.push('接口未返回 ok=true')
  if (!answer) failures.push('回答为空')
  if (!expectedLevels.includes(trustLevel)) failures.push(`可信等级应为 ${expectedLevels.join('/')}，实际为 ${trustLevel || '空'}`)

  for (const group of testCase.requiredAnyGroups || []) {
    if (!group.some(keyword => includesText(answer, keyword))) {
      failures.push(`回答缺少关键点（至少包含其一）：${group.join(' / ')}`)
    }
  }
  if (Number(testCase.minimumNumberedSteps) > 0) {
    const numberedSteps = [...answer.matchAll(/(?:^|\s)(\d+)(?:、|[.．]\s+)/g)].length
    if (numberedSteps < Number(testCase.minimumNumberedSteps)) {
      failures.push(`编号步骤不足：至少 ${testCase.minimumNumberedSteps} 步，实际 ${numberedSteps} 步`)
    }
  }
  for (const keyword of testCase.forbidden || []) {
    if (includesText(answer, keyword)) failures.push(`回答出现禁用内容：${keyword}`)
  }

  const sources = Array.isArray(data.sources) ? data.sources : []
  if (testCase.expectedTrust !== 'refuse' && sources.length === 0) failures.push('应答没有资料来源')
  if ((testCase.expectedSourceTitlesAny || []).length > 0) {
    const titles = sources.map(sourceTitle)
    if (!testCase.expectedSourceTitlesAny.some(expected => titles.some(title => includesText(title, expected)))) {
      failures.push(`未命中预期资料：${testCase.expectedSourceTitlesAny.join(' / ')}`)
    }
  }

  const videos = Array.isArray(data.recommendedVideos) ? data.recommendedVideos : []
  const sops = Array.isArray(data.recommendedSops) ? data.recommendedSops : []
  for (const item of [...videos, ...sops]) {
    const actualModel = recommendationModel(item)
    if (!matchesExpectedModel(actualModel, testCase.productModel)) {
      failures.push(`推荐内容串型号：期望 ${testCase.productModel}，实际 ${actualModel}`)
    }
  }
  if (testCase.forbidRecommendations && (videos.length > 0 || sops.length > 0)) {
    failures.push('本题不应推荐视频或 SOP')
  }
  if ((testCase.expectedVideoTitlesAny || []).length > 0) {
    const titles = videos.map(item => cleanText(item.title))
    if (!testCase.expectedVideoTitlesAny.some(expected => titles.some(title => includesText(title, expected)))) {
      failures.push(`未推荐预期视频：${testCase.expectedVideoTitlesAny.join(' / ')}`)
    }
  }
  if (testCase.expectedPrimaryVideoTitle) {
    const primary = videos[0]
    if (!primary || !includesText(primary.title, testCase.expectedPrimaryVideoTitle)) {
      failures.push(`首条视频应为：${testCase.expectedPrimaryVideoTitle}`)
    } else if (testCase.requireOfficialVideo && videoProvider(primary) !== 'iflytek-h5') {
      failures.push(`首条视频不是科大讯飞官方 H5 来源：${videoProvider(primary) || '来源为空'}`)
    }
  }

  const adminOnlyFields = ['answerSource', 'retrievalMode', 'agent', 'router', 'memory', 'reflection', 'queryEnhancement', 'totalChunks', 'totalDocs']
  const leakedFields = adminOnlyFields.filter(field => Object.hasOwn(data, field))
  if (leakedFields.length > 0) failures.push(`普通用户响应泄露管理员字段：${leakedFields.join(', ')}`)

  return {
    id: testCase.id,
    question: testCase.question,
    productModel: testCase.productModel,
    passed: failures.length === 0,
    failures,
    trustLevel,
    answer,
    sourceTitles: sources.map(sourceTitle).filter(Boolean),
    videoTitles: videos.map(item => cleanText(item.title)).filter(Boolean),
    sopTitles: sops.map(item => cleanText(item.title)).filter(Boolean)
  }
}

export function loadLiveAuditCases(filePath = defaultFixturePath) {
  const cases = JSON.parse(fs.readFileSync(filePath, 'utf8'))
  if (!Array.isArray(cases) || cases.length === 0) throw new Error('实时回归题库必须是非空 JSON 数组')
  return cases
}

function parseArgs(args) {
  const valueAfter = flag => {
    const index = args.indexOf(flag)
    return index >= 0 ? args[index + 1] : ''
  }
  return {
    baseUrl: valueAfter('--base-url') || process.env.RAG_AUDIT_BASE_URL || 'http://127.0.0.1:3000',
    token: valueAfter('--token') || process.env.RAG_AUDIT_TOKEN || '',
    fixturePath: valueAfter('--fixture') || defaultFixturePath,
    outputPath: valueAfter('--output') || process.env.RAG_AUDIT_OUTPUT || '',
    caseIds: (valueAfter('--ids') || process.env.RAG_AUDIT_IDS || '').split(',').map(item => item.trim()).filter(Boolean),
    delayMs: Number(valueAfter('--delay-ms') || process.env.RAG_AUDIT_DELAY_MS || 100)
  }
}

async function readJsonResponse(response) {
  const text = await response.text()
  try { return JSON.parse(text) } catch { throw new Error(`接口返回的不是 JSON（HTTP ${response.status}）`) }
}

export async function runLiveAudit({ baseUrl, token, fixturePath = defaultFixturePath, outputPath = '', caseIds = [], delayMs = 100, fetchImpl = fetch } = {}) {
  if (!token) throw new Error('请通过 --token 或 RAG_AUDIT_TOKEN 提供普通用户令牌；脚本不会保存账号密码')
  const root = String(baseUrl || 'http://127.0.0.1:3000').replace(/\/$/, '')
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
  const productResponse = await fetchImpl(`${root}/api/support-channels/products`, { headers })
  const productPayload = await readJsonResponse(productResponse)
  if (!productResponse.ok || productPayload.ok !== true) throw new Error(productPayload.error || '无法读取可信产品范围')
  const products = Array.isArray(productPayload.data) ? productPayload.data : []
  const productByModel = new Map(products.map(product => [cleanText(product.productModel), product]))
  const allCases = loadLiveAuditCases(fixturePath)
  const selectedIds = new Set(caseIds)
  const cases = selectedIds.size > 0 ? allCases.filter(testCase => selectedIds.has(testCase.id)) : allCases
  if (cases.length === 0) throw new Error('没有匹配 --ids 的实时回归题目')
  const results = []
  const sessionIds = new Map()

  for (const testCase of cases) {
    const product = productByModel.get(cleanText(testCase.productModel))
    if (!product) {
      results.push({ id: testCase.id, question: testCase.question, productModel: testCase.productModel, passed: false, failures: ['服务端可信产品范围中没有该型号'] })
      continue
    }
    const startedAt = Date.now()
    try {
      const sessionKey = cleanText(testCase.sessionGroup)
      if (sessionKey && !sessionIds.has(sessionKey)) sessionIds.set(sessionKey, `live-audit-session-${sessionKey}-${Date.now()}`)
      const response = await fetchImpl(`${root}/api/rag/ask`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          question: testCase.question,
          productKey: product.productKey,
          sessionId: sessionKey ? sessionIds.get(sessionKey) : `live-audit-${testCase.id}-${Date.now()}`,
          mode: 'plan-solve',
          reflection: true
        })
      })
      const payload = await readJsonResponse(response)
      const result = evaluateLiveCase(testCase, payload)
      result.httpStatus = response.status
      result.latencyMs = Date.now() - startedAt
      if (!response.ok) {
        result.passed = false
        result.failures.unshift(payload.error || `HTTP ${response.status}`)
      }
      results.push(result)
    } catch (error) {
      results.push({ id: testCase.id, question: testCase.question, productModel: testCase.productModel, passed: false, failures: [error.message], latencyMs: Date.now() - startedAt })
    }
    if (delayMs > 0) await new Promise(resolve => setTimeout(resolve, delayMs))
  }

  const report = {
    generatedAt: new Date().toISOString(),
    baseUrl: root,
    note: '这是自动化真实接口回归，不等同于用户逐题确认的 30 题人工验收。',
    total: results.length,
    passed: results.filter(item => item.passed).length,
    failed: results.filter(item => !item.passed).length,
    results
  }
  if (outputPath) {
    const absoluteOutput = path.resolve(outputPath)
    fs.mkdirSync(path.dirname(absoluteOutput), { recursive: true })
    fs.writeFileSync(absoluteOutput, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  }
  return report
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (invokedDirectly) {
  try {
    const options = parseArgs(process.argv.slice(2))
    const report = await runLiveAudit(options)
    console.log(`普通顾客真实接口回归：${report.passed}/${report.total} 通过`)
    for (const result of report.results.filter(item => !item.passed)) {
      console.log(`- ${result.id} ${result.productModel}「${result.question}」：${result.failures.join('；')}`)
    }
    if (report.failed > 0) process.exitCode = 1
  } catch (error) {
    console.error(`实时回归失败：${error.message}`)
    process.exitCode = 1
  }
}
