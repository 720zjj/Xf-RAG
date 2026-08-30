import test from 'node:test'
import assert from 'node:assert/strict'
import { appendFallbackDocuments } from '../server/services/chunkStore.js'

test('为没有向量块的就绪文档补充关键词检索块', () => {
  const bundle = {
    contents: ['已有向量块'],
    embeddings: [[0.1, 0.2]],
    sources: [{ docId: 1, docName: '已有文档' }],
    metadata: [{ effectiveStatus: 'active' }]
  }

  appendFallbackDocuments(bundle, [
    { id: 1, original_name: '已有文档', content: '不应重复加入' },
    { id: 2, original_name: '缺少向量的公共文档', content: '第一段\n第二段' }
  ])

  assert.equal(bundle.sources.some(source => source.docId === 2), true)
  assert.equal(bundle.sources.filter(source => source.docId === 1).length, 1)
  const fallbackIndex = bundle.sources.findIndex(source => source.docId === 2)
  assert.equal(bundle.embeddings[fallbackIndex], null)
  assert.equal(bundle.metadata[fallbackIndex].effectiveStatus, 'active')
})
