import test from 'node:test'
import assert from 'node:assert/strict'
import { filterChunkBundle } from '../server/services/ragFilters.js'

const bundle = {
  contents: ['通用内容', 'A 型号内容', '已废弃内容'],
  sources: [{ docId: 1 }, { docId: 2 }, { docId: 3 }],
  embeddings: [[1], [2], [3]],
  metadata: [
    { productLine: '翻译机', productModel: '', effectiveStatus: 'active' },
    { productLine: '翻译机', productModel: 'A', effectiveStatus: 'active' },
    { productLine: '翻译机', productModel: 'B', effectiveStatus: 'deprecated' }
  ]
}

test('型号过滤保留通用内容和精确型号内容', () => {
  const result = filterChunkBundle(bundle, { productLine: '翻译机', productModel: 'A' })
  assert.deepEqual(result.contents, ['通用内容', 'A 型号内容'])
  assert.deepEqual(result.embeddings, [[1], [2]])
})

test('型号零命中时返回空集合，不回退到其他型号', () => {
  const strictBundle = {
    ...bundle,
    contents: bundle.contents.slice(1),
    sources: bundle.sources.slice(1),
    embeddings: bundle.embeddings.slice(1),
    metadata: bundle.metadata.slice(1)
  }
  const result = filterChunkBundle(strictBundle, { productModel: 'C' })
  assert.equal(result.contents.length, 0)
  assert.equal(result.filterRequested, true)
})

test('已废弃内容始终被排除', () => {
  const result = filterChunkBundle(bundle)
  assert.deepEqual(result.contents, ['通用内容', 'A 型号内容'])
})

test('可信资料 ID 范围严格排除空型号的其他资料，并补齐选定型号元数据', () => {
  const result = filterChunkBundle(bundle, {
    productLine: '翻译机',
    productModel: '翻译机4.0',
    allowedDocumentIds: [2]
  })
  assert.deepEqual(result.contents, ['A 型号内容'])
  assert.equal(result.metadata[0].productModel, '翻译机4.0')
  assert.equal(result.filterRequested, true)
})

test('显式空资料范围不会回退到全部文档', () => {
  const result = filterChunkBundle(bundle, { allowedDocumentIds: [] })
  assert.equal(result.contents.length, 0)
})

test('当前型号缺少答案时仅引入另一型号的直接通用排查并标记范围', () => {
  const troubleshootingBundle = {
    contents: [
      '双屏 2.0 拍照翻译功能说明。',
      '翻译机无法开机怎么办？先连接充电线和适配器充电，再长按电源键；仍无反应请联系官方售后。',
      '翻译机 4.0 怎么进入面对面翻译？从屏幕左侧边缘向右轻滑。'
    ],
    sources: [{ docId: 20 }, { docId: 40 }, { docId: 40 }],
    embeddings: [[1], [2], [3]],
    metadata: [
      { productLine: '翻译机', productModel: '翻译机2.0', effectiveStatus: 'active' },
      { productLine: '翻译机', productModel: '翻译机4.0', effectiveStatus: 'active' },
      { productLine: '翻译机', productModel: '翻译机4.0', effectiveStatus: 'active' }
    ]
  }

  const result = filterChunkBundle(troubleshootingBundle, {
    productLine: '翻译机',
    productModel: '翻译机2.0',
    allowedDocumentIds: [20],
    question: '设备无法开机怎么办？'
  })

  assert.equal(result.contents.length, 2)
  assert.match(result.contents[1], /无法开机/)
  assert.equal(result.metadata[1].productModel, '翻译机2.0')
  assert.equal(result.metadata[1].sourceProductModel, '翻译机4.0')
  assert.equal(result.metadata[1].limitedScope, true)
  assert.equal(result.metadata[1].crossModelCommon, true)
})

test('具体菜单与专属功能问题继续严格排除其他型号资料', () => {
  const troubleshootingBundle = {
    contents: [
      '双屏 2.0 常见问题。',
      '翻译机 4.0 怎么进入面对面翻译？从屏幕左侧边缘向右轻滑。'
    ],
    sources: [{ docId: 20 }, { docId: 40 }],
    embeddings: [[1], [2]],
    metadata: [
      { productLine: '翻译机', productModel: '翻译机2.0', effectiveStatus: 'active' },
      { productLine: '翻译机', productModel: '翻译机4.0', effectiveStatus: 'active' }
    ]
  }

  const result = filterChunkBundle(troubleshootingBundle, {
    productLine: '翻译机',
    productModel: '翻译机2.0',
    allowedDocumentIds: [20],
    question: '怎么进入面对面翻译？'
  })

  assert.deepEqual(result.contents, ['双屏 2.0 常见问题。'])
})

test('当前型号已有直接排查时不再混入另一型号的相同答案', () => {
  const troubleshootingBundle = {
    contents: [
      '设备无法开机怎么办？先充电 10 分钟，再长按电源键；仍无反应请联系官方售后。',
      '翻译机无法开机怎么办？先连接充电线和适配器充电，再长按电源键；仍无反应请联系官方售后。'
    ],
    sources: [{ docId: 20 }, { docId: 40 }],
    embeddings: [[1], [2]],
    metadata: [
      { productLine: '翻译机', productModel: '翻译机2.0', effectiveStatus: 'active' },
      { productLine: '翻译机', productModel: '翻译机4.0', effectiveStatus: 'active' }
    ]
  }

  const result = filterChunkBundle(troubleshootingBundle, {
    productLine: '翻译机',
    productModel: '翻译机2.0',
    allowedDocumentIds: [20],
    question: '设备无法开机怎么办？'
  })

  assert.equal(result.contents.length, 1)
  assert.equal(result.metadata[0].crossModelCommon, false)
})
