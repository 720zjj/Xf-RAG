// 本地 Embedding 服务
// 使用 @xenova/transformers 在 Node 进程内运行中文句向量模型（bge-small-zh），
// 全程不调用外部推理 API；模型权重首次运行时从镜像下载并缓存到本地，之后离线可用。
import { pipeline, env } from '@xenova/transformers'
import dotenv from 'dotenv'
import { configureTransformersRuntime } from './transformersRuntime.js'
dotenv.config()

// 允许远端下载模型（首次），并使用国内镜像避开 huggingface.co 连接超时
env.allowLocalModels = true
env.remoteHost = process.env.HF_MIRROR || 'https://hf-mirror.com'
configureTransformersRuntime({ transformersEnv: env })

const MODEL = process.env.EMBED_MODEL || 'Xenova/bge-small-zh-v1.5'

// bge 系列建议：查询侧加检索指令前缀，文档侧不加，可显著提升检索效果
const QUERY_INSTRUCTION = '为这个句子生成表示以用于检索相关文章：'

let _extractorPromise = null
function getExtractor() {
  if (!_extractorPromise) {
    console.log(`[embedding] 正在加载模型 ${MODEL} ...（首次需联网下载）`)
    _extractorPromise = pipeline('feature-extraction', MODEL)
      .then(ext => { console.log(`[embedding] 模型 ${MODEL} 就绪`); return ext })
      .catch(err => { _extractorPromise = null; throw err })
  }
  return _extractorPromise
}

/** 编码单条文本为归一化句向量（数组）。isQuery=true 时加检索指令前缀。 */
export async function embedText(text, isQuery = false) {
  const extractor = await getExtractor()
  const input = (isQuery ? QUERY_INSTRUCTION : '') + (text || '')
  const out = await extractor(input, { pooling: 'mean', normalize: true })
  return Array.from(out.data)
}

/** 批量编码（逐条，稳定；本项目规模下足够快） */
export async function embedBatch(texts, isQuery = false) {
  const vectors = []
  for (const t of texts) vectors.push(await embedText(t, isQuery))
  return vectors
}

/** 余弦相似度（输入均为已 L2 归一化的向量，点积即余弦） */
export function cosine(a, b) {
  if (!a || !b) return 0
  const n = Math.min(a.length, b.length)
  let s = 0
  for (let i = 0; i < n; i++) s += a[i] * b[i]
  return s
}

/** 预热：提前触发模型加载/下载，避免首个用户查询阻塞过久 */
export async function warmupEmbedding() {
  try {
    await getExtractor()
    return true
  } catch (err) {
    console.warn('[embedding] 预热失败（稍后按需重试）：', err.message)
    return false
  }
}

export const EMBED_MODEL_NAME = MODEL
