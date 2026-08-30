/**
 * MCP Server — 将讯飞翻译机智能使用助手的核心能力暴露为 MCP 协议工具
 * 
 * 任何支持 MCP 的 AI 客户端（Claude Desktop / Cursor / Qoder 等）
 * 均可通过 stdio 连接本服务，获得以下能力：
 *   - search_knowledge_base：RAG 混合检索（BM25 + 向量 + Rerank）
 *   - ask_question：完整 RAG 问答（检索 + LLM 生成）
 *   - summarize_topic：基于文档的主题摘要
 *   - list_documents：列出已上传文档
 *
 * 启动方式：node server/mcpServer.js
 * 配置示例（Claude Desktop claude_desktop_config.json）：
 * {
 *   "mcpServers": {
 *     "iflytek-rag": {
 *       "command": "D:\\New Folder\\node.exe",
 *       "args": ["d:\\aaagent\\a2\\server\\mcpServer.js"]
 *     }
 *   }
 * }
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import dotenv from 'dotenv'
dotenv.config()

// ─── 导入现有服务 ─────────────────────────────────────────────────────────────
import pool from './db.js'
import { loadUserChunks } from './services/chunkStore.js'
import {
  BM25Index, SemanticIndex, rerank,
  generateAnswer, generateAnswerLLM, generateHyDE, generateHyDEPassage,
  expandQueries, isLLMEnabled
} from './services/ragEngine.js'
import { callLLM } from './services/langchainLLM.js'
import { buildKnowledgeScope } from './services/knowledgeAccess.js'

// ─── 全局状态 ─────────────────────────────────────────────────────────────────
const MCP_USER_ID = Number(process.env.MCP_USER_ID)

let bm25 = null
let semantic = null
let allChunks = []
let chunkSources = []
let initialized = false
let indexVersion = ''

/**
 * 初始化：加载用户文档块，构建检索索引
 */
async function ensureInitialized() {
  if (!Number.isInteger(MCP_USER_ID) || MCP_USER_ID <= 0) {
    throw new Error('请在 .env 中显式配置 MCP_USER_ID，禁止默认读取其他用户数据')
  }

  const versionScope = buildKnowledgeScope(MCP_USER_ID, { documentAlias: 'd', ownerAlias: 'owner' })
  const [[documentVersion]] = await pool.query(
    `SELECT COUNT(*) AS total_docs, COALESCE(MAX(d.id), 0) AS max_doc_id,
            COALESCE(SUM(CRC32(CONCAT(d.id, ':', COALESCE(d.content, '')))), 0) AS doc_checksum,
            COALESCE(SUM(d.chunk_count), 0) AS declared_chunks
     FROM documents d
     JOIN users owner ON d.user_id = owner.id
     WHERE ${versionScope.where} AND d.status = 1`,
    versionScope.params
  )
  const [[chunkVersion]] = await pool.query(
    `SELECT COUNT(*) AS total, COALESCE(MAX(dc.id), 0) AS max_id
     FROM document_chunks dc
     JOIN documents d ON dc.document_id = d.id
     JOIN users owner ON d.user_id = owner.id
     WHERE ${versionScope.where} AND d.status = 1`,
    versionScope.params
  )
  const currentVersion = [
    documentVersion.total_docs,
    documentVersion.max_doc_id,
    documentVersion.doc_checksum,
    documentVersion.declared_chunks,
    chunkVersion.total,
    chunkVersion.max_id
  ].join(':')
  if (initialized && currentVersion === indexVersion) return

  const loaded = await loadUserChunks(MCP_USER_ID, { forceRefresh: true })
  if (!loaded.contents || loaded.contents.length === 0) {
    allChunks = []
    chunkSources = []
    initialized = true
    indexVersion = currentVersion
    return
  }

  allChunks = loaded.contents
  chunkSources = loaded.sources

  // 构建 BM25 索引
  bm25 = new BM25Index()
  bm25.build(allChunks)

  // 构建语义索引
  semantic = new SemanticIndex()
  semantic.build(allChunks)

  initialized = true
  indexVersion = currentVersion
  console.error(`[MCP] 索引构建完成：${allChunks.length} 个文档块`)
}

/**
 * 混合检索（BM25 + 语义 + Rerank）
 */
async function hybridRetrieve(query, topK = 5) {
  await ensureInitialized()
  if (allChunks.length === 0) return []

  // 多查询扩展
  const queries = expandQueries(query)
  const hydeDoc = generateHyDE(query)
  queries.push(hydeDoc)

  // BM25 粗召回
  const bm25Candidates = new Map()
  for (const q of queries) {
    for (const r of bm25.searchCoarse(q, 10)) {
      const prev = bm25Candidates.get(r.index) || 0
      bm25Candidates.set(r.index, Math.max(prev, r.score))
    }
  }

  // 语义检索
  const semanticScores = {}
  if (semantic) {
    for (const q of queries) {
      const results = semantic.search(q, 10)
      for (const r of results) {
        semanticScores[r.index] = Math.max(semanticScores[r.index] || 0, r.score)
      }
    }
  }

  // 合并候选
  const allIndices = new Set([...bm25Candidates.keys(), ...Object.keys(semanticScores).map(Number)])
  const candidates = [...allIndices].map(idx => ({
    index: idx,
    text: allChunks[idx],
    docId: chunkSources[idx]?.docId,
    docName: chunkSources[idx]?.docName,
    score: (bm25Candidates.get(idx) || 0) + (semanticScores[idx] || 0)
  }))

  // Rerank 重排序
  const reranked = rerank(query, candidates, allChunks, chunkSources, semanticScores)
  return reranked.slice(0, topK)
}

