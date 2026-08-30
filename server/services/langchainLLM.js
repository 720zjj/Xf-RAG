/**
 * LangChain LLM 封装层
 * 统一使用 @langchain/openai 的 ChatOpenAI 调用外部 LLM（GLM-4-Flash 等 OpenAI 兼容接口），
 * 替代原先散落在 ragEngine.js 中的 5 处手写 fetch 代码。
 * 本地 Xenova 模型作为回退方案保留。
 */

import { ChatOpenAI } from '@langchain/openai'
import { localLLM, localLLMStream, isLocalLLMReady } from './localLLM.js'

// ─── 单例 ChatOpenAI 实例 ──────────────────────────────────────────────────

function getLLM(overrides = {}) {
  const baseURL = (process.env.LLM_BASE_URL || '').replace(/\/+$/, '')
  return new ChatOpenAI({
    model: process.env.LLM_MODEL || 'glm-4-flash',
    temperature: overrides.temperature ?? 0.3,
    maxTokens: overrides.maxTokens ?? 1024,
    timeout: overrides.timeout ?? 20000,
    configuration: {
      baseURL,
      apiKey: process.env.LLM_API_KEY
    }
  })
}

// ─── 可用性检查 ─────────────────────────────────────────────────────────────

/** 是否已配置外部 LLM（三项环境变量齐备才启用） */
export function isLLMEnabled() {
  return Boolean(process.env.LLM_BASE_URL && process.env.LLM_API_KEY && process.env.LLM_MODEL)
}

/** 是否有任何 LLM 可用（外部配置 或 本地 Xenova 模型） */
export function isAnyLLMAvailable() {
  return isLLMEnabled() || isLocalLLMReady()
}

// ─── 核心调用 ───────────────────────────────────────────────────────────────

/**
 * 非流式 LLM 调用
 * @param {Array<{role: string, content: string}>} messages
 * @param {object} opts - { temperature, timeoutMs, maxTokens }
 * @returns {Promise<string>} LLM 返回文本
 */
export async function callLLM(messages, { temperature = 0.3, timeoutMs = 20000, maxTokens = 1024 } = {}) {
  if (isLLMEnabled()) {
    const llm = getLLM({ temperature, maxTokens, timeout: timeoutMs })
    const response = await llm.invoke(messages, {
      signal: AbortSignal.timeout(timeoutMs)
    })
    const content = typeof response.content === 'string'
      ? response.content
      : response.content?.map(c => c.text || '').join('') || ''
    if (!content.trim()) throw new Error('LLM 返回内容为空')
    return content.trim()
  }

  // 回退到本地 Xenova LLM
  console.log('[callLLM] 外部 LLM 未配置，使用本地 Xenova 模型')
  return await localLLM(messages, { temperature, maxNewTokens: Math.min(timeoutMs / 20, 1024) })
}

/**
 * 流式 LLM 调用（逐 token 回调，用于思考面板逐字展示）
 * @param {Array<{role: string, content: string}>} messages
 * @param {object} opts - { temperature, timeoutMs, maxTokens, onToken }
 * @returns {Promise<string>} 完整文本
 */
export async function callLLMStream(messages, { temperature = 0.3, timeoutMs = 30000, maxTokens = 512, onToken } = {}) {
  if (isLLMEnabled()) {
    const llm = getLLM({ temperature, maxTokens, timeout: timeoutMs })
    const stream = await llm.stream(messages, {
      signal: AbortSignal.timeout(timeoutMs)
    })
    let fullText = ''
    for await (const chunk of stream) {
      const delta = typeof chunk.content === 'string' ? chunk.content : ''
      if (delta) {
        fullText += delta
        onToken?.(delta)
      }
    }
    return fullText.trim()
  }

  // 回退到本地流式
  console.log('[callLLMStream] 使用本地 Xenova 流式模型')
  return await localLLMStream(messages, {
    temperature,
    maxNewTokens: Math.min(timeoutMs / 20, 128),
    onToken
  })
}
