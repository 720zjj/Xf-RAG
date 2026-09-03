import test from 'node:test'
import assert from 'node:assert/strict'
import { customerProductDisplayName, productLines, productsForLine, selectedProduct } from '../src/productSelection.js'
import fs from 'node:fs'

const products = [
  { productKey: 'four', productLine: '翻译机', productModel: '翻译机4.0' },
  { productKey: 'two', productLine: '翻译机', productModel: '翻译机2.0' },
  { productKey: 'other', productLine: '录音笔', productModel: '录音笔A' }
]

test('产品选择按产品线级联且不会返回其他产品线型号', () => {
  assert.deepEqual(productLines(products), ['翻译机', '录音笔'])
  assert.deepEqual(productsForLine(products, '翻译机').map(item => item.productKey), ['four', 'two'])
  assert.deepEqual(productsForLine(products, ''), [])
})

test('只能从服务端产品列表解析已选择型号', () => {
  assert.equal(selectedProduct(products, 'two')?.productModel, '翻译机2.0')
  assert.equal(selectedProduct(products, 'forged'), null)
})

test('顾客端使用清晰的双屏 2.0 产品名称', () => {
  assert.equal(customerProductDisplayName({ productModel: '翻译机2.0' }), '双屏翻译机 2.0')
  assert.equal(customerProductDisplayName({ productModel: '翻译机4.0' }), '翻译机 4.0')
})

test('型号在未选产品线时禁用，扫码锁定时两个选择框都不可修改', () => {
  const source = fs.readFileSync(new URL('../src/ProductSelector.jsx', import.meta.url), 'utf8')
  assert.match(source, /disabled=\{unavailable \|\| !productLine\}/)
  assert.match(source, /const unavailable = disabled \|\| locked/)
  assert.match(source, /已由商品二维码锁定/)
})
