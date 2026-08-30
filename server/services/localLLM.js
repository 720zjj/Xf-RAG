/**
 * 本地 LLM 推理服务（基于 @xenova/transformers）
 * 当外部 LLM（Ollama/DeepSeek 等）未配置时，自动回退到本地小模型
 * 模型首次使用从 HF 镜像下载缓存，之后离线可用
 */

import { pipeline, env } from '@xenova/transformers'
import dotenv from 'dotenv'
import { configureTransformersRuntime } from './transformersRuntime.js'

dotenv.config()
configureTransformersRuntime({ transformersEnv: env })

// 模型配置：Qwen1.5 0.5B Chat，Xenova 原生格式，量化版仅 482MB，原生中文
const MODEL_NAME = 'Xenova/Qwen1.5-0.5B-Chat'
let generator = null
let loadPromise = null
let loadError = null

/**
 * 懒加载文本生成管线（首次调用时下载模型并缓存）
 */
async function getGenerator() {
  if (generator) return generator
  if (loadError) throw loadError

  if (!loadPromise) {
    loadPromise = (async () => {
      console.log(`[localLLM] 正在加载模型 ${MODEL_NAME} ...（首次需下载约 500MB，之后缓存）`)
      try {
        generator = await pipeline('text-generation', MODEL_NAME, {
          // 使用 HF 镜像加速下载（与 embedding 共用同一镜像配置）
          progress_callback: (info) => {
            if (info?.status === 'downloading') {
              const pct = info.progress ? Math.round(info.progress) : 0
              if (pct % 10 === 0) console.log(`[localLLM] 下载进度: ${pct}%`)
            }
          }
        })
        console.log(`[localLLM] 模型 ${MODEL_NAME} 就绪`)
      } catch (err) {
        loadError = err
        console.error(`[localLLM] 模型加载失败:`, err.message)
        throw err
      }
    })()
  }
  return loadPromise
}

/**
 * 将 OpenAI 格式 messages 转为 Qwen2.5 对话模板文本
 *   <|im_start|>system
{system}<|im_end|>
<|im_start|>user
{user}<|im_end|>
<|im_start|>assistant

 */
function buildChatPrompt(messages) {
  if (messages.length === 0) return ''

  let prompt = ''
  for (const msg of messages) {
    const role = msg.role
    const content = (msg.content || '').trim()
    if (role === 'system') {
      prompt += `<|im_start|>system\n${content}<|im_end|>\n`
    } else if (role === 'user') {
      prompt += `<|im_start|>user\n${content}<|im_end|>\n`
    } else if (role === 'assistant') {
      prompt += `<|im_start|>assistant\n${content}<|im_end|>\n`
    }
  }
  // 引导 assistant 回复
  prompt += '<|im_start|>assistant\n'
  return prompt
}

/**
 * 清理生成结果：去除输入 prompt、EOS 标记和残留
 */
function cleanOutput(rawOutput, inputPrompt) {
  let text = rawOutput
  if (text.startsWith(inputPrompt)) {
    text = text.slice(inputPrompt.length)
  }
  // 截断到 <|im_end|> (Qwen EOS)
  const eosIdx = text.indexOf('<|im_end|>')
  if (eosIdx >= 0) text = text.slice(0, eosIdx)
  // 去除可能的 <|im_start|> 残留（模型可能开始新轮）
  const startIdx = text.indexOf('<|im_start|>')
  if (startIdx >= 0) text = text.slice(0, startIdx)
  return text.trim()
}

/**
 * 本地 LLM 流式推理（逐 token 回调）
 * @param {Array} messages - [{role, content}, ...]
 * @param {object} opts - { temperature, maxNewTokens, onToken }
 *   onToken(chunk) - 每次生成新文本时调用
 * @returns {Promise<string>} 完整生成文本
 */
export async function localLLMStream(messages, { temperature = 0.2, maxNewTokens = 128, onToken } = {}) {
  const gen = await getGenerator()

  const sysMsg = messages.find(m => m.role === 'system')
  const otherMsgs = messages.filter(m => m.role !== 'system')
  let truncated = sysMsg ? [sysMsg] : []
  let charCount = sysMsg ? (sysMsg.content || '').length : 0
  for (let i = otherMsgs.length - 1; i >= 0; i--) {
    const len = (otherMsgs[i].content || '').length
    if (charCount + len > 1200) break
    truncated.unshift(otherMsgs[i])
    charCount += len
  }

  const prompt = buildChatPrompt(truncated)
  const safeMaxTokens = Math.min(maxNewTokens, 128)

  let lastText = ''
  await gen(prompt, {
    max_new_tokens: safeMaxTokens,
    temperature,
    do_sample: temperature > 0,
    top_p: 0.9,
    repetition_penalty: 1.1,
    eos_token_id: 151645,
    pad_token_id: 151643,
    callback_function: (output) => {
      const beams = Array.isArray(output) ? output : [output]
      const currentText = beams[0]?.generated_text || ''
      // 只取增量部分
      if (currentText.length > lastText.length) {
        const delta = currentText.slice(lastText.length)
        lastText = currentText
        if (onToken) {
          try { onToken(delta) } catch { /* ignore callback errors */ }
        }
      }
    }
  })

  return cleanOutput(lastText, prompt)
}

/**
 * 本地 LLM 推理（与 callLLM 接口兼容）
 * @param {Array} messages - [{role: 'system'|'user'|'assistant', content: string}, ...]
 * @param {object} opts - { temperature, maxNewTokens }
 * @returns {Promise<string>} 生成的文本
 */
export async function localLLM(messages, { temperature = 0.2, maxNewTokens = 256 } = {}) {
  const gen = await getGenerator()

  // 限制上下文长度：本地模型内存有限，保留最后的信息
  // 总是保留 system prompt + 最后 ~1500 字符的对话
  const sysMsg = messages.find(m => m.role === 'system')
  const otherMsgs = messages.filter(m => m.role !== 'system')
  let truncated = sysMsg ? [sysMsg] : []
  let charCount = sysMsg ? (sysMsg.content || '').length : 0
  for (let i = otherMsgs.length - 1; i >= 0; i--) {
    const len = (otherMsgs[i].content || '').length
    if (charCount + len > 1200) break
    truncated.unshift(otherMsgs[i])
    charCount += len
  }

  const prompt = buildChatPrompt(truncated)

  // 本地 CPU 推理限制 token 数，防止 OOM（每一步推理都需要 KV cache 内存）
  const safeMaxTokens = Math.min(maxNewTokens, 128)

  const result = await gen(prompt, {
    max_new_tokens: safeMaxTokens,
    temperature,
    do_sample: temperature > 0,
    top_p: 0.9,
    repetition_penalty: 1.1,
    // Qwen2.5 token IDs
    eos_token_id: 151645,  // <|im_end|>
    pad_token_id: 151643,  // <|endoftext|>
  })

  const rawOutput = Array.isArray(result) ? result[0]?.generated_text || '' : ''
  return cleanOutput(rawOutput, prompt)
}

/**
 * 预加载模型（可在服务启动时调用来预热，避免首次查询阻塞）
 */
export async function warmupLocalLLM() {
  try {
    await getGenerator()
    return true
  } catch (e) {
    console.warn('[localLLM] 预热失败，将在首次查询时重试:', e.message)
    return false
  }
}

/**
 * 是否已加载成功
 */
export function isLocalLLMReady() {
  return generator !== null
}
