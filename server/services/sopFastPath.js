import pool from '../db.js'

const ACTION_TERMS = ['恢复出厂设置', '恢复出厂', '连接', '配对', '开机', '关机', '升级', '更新', '设置', '切换', '开启', '关闭', '添加', '删除', '重启']
const OPERATION_PATTERN = /怎么|如何|怎样|步骤|流程|操作|设置|连接|配对|开机|关机|升级|更新|恢复|重启|切换|开启|关闭|添加|删除/
const TROUBLESHOOT_PATTERN = /为什么|原因|故障|异常|报错|错误|失败|不行|不能|无法|不了|连不上|搜不到|没反应|死机|卡住|闪退|掉线|损坏|坏了/
const MULTI_QUESTION_PATTERN = /[，,、；;]|还有|另外|以及|同时|并且|而且|顺便/
const QUERY_FILLERS = ['翻译机', '讯飞', '请问', '怎么', '如何', '怎样', '步骤', '流程', '操作', '一下', '功能']

const ACTION_ALIAS_GROUPS = [
  ['恢复出厂设置', '恢复出厂', '重置', '还原'],
  ['连接', '接入', '联网'],
  ['配对'],
  ['开机', '启动'],
  ['关机'],
  ['升级', '更新'],
  ['设置', '配置', '调整'],
  ['切换', '选择', '更换', '变更', '调整', '设置'],
  ['开启', '打开'],
  ['关闭'],
  ['添加', '新增'],
  ['删除', '移除'],
  ['重启', '重新启动']
]

const DIRECT_OBJECT_CONCEPTS = [
  {
    pattern: /(翻译语言|翻译语种|互译语种|语言对|源语言|目标语言|语种)/i,
    aliases: ['翻译语言', '翻译语种', '互译语种', '语言对', '源语言', '目标语言', '语种']
  },
  {
    pattern: /(wi[\s-]?fi|wlan|无线网络)/i,
    aliases: ['wifi', 'wi-fi', 'wlan', '无线网络']
  }
]

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
  return normalizeMatchText(value).includes(normalizeMatchText(keyword))
}

function textValue(value) {
  return typeof value === 'string' || typeof value === 'number' ? String(value).trim() : ''
}

function normalizeMatchText(value) {
  return String(value || '').toLocaleLowerCase().replace(/[\s_-]+/g, '')
}

function uniqueByNormalized(values) {
  const seen = new Set()
  return values.filter(value => {
    const key = normalizeMatchText(value)
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function extractActionTerms(source) {
  const matches = ACTION_TERMS.filter(term => source.includes(term))
  return matches.filter(term => !matches.some(other => other.length > term.length && other.includes(term)))
}

function replaceAllText(source, value) {
  return value ? source.split(value).join(' ') : source
}

function extractObjectAliasGroups(source, actionTerms) {
  const groups = []
  for (const concept of DIRECT_OBJECT_CONCEPTS) {
    const match = source.match(concept.pattern)
    if (match) groups.push(uniqueByNormalized([match[0], ...concept.aliases]))
  }

  for (const english of source.match(/[a-zA-Z][a-zA-Z0-9._-]*/g) || []) {
    groups.push([english])
  }

  let remainder = source
  for (const filler of QUERY_FILLERS) remainder = replaceAllText(remainder, filler)
  for (const action of actionTerms) remainder = replaceAllText(remainder, action)
  remainder = remainder.replace(/[？?！!。，,、；;：:（）()【】\[\]<>]/g, ' ')

  for (const token of remainder.match(/[\u4e00-\u9fa5]{2,16}|[a-zA-Z][a-zA-Z0-9._-]*/g) || []) {
    if (QUERY_FILLERS.includes(token)) continue
    groups.push([token])
  }

  const seen = new Set()
  return groups.filter(group => {
    const primary = normalizeMatchText(group[0])
    if (!primary || seen.has(primary)) return false
    seen.add(primary)
    return true
  })
}

function actionAliases(action) {
  return ACTION_ALIAS_GROUPS.find(group => group.includes(action)) || [action]
}

function hasSopSource(sop) {
  return Boolean(textValue(sop?.source_document || sop?.sourceDocument) || textValue(sop?.source_pages || sop?.sourcePages))
}

/**
 * SOP 直达比普通推荐更严格：来源必须存在，且标题/分类必须明确写出
 * 用户要执行的动作和对象。步骤正文只能补充细节，不能让泛化标题获得直达资格。
 */
export function supportsDirectIntent(sop, intent) {
  if (!hasSopSource(sop) || !intent?.eligible) return false
  const titleAndCategory = [sop?.title, sop?.category].map(textValue).filter(Boolean).join(' ')
  if (!titleAndCategory) return false

  const actionCovered = (intent.actionTerms || []).every(action => (
    actionAliases(action).some(alias => includesKeyword(titleAndCategory, alias))
  ))
  const objectCovered = (intent.objectAliasGroups || []).every(group => (
    group.some(alias => includesKeyword(titleAndCategory, alias))
  ))
  return actionCovered && objectCovered
}

export function formatSopStep(step) {
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
  const actionTerms = extractActionTerms(source)
  const objectAliasGroups = extractObjectAliasGroups(source, actionTerms)
  const objectTerms = objectAliasGroups.map(group => group[0])
  const keywords = [
    ...actionTerms,
    ...objectTerms
  ].filter((keyword, index, list) => list.indexOf(keyword) === index)

  return {
    eligible: Boolean(source && hasOperationIntent && !hasTroubleshootingIntent && !hasMultipleQuestions && actionTerms.length > 0),
    keywords,
    actionTerms,
    objectTerms,
    objectAliasGroups,
    reason: '简单操作问题，优先查询标准 SOP'
  }
}

export function rankSops(sops, { keywords = [], productLine = '', productModel = '', directIntent = null } = {}) {
  return (sops || [])
    .filter(sop => {
      const sopLine = String(sop.product_line || '')
      const sopModel = String(sop.product_model || '')
      return (!productLine || !sopLine || sopLine === productLine || sopLine === '翻译机') &&
        (!productModel || !sopModel || sopModel === productModel) &&
        (!directIntent || supportsDirectIntent(sop, directIntent))
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
                    prerequisites, warnings, steps, completion_check, source_document, source_pages
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
  const sop = rankSops(rows, { ...filters, keywords: intent.keywords, directIntent: intent })[0] || null
  return { intent, sop }
}

export async function resolveSopFastPath(question, filters = {}, { findSop = findDirectSop } = {}) {
  try {
    const { intent, sop } = await findSop(question, filters)
    const directIntent = classifySopFastPath(question)
    if (!sop || !supportsDirectIntent(sop, directIntent)) return null

    return {
      answer: formatSopAnswer(sop),
      sop,
      router: {
        mode: 'sop-direct',
        confidence: 'high',
        reason: intent?.reason || directIntent.reason,
        enableReflection: false,
        routedBy: 'rule'
      }
    }
  } catch {
    return null
  }
}
