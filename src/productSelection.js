export function productLines(products = []) {
  return [...new Set(products.map(product => String(product?.productLine || '').trim()).filter(Boolean))]
}

export function productsForLine(products = [], productLine = '') {
  return products.filter(product => product.productLine === productLine)
}

export function selectedProduct(products = [], productKey = '') {
  return products.find(product => product.productKey === productKey) || null
}

export function customerProductDisplayName(product) {
  const model = String(product?.productModel || product?.product_model || '').trim()
  const displayName = String(product?.displayName || '').trim()
  if (model === '翻译机2.0' || /双屏.*2\.0/.test(displayName)) return '双屏翻译机 2.0'
  if (model === '翻译机4.0') return '翻译机 4.0'
  return displayName || model
}
