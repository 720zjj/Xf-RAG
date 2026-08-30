/**
 * 路由智能体（Router Agent）
 * 自动分析用户问题类型，分发到最优检索策略：
 *   - default    → 简单事实题（HyDE + 多查询融合，最快）
 *   - react      → 需要推理/排障的问题（多轮思考+检索）
 *   - plan-solve → 多角度/对比/复杂问题（先分解再并行检索）
 *
 * 两层分类：
 *   1. 规则层（instant）：基于 detectQueryType + 关键词启发式，零延迟
 *   2. LLM 层（optional）：规则层置信度低时调用 LLM 辅助判断，~1s
 */

import { callLLM, isLLMEnabled } from './langchainLLM.js'
import { classifySopFastPath } from './sopFastPath.js'

// ─── 规则层分类 ─────────────────────────────────────────────────────────────

/**
 * 查询类型检测（与 ragEngine.js 中 detectQueryType 保持一致）
 */
function detectQueryType(query) {
  const q = query.toLowerCase()
  if (/问题|故障|报错|错误|异常|不行|没用|不能|无法|不了|坏了|死机|卡住|闪退|连不上|搜不到|掉线/.test(q)) return 'troubleshoot'
  if (/怎么|如何|怎样|咋|方法|步骤|流程|操作|做法|咋样/.test(q)) return 'how-to'
  if (/为什么|为啥|原因|原理|为何|怎么会/.test(q)) return 'why'
  if (/区别|不同|比较|对比|哪个好|还是|差异|哪个更|有啥不一样/.test(q)) return 'compare'
  if (/支持|能不能|可以|能否|是否|有没有|具备|兼容|能不能够/.test(q)) return 'feature'
  if (/多少|几个|多少钱|价格|费用|多久|多大|多重|尺寸|时长|容量/.test(q)) return 'spec'
  if (/什么|啥|是什么|什么是|定义|含义|意思|指的是|干啥|干嘛/.test(q)) return 'what-is'
  return 'general'
}

/**
 * 检测问题是否包含多个子问题（用标点或连接词分隔）
 */
function hasMultipleSubQuestions(query) {
  // 中文问号/逗号/顿号分割，或包含"还有""另外""以及""和""跟"等连接词
  const parts = query.split(/[？?，,、；;]/).filter(p => p.trim().length > 2)
  if (parts.length >= 2) return true
  if (/还有|另外|以及|同时|并且|而且|顺便/.test(query)) return true
  return false
}

/**
 * 规则层路由（零延迟）
 * @returns {{ mode: string, confidence: 'high'|'medium'|'low', reason: string, enableReflection: boolean }}
 */
function ruleBasedRoute(question, { skipSop = false } = {}) {
  const sopFastPath = classifySopFastPath(question)
  if (!skipSop && sopFastPath.eligible) {
    return {
      mode: 'sop-direct',
      confidence: 'high',
      reason: sopFastPath.reason,
      enableReflection: false
    }
  }

  const qType = detectQueryType(question)
  const multiQ = hasMultipleSubQuestions(question)
  const qLen = question.length

  // ── 高置信度路由 ──

  // 故障排查 / 原因分析 → ReAct（需要多轮推理验证）
  if (qType === 'troubleshoot' || qType === 'why') {
    return {
      mode: 'react',
      confidence: 'high',
      reason: qType === 'troubleshoot'
        ? '故障排查类问题，需要多轮推理定位原因'
        : '原因分析类问题，需要逐步推理验证',
      enableReflection: true
    }
  }

  // 对比类 → Plan-and-Solve（需要多角度检索）
  if (qType === 'compare') {
    return {
      mode: 'plan-solve',
      confidence: 'high',
      reason: '对比类问题，需要分解为多角度并行检索',
      enableReflection: false
    }
  }

  // 多子问题 → Plan-and-Solve
  if (multiQ) {
    return {
      mode: 'plan-solve',
      confidence: 'high',
      reason: '包含多个子问题，适合分解后并行检索',
      enableReflection: false
    }
  }

  // ── 中置信度路由 ──

  // 长问题 + 操作类 → Plan-and-Solve（可能涉及多步骤）
  if (qType === 'how-to' && qLen > 20) {
    return {
      mode: 'plan-solve',
      confidence: 'medium',
      reason: '复杂操作类问题，分解为子步骤检索效果更好',
      enableReflection: false
    }
  }

  // 短操作类 → default（简单问题不需要 Agent 开销）
  if (qType === 'how-to') {
    return {
      mode: 'default',
      confidence: 'medium',
      reason: '简单操作类问题，默认多查询检索即可',
      enableReflection: false
    }
  }

  // ── 默认路由 ──

  // 事实查询 / 功能询问 / 参数查询 / 通用 → default
  return {
    mode: 'default',
    confidence: qType === 'general' ? 'low' : 'high',
    reason: qType === 'general'
      ? '通用问题，默认策略'
      : `${qType} 类问题，默认多查询检索最高效`,
    enableReflection: false
  }
}

