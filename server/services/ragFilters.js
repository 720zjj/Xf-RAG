/**
 * 对检索语料执行严格元数据过滤。零命中时返回空集合，绝不回退到其他型号或已废弃内容。
 */
export function filterChunkBundle(bundle, { productLine = '', productModel = '' } = {}) {
  const contents = bundle.contents || []
  const sources = bundle.sources || []
  const embeddings = bundle.embeddings || []
  const metadata = bundle.metadata || []
  const keep = []

  for (let i = 0; i < contents.length; i++) {
    const meta = metadata[i] || {}
    if (meta.effectiveStatus === 'deprecated') continue
    if (productLine && meta.productLine && meta.productLine !== productLine) continue
    if (productModel && meta.productModel && meta.productModel !== productModel) continue
    keep.push(i)
  }

  return {
    contents: keep.map(i => contents[i]),
    sources: keep.map(i => sources[i]),
    embeddings: keep.map(i => embeddings[i] ?? null),
    metadata: keep.map(i => metadata[i] || {}),
    filteredCount: contents.length - keep.length,
    filterRequested: Boolean(productLine || productModel)
  }
}
