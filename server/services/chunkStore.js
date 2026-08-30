// 文档分块 + 向量存储/读取
// - chunkDocument: 按章节切分，章节内再切分；保留章节路径、表格和图片说明的完整语义
// - storeDocumentChunks: 对一篇文档切块、逐块编码为句向量，写入 document_chunks（先清旧块）
// - loadUserChunks: 读出某用户全部已向量化的 chunk（内容 + 向量 + 来源），供 RAG 检索使用
import pool from '../db.js'
import { embedBatch } from './embedding.js'
import { buildKnowledgeScope } from './knowledgeAccess.js'

const chunkCache = new Map()
const CHUNK_CACHE_TTL = 60 * 1000

export function invalidateUserChunks(userId) {
  chunkCache.delete(String(userId))
}

export function invalidateAllChunks() {
  chunkCache.clear()
}

const MARKDOWN_HEADING = /^(#{1,6})\s+(.+?)\s*#*\s*$/
const CHINESE_CHAPTER = /^(第[一二三四五六七八九十百千万\d]+[章节篇]|[一二三四五六七八九十百千万]+、)\s*(.+?)\s*$/
const CHINESE_SUBHEADING = /^（([一二三四五六七八九十百千万\d]+)）\s*(.+?)\s*$/
const SCENE_HEADING = /^(场景|功能|步骤)\s*\d+\s*[:：]\s*(.+?)\s*$/
const IMAGE_ONLY = /^!\[[^\]]*\]\([^)]*\)\s*$/
const TABLE_LINE = /^\s*\|.*\|\s*$/

function readHeading(line) {
  const markdown = line.match(MARKDOWN_HEADING)
  if (markdown) return { level: markdown[1].length, title: markdown[2].trim() }

  const subheading = line.match(CHINESE_SUBHEADING)
  if (subheading) return { level: 3, title: `（${subheading[1]}）${subheading[2]}` }

  const chapter = line.match(CHINESE_CHAPTER)
  if (chapter) return { level: 2, title: `${chapter[1]}${chapter[2]}` }

  const scene = line.match(SCENE_HEADING)
  if (scene) return { level: 2, title: line.trim() }
  return null
}

function splitIntoSections(text) {
  const sections = []
  let headingPath = []
  let lines = []

  const flush = () => {
    const body = lines.join('\n').trim()
    if (body) sections.push({ path: headingPath.filter(Boolean), body })
    lines = []
  }

  for (const rawLine of text.replace(/\r\n/g, '\n').split('\n')) {
    const heading = readHeading(rawLine.trim())
    if (!heading) {
      lines.push(rawLine)
      continue
    }

    flush()
    headingPath = headingPath.slice(0, heading.level - 1)
    headingPath[heading.level - 1] = heading.title
    headingPath = headingPath.slice(0, heading.level)
  }
  flush()
  return sections
}

function splitBlocks(body) {
  const blocks = []
  let textLines = []
  let tableLines = []
  const flushText = () => {
    const block = textLines.join('\n').trim()
    if (block) blocks.push(block)
    textLines = []
  }
  const flushTable = () => {
    const block = tableLines.join('\n').trim()
    if (block) blocks.push(block)
    tableLines = []
  }

  for (const rawLine of body.split('\n')) {
    if (!rawLine.trim()) {
      flushText()
      flushTable()
    } else if (TABLE_LINE.test(rawLine)) {
      flushText()
      tableLines.push(rawLine.trim())
    } else {
      flushTable()
      textLines.push(rawLine.trimEnd())
    }
  }
  flushText()
  flushTable()

  // Markdown 图片经常单独占段；把它与相邻说明合并，避免图和图注被检索到不同块。
  const merged = []
  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index]
    if (!IMAGE_ONLY.test(block)) {
      merged.push(block)
      continue
    }

    const next = blocks[index + 1]
    if (merged.length > 0) {
      merged[merged.length - 1] = `${merged[merged.length - 1]}\n\n${block}${next ? `\n\n${next}` : ''}`
      if (next) index += 1
    } else if (next) {
      merged.push(`${block}\n\n${next}`)
      index += 1
    } else {
      merged.push(block)
    }
  }
  return merged
}

function hasProtectedContent(block) {
  return /!\[[^\]]*\]\([^)]*\)/.test(block) || block.split('\n').some(line => TABLE_LINE.test(line))
}