// ─── LLM 层分类（规则层置信度低时启用）───────────────────────────────────────

const ROUTER_SYSTEM_PROMPT = `你是一个问题分类器。根据用户的问题，判断它属于以下哪种类型，只输出类型名称：

- default：简单事实查询、功能询问、参数查询（如"支持蓝牙吗""电池多大""是什么"）
- react：需要推理分析的问题、故障排查、原因分析（如"为什么连不上WiFi""翻译不准确怎么办"）
- plan-solve：需要多角度对比、包含多个子问题、复杂操作（如"对比A和B的区别""支持哪些语言，离线能用吗"）

只输出 default / react / plan-solve 其中一个，不要任何解释。`

/**
 * LLM 辅助分类（~1s，仅在规则层不确定时调用）
 */
async function llmRoute(question) {
  try {
    const result = await callLLM(
      [
        { role: 'system', content: ROUTER_SYSTEM_PROMPT },
        { role: 'user', content: question }
      ],
      { temperature: 0, timeoutMs: 5000, maxTokens: 20 }
    )
    const mode = result.trim().toLowerCase()
    if (['default', 'react', 'plan-solve'].includes(mode)) {
      return mode
    }
  } catch (e) {
    console.warn('[Router] LLM 分类失败，使用规则层结果：', e.message)
  }
  return null
}

// ─── 统一入口 ────────────────────────────────────────────────────────────────

/**
 * 路由智能体：自动选择最优检索策略
 * @param {string} question - 用户问题
 * @param {object} opts - { forceMode?: string, skipSop?: boolean } 强制指定模式或跳过 SOP 快速路径
 * @returns {Promise<{ mode: string, confidence: string, reason: string, enableReflection: boolean, routedBy: string }>}
 */
export async function routeQuestion(question, { forceMode, skipSop = false } = {}) {
  // 用户手动指定了模式 → 直接返回
  if (forceMode && forceMode !== 'auto') {
    return {
      mode: forceMode,
      confidence: 'high',
      reason: '用户手动指定',
      enableReflection: forceMode === 'reflection',
      routedBy: 'manual'
    }
  }

  // 规则层分类（instant）
  const ruleResult = ruleBasedRoute(question, { skipSop })

  // 规则层高置信度 → 直接返回
  if (ruleResult.confidence === 'high') {
    return { ...ruleResult, routedBy: 'rule' }
  }

  // 规则层低/中置信度 + LLM 可用 → LLM 辅助判断
  if (isLLMEnabled()) {
    const llmMode = await llmRoute(question)
    if (llmMode && llmMode !== ruleResult.mode) {
      return {
        mode: llmMode,
        confidence: 'medium',
        reason: `规则层判断为 ${ruleResult.mode}（${ruleResult.reason}），LLM 修正为 ${llmMode}`,
        enableReflection: llmMode === 'react',
        routedBy: 'llm'
      }
    }
  }

  // 最终使用规则层结果
  return { ...ruleResult, routedBy: 'rule' }
}