// ─── 创建 MCP Server ──────────────────────────────────────────────────────────

const server = new McpServer({
  name: 'iflytek-translator-rag',
  version: '1.0.0'
})

// 工具 1：知识库检索
server.tool(
  'search_knowledge_base',
  '在讯飞翻译机产品文档知识库中检索相关内容。适用于查询产品功能、参数、使用方法、故障排查等。',
  { query: z.string().describe('检索查询语句') },
  async ({ query }) => {
    try {
      const results = await hybridRetrieve(query, 5)
      if (results.length === 0) {
        return { content: [{ type: 'text', text: '未检索到相关内容。请确认已上传文档。' }] }
      }
      const formatted = results.map((r, i) =>
        `【${i + 1}】来源：${r.docName || '未知'}\n${(r.text || '').substring(0, 400)}`
      ).join('\n\n---\n\n')
      return { content: [{ type: 'text', text: `检索到 ${results.length} 条相关内容：\n\n${formatted}` }] }
    } catch (e) {
      return { content: [{ type: 'text', text: `检索失败：${e.message}` }], isError: true }
    }
  }
)

// 工具 2：完整 RAG 问答
server.tool(
  'ask_question',
  '基于产品文档知识库回答用户问题（检索 + AI 生成）。返回完整的答案和参考来源。',
  { question: z.string().describe('用户问题') },
  async ({ question }) => {
    try {
      const retrieved = await hybridRetrieve(question, 5)
      if (retrieved.length === 0) {
        return { content: [{ type: 'text', text: '知识库中未找到相关内容，无法回答该问题。' }] }
      }

      let answer
      if (isLLMEnabled()) {
        answer = await generateAnswerLLM(question, retrieved, { timeoutMs: 25000 })
      } else {
        answer = generateAnswer(question, retrieved)
      }

      const sources = [...new Set(retrieved.map(r => r.docName).filter(Boolean))]
      const sourceText = sources.length > 0 ? `\n\n📚 参考来源：${sources.join('、')}` : ''

      return { content: [{ type: 'text', text: `${answer}${sourceText}` }] }
    } catch (e) {
      return { content: [{ type: 'text', text: `问答失败：${e.message}` }], isError: true }
    }
  }
)

// 工具 3：主题摘要
server.tool(
  'summarize_topic',
  '基于文档内容生成某个主题的摘要总结。适用于概括产品功能、特性等。',
  { topic: z.string().describe('要总结的主题，如"蓝牙功能""电池续航"') },
  async ({ topic }) => {
    try {
      const results = await hybridRetrieve(topic, 5)
      if (results.length === 0) {
        return { content: [{ type: 'text', text: `未找到与"${topic}"相关的文档内容。` }] }
      }

      if (!isLLMEnabled()) {
        // 无 LLM 时直接返回检索片段
        const text = results.map((r, i) => `${i + 1}. ${r.text.substring(0, 200)}`).join('\n')
        return { content: [{ type: 'text', text: `关于"${topic}"的相关文档片段：\n${text}` }] }
      }

      const context = results.map(r => r.text).join('\n\n')
      const summary = await callLLM(
        [
          { role: 'system', content: '你是产品文档专家。根据参考资料生成简洁的主题摘要（200字以内），使用中文。' },
          { role: 'user', content: `主题：${topic}\n\n参考资料：\n${context}` }
        ],
        { temperature: 0.2, timeoutMs: 15000, maxTokens: 512 }
      )
      return { content: [{ type: 'text', text: `📝 "${topic}"摘要：\n${summary}` }] }
    } catch (e) {
      return { content: [{ type: 'text', text: `摘要生成失败：${e.message}` }], isError: true }
    }
  }
)

