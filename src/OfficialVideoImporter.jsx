import { useEffect, useMemo, useState } from 'react'

function messageFrom(data, fallback) {
  return data?.error || fallback
}

function groupByModel(items) {
  const groups = new Map()
  for (const item of items) {
    const current = groups.get(item.productModel) || []
    current.push(item)
    groups.set(item.productModel, current)
  }
  return [...groups.entries()]
}

export default function OfficialVideoImporter({ api = '/api' }) {
  const [catalog, setCatalog] = useState([])
  const [selectedIds, setSelectedIds] = useState(() => new Set())
  const [loading, setLoading] = useState(true)
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const groups = useMemo(() => groupByModel(catalog), [catalog])
  const importedCount = catalog.filter(item => item.imported).length

  const loadCatalog = async ({ preserveSelection = false } = {}) => {
    setLoading(true)
    setError('')
    try {
      const response = await fetch(`${api}/video/official-catalog`)
      const data = await response.json().catch(() => null)
      if (!response.ok || !data?.ok) throw new Error(messageFrom(data, '读取官方视频目录失败'))
      const list = data.data?.list || []
      setCatalog(list)
      setSelectedIds(previous => {
        if (preserveSelection) {
          const valid = new Set(list.map(item => item.externalId))
          return new Set([...previous].filter(id => valid.has(id)))
        }
        return new Set(list.filter(item => !item.imported).map(item => item.externalId))
      })
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadCatalog()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api])

  const toggle = externalId => {
    setSelectedIds(previous => {
      const next = new Set(previous)
      if (next.has(externalId)) next.delete(externalId)
      else next.add(externalId)
      return next
    })
  }

  const selectUnimported = () => setSelectedIds(new Set(catalog.filter(item => !item.imported).map(item => item.externalId)))

  const importSelected = async () => {
    if (selectedIds.size === 0 || importing) return
    setImporting(true)
    setError('')
    setNotice('')
    try {
      const response = await fetch(`${api}/video/official-catalog/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ externalIds: [...selectedIds] })
      })
      const data = await response.json().catch(() => null)
      if (!response.ok || !data?.ok) throw new Error(messageFrom(data, '导入官方视频失败'))
      setNotice(`已完成：新增 ${data.data.created} 条，更新 ${data.data.updated} 条。现有本地视频未被修改。`)
      await loadCatalog({ preserveSelection: false })
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setImporting(false)
    }
  }

  return (
    <section className="official-video-importer" aria-label="官方视频目录导入">
      <div className="official-video-importer__heading">
        <div>
          <span className="official-video-importer__eyebrow">推荐 · 官方实拍内容</span>
          <h2>科大讯飞官方使用视频</h2>
          <p>目录已固定为首发两个型号。导入的只是标题、封面和 HTTPS 播放地址，不复制视频文件，也不会删除现有视频。</p>
        </div>
        <div className="official-video-importer__summary">
          <strong>{catalog.length || 16}</strong>
          <span>条可信视频</span>
          <small>已导入 {importedCount} 条</small>
        </div>
      </div>

      {error && <div className="sop-video-studio__banner error">⚠️ {error}</div>}
      {notice && <div className="sop-video-studio__banner notice">✓ {notice}</div>}

      {loading ? <div className="official-video-importer__loading">正在读取官方视频目录…</div> : (
        <>
          {groups.map(([model, items]) => (
            <section className="official-video-model" key={model}>
              <div className="official-video-model__title">
                <div><strong>{model === '翻译机2.0' ? '讯飞双屏翻译机 2.0' : '翻译机 4.0'}</strong><span>{items.length} 条</span></div>
                <a href={items[0]?.sourcePageUrl} target="_blank" rel="noreferrer">查看官方目录 ↗</a>
              </div>
              <div className="official-video-grid">
                {items.map(item => (
                  <label className={`official-video-card${item.imported ? ' is-imported' : ''}${selectedIds.has(item.externalId) ? ' is-selected' : ''}`} key={item.externalId}>
                    <input type="checkbox" checked={selectedIds.has(item.externalId)} onChange={() => toggle(item.externalId)} />
                    <img src={item.thumbnailUrl} alt="" loading="lazy" />
                    <span className="official-video-card__copy">
                      <span className="official-video-card__status">{item.imported ? '已导入 · 可重新同步' : '待导入'}</span>
                      <strong>{item.title}</strong>
                      <small>{item.category} · 官方视频</small>
                    </span>
                    <a href={item.videoUrl} target="_blank" rel="noreferrer" onClick={event => event.stopPropagation()}>预览</a>
                  </label>
                ))}
              </div>
            </section>
          ))}

          <div className="official-video-importer__actions">
            <button type="button" className="sop-video-studio__secondary" onClick={selectUnimported} disabled={importing}>选择未导入视频</button>
            <button type="button" className="sop-video-studio__primary" onClick={importSelected} disabled={selectedIds.size === 0 || importing}>
              {importing ? '正在导入…' : `确认导入 ${selectedIds.size} 条`}
            </button>
            <span>重复导入只会同步元数据，不会产生重复记录。</span>
          </div>
        </>
      )}
    </section>
  )
}
