import { useEffect, useRef, useState } from 'react'
import { ProductSelector } from './ProductSelector.jsx'
import { customerProductDisplayName } from './productSelection.js'

const QUICK_QUESTIONS = [
  '翻译机怎么联网？',
  '第一次使用怎么操作？',
  '如何使用拍照翻译？',
  '设备无法开机怎么办？',
  '翻译机进水了怎么办？'
]

function AssistantMark({ className = '' }) {
  return (
    <span className={`customer-assistant-mark ${className}`.trim()} aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none">
        <rect x="3.5" y="5" width="11" height="9" rx="3" stroke="currentColor" strokeWidth="1.8" />
        <path d="M9.5 16.5 12.6 19" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        <rect x="12.5" y="9" width="8" height="8" rx="3.5" stroke="currentColor" strokeWidth="1.8" />
        <path d="M16.5 19 18.7 21" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    </span>
  )
}

function ScanMark() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M8.5 9.5h1.3M14.2 9.5h1.3M8.5 14.2h1.3M14.2 14.2h1.3M12 11.9v.01M12 16.1v.01" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  )
}

export function CustomerQaPage({
  user,
  supportMode,
  supportChannel,
  products,
  productLine,
  productKey,
  selectedProduct,
  onProductLineChange,
  onProductKeyChange,
  question,
  onQuestionChange,
  onAsk,
  onNewConversation,
  onLogout,
  canAsk,
  loading,
  lastQuestion,
  documentsReady,
  hasResults,
  children
}) {
  const [showLockTip, setShowLockTip] = useState(false)
  const [quickQuestionsFit, setQuickQuestionsFit] = useState(false)
  const quickListRef = useRef(null)
  const textareaRef = useRef(null)

  const productName = customerProductDisplayName(supportChannel || selectedProduct)

  useEffect(() => {
    const element = quickListRef.current
    if (!element) return undefined
    const sync = () => setQuickQuestionsFit(element.scrollWidth <= element.clientWidth + 1)
    sync()
    const observer = typeof window.ResizeObserver === 'undefined' ? null : new window.ResizeObserver(sync)
    observer?.observe(element)
    window.addEventListener('resize', sync)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', sync)
    }
  }, [])

  useEffect(() => {
    const element = textareaRef.current
    if (!element) return
    element.style.height = 'auto'
    element.style.height = `${Math.min(element.scrollHeight, 120)}px`
  }, [question])

  const selectQuickQuestion = value => {
    onQuestionChange(value)
    requestAnimationFrame(() => textareaRef.current?.focus())
  }

  return (
    <div className="customer-qa">
      <header className="customer-qa__topbar">
        <div className="customer-qa__topbar-inner">
          <div className="customer-brand">
            <AssistantMark className="customer-brand__mark" />
            <strong>讯飞翻译机 · 售后助手</strong>
            <span>资料支持 · 官方知识库问答</span>
          </div>
          <div className="customer-topbar-actions">
            <span className="customer-service-time">
              <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.6" />
                <path d="M12 7v5l3.5 2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
              人工客服 09:00—18:00
            </span>
            {!supportMode && <span className="customer-account-name">{user?.nickname || user?.username}</span>}
            {!supportMode && <button type="button" className="customer-text-button" onClick={onLogout}>退出</button>}
          </div>
        </div>
      </header>

      <div className="customer-qa__layout">
        <aside className="customer-qa__sidebar">
          <section className="customer-panel customer-product-panel" aria-label="当前产品">
            {supportMode && supportChannel ? (
              <>
                <div className="customer-lock-bar">
                  <span className="customer-lock-bar__icon"><ScanMark /></span>
                  <span className="customer-lock-bar__name">
                    <strong>{productName}</strong>
                    <small>扫码识别</small>
                  </span>
                  <span className="customer-lock-chip">
                    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <rect x="5" y="10.5" width="14" height="9" rx="2.5" stroke="currentColor" strokeWidth="1.7" />
                      <path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" stroke="currentColor" strokeWidth="1.7" />
                    </svg>
                    型号已锁定
                  </span>
                  <button
                    type="button"
                    className="customer-lock-info"
                    aria-label="查看型号锁定说明"
                    aria-expanded={showLockTip}
                    onClick={() => setShowLockTip(value => !value)}
                  >i</button>
                </div>
                {showLockTip && <p className="customer-lock-tip">当前设备由所扫商品二维码自动识别，本次会话不可更换。</p>}
              </>
            ) : (
              <>
                <h2 className="customer-panel__title">选择你的设备</h2>
                <ProductSelector
                  products={products}
                  productLine={productLine}
                  productKey={productKey}
                  onProductLineChange={onProductLineChange}
                  onProductKeyChange={onProductKeyChange}
                />
                <p className="customer-product-hint">
                  {selectedProduct ? `已选择 ${selectedProduct.displayName}` : '选择产品线和型号后即可提问'}
                </p>
              </>
            )}
          </section>

          <section className="customer-panel customer-quick-panel" aria-label="常见问题">
            <h2 className="customer-panel__title">常见问题</h2>
            <div
              ref={quickListRef}
              className={`customer-quick-list${quickQuestionsFit ? ' customer-quick-list--centered' : ''}`}
            >
              {QUICK_QUESTIONS.map(value => (
                <button type="button" key={value} onClick={() => selectQuickQuestion(value)}>{value}</button>
              ))}
            </div>
          </section>

          <section className="customer-panel customer-human-panel">
            <h2 className="customer-panel__title">人工客服时间</h2>
            <strong>09:00 — 18:00</strong>
            <p>回答来自售后知识库。紧急情况或设备存在安全风险时，请及时联系人工客服。</p>
          </section>
        </aside>

        <main className="customer-chat-pane">
          <div className="customer-chat-scroll" aria-live="polite" aria-relevant="additions">
            {!lastQuestion && !hasResults && !loading && (
              <div className="customer-welcome">
                <AssistantMark />
                <div>
                  <strong>你好，我是售后助手</strong>
                  <p>你可以咨询产品使用、联网、翻译、故障排查和售后问题，我会基于现有资料为你解答。</p>
                </div>
              </div>
            )}

            {lastQuestion && <div className="customer-user-message"><span>{lastQuestion}</span></div>}

            {loading && (
              <div className="customer-waiting" role="status">
                <AssistantMark />
                <span>正在查找资料并整理回答</span>
                <i /><i /><i />
              </div>
            )}

            {children}
          </div>

          <form className="customer-composer" onSubmit={event => { event.preventDefault(); if (canAsk) onAsk() }}>
            <div className="customer-composer__row">
              <textarea
                ref={textareaRef}
                rows="1"
                value={question}
                onChange={event => onQuestionChange(event.target.value)}
                onKeyDown={event => {
                  if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && canAsk) {
                    event.preventDefault()
                    onAsk()
                  }
                }}
                placeholder={documentsReady ? (productName ? `咨询 ${productName} 的使用或售后问题…` : '请先选择产品型号…') : '知识库暂不可用…'}
                aria-label="输入问题"
                disabled={!documentsReady || loading}
              />
              <button type="submit" className="customer-send-button" aria-label="发送问题" disabled={!canAsk}>
                <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M12 20V5M5.5 11.5 12 5l6.5 6.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
              <button type="button" className="customer-new-chat" onClick={onNewConversation}>新对话</button>
            </div>
            <p>回答由售后知识库自动生成，仅供参考；紧急情况请联系人工客服。</p>
          </form>
        </main>
      </div>
    </div>
  )
}
