import { useId } from 'react'
import { productLines, productsForLine } from './productSelection.js'

export function ProductSelector({
  products = [],
  productLine = '',
  productKey = '',
  onProductLineChange,
  onProductKeyChange,
  disabled = false,
  locked = false
}) {
  const lineId = useId()
  const modelId = useId()
  const lines = productLines(products)
  const models = productsForLine(products, productLine)
  const unavailable = disabled || locked

  return (
    <div className={`product-selector${locked ? ' product-selector--locked' : ''}`}>
      <label htmlFor={lineId}>
        产品线
        <select
          id={lineId}
          value={productLine}
          disabled={unavailable}
          onChange={event => {
            onProductLineChange?.(event.target.value)
            onProductKeyChange?.('')
          }}
        >
          <option value="">请选择产品线</option>
          {lines.map(line => <option key={line} value={line}>{line}</option>)}
        </select>
      </label>
      <label htmlFor={modelId}>
        产品型号
        <select
          id={modelId}
          value={productKey}
          disabled={unavailable || !productLine}
          onChange={event => onProductKeyChange?.(event.target.value)}
        >
          <option value="">请选择产品型号</option>
          {models.map(product => (
            <option key={product.productKey} value={product.productKey}>{product.displayName}</option>
          ))}
        </select>
      </label>
      {locked && <span className="product-selector__locked">已由商品二维码锁定</span>}
    </div>
  )
}
