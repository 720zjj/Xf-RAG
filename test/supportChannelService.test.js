import test from 'node:test'
import assert from 'node:assert/strict'
import {
  CHANNEL_CODE_PATTERN,
  createSupportChannelService,
  generateChannelCode,
  normalizeSupportChannelInput,
  parsePublicAppUrl
} from '../server/services/supportChannelService.js'


test('二维码入口编号使用 URL 安全的至少 128 bit 随机值', () => {
  const code = generateChannelCode(size => Buffer.alloc(size, 7))
  assert.match(code, CHANNEL_CODE_PATTERN)
  assert.ok(code.length >= 22)
})

test('二维码配置只接受展示名称和服务端产品标识', () => {
  assert.deepEqual(normalizeSupportChannelInput({ displayName: ' 商品二维码 ', productKey: ' product_trusted ' }), {
    displayName: '商品二维码', productKey: 'product_trusted'
  })
  assert.throws(() => normalizeSupportChannelInput({ displayName: '商品二维码', productLine: '伪造产品线', productModel: '伪造型号' }), /选择产品型号/)
  assert.throws(() => normalizeSupportChannelInput({ displayName: 'x'.repeat(101), productKey: 'product_trusted' }), /展示名称/)
})

test('PUBLIC_APP_URL 必须是绝对 HTTP(S) 地址，生产环境必须 HTTPS 且不能 localhost', () => {
  assert.equal(parsePublicAppUrl('http://localhost:3000'), 'http://localhost:3000')
  assert.equal(parsePublicAppUrl('https://help.example.com/'), 'https://help.example.com')
  assert.throws(() => parsePublicAppUrl('/support'), /绝对 URL/)
  assert.throws(() => parsePublicAppUrl('ftp://help.example.com'), /HTTP/)
  assert.throws(() => parsePublicAppUrl('http://localhost:3000', { production: true }), /HTTPS|localhost/)
  assert.throws(() => parsePublicAppUrl('http://help.example.com', { production: true }), /HTTPS/)
})

test('support channel service uses parameterized CRUD and resolves active channels only', async () => {
  const calls = []
  const rows = [{ id: 4, channel_code: 'abcdefghijklmnopqrstuv', display_name: 'T9', product_line: '翻译机', product_model: 'T9', is_active: 1 }]
  const query = async (sql, params) => {
    calls.push({ sql, params })
    if (sql.startsWith('SELECT')) return [rows]
    if (sql.startsWith('INSERT')) return [{ insertId: 9 }]
    return [{ affectedRows: 1 }]
  }
  const product = { productKey: 'product_trusted', productLine: '翻译机', productModel: '翻译机4.0' }
  const service = createSupportChannelService({
    query,
    publicAppUrl: 'https://help.example.com',
    codeFactory: () => 'abcdefghijklmnopqrstuv',
    resolveProduct: async key => key === product.productKey ? product : null
  })
  assert.deepEqual(await service.list(7), rows)
  assert.equal((await service.create({ createdBy: 7, displayName: '商品二维码', productKey: 'product_trusted' })).id, 9)
  assert.equal((await service.update(4, { displayName: '商品二维码', isActive: false })).affectedRows, 1)
  assert.equal((await service.rotate(4)).affectedRows, 1)
  assert.deepEqual(await service.resolve('abcdefghijklmnopqrstuv'), rows[0])
  assert.equal(service.buildSupportUrl('abcdefghijklmnopqrstuv'), 'https://help.example.com/support/abcdefghijklmnopqrstuv')
  assert.ok(calls.every(({ sql, params }) => !/['"](?:T9|翻译机|abcdefghijklmnopqrstuv)['"]/.test(sql) && Array.isArray(params)))
})

test('未知、格式非法或停用的入口 resolve 返回 null', async () => {
  const service = createSupportChannelService({
    query: async () => [[]],
    publicAppUrl: 'https://help.example.com',
    resolveProduct: async () => null
  })
  assert.equal(await service.resolve('too-short'), null)
  assert.equal(await service.resolve('abcdefghijklmnopqrstuv'), null)
})

test('写入时将数据库重复约束错误保留给路由映射为冲突响应', async () => {
  const duplicateError = Object.assign(new Error('internal duplicate details'), { code: 'ER_DUP_ENTRY' })
  const service = createSupportChannelService({
    query: async () => { throw duplicateError },
    publicAppUrl: 'https://help.example.com',
    codeFactory: () => 'abcdefghijklmnopqrstuv',
    resolveProduct: async () => ({ productKey: 'product_trusted', productLine: '翻译机', productModel: '翻译机4.0' })
  })
  const input = { createdBy: 7, displayName: '商品二维码', productKey: 'product_trusted' }
  await assert.rejects(() => service.create(input), error => error === duplicateError)
  await assert.rejects(() => service.update(4, { displayName: '商品二维码' }), error => error === duplicateError)
})

test('未知产品标识不能创建二维码，前端自报产品文本不会被使用', async () => {
  let queried = false
  const service = createSupportChannelService({
    query: async () => { queried = true; return [{ insertId: 1 }] },
    publicAppUrl: 'https://help.example.com',
    resolveProduct: async () => null
  })
  await assert.rejects(() => service.create({
    createdBy: 7,
    displayName: '伪造二维码',
    productKey: 'product_unknown',
    productLine: '其他产品',
    productModel: '其他型号'
  }), /不存在|有效资料/)
  assert.equal(queried, false)
})
