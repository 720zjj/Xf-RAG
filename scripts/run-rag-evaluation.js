import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const workspaceRoot = path.resolve(scriptDirectory, '..')
const defaultFixturePath = path.join(workspaceRoot, 'test', 'fixtures', 'rag-evaluation.json')
const defaultReportPath = path.join(workspaceRoot, 'reports', 'rag-evaluation-report.md')

function finiteNumber(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function ratio(numerator, denominator) {
  return denominator > 0 ? numerator / denominator : null
}

function formatPercentage(value) {
  return value === null ? '未实测' : `${(value * 100).toFixed(1)}%`
}

function formatNumber(value, suffix = '') {
  return value === null ? '未实测' : `${value}${suffix}`
}

function normalizeTitle(value) {
  return String(value || '')
    .trim()
    .replace(/\.(md|txt|docx|pdf)$/i, '')
    .replace(/[\s\-—_（）()]/g, '')
    .toLowerCase()
}

function sourceTitlesOf(observation = {}) {
  const explicit = Array.isArray(observation.sourceTitles) ? observation.sourceTitles : []
  const sources = Array.isArray(observation.sources) ? observation.sources : []
  return [...explicit, ...sources.map(item => item?.title || item?.documentName || item?.document_name)]
    .map(item => String(item || '').trim())
    .filter(Boolean)
}

function expectedSourceMatched(expectedDocuments, sourceTitles) {
  const normalizedSources = sourceTitles.map(normalizeTitle)
  return expectedDocuments.some(expected => {
    const normalizedExpected = normalizeTitle(expected)
    return normalizedSources.some(source => source.includes(normalizedExpected) || normalizedExpected.includes(source))
  })
}

function normalizeObservations(value) {
  const observations = Array.isArray(value) ? value : value?.results
  if (!Array.isArray(observations)) {
    throw new Error('实测结果文件必须是数组，或包含 results 数组的 JSON 对象。')
  }
  return observations
}

function normalizeOutcome(value) {
  const outcome = String(value || '').trim().toLowerCase()
  if (outcome === '通过' || outcome === 'passed' || outcome === 'pass') return 'passed'
  if (outcome === '部分通过' || outcome === 'partial') return 'partial'
  if (outcome === '失败' || outcome === 'failed' || outcome === 'fail') return 'failed'
  return 'partial'
}

export function loadEvaluationCases(filePath = defaultFixturePath) {
  const cases = JSON.parse(fs.readFileSync(filePath, 'utf8'))
  if (!Array.isArray(cases)) throw new Error('评测集必须是 JSON 数组。')
  return cases
}

export function evaluateCases(cases, recordedObservations = []) {
  const observations = normalizeObservations(recordedObservations)
  const caseIds = new Set(cases.map(item => item.id))
  const unexpected = observations.map(item => item?.id).filter(id => !caseIds.has(id))
  if (unexpected.length > 0) throw new Error(`实测结果包含未知题目：${unexpected.join('、')}`)

  const observationById = new Map(observations.filter(item => item?.id).map(item => [item.id, item]))
  const rows = cases.map(item => {
    const observation = observationById.get(item.id)
    if (!observation) return { ...item, status: 'pending', sourceTitles: [] }

    const sourceTitles = sourceTitlesOf(observation)
    const retrievalApplicable = !item.shouldRefuse && item.expectedDocuments.length > 0
    const retrievalHit = retrievalApplicable ? expectedSourceMatched(item.expectedDocuments, sourceTitles) : null
    const citationAccurate = typeof observation.citationAccurate === 'boolean' ? observation.citationAccurate : null
    const refusalCorrect = item.shouldRefuse && typeof observation.refusalFollowed === 'boolean'
      ? observation.refusalFollowed
      : null
    const status = normalizeOutcome(observation.result)

    return {
      ...item,
      status,
      sourceTitles,
      retrievalApplicable,
      retrievalHit,
      citationAccurate,
      refusalCorrect,
      latencyMs: finiteNumber(observation.latencyMs),
      totalTokens: finiteNumber(observation.totalTokens),
      note: String(observation.note || '').trim()
    }
  })

  const retrievalRows = rows.filter(item => item.retrievalApplicable)
  const citationRows = rows.filter(item => typeof item.citationAccurate === 'boolean')
  const refusalRows = rows.filter(item => item.shouldRefuse && typeof item.refusalCorrect === 'boolean')
  const timedRows = rows.filter(item => Number.isFinite(item.latencyMs))
  const tokenRows = rows.filter(item => Number.isFinite(item.totalTokens))
  const outcomes = {
    passed: rows.filter(item => item.status === 'passed').length,
    partial: rows.filter(item => item.status === 'partial').length,
    failed: rows.filter(item => item.status === 'failed').length,
    pending: rows.filter(item => item.status === 'pending').length
  }

  return {
    generatedAt: new Date().toISOString(),
    total: cases.length,
    rows,
    retrieval: {
      applicable: retrievalRows.length,
      hit: retrievalRows.filter(item => item.retrievalHit).length,
      rate: ratio(retrievalRows.filter(item => item.retrievalHit).length, retrievalRows.length)
    },
    citations: {
      assessed: citationRows.length,
      accurate: citationRows.filter(item => item.citationAccurate).length,
      rate: ratio(citationRows.filter(item => item.citationAccurate).length, citationRows.length)
    },
    refusals: {
      expected: refusalRows.length,
      correct: refusalRows.filter(item => item.refusalCorrect).length,
      rate: ratio(refusalRows.filter(item => item.refusalCorrect).length, refusalRows.length)
    },
    performance: {
      timed: timedRows.length,
      averageLatencyMs: timedRows.length > 0 ? Math.round(timedRows.reduce((sum, item) => sum + item.latencyMs, 0) / timedRows.length) : null,
      tokenObservations: tokenRows.length,
      totalTokens: tokenRows.length > 0 ? tokenRows.reduce((sum, item) => sum + item.totalTokens, 0) : null
    },
    outcomes
  }
}

function cell(value) {
  return String(value ?? '').replaceAll('|', '\\|').replaceAll('\n', '<br>')
}

export function buildMarkdownReport(report) {
  const pending = report.outcomes.pending
  const titleStatus = pending === report.total ? '待实测' : pending > 0 ? '部分完成' : '已完成'
  const lines = [
    `# RAG 可信回答评测报告（${titleStatus}）`,
    '',
    `生成时间：${report.generatedAt}`,
    '',
    '## 指标',
    '',
    '| 指标 | 结果 |',
    '| --- | ---: |',
    `| 已录入结果 | ${report.total - pending} / ${report.total} |`,
    `| 检索命中率 | ${formatPercentage(report.retrieval.rate)}（${report.retrieval.hit} / ${report.retrieval.applicable}） |`,
    `| 引用准确率 | ${formatPercentage(report.citations.rate)}（${report.citations.accurate} / ${report.citations.assessed}） |`,
    `| 拒答准确率 | ${formatPercentage(report.refusals.rate)}（${report.refusals.correct} / ${report.refusals.expected}） |`,
    `| 平均耗时 | ${formatNumber(report.performance.averageLatencyMs, ' ms')}（${report.performance.timed} 条有记录） |`,
    `| Token 消耗 | ${formatNumber(report.performance.totalTokens)}（${report.performance.tokenObservations} 条有记录） |`,
    '',
    '## 结果分布',
    '',
    `通过 ${report.outcomes.passed}，部分通过 ${report.outcomes.partial}，失败 ${report.outcomes.failed}，待测 ${report.outcomes.pending}。`,
    '',
    '## 明细',
    '',
    '| ID | 结果 | 检索 | 引用 | 拒答 | 耗时 | 来源 | 备注 |',
    '| --- | --- | --- | --- | --- | ---: | --- | --- |'
  ]

  for (const row of report.rows) {
    const retrieval = row.retrievalApplicable === undefined || row.retrievalApplicable === null
      ? '—'
      : row.retrievalHit ? '命中' : '未命中'
    const citation = row.citationAccurate === null || row.citationAccurate === undefined
      ? '未记录'
      : row.citationAccurate ? '准确' : '不准确'
    const refusal = row.refusalCorrect === null || row.refusalCorrect === undefined
      ? (row.shouldRefuse ? '未记录' : '不适用')
      : row.refusalCorrect ? '正确' : '失败'
    lines.push(`| ${row.id} | ${row.status === 'pending' ? '待测' : row.status} | ${retrieval} | ${citation} | ${refusal} | ${formatNumber(row.latencyMs, ' ms')} | ${cell(row.sourceTitles.join('、') || '—')} | ${cell(row.note || '—')} |`)
  }

  lines.push(
    '',
    '## 录入规则',
    '',
    '- 只填写实际网页或接口测试的观察结果；缺失数据会显示为“未实测”，脚本不会补造成绩。',
    '- 拒答题为 E26、E29、E30。任一拒答失败都应先修复可信规则，再重新评测。',
    '- 每次调整检索、切分或 Prompt 后，使用同一份 30 题结果格式重新生成报告进行对比。'
  )
  return `${lines.join('\n')}\n`
}

function inputPathFromArgs(args) {
  const flagIndex = args.indexOf('--input')
  if (flagIndex >= 0) return args[flagIndex + 1]
  return args.find(arg => !arg.startsWith('-')) || process.env.RAG_EVAL_RESULTS || ''
}

export function runEvaluation({ inputPath = '', outputPath = defaultReportPath } = {}) {
  const cases = loadEvaluationCases()
  const observations = inputPath
    ? normalizeObservations(JSON.parse(fs.readFileSync(path.resolve(inputPath), 'utf8')))
    : []
  const report = evaluateCases(cases, observations)
  fs.mkdirSync(path.dirname(outputPath), { recursive: true })
  fs.writeFileSync(outputPath, buildMarkdownReport(report), 'utf8')
  return { report, outputPath }
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (invokedDirectly) {
  try {
    const inputPath = inputPathFromArgs(process.argv.slice(2))
    const outputPath = process.env.RAG_EVAL_REPORT || defaultReportPath
    const { report, outputPath: writtenPath } = runEvaluation({ inputPath, outputPath })
    console.log(`评测报告已生成：${writtenPath}`)
    console.log(`已录入 ${report.total - report.outcomes.pending}/${report.total} 条；拒答准确率：${formatPercentage(report.refusals.rate)}`)
    if (report.outcomes.failed > 0 || report.refusals.rate !== null && report.refusals.rate < 1) process.exitCode = 1
  } catch (error) {
    console.error(`评测运行失败：${error.message}`)
    process.exitCode = 1
  }
}