function splitLongText(block, limit) {
  if (block.length <= limit || hasProtectedContent(block)) return [block]

  const pieces = []
  const sentences = block.match(/[^。！？!?；;]+[。！？!?；;]?/g) || [block]
  let current = ''
  const push = () => {
    if (current.trim()) pieces.push(current.trim())
    current = ''
  }

  for (let sentence of sentences) {
    sentence = sentence.trim()
    if (!sentence) continue
    if (sentence.length > limit) {
      push()
      while (sentence.length > limit) {
        const candidates = [sentence.lastIndexOf('\n', limit), sentence.lastIndexOf('，', limit), sentence.lastIndexOf('、', limit), sentence.lastIndexOf(' ', limit)]
        const breakpoint = Math.max(...candidates)
        const end = breakpoint >= Math.floor(limit * 0.6) ? breakpoint + 1 : limit
        pieces.push(sentence.slice(0, end).trim())
        sentence = sentence.slice(end).trim()
      }
    }
    if (current && current.length + sentence.length > limit) push()
    current += sentence
  }
  push()
  return pieces
}

function getOverlap(text, limit = 40) {
  if (hasProtectedContent(text)) return ''
  const normalized = text.replace(/\s+/g, ' ').trim()
  return normalized.length > limit ? normalized.slice(-limit) : ''
}

function buildSectionChunks(section, chunkSize) {
  const prefix = section.path.length > 0 ? `【章节：${section.path.join(' > ')}】` : ''
  const bodyLimit = Math.max(120, chunkSize - prefix.length - 1)
  const blocks = splitBlocks(section.body).flatMap(block => splitLongText(block, bodyLimit))
  const chunks = []
  let current = ''
  let overlap = ''
  const flush = () => {
    if (!current.trim()) return
    chunks.push(prefix ? `${prefix}\n${current.trim()}` : current.trim())
    overlap = getOverlap(current)
    current = ''
  }

  for (const block of blocks) {
    const candidate = current ? `${current}\n\n${block}` : block
    if (!current || candidate.length <= bodyLimit) {
      current = candidate
      continue
    }

    flush()
    const withOverlap = overlap ? `${overlap}\n${block}` : block
    current = withOverlap.length <= bodyLimit || block.length > bodyLimit ? withOverlap : block
  }
  flush()
  return chunks
}

export function chunkDocument(text, chunkSize = 420) {
  if (!text || !text.trim()) return []
  return splitIntoSections(text).flatMap(section => buildSectionChunks(section, chunkSize))
}

/**
 * 解析 YAML front matter（--- 包裹的元数据块）
 * 返回 { metadata: {...}, body: string }
 */
export function parseFrontMatter(text) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/)
  if (!match) return { metadata: {}, body: text }
  const yamlStr = match[1]
  const body = text.slice(match[0].length)
  const metadata = {}
  for (const line of yamlStr.split('\n')) {
    const idx = line.indexOf(':')
    if (idx > 0) {
      const key = line.slice(0, idx).trim()
      const val = line.slice(idx + 1).trim()
      if (key && val) metadata[key] = val
    }
  }
  return { metadata, body }
}

/**
 * 对一篇文档切块 -> 逐块编码 -> 写入 document_chunks（先删除该文档旧块）。
 * 返回写入的 chunk 数量。编码失败时抛出异常，由调用方决定如何处理。
 * @param {object} meta - 文档级元数据（来自 YAML front matter 或默认值）
 */
export async function storeDocumentChunks(documentId, userId, content, meta = {}) {
  // 解析 front matter（如果 content 中仍包含）
  const { metadata: fm, body } = parseFrontMatter(content)
  const merged = { ...fm, ...meta }  // 显式传入的 meta 优先
  const textToChunk = body || content

  const chunks = chunkDocument(textToChunk)
  if (chunks.length === 0) {
    await pool.query('DELETE FROM document_chunks WHERE document_id = ?', [documentId])
    invalidateAllChunks()
    return 0
  }

  // 先在事务外完成最耗时、最容易失败的编码，确保失败时旧索引仍然可用。
  const vectors = await embedBatch(chunks, false)

  // 批量插入（含元数据字段）
  const values = chunks.map((c, i) => [
    documentId, userId, i, c, JSON.stringify(vectors[i]),
    merged.brand || '科大讯飞',
    merged.product_line || '翻译机',
    merged.product_model || '',
    merged.firmware_version || '',
    merged.document_type || '',
    merged.document_version || '',
    merged.chapter || '',
    merged.content_type || 'general',
    merged.risk_level || 'low',
    merged.effective_status || 'active'
  ])
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    await conn.query('DELETE FROM document_chunks WHERE document_id = ?', [documentId])
    await conn.query(
      `INSERT INTO document_chunks
       (document_id, user_id, chunk_index, content, embedding,
        brand, product_line, product_model, firmware_version,
        document_type, document_version, chapter, content_type, risk_level, effective_status)
       VALUES ?`,
      [values]
    )
    await conn.commit()
    invalidateAllChunks()
  } catch (err) {
    await conn.rollback()
    throw err
  } finally {
    conn.release()
  }
  return chunks.length
}

