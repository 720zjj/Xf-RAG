/**
 * 对检索语料执行严格元数据过滤。零命中时返回空集合，绝不回退到其他型号或已废弃内容。
 */
export function filterChunkBundle(bundle, { productLine = '', productModel = '', allowedDocumentIds } = {}) {
  const contents = bundle.contents || []
  const sources = bundle.sources || []
  const embeddings = bundle.embeddings || []
  const metadata = bundle.metadata || []
  const keep = []
  const hasDocumentScope = Array.isArray(allowedDocumentIds)
  const allowedDocuments = new Set((allowedDocumentIds || []).map(Number).filter(Number.isSafeInteger))

  for (let i = 0; i < contents.length; i++) {
    const meta = metadata[i] || {}
    if (meta.effectiveStatus === 'deprecated') continue
    if (hasDocumentScope && !allowedDocuments.has(Number(sources[i]?.docId))) continue
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
            productModel: productModel || original.productModel || ''
          }
        : original
    }),
    filteredCount: contents.length - keep.length,
    filterRequested: Boolean(productLine || productModel || hasDocumentScope)
  }
}
