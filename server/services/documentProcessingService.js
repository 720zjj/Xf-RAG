export class DocumentProcessingError extends Error {
  constructor(code, message, { retryable = false } = {}) {
    super(message)
    this.name = 'DocumentProcessingError'
    this.code = code
    this.retryable = retryable
  }
}

function cancelledError() {
  return new DocumentProcessingError('DOCUMENT_JOB_CANCELLED', '任务已取消', { retryable: false })
}

function ensureNonEmptyContent(content) {
  if (!String(content || '').trim()) {
    throw new DocumentProcessingError('DOCUMENT_EMPTY', '未提取到可用文本', { retryable: false })
  }
  return String(content)
}

export function createDocumentProcessor({
  parseWithMineru,
  parseDocument,
  readTextFile,
  parseFrontMatter,
  chunkDocument,
  storeDocumentChunks,
  reportProgress,
  isCancelRequested
}) {
  async function assertNotCancelled(jobId) {
    if (await isCancelRequested(jobId)) throw cancelledError()
  }

  async function parseInput({ filePath, fileType, documentId }) {
    if (fileType === 'md' || fileType === 'txt') {
      const rawContent = await readTextFile(filePath, 'utf8')
      const { metadata: frontMatter, body } = parseFrontMatter(rawContent)
      return { content: body || rawContent, metadata: null, frontMatter }
    }
    if (process.env.MINERU_API_KEY) return parseWithMineru(filePath, fileType, documentId)
    if (fileType === 'pdf' || fileType === 'docx') {
      const content = await parseDocument(filePath, fileType)
      return { content, metadata: null, frontMatter: {} }
    }
    throw new DocumentProcessingError('DOCUMENT_UNSUPPORTED', `不支持 ${fileType} 文件解析`, { retryable: false })
  }

  return {
    async process({ jobId, documentId, userId, filePath, fileType }) {
      await assertNotCancelled(jobId)
      await reportProgress({ jobId, stage: 'parsing', progress: 20 })
      const parsed = await parseInput({ filePath, fileType, documentId })
      const content = ensureNonEmptyContent(parsed.content)

      await assertNotCancelled(jobId)
      await reportProgress({ jobId, stage: 'chunking', progress: 55 })
      const chunks = chunkDocument(content)
      if (chunks.length === 0) {
        throw new DocumentProcessingError('DOCUMENT_EMPTY', '未提取到可用文本', { retryable: false })
      }

      await assertNotCancelled(jobId)
      await reportProgress({ jobId, stage: 'embedding', progress: 75 })
      const chunkCount = await storeDocumentChunks(documentId, userId, content, parsed.frontMatter || {})

      await assertNotCancelled(jobId)
      await reportProgress({ jobId, stage: 'finalizing', progress: 100 })
      return { content, chunkCount, metadata: parsed.metadata, frontMatter: parsed.frontMatter || {} }
    }
  }
}
