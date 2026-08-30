const MAX_EXCERPT_LENGTH = 1200
const SAFETY_PATTERN = /(进水|拆机|电池|充电|恢复出厂|无响应|安全|危险)/

function text(value) {
  return String(value || '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ' ').replace(/\s+/g, ' ').trim()
}

function numberOrNull(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function metadataFor(item) {
  return item?.metadata || item?.meta || {}
}

function isActive(item) {
  const status = String(metadataFor(item).effectiveStatus || item?.effectiveStatus || 'active').toLowerCase()
  return status === 'active'
}

function comparableText(value) {
  return text(value).toLowerCase().replace(/[\p{P}\p{S}\s]/gu, '')
}

function inferCoverage(item) {
  if (typeof item?.coversQuestion === 'boolean') return item.coversQuestion
  const factors = item?.factors || {}
  return factors.phraseMatch === true || Number(factors.coverage) >= 0.34
}

function toEvidence(item, index, selectionReason) {
  const metadata = metadataFor(item)
  const sourceType = item?.sourceType === 'sop' || item?.sopId ? 'sop' : 'document_chunk'
  const excerpt = text(item?.excerpt || item?.text).slice(0, MAX_EXCERPT_LENGTH)
  return {
    evidenceId: `E${index + 1}`,
    sourceType,
    documentId: Number.isInteger(Number(item?.docId ?? item?.documentId)) ? Number(item.docId ?? item.documentId) : null,
    chunkId: Number.isInteger(Number(item?.chunkId ?? item?.id)) && sourceType === 'document_chunk' ? Number(item.chunkId ?? item.id) : null,
    sopId: Number.isInteger(Number(item?.sopId)) ? Number(item.sopId) : null,
    title: text(item?.docName || item?.title || '未命名资料'),
    excerpt,
    productLine: text(metadata.productLine || item?.productLine),
    productModel: text(metadata.productModel || item?.productModel),
    retrievalScore: numberOrNull(item?.bm25Score ?? item?.retrievalScore),
    rerankScore: numberOrNull(item?.score ?? item?.rerankScore),
    factors: item?.factors || null,
    coversQuestion: inferCoverage(item),
    limitedScope: Boolean(item?.limitedScope || metadata.limitedScope),
    selectionReason
  }
}

function candidateScore(item) {
  return Number(item?.score ?? item?.rerankScore ?? 0)
}

/** Normalizes only active retrieved records into a bounded, request-local evidence set. */
export function selectEvidence(retrieved, { limit = 5, question = '' } = {}) {
  const active = (Array.isArray(retrieved) ? retrieved : [])
    .filter(item => isActive(item) && text(item?.excerpt || item?.text))
    .sort((left, right) => candidateScore(right) - candidateScore(left))

  const safetyQuestion = SAFETY_PATTERN.test(String(question || ''))
  if (safetyQuestion) {
    active.sort((left, right) => {
      const leftSafety = String(metadataFor(left).riskLevel || left?.riskLevel || '').toLowerCase() === 'high' ? 1 : 0
      const rightSafety = String(metadataFor(right).riskLevel || right?.riskLevel || '').toLowerCase() === 'high' ? 1 : 0
      return rightSafety - leftSafety || candidateScore(right) - candidateScore(left)
    })
  }

  const seen = new Set()
  const selected = []
  for (const item of active) {
    const documentKey = item?.docId ?? item?.documentId ?? item?.sopId ?? item?.title ?? ''
    const key = `${documentKey}:${comparableText(item?.excerpt || item?.text)}`
    if (seen.has(key)) continue
    seen.add(key)
    const highRisk = String(metadataFor(item).riskLevel || item?.riskLevel || '').toLowerCase() === 'high'
    selected.push(toEvidence(item, selected.length, safetyQuestion && highRisk ? 'safety' : 'best-match'))
    if (selected.length >= limit) break
  }
  return selected
}

/** Removes internal ranking factors before data is returned to the browser. */
export function toPublicSources(evidence) {
  return (Array.isArray(evidence) ? evidence : []).map(item => ({
    evidenceId: item.evidenceId,
    sourceType: item.sourceType,
    documentId: item.documentId,
    chunkId: item.chunkId,
    sopId: item.sopId,
    text: item.excerpt,
    docName: item.title,
    score: item.rerankScore ?? 0,
    bm25Score: item.retrievalScore ?? 0,
    productLine: item.productLine,
    productModel: item.productModel,
    supportedClaims: []
  }))
}