/**
 * 读取某用户全部已向量化的 chunk（含元数据，供检索前置过滤）。
 * 返回 { contents, embeddings, sources, metadata }
 * metadata[i] = { brand, productLine, productModel, firmwareVersion, documentType, contentType, riskLevel, effectiveStatus, chapter }
 */
export function appendFallbackDocuments(bundle, documents) {
  const loadedDocumentIds = new Set(bundle.sources.map(source => Number(source.docId)))
  for (const document of documents) {
    if (loadedDocumentIds.has(Number(document.id))) continue
    for (const content of chunkDocument(document.content || '')) {
      bundle.contents.push(content)
      bundle.embeddings.push(null)
      bundle.sources.push({ docId: document.id, docName: document.original_name })
      bundle.metadata.push({
        brand: '',
        productLine: '',
        productModel: '',
        firmwareVersion: '',
        documentType: '',
        documentVersion: '',
        chapter: '',
        contentType: 'general',
        riskLevel: 'low',
        effectiveStatus: 'active'
      })
    }
  }
  return bundle
}

export async function loadUserChunks(userId, { forceRefresh = false } = {}) {
  const cacheKey = String(userId)
  const cached = chunkCache.get(cacheKey)
  if (!forceRefresh && cached && Date.now() - cached.loadedAt < CHUNK_CACHE_TTL) return cached.value

  const scope = buildKnowledgeScope(userId, { documentAlias: 'd', ownerAlias: 'owner' })
  const [rows] = await pool.query(
    `SELECT dc.document_id, dc.content, dc.embedding, d.original_name,
            dc.brand, dc.product_line, dc.product_model, dc.firmware_version,
            dc.document_type, dc.document_version, dc.chapter,
            dc.content_type, dc.risk_level, dc.effective_status
     FROM document_chunks dc
     JOIN documents d ON dc.document_id = d.id
     JOIN users owner ON d.user_id = owner.id
     WHERE ${scope.where} AND d.status = 1
     ORDER BY dc.document_id, dc.chunk_index`,
    scope.params
  )
  const contents = []
  const embeddings = []
  const sources = []
  const metadata = []
  for (const r of rows) {
    contents.push(r.content)
    let vec = null
    try { vec = JSON.parse(r.embedding) } catch { vec = null }
    embeddings.push(vec)
    sources.push({ docId: r.document_id, docName: r.original_name })
    metadata.push({
      brand: r.brand || '',
      productLine: r.product_line || '',
      productModel: r.product_model || '',
      firmwareVersion: r.firmware_version || '',
      documentType: r.document_type || '',
      documentVersion: r.document_version || '',
      chapter: r.chapter || '',
      contentType: r.content_type || 'general',
      riskLevel: r.risk_level || 'low',
      effectiveStatus: r.effective_status || 'active'
    })
  }
  const value = { contents, embeddings, sources, metadata }
  // 向量化失败不应让文档从混合检索中消失：仅为完全没有持久化块的
  // 已就绪文档实时切块，embedding 置空后仍可参与 BM25。
  const [fallbackDocuments] = await pool.query(
    `SELECT d.id, d.original_name, d.content
     FROM documents d
     JOIN users owner ON d.user_id = owner.id
     WHERE ${scope.where} AND d.status = 1
       AND NOT EXISTS (SELECT 1 FROM document_chunks dc WHERE dc.document_id = d.id)`,
    scope.params
  )
  appendFallbackDocuments(value, fallbackDocuments)
  chunkCache.set(cacheKey, { loadedAt: Date.now(), value })
  return value
}
