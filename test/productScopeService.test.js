import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import {
  FIRST_RELEASE_PRODUCTS,
  createProductScopeService,
  isPathInside,
  parseProductFrontMatter,
  productKeyFor,
  supportedProductsForMetadata
} from '../server/services/productScopeService.js'

const uploadDir = path.resolve('uploads')
const markdown = `---
brand: 科大讯飞
product_line: 翻译机
product_model: 讯飞翻译机2.0/3.0/4.0
effective_status: active
---
# 使用说明`

test('首发产品固定为普通版4.0和双屏版2.0', () => {
  assert.deepEqual(FIRST_RELEASE_PRODUCTS.map(item => item.displayName), [
    '讯飞翻译机普通版 4.0',
    '讯飞翻译机双屏版 2.0'
  ])
  assert.deepEqual(
    supportedProductsForMetadata({ productLine: '翻译机', productModel: '讯飞翻译机2.0/3.0/4.0' }).map(item => item.productModel),
    ['翻译机4.0', '翻译机2.0']
  )
})

test('产品 key 对规范产品范围稳定且不直接暴露型号', () => {
  const first = productKeyFor('翻译机', '翻译机4.0')
  assert.equal(first, productKeyFor('翻译机', '翻译机4.0'))
  assert.match(first, /^product_[A-Za-z0-9_-]{24}$/)
  assert.doesNotMatch(first, /4\.0|翻译机/)
})

test('只解析受控上传目录内 Markdown 的 frontmatter', () => {
  assert.equal(parseProductFrontMatter(markdown).product_model, '讯飞翻译机2.0/3.0/4.0')
  assert.equal(isPathInside(uploadDir, path.join(uploadDir, 'manual.md')), true)
  assert.equal(isPathInside(uploadDir, path.resolve('outside', 'manual.md')), false)
})

test('目录只收录解析完成、有效且带可信型号元数据的管理员资料', async () => {
  const rows = [
    { id: 4, original_name: '快速入门指南.md', file_type: 'md', file_path: path.join(uploadDir, 'guide.md'), product_lines: '翻译机', product_models: '' },
    { id: 5, original_name: '用户手册.md', file_type: 'md', file_path: path.join(uploadDir, 'manual.md'), product_lines: '翻译机', product_models: '' },
    { id: 6, original_name: '旧通用资料.docx', file_type: 'docx', file_path: path.join(uploadDir, 'generic.docx'), product_lines: '翻译机', product_models: '' }
  ]
  const calls = []
  const service = createProductScopeService({
    query: async (sql, params) => { calls.push({ sql, params }); return [rows] },
    readFile: async filePath => filePath.endsWith('guide.md') ? markdown : markdown.replace('active', 'deprecated'),
    uploadDir,
    adminUsernames: ['admin']
  })
  const products = await service.listProducts()
  assert.equal(products.length, 2)
  assert.deepEqual(products.map(item => item.documentIds), [[4], [4]])
  assert.match(calls[0].sql, /d\.status = 1/)
  assert.match(calls[0].sql, /effective_status/)
  assert.deepEqual(calls[0].params, [['admin']])
})

test('直接切块型号优先于旧文件回退，且未知 productKey 被拒绝', async () => {
  const rows = [{ id: 8, original_name: '安全.md', file_type: 'md', file_path: path.join(uploadDir, 'safety.md'), product_lines: '翻译机', product_models: '翻译机4.0' }]
  let reads = 0
  const service = createProductScopeService({
    query: async () => [rows],
    readFile: async () => { reads += 1; return markdown },
    uploadDir,
    adminUsernames: ['admin']
  })
  const products = await service.listProducts()
  assert.deepEqual(products.map(item => item.productModel), ['翻译机4.0'])
  assert.equal(reads, 0)
  await assert.rejects(() => service.resolveRequestScope({ productKey: 'product_invalid' }), /不存在|有效资料/)
  await assert.rejects(() => service.resolveRequestScope({}), /选择产品型号/)
})

test('扫码范围每次校验渠道状态和当前有效资料', async () => {
  const documentRows = [{ id: 4, original_name: '指南.md', file_type: 'md', file_path: path.join(uploadDir, 'guide.md'), product_lines: '翻译机', product_models: '' }]
  let channelActive = true
  const service = createProductScopeService({
    query: async sql => sql.includes('FROM support_channels')
      ? [channelActive ? [{ display_name: '商品二维码', product_line: '翻译机', product_model: '翻译机4.0', channel_code: 'abcdefghijklmnopqrstuv' }] : []]
      : [documentRows],
    readFile: async () => markdown,
    uploadDir,
    adminUsernames: ['admin']
  })
  const scope = await service.resolveRequestScope({ supportChannelCode: 'abcdefghijklmnopqrstuv' })
  assert.equal(scope.productModel, '翻译机4.0')
  assert.deepEqual(scope.documentIds, [4])
  channelActive = false
  await assert.rejects(() => service.resolveRequestScope({ supportChannelCode: 'abcdefghijklmnopqrstuv' }), /停用|失效/)
})
