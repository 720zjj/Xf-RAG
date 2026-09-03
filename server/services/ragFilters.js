import { isCommonDeviceSupportEvidence, isCommonDeviceSupportQuestion } from './questionIntent.js'

function modelVersion(value) {
  return String(value || '').match(/(?:^|[^0-9])(4\.0|2\.0)(?![0-9])/)?.[1] || ''
}

/**
 * Product-specific material stays strictly scoped. For a small allowlist of
 * non-invasive device troubleshooting questions, a direct answer from another
 * supported model may be retained as explicitly limited, common guidance.
 */
export function filterChunkBundle(bundle, { productLine = '', productModel = '', allowedDocumentIds, question = '' } = {}) {
  const contents = bundle.contents || []
  const sources = bundle.sources || []
  const embeddings = bundle.embeddings || []
  const metadata = bundle.metadata || []
  const keep = []
  const crossModelCommon = new Set()
  const hasDocumentScope = Array.isArray(allowedDocumentIds)
  const allowedDocuments = new Set((allowedDocumentIds || []).map(Number).filter(Number.isSafeInteger))
  const commonSupportQuestion = hasDocumentScope && isCommonDeviceSupportQuestion(question)
  const scopedDirectEvidenceAvailable = commonSupportQuestion && contents.some((content, index) => {
    const meta = metadata[index] || {}
    return meta.effectiveStatus !== 'deprecated'
      && allowedDocuments.has(Number(sources[index]?.docId))
      && isCommonDeviceSupportEvidence(question, content)
  })

  for (let i = 0; i < contents.length; i++) {
    const meta = metadata[i] || {}
    if (meta.effectiveStatus === 'deprecated') continue
    if (hasDocumentScope && !allowedDocuments.has(Number(sources[i]?.docId))) {
      const sourceModel = String(meta.productModel || '').trim()
      const sourceVersion = modelVersion(sourceModel)
      const requestedVersion = modelVersion(productModel)
      const sameProductLine = !productLine || !meta.productLine || meta.productLine === productLine
      const canUseCommonFallback = commonSupportQuestion
        && !scopedDirectEvidenceAvailable
        && sameProductLine
        && sourceVersion
        && requestedVersion
        && sourceVersion !== requestedVersion
        && isCommonDeviceSupportEvidence(question, contents[i])
      if (!canUseCommonFallback) continue
      crossModelCommon.add(i)
    }
    if (hasDocumentScope) {
      keep.push(i)
      continue
    }
    if (productLine && meta.productLine && meta.productLine !== productLine) continue
    if (productModel && meta.productModel && meta.productModel !== productModel) continue
    keep.push(i)
  }

  return {
    contents: keep.map(i => contents[i]),
    sources: keep.map(i => sources[i]),
    embeddings: keep.map(i => embeddings[i] ?? null),
    metadata: keep.map(i => {
      const original = metadata[i] || {}
      return hasDocumentScope
        ? {
            ...original,
            sourceProductLine: original.productLine || '',
            sourceProductModel: original.productModel || '',
            productLine: productLine || original.productLine || '',
            productModel: productModel || original.productModel || '',
            limitedScope: Boolean(original.limitedScope || crossModelCommon.has(i)),
            crossModelCommon: crossModelCommon.has(i)
          }
        : original
    }),
    filteredCount: contents.length - keep.length,
    filterRequested: Boolean(productLine || productModel || hasDocumentScope)
  }
}
