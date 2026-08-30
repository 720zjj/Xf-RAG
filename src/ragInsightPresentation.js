const MODE_LABELS = {
  default: '快速检索',
  react: '深度分析',
  'plan-solve': '分步处理',
  'tool-agent': '多工具协作',
  reflection: '回答复核',
  auto: '智能检索'
}

const STRATEGY_LABELS = [
  [/HyDE|查询重写|假设性文档/i, '问题理解'],
  [/扩展查询|多查询/i, '多路查找'],
  [/BM25|关键词/i, '关键词检索'],
  [/多向量|向量语义|TF-IDF语义/i, '语义检索'],
  [/重排|RRF/i, '结果筛选']
]

function unique(values) {
  return [...new Set(values.filter(Boolean))]
}

function getStrategyLabels(strategies) {
  return unique((strategies || []).map(strategy => {
    const match = STRATEGY_LABELS.find(([pattern]) => pattern.test(String(strategy)))
    return match?.[1]
  }))
}

function getModeLabel(router, agent) {
  return MODE_LABELS[router?.mode || agent?.mode] || '智能检索'
}

function getSummary(router, agent, modeLabel) {
  if (agent?.fallback) return '原定处理方式暂不可用，已改用稳定的快速检索完成回答。'

  const reason = String(router?.reason || '')
    .replace(/默认多查询检索/g, '知识库检索')
    .replace(/即可/g, '')
    .trim()

  if (reason) return `系统已选择${modeLabel}：${reason}${/[。！？!?]$/.test(reason) ? '' : '。'}`
  if (agent?.mode === 'tool-agent') return '系统已结合知识库和相关工具，整理出本次回答。'
  if (agent?.mode === 'plan-solve') return '系统已将问题拆成小步骤，逐步查找后再整理回答。'
  if (agent?.mode === 'react') return '系统已针对问题多轮查找并交叉确认相关内容。'
  return '系统已从知识库中筛选相关内容，并整理成便于阅读的回答。'
}

export function buildRagInsight({ queryEnhancement, ragMeta } = {}) {
  const enhancement = queryEnhancement || {}
  const meta = ragMeta || {}
  const router = meta.router
  const agent = meta.agent
  const modeLabel = getModeLabel(router, agent)
  const technicalDetails = {
    originalQuery: enhancement.originalQuery || '',
    rewrittenQuery: enhancement.rewrittenQuery || '',
    hydeDoc: enhancement.hydeDoc || '',
    expandedQueries: Array.isArray(enhancement.expandedQueries) ? enhancement.expandedQueries : [],
    totalQueries: Number.isFinite(enhancement.totalQueries) ? enhancement.totalQueries : null,
    strategies: Array.isArray(enhancement.strategies) ? enhancement.strategies : [],
    rounds: Number.isFinite(agent?.rounds) ? agent.rounds : null,
    planLength: Array.isArray(agent?.plan) ? agent.plan.length : null,
    stepCount: Number.isFinite(agent?.steps) ? agent.steps : null,
    toolCount: Array.isArray(agent?.toolCalls) ? agent.toolCalls.length : null,
    fallbackMessage: agent?.fallback ? String(agent.error || '系统已自动切换为稳定方案。') : ''
  }

  const hasTechnicalDetails = Object.values(technicalDetails).some(value => Array.isArray(value) ? value.length > 0 : value !== '' && value !== null)
  const memoryMessage = meta.memory?.resolved && meta.memory.resolvedQuestion
    ? `已结合上文，将问题理解为“${meta.memory.resolvedQuestion}”。`
    : ''
  const reflectionMessage = meta.reflection?.applied
    ? '回答已完成复核与优化。'
    : meta.reflection?.applied === false
      ? '本次回答已直接生成。'
      : ''

  return {
    visible: Boolean(queryEnhancement || router || agent || meta.memory || meta.reflection),
    modeLabel,
    summary: getSummary(router, agent, modeLabel),
    strategyLabels: getStrategyLabels(enhancement.strategies),
    memoryMessage,
    reflectionMessage,
    technicalDetails,
    hasTechnicalDetails
  }
}