// 工具 4：列出文档
server.tool(
  'list_documents',
  '列出用户已上传的文档列表，包含文件名、类型、状态等信息。',
  {},
  async () => {
    try {
      const scope = buildKnowledgeScope(MCP_USER_ID, { documentAlias: 'd', ownerAlias: 'owner' })
      const [rows] = await pool.query(
        `SELECT d.id, d.original_name, d.file_type, d.status, d.chunk_count, d.created_at,
                d.user_id = ? AS is_owner
         FROM documents d
         JOIN users owner ON d.user_id = owner.id
         WHERE ${scope.where}
         ORDER BY is_owner DESC, d.created_at DESC LIMIT 20`,
        [MCP_USER_ID, ...scope.params]
      )
      if (rows.length === 0) {
        return { content: [{ type: 'text', text: '暂无已上传的文档。' }] }
      }
      const list = rows.map(d =>
        `${d.status === 1 ? '✅' : '⏳'} [${d.id}] ${d.original_name} (${d.is_owner ? '我的文档' : '公共知识库'}, ${d.file_type}, ${d.chunk_count}块, ${new Date(d.created_at).toLocaleDateString('zh-CN')})`
      ).join('\n')
      return { content: [{ type: 'text', text: `共 ${rows.length} 个文档：\n${list}` }] }
    } catch (e) {
      return { content: [{ type: 'text', text: `查询失败：${e.message}` }], isError: true }
    }
  }
)

// 工具 5：视频检索
server.tool(
  'search_videos',
  '根据关键词检索已发布的操作视频。返回视频标题、时长、分类等信息，优先推荐20秒~5分钟的短视频。',
  { query: z.string().describe('视频检索关键词，如"连接WiFi""开机""蓝牙配对"'), productModel: z.string().optional().describe('产品型号过滤，如"翻译机4.0"') },
  async ({ query, productModel }) => {
    try {
      let sql = `SELECT id, title, description, category, duration_seconds, video_url, product_model, view_count, resolve_count
        FROM videos WHERE publish_status = 'published' AND (title LIKE ? OR description LIKE ?)`
      const params = [`%${query}%`, `%${query}%`]
      if (productModel) { sql += ' AND (product_model = ? OR product_model = "")'; params.push(productModel) }
      sql += ' ORDER BY (duration_seconds BETWEEN 20 AND 300) DESC, resolve_count DESC LIMIT 5'
      const [rows] = await pool.query(sql, params)
      if (rows.length === 0) {
        return { content: [{ type: 'text', text: `未找到与"${query}"相关的操作视频。` }] }
      }
      const list = rows.map((v, i) =>
        `${i + 1}. 【${v.title}】 ${v.duration_seconds}秒 | ${v.category || '未分类'} | ${v.product_model || '通用'}${v.resolve_count > 0 ? ` | ✅${v.resolve_count}人解决` : ''}`
      ).join('\n')
      return { content: [{ type: 'text', text: `找到 ${rows.length} 个相关视频：\n${list}` }] }
    } catch (e) {
      return { content: [{ type: 'text', text: `视频检索失败：${e.message}` }], isError: true }
    }
  }
)

// 工具 6：SOP 操作指南查询
server.tool(
  'get_sop',
  '根据关键词查询结构化SOP操作指南，返回分步骤操作说明、前置条件、常见错误等。',
  { query: z.string().describe('SOP查询关键词，如"连接WiFi""恢复出厂设置"') },
  async ({ query }) => {
    try {
      const [rows] = await pool.query(
        `SELECT id, title, prerequisites, warnings, steps, completion_check, common_errors, difficulty, estimated_duration
         FROM sops WHERE review_status = 'approved' AND (title LIKE ? OR CAST(steps AS CHAR) LIKE ?) ORDER BY created_at DESC LIMIT 3`,
        [`%${query}%`, `%${query}%`]
      )
      if (rows.length === 0) {
        return { content: [{ type: 'text', text: `未找到与"${query}"相关的SOP操作指南。` }] }
      }
      const formatted = rows.map(sop => {
        let text = `【${sop.title}】 难度:${sop.difficulty} 约${sop.estimated_duration}秒\n`
        const prereqs = safeJsonParse(sop.prerequisites)
        if (prereqs.length) text += `前置条件：${prereqs.join('、')}\n`
        const warnings = safeJsonParse(sop.warnings)
        if (warnings.length) text += `⚠️ 注意：${warnings.join('、')}\n`
        const steps = safeJsonParse(sop.steps)
        if (steps.length) text += steps.map(s => `  ${s.step}. ${s.action} → ${s.expected_result}`).join('\n') + '\n'
        if (sop.completion_check) text += `✅ 完成标志：${sop.completion_check}\n`
        const errors = safeJsonParse(sop.common_errors)
        if (errors.length) text += `常见错误：${errors.map(e => `${e.error}→${e.solution}`).join('；')}`
        return text
      }).join('\n---\n')
      return { content: [{ type: 'text', text: formatted }] }
    } catch (e) {
      return { content: [{ type: 'text', text: `SOP查询失败：${e.message}` }], isError: true }
    }
  }
)

function safeJsonParse(val) {
  if (!val) return []
  if (typeof val === 'object') return val
  try { return JSON.parse(val) } catch { return [] }
}

// ─── 启动 ─────────────────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport()
  await server.connect(transport)
  console.error('[MCP] 讯飞翻译机智能使用助手 MCP Server 已启动（stdio 模式）')
  console.error('[MCP] 可用工具：search_knowledge_base, ask_question, summarize_topic, list_documents, search_videos, get_sop')
}

main().catch(err => {
  console.error('[MCP] 启动失败:', err.message)
  process.exit(1)
})
