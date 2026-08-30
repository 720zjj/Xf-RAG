import { useEffect, useMemo, useRef, useState } from 'react'
import { getSopVideoRendererSupport, renderSopVideo } from './sopVideoRenderer.js'
import './sopVideoStudio.css'

function formatDuration(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0))
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

function responseError(data, fallback) {
  return data?.error || fallback
}

export default function SopVideoStudio({ api = '/api' }) {
  const [sops, setSops] = useState([])
  const [keyword, setKeyword] = useState('')
  const [selectedSopId, setSelectedSopId] = useState(null)
  const [storyboard, setStoryboard] = useState(null)
  const [activeSceneIndex, setActiveSceneIndex] = useState(0)
  const [loadingSops, setLoadingSops] = useState(true)
  const [loadingStoryboard, setLoadingStoryboard] = useState(false)
  const [rendering, setRendering] = useState(false)
  const [renderProgress, setRenderProgress] = useState(null)
  const [videoBlob, setVideoBlob] = useState(null)
  const [previewUrl, setPreviewUrl] = useState('')
  const [publishing, setPublishing] = useState(false)
  const [publishedVideo, setPublishedVideo] = useState(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const renderAbortRef = useRef(null)

  const rendererSupport = useMemo(() => getSopVideoRendererSupport(), [])
  const selectedSop = sops.find(sop => Number(sop.id) === Number(selectedSopId)) || null
  const activeScene = storyboard?.scenes?.[activeSceneIndex] || null

  const loadSops = async (query = keyword) => {
    setLoadingSops(true)
    setError('')
    try {
      const params = new URLSearchParams()
      if (query.trim()) params.set('q', query.trim())
      const response = await fetch(`${api}/video/studio/sops${params.size ? `?${params}` : ''}`)
      const data = await response.json().catch(() => null)
      if (!response.ok || !data?.ok) throw new Error(responseError(data, '读取 SOP 列表失败'))
      setSops(data.data || [])
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setLoadingSops(false)
    }
  }

  useEffect(() => {
    loadSops('')
    // 初始列表只读取一次；检索由表单主动触发，避免每次输入都请求后端。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => () => {
    renderAbortRef.current?.abort()
    if (previewUrl) URL.revokeObjectURL(previewUrl)
  }, [previewUrl])

  const requestStoryboard = async (sopId) => {
    if (!sopId) return
    setSelectedSopId(sopId)
    setLoadingStoryboard(true)
    setStoryboard(null)
    setVideoBlob(null)
    setPublishedVideo(null)
    setPreviewUrl(previous => {
      if (previous) URL.revokeObjectURL(previous)
      return ''
    })
    setError('')
    setNotice('')
    try {
      const response = await fetch(`${api}/video/studio/storyboard`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sopId })
      })
      const data = await response.json().catch(() => null)
      if (!response.ok || !data?.ok) throw new Error(responseError(data, '生成视频分镜失败'))
      setStoryboard(data.data)
      setActiveSceneIndex(0)
      setNotice('已按当前已审核 SOP 生成分镜；若 SOP 之后被修改，发布时会要求重新生成。')
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setLoadingStoryboard(false)
    }
  }

  const handleRender = async () => {
    if (!storyboard || rendering) return
    if (!rendererSupport.supported) {
      setError(`${rendererSupport.reason}。请使用最新版 Chrome 或 Edge。`)
      return
    }
    const controller = new AbortController()
    renderAbortRef.current = controller
    setRendering(true)
    setRenderProgress({ progress: 0, elapsedSeconds: 0, durationSeconds: storyboard.durationSeconds })
    setError('')
    setNotice('正在浏览器本地生成 1080p WebM，请保持当前页面打开。')
    setPublishedVideo(null)
    try {
      const blob = await renderSopVideo(storyboard, {
        signal: controller.signal,
        fps: 24,
        onProgress: progress => setRenderProgress(progress)
      })
      const nextPreviewUrl = URL.createObjectURL(blob)
      setPreviewUrl(previous => {
        if (previous) URL.revokeObjectURL(previous)
        return nextPreviewUrl
      })
      setVideoBlob(blob)
      setNotice(`字幕视频已生成（${(blob.size / 1024 / 1024).toFixed(1)} MB）。先预览，确认后再发布。`)
    } catch (renderError) {
      if (renderError?.name === 'AbortError') setNotice('已取消视频生成。')
      else setError(renderError.message || '视频生成失败')
    } finally {
      if (renderAbortRef.current === controller) renderAbortRef.current = null
      setRendering(false)
    }
  }

  const cancelRender = () => renderAbortRef.current?.abort()

  const handlePublish = async () => {
    if (!storyboard || !videoBlob || publishing) return
    setPublishing(true)
    setError('')
    setNotice('正在上传 WebM 并写入章节…')
    try {
      const filename = `sop-${storyboard.sourceSopId}-${Date.now()}.webm`
      const uploadResponse = await fetch(`${api}/video/upload-file?filename=${encodeURIComponent(filename)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'video/webm' },
        body: videoBlob
      })
      const uploadData = await uploadResponse.json().catch(() => null)
      if (!uploadResponse.ok || !uploadData?.ok) throw new Error(responseError(uploadData, '视频上传失败'))

      const publishResponse = await fetch(`${api}/video/studio/publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sopId: storyboard.sourceSopId,
          videoUrl: uploadData.url,
          storyboardFingerprint: storyboard.fingerprint
        })
      })
      const publishData = await publishResponse.json().catch(() => null)
      if (!publishResponse.ok || !publishData?.ok) throw new Error(responseError(publishData, '发布视频失败'))
      setPublishedVideo(publishData.data)
      setNotice('视频已审核并发布。问答推荐会自动使用它。')
    } catch (publishError) {
      setError(publishError.message)
    } finally {
      setPublishing(false)
    }
  }

  return (
    <section className="sop-video-studio" aria-label="SOP 视频工坊">
      <header className="sop-video-studio__hero">
        <div>
          <span className="sop-video-studio__eyebrow">管理员专用 · 浏览器本地生成</span>
          <h2>把已审核 SOP 做成可播放的教学视频</h2>
          <p>自动生成分镜、章节和无声字幕 WebM；不会伪装成实拍或 AI 配音。</p>
        </div>
        <div className="sop-video-studio__hero-meta">
          <span>1080p WebM</span>
          <span>≤ 60 秒</span>
          <span>发布后可被问答推荐</span>
        </div>
      </header>

      {!rendererSupport.supported && (
        <div className="sop-video-studio__banner warning">⚠️ {rendererSupport.reason}。可查看分镜；导出请使用 Chrome 或 Edge。</div>
      )}
      {error && <div className="sop-video-studio__banner error">⚠️ {error}</div>}
      {notice && <div className="sop-video-studio__banner notice">✓ {notice}</div>}

      <div className="sop-video-studio__layout">
        <aside className="sop-video-studio__library">
          <div className="sop-video-studio__section-heading">
            <div><span>01</span><h3>选择已审核 SOP</h3></div>
            <small>{sops.length} 条</small>
          </div>
          <form className="sop-video-studio__search" onSubmit={event => { event.preventDefault(); loadSops() }}>
            <input value={keyword} onChange={event => setKeyword(event.target.value)} placeholder="检索标题、型号或分类" aria-label="检索 SOP" />
            <button type="submit" disabled={loadingSops}>检索</button>
          </form>
          <div className="sop-video-studio__sop-list">
            {loadingSops && <div className="sop-video-studio__empty">正在读取 SOP…</div>}
            {!loadingSops && sops.length === 0 && <div className="sop-video-studio__empty">暂无可用于生成视频的已审核 SOP。</div>}
            {sops.map(sop => (
              <button
                type="button"
                key={sop.id}
                className={`sop-video-studio__sop ${Number(sop.id) === Number(selectedSopId) ? 'is-selected' : ''}`}
                onClick={() => requestStoryboard(sop.id)}
              >
                <span className="sop-video-studio__sop-status">已审核</span>
                <strong>{sop.title}</strong>
                <small>{[sop.product_model, sop.category].filter(Boolean).join(' · ') || '通用操作'}</small>
              </button>
            ))}
          </div>
        </aside>

        <div className="sop-video-studio__workspace">
          <div className="sop-video-studio__section-heading">
            <div><span>02</span><h3>检查分镜</h3></div>
            {storyboard && <small>{storyboard.scenes.length} 个场景 · {formatDuration(storyboard.durationSeconds)}</small>}
          </div>

          {!storyboard && !loadingStoryboard && (
            <div className="sop-video-studio__empty sop-video-studio__empty--large">从左侧选择一条 SOP，系统会生成可审核的字幕分镜。</div>
          )}
          {loadingStoryboard && <div className="sop-video-studio__empty sop-video-studio__empty--large">正在生成分镜…</div>}
          {storyboard && activeScene && (
            <>
              <div className={`sop-video-studio__stage is-${activeScene.kind}`}>
                <div className="sop-video-studio__stage-top"><span>科大讯飞 · SOP 操作指引</span><b>{activeScene.kind === 'step' ? `步骤 ${activeScene.stepNumber}` : activeScene.kind === 'intro' ? '操作概览' : activeScene.kind === 'completion' ? '完成确认' : '开始前确认'}</b></div>
                <div className="sop-video-studio__stage-content">
                  <h1>{activeScene.title}</h1>
                  <p>{activeScene.body}</p>
                  {(activeScene.notes?.length > 0 || activeScene.warnings?.length > 0) && (
                    <div className="sop-video-studio__stage-notes">
                      {activeScene.notes?.slice(0, 2).map((item, index) => <span key={`note-${index}`}>提示：{item}</span>)}
                      {activeScene.warnings?.slice(0, 2).map((item, index) => <span className="warning" key={`warning-${index}`}>注意：{item}</span>)}
                    </div>
                  )}
                </div>
                <div className="sop-video-studio__stage-progress"><i style={{ width: `${((activeScene.endTime || 0) / storyboard.durationSeconds) * 100}%` }} /></div>
              </div>

              <div className="sop-video-studio__timeline" aria-label="视频分镜时间线">
                {storyboard.scenes.map((scene, index) => (
                  <button type="button" key={scene.id} onClick={() => setActiveSceneIndex(index)} className={index === activeSceneIndex ? 'is-active' : ''}>
                    <span>{String(index + 1).padStart(2, '0')}</span>
                    <b>{scene.title}</b>
                    <small>{formatDuration(scene.startTime)} — {formatDuration(scene.endTime)}</small>
                  </button>
                ))}
              </div>
              {storyboard.notice && <p className="sop-video-studio__storyboard-notice">ℹ️ {storyboard.notice}</p>}
            </>
          )}

          {storyboard && (
            <div className="sop-video-studio__actions">
              {!rendering ? (
                <button type="button" className="sop-video-studio__primary" onClick={handleRender} disabled={!rendererSupport.supported}>
                  {videoBlob ? '重新生成字幕视频' : '生成 1080p 字幕 WebM'}
                </button>
              ) : (
                <button type="button" className="sop-video-studio__secondary" onClick={cancelRender}>取消生成</button>
              )}
              {rendering && renderProgress && <span>正在生成 {Math.floor(renderProgress.elapsedSeconds)} / {renderProgress.durationSeconds} 秒</span>}
              {selectedSop && <small>来源：{selectedSop.title}</small>}
            </div>
          )}

          {renderProgress && rendering && <div className="sop-video-studio__render-progress"><i style={{ width: `${Math.round((renderProgress.progress || 0) * 100)}%` }} /></div>}

          {previewUrl && (
            <section className="sop-video-studio__preview">
              <div className="sop-video-studio__section-heading"><div><span>03</span><h3>预览并发布</h3></div><small>无声字幕草稿</small></div>
              <video src={previewUrl} controls className="sop-video-studio__video" />
              <div className="sop-video-studio__publish-row">
                <p>发布会在服务端重新核对 SOP 版本、分镜指纹、WebM 文件和章节。</p>
                <button type="button" className="sop-video-studio__primary" onClick={handlePublish} disabled={publishing || Boolean(publishedVideo)}>
                  {publishedVideo ? '已发布' : publishing ? '正在发布…' : '审核并发布视频'}
                </button>
              </div>
              {publishedVideo && <div className="sop-video-studio__published">✓ 已发布视频 #{publishedVideo.id} · {publishedVideo.title} · {formatDuration(publishedVideo.durationSeconds)}</div>}
            </section>
          )}
        </div>
      </div>
    </section>
  )
}

