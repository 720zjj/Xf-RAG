import pool from '../db.js'

const ACTION_TERMS = ['恢复出厂设置', '恢复出厂', '连接', '配对', '开机', '关机', '升级', '更新', '设置', '切换', '开启', '关闭', '添加', '删除', '重启']
const OPERATION_PATTERN = /怎么|如何|怎样|步骤|流程|操作|设置|连接|配对|开机|关机|升级|更新|恢复|重启|切换|开启|关闭|添加|删除/
const TROUBLESHOOT_PATTERN = /为什么|原因|故障|异常|报错|错误|失败|不行|不能|无法|不了|连不上|搜不到|没反应|死机|卡住|闪退|掉线|损坏|坏了/
const MULTI_QUESTION_PATTERN = /[，,、；;]|还有|另外|以及|同时|并且|而且|顺便/

function parseList(value) {
  if (Array.isArray(value)) return value
  if (!value) return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function includesKeyword(value, keyword) {
  return String(value || '').toLocaleLowerCase().includes(String(keyword || '').toLocaleLowerCase())
}

function textValue(value) {
  return typeof value === 'string' || typeof value === 'number' ? String(value).trim() : ''
}

function formatSopStep(step) {
  const simpleText = textValue(step)
  if (simpleText) return simpleText
  if (!step || typeof step !== 'object') return ''

  const action = [step.action, step.description, step.content, step.instruction, step.text, step.title, step.name]
    .map(textValue)
    .find(Boolean) || ''
  const detail = [step.detail, step.tip, step.note, step.reminder]
    .map(textValue)
    .find(Boolean) || ''

  if (!action) return detail
  return detail && detail !== action ? `${action}（${detail}）` : action
}

export function classifySopFastPath(question) {
  const source = String(question || '').trim()
  const hasOperationIntent = OPERATION_PATTERN.test(source)
  const hasTroubleshootingIntent = TROUBLESHOOT_PATTERN.test(source)
  const hasMultipleQuestions = MULTI_QUESTION_PATTERN.test(source)
  const keywords = [
    ...ACTION_TERMS.filter(term => source.includes(term)),
    ...(source.match(/[a-zA-Z][a-zA-Z0-9._-]*/g) || [])
  ].filter((keyword, index, list) => list.indexOf(keyword) === index)

  return {
    eligible: Boolean(source && hasOperationIntent && !hasTroubleshootingIntent && !hasMultipleQuestions && keywords.length > 0),
    keywords,
    reason: '简单操作问题，优先查询标准 SOP'
  }
}

export function rankSops(sops, { keywords = [], productLine = '', productModel = '' } = {}) {
  return (sops || [])
    .filter(sop => {
      const sopLine = String(sop.product_line || '')
      const sopModel = String(sop.product_model || '')
      return (!productLine || !sopLine || sopLine === productLine || sopLine === '翻译机') &&
        (!productModel || !sopModel || sopModel === productModel)
    })
    .map(sop => {
      const steps = parseList(sop.steps).map(formatSopStep).join(' ')
      let relevance = 0
      for (const keyword of keywords) {
        if (includesKeyword(sop.title, keyword)) relevance += 12
        if (includesKeyword(sop.category, keyword)) relevance += 6
        if (includesKeyword(steps, keyword)) relevance += 4
      }
      if (productModel && String(sop.product_model || '') === productModel) relevance += 4
      return { ...sop, relevance }
    })
    .filter(sop => sop.relevance > 0)
    .sort((left, right) => right.relevance - left.relevance || Number(left.id) - Number(right.id))
}

export function formatSopAnswer(sop) {
  const prerequisites = parseList(sop.prerequisites)
  const warnings = parseList(sop.warnings)
  const steps = parseList(sop.steps)
  const lines = [
    `问题结论：可按“${sop.title}”标准操作指南完成操作。`,
    '操作步骤：',
    ...steps.map((step, index) => `${index + 1}. ${formatSopStep(step) || '请查看完整操作指南'}`)
  ]

  if (prerequisites.length > 0 || warnings.length > 0 || sop.completion_check) {
    lines.push('注意事项：')
    if (prerequisites.length > 0) lines.push(`前置条件：${prerequisites.join('；')}`)
    lines.push(...warnings)
    if (sop.completion_check) lines.push(`完成检查：${sop.completion_check}`)
  }

  lines.push(`适用产品和版本：${sop.product_model || '通用型号'}。`)
  return lines.join('\n')
}

export async function findDirectSop(question, filters = {}) {
  const intent = classifySopFastPath(question)
  if (!intent.eligible) return { intent, sop: null }

  const matchClauses = intent.keywords.map(() => '(title LIKE ? OR CAST(steps AS CHAR) LIKE ? OR category LIKE ?)').join(' OR ')
  const matchParams = intent.keywords.flatMap(keyword => [`%${keyword}%`, `%${keyword}%`, `%${keyword}%`])
  let sql = `SELECT id, title, product_line, product_model, category, difficulty, estimated_duration,
                    prerequisites, warnings, steps, completion_check
             FROM sops WHERE review_status = 'approved' AND (${matchClauses})`
  const params = [...matchParams]

  if (filters.productLine) {
    sql += ' AND (product_line = ? OR product_line = "翻译机" OR product_line = "")'
    params.push(filters.productLine)
  }
  if (filters.productModel) {
    sql += ' AND (product_model = ? OR product_model = "")'
    params.push(filters.productModel)
  }

  sql += ' ORDER BY created_at DESC LIMIT 30'
  const [rows] = await pool.query(sql, params)
  const sop = rankSops(rows, { ...filters, keywords: intent.keywords })[0] || null
  return { intent, sop }
}

export async function resolveSopFastPath(question, filters = {}, { findSop = findDirectSop } = {}) {
  try {
    const { intent, sop } = await findSop(question, filters)
    if (!sop) return null

    return {
      answer: formatSopAnswer(sop),
      sop,
      router: {
        mode: 'sop-direct',
        confidence: 'high',
        reason: intent.reason,
        enableReflection: false,
        routedBy: 'rule'
      }
    }
  } catch {
    return null
  }
}
