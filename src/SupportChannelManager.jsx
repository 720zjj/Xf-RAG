import { useCallback, useEffect, useState } from 'react'
import { ProductSelector } from './ProductSelector.jsx'

const EMPTY_FORM = { displayName: '', productLine: '', productKey: '' }

function messageFrom(error, fallback) {
  return error instanceof Error && error.message ? error.message : fallback
}

function channelValue(channel, camelCase, snakeCase) {
  return channel[camelCase] ?? channel[snakeCase] ?? ''
}

function channelUrl(publicAppUrl, channel) {
  const canonical = String(channelValue(channel, 'supportUrl', 'support_url')).trim()
  if (canonical) return canonical
  const code = channelValue(channel, 'channelCode', 'channel_code')
  const base = String(publicAppUrl || '').trim().replace(/\/+$/, '')
  return code && base ? `${base}/support/${encodeURIComponent(code)}` : ''
}

async function readApiResponse(response, fallback) {
  const body = typeof response?.json === 'function' ? await response.json() : response
  if (response?.ok === false || body?.ok === false) throw new Error(body?.error || fallback)
  return body?.data ?? body
}

export function SupportChannelManager({ apiFetch, publicAppUrl }) {
  const [channels, setChannels] = useState([])
  const [products, setProducts] = useState([])
  const [form, setForm] = useState(EMPTY_FORM)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [actionId, setActionId] = useState(null)
  const [error, setError] = useState('')
  const [copyUrl, setCopyUrl] = useState('')

  const loadChannels = useCallback(async () => {
    setLoading(true)
    try {
      const data = await readApiResponse(await apiFetch('/api/support-channels'), '无法获取产品支持二维码')
      setChannels(Array.isArray(data) ? data : [])
      setError('')
    } catch (requestError) {
      setError(messageFrom(requestError, '无法获取产品支持二维码'))
    } finally {
      setLoading(false)
    }
  }, [apiFetch])

  const loadProducts = useCallback(async () => {
    try {
      const data = await readApiResponse(await apiFetch('/api/support-channels/products'), '无法获取产品型号')
      setProducts(Array.isArray(data) ? data : [])
    } catch (requestError) {
      setProducts([])
      setError(messageFrom(requestError, '无法获取产品型号'))
    }
  }, [apiFetch])

  useEffect(() => { loadChannels(); loadProducts() }, [loadChannels, loadProducts])

  const runAction = async (id, operation) => {
    setActionId(id)
    setError('')
    try {
      await operation()
      await loadChannels()
    } catch (requestError) {
      setError(messageFrom(requestError, '操作失败，请稍后重试'))
    } finally {
      setActionId(null)
    }
  }

  const handleCreate = async event => {
    event.preventDefault()
    setSubmitting(true)
    setError('')
    try {
      await readApiResponse(await apiFetch('/api/support-channels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form)
      }), '创建产品支持二维码失败')
      setForm(EMPTY_FORM)
      await loadChannels()
    } catch (requestError) {
      setError(messageFrom(requestError, '创建产品支持二维码失败'))
    } finally {
      setSubmitting(false)
    }
  }

  const handleDownload = async channel => {
    await runAction(channel.id, async () => {
      const response = await apiFetch(`/api/support-channels/${channel.id}/qrcode.svg`)
      if (response?.ok === false) throw new Error('下载二维码失败')
      if (typeof response?.blob !== 'function') throw new Error('当前浏览器无法下载二维码')
      const blob = await response.blob()
      const objectUrl = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = objectUrl
      anchor.download = `support-${channelValue(channel, 'productModel', 'product_model') || channel.id}.svg`
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(objectUrl)
    })
  }

  const handleCopy = async channel => {
    const url = channelUrl(publicAppUrl, channel)
    setCopyUrl(url)
    if (!url) {
      setError('未配置公开访问地址，无法生成支持链接')
      return
    }
    try {
      await navigator.clipboard.writeText(url)
      setError('')
    } catch {
      setError('浏览器未授予剪贴板权限，请手动复制下方链接')
    }
  }

  const handleToggle = channel => runAction(channel.id, async () => {
    const nextActive = !channelValue(channel, 'isActive', 'is_active')
    await readApiResponse(await apiFetch(`/api/support-channels/${channel.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        displayName: channelValue(channel, 'displayName', 'display_name'),
        isActive: nextActive
      })
    }), '更新产品支持二维码失败')
    if (!nextActive && copyUrl === channelUrl(publicAppUrl, channel)) setCopyUrl('')
  })

  const handleRotate = channel => runAction(channel.id, async () => {
    await readApiResponse(await apiFetch(`/api/support-channels/${channel.id}/rotate`, {
      method: 'POST'
    }), '轮换二维码失败')
    if (copyUrl === channelUrl(publicAppUrl, channel)) setCopyUrl('')
  })

  return (
    <section className="support-manager card" aria-label="产品支持二维码管理">
      <div className="card-title">产品支持二维码</div>
      <p className="support-manager__intro">为固定产品型号生成登录后的专属支持入口。</p>
      <form className="support-manager__form" onSubmit={handleCreate}>
        <label>
          展示名称
          <input value={form.displayName} onChange={event => setForm({ ...form, displayName: event.target.value })} required maxLength="100" />
        </label>
        <ProductSelector
          products={products}
          productLine={form.productLine}
          productKey={form.productKey}
          onProductLineChange={productLine => setForm(current => ({ ...current, productLine, productKey: '' }))}
          onProductKeyChange={productKey => setForm(current => ({ ...current, productKey }))}
          disabled={submitting}
        />
        <button className="btn btn-primary" type="submit" disabled={submitting || !form.productKey}>{submitting ? '创建中…' : '创建二维码'}</button>
      </form>

      {!loading && products.length === 0 && <p className="support-manager__message" role="status">暂无具有有效资料的首发产品型号，暂时不能生成二维码。</p>}

      {error && <p className="support-manager__message" role="alert">{error}</p>}
      {copyUrl && <p className="support-manager__copy-url">支持链接：<a href={copyUrl}>{copyUrl}</a></p>}

      {loading ? <p className="support-manager__empty">正在加载二维码…</p> : channels.length === 0 ? <p className="support-manager__empty">尚未创建产品支持二维码。</p> : (
        <div className="support-manager__list">
          {channels.map(channel => {
            const active = Boolean(channelValue(channel, 'isActive', 'is_active'))
            const busy = actionId === channel.id
            return (
              <article className="support-manager__item" key={channel.id}>
                <div>
                  <strong>{channelValue(channel, 'displayName', 'display_name')}</strong>
                  <p>{channelValue(channel, 'productLine', 'product_line')} · {channelValue(channel, 'productModel', 'product_model')}</p>
                  <span className={`support-manager__status ${active ? 'support-manager__status--active' : ''}`}>{active ? '已启用' : '已停用'}</span>
                </div>
                <div className="support-manager__actions">
                  <button type="button" className="btn btn-outline btn-sm" disabled={busy} onClick={() => handleDownload(channel)}>下载 SVG</button>
                  <button type="button" className="btn btn-outline btn-sm" disabled={busy} onClick={() => handleCopy(channel)}>复制链接</button>
                  <button type="button" className="btn btn-outline btn-sm" disabled={busy} onClick={() => handleToggle(channel)}>{active ? '停用' : '启用'}</button>
                  <button type="button" className="btn btn-outline btn-sm" disabled={busy} onClick={() => handleRotate(channel)}>轮换二维码</button>
                </div>
              </article>
            )
          })}
        </div>
      )}
    </section>
  )
}
