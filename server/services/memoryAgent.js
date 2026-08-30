/**
 * 对话记忆智能体（Conversational Memory Agent）
 * 管理多轮对话历史，实现：
 *   1. 指代消解：用户说"那续航呢"→ 自动补全为"科大讯飞翻译机的电池续航时间"
 *   2. 上下文注入：将历史 Q&A 注入回答生成 prompt，让 LLM 理解对话脉络
 *   3. 会话管理：内存存储，自动过期清理，支持多用户并发
 */

import { callLLM, isLLMEnabled } from './langchainLLM.js'

// ─── 会话存储 ────────────────────────────────────────────────────────────────

/**
 * 会话历史存储
 * key: sessionId
 * value: { turns: Array<{ question, answer, timestamp }>, lastAccess: number }
 */
const sessions = new Map()

const MAX_TURNS = 8          // 每个会话最多保留 8 轮
const SESSION_TTL = 30 * 60 * 1000  // 30 分钟过期

/** 定期清理过期会话（每 10 分钟） */
setInterval(() => {
  const now = Date.now()
  for (const [id, session] of sessions) {
    if (now - session.lastAccess > SESSION_TTL) {
      sessions.delete(id)
    }
  }
}, 10 * 60 * 1000)

// ─── 核心 API ────────────────────────────────────────────────────────────────

/**
 * 获取会话历史
 * @param {string} sessionId
 * @returns {Array<{ question: string, answer: string, timestamp: number }>}
 */
export function getHistory(sessionId) {
  if (!sessionId) return []
  const session = sessions.get(sessionId)
  if (!session) return []
  session.lastAccess = Date.now()
  return session.turns
}

/**
 * 添加一轮对话到历史
 * @param {string} sessionId
 * @param {string} question - 用户问题
 * @param {string} answer - AI 回答
 */
export function addToHistory(sessionId, question, answer) {
  if (!sessionId) return
  if (!sessions.has(sessionId)) {
    sessions.set(sessionId, { turns: [], lastAccess: Date.now() })
  }
  const session = sessions.get(sessionId)
  session.turns.push({ question, answer, timestamp: Date.now() })
  // 超出上限时移除最早的轮次
  if (session.turns.length > MAX_TURNS) {
    session.turns = session.turns.slice(-MAX_TURNS)
  }
  session.lastAccess = Date.now()
}

/**
 * 清除指定会话
 */
export function clearSession(sessionId) {
  if (sessionId) sessions.delete(sessionId)
}

// ─── 上下文感知查询重写（指代消解）────────────────────────────────────────────

const COREF_SYSTEM_PROMPT = `你是一个查询重写专家。根据对话历史，将用户的最新问题重写为一个独立、完整、无指代歧义的查询。

规则：
1. 如果最新问题包含指代词（"它""这个""那""上面说的"等）或省略了主语，根据历史补全
2. 如果最新问题已经完整独立，原样返回
3. 只输出重写后的查询，不要解释
4. 保持用户原意，不要添加额外信息
5. 用中文输出`

/**
 * 上下文感知查询重写（指代消解 + 省略补全）
 * @param {string} sessionId - 会话 ID
 * @param {string} question - 用户最新问题
 * @returns {Promise<{ rewritten: string, resolved: boolean }>}
 *   - rewritten: 重写后的查询（无指代歧义）
 *   - resolved: 是否发生了实质性重写
 */
export async function rewriteWithContext(sessionId, question) {
  const history = getHistory(sessionId)

  // 无历史或 LLM 不可用 → 直接返回原问题
  if (history.length === 0 || !isLLMEnabled()) {
    return { rewritten: question, resolved: false }
  }

  // 检测是否可能需要指代消解（快速规则预判，避免无意义的 LLM 调用）
  const needsResolution =
    /[它这那其]|上面|前面|刚才|之前|同样|也|还有|呢$|吗$/.test(question) &&
    question.length < 30  // 短问题更可能有指代

  if (!needsResolution) {
    return { rewritten: question, resolved: false }
  }

  try {
    // 取最近 3 轮历史作为上下文
    const recentHistory = history.slice(-3)
    const historyText = recentHistory
      .map((t, i) => `第${i + 1}轮\n用户：${t.question}\n助手：${t.answer.substring(0, 150)}`)
      .join('\n\n')

    const result = await callLLM(
      [
        { role: 'system', content: COREF_SYSTEM_PROMPT },
        { role: 'user', content: `对话历史：\n${historyText}\n\n用户最新问题：${question}\n\n请输出重写后的完整查询：` }
      ],
      { temperature: 0, timeoutMs: 5000, maxTokens: 100 }
    )

    const rewritten = result.trim().replace(/^["'""'']|["'""'']$/g, '')  // 去除可能的引号包裹
    const resolved = rewritten !== question && rewritten.length > 0

    if (resolved) {
      console.log(`[Memory] 指代消解："${question}" → "${rewritten}"`)
    }

    return { rewritten: resolved ? rewritten : question, resolved }
  } catch (e) {
    console.warn('[Memory] 上下文重写失败，使用原问题：', e.message)
    return { rewritten: question, resolved: false }
  }
}

// ─── 历史格式化（注入回答生成 prompt）────────────────────────────────────────

/**
 * 将对话历史格式化为 prompt 片段
 * @param {string} sessionId
 * @param {number} maxTurns - 最多包含几轮（默认 3）
 * @returns {string|null} 格式化的历史文本，无历史时返回 null
 */
export function formatHistoryForPrompt(sessionId, maxTurns = 3) {
  const history = getHistory(sessionId)
  if (history.length === 0) return null

  const recent = history.slice(-maxTurns)
  const lines = recent.map((t, i) =>
    `【第${i + 1}轮】\n用户问：${t.question}\n助手答：${t.answer.substring(0, 200)}${t.answer.length > 200 ? '...' : ''}`
  )

  return `以下是之前的对话历史（共${recent.length}轮），请结合上下文回答最新问题：\n\n${lines.join('\n\n')}`
}

/**
 * 获取当前活跃会话数（用于监控）
 */
export function getActiveSessionCount() {
  return sessions.size
}
