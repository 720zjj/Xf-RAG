import { useState, useRef, useEffect, useMemo } from 'react'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { canManageDocument, documentScopeLabel } from './documentAccess.js'
import { parseAnswerSections, toStreamingPlainText } from './answerPresentation.js'
import { getDocumentJobPresentation, shouldPollDocumentJobs } from './documentJobPresentation.js'
import { normalizeAnswerBlocks, parseStepPresentation, sourceIdSet, trustBadge } from './trustedAnswerPresentation.js'
import { getSupportChannelCode } from './supportChannelLocation.js'
import { SupportExperience } from './SupportExperience.jsx'
import { SupportChannelManager } from './SupportChannelManager.jsx'
import { ProductSelector } from './ProductSelector.jsx'
import { customerProductDisplayName, selectedProduct } from './productSelection.js'
import { getSourcePresentation } from './sourcePresentation.js'
import { buildRagInsight } from './ragInsightPresentation.js'
import SopVideoStudio from './SopVideoStudio.jsx'
import { CustomerQaPage } from './CustomerQaPage.jsx'

const API = '/api'

function renderMarkdown(value) {
  if (!value) return ''
  try {
    return DOMPurify.sanitize(marked.parse(value), {
      USE_PROFILES: { html: true },
      FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form'],
      FORBID_ATTR: ['style']
    })
  } catch {
    return DOMPurify.sanitize(String(value))
  }
}

const ANSWER_SECTION_ICONS = {
  conclusion: '✨', steps: '🧭', notice: '⚠️', product: '📱', sources: '📚', related: '💡', details: '📝'
}

const VIDEO_CATEGORY_ICONS = {
  '网络设置': '📶', '蓝牙连接': '🔗', '翻译功能': '🗣️', '拍照翻译': '📷',
  '语音功能': '🎙️', '系统设置': '⚙️', '常见问题': '💡', '基础使用': '▶️'
}

function AnswerReader({ answer, streaming = false }) {
  if (streaming) return <div className="rag-answer-stream">{toStreamingPlainText(answer)}</div>

  const sections = parseAnswerSections(answer)
  return (
    <div className="answer-reader">
      {sections.map((section, index) => (
        <section className={`answer-section answer-section--${section.key}`} key={`${section.key}-${index}`}>
          <div className="answer-section-heading">
            <span className="answer-section-icon" aria-hidden="true">{ANSWER_SECTION_ICONS[section.key] || '📝'}</span>
            <span>{section.title}</span>
          </div>
          {section.type === 'steps' ? (
            <ol className="answer-list answer-steps">
              {section.content.map((item, itemIndex) => <li key={itemIndex}>{item}</li>)}
            </ol>
          ) : section.type === 'bullets' ? (
            <ul className="answer-list answer-bullets">
              {section.content.map((item, itemIndex) => <li key={itemIndex}>{item}</li>)}
            </ul>
          ) : (
            <div className="answer-paragraphs">
              {section.content.map((paragraph, paragraphIndex) => <p key={paragraphIndex}>{paragraph}</p>)}
            </div>
          )}
        </section>
      ))}
    </div>
  )
}

const TRUSTED_BLOCK_TITLES = {
  conclusion: '问题结论', step: '操作步骤', notice: '注意事项', scope: '适用产品和版本', related: '相关问题', details: '说明'
}

function TrustedStepText({ text }) {
  const presentation = parseStepPresentation(text)
  if (presentation.type === 'methods') {
    return <div className="customer-answer-methods">
      {presentation.methods.map(method => <section className="customer-answer-method" key={method.title}>
        <h4>{method.title}</h4>
        <ol className="customer-answer-step-list">
          {method.steps.map((step, index) => <li key={`${method.title}-${index}`}>{step}</li>)}
        </ol>
      </section>)}
    </div>
  }
  if (presentation.type === 'steps') {
    return <ol className="customer-answer-step-list">
      {presentation.steps.map((step, index) => <li key={index}>{step}</li>)}
    </ol>
  }
  return <p className="trusted-answer-text">{presentation.text}</p>
}

function TrustedAnswerReader({ blocks, onEvidenceSelect }) {
  return (
    <div className="answer-reader trusted-answer-reader">
      <section className="answer-section trusted-answer-card">
        {blocks.map((block, index) => (
          <div className={`trusted-answer-group trusted-answer-group--${block.kind}`} key={`${block.kind}-${index}`}>
          <div className="answer-section-heading">
            <span className="answer-section-icon" aria-hidden="true">{ANSWER_SECTION_ICONS[block.kind] || '📝'}</span>
            <span>{TRUSTED_BLOCK_TITLES[block.kind] || '说明'}</span>
          </div>
          {block.kind === 'step' ? <TrustedStepText text={block.text} /> : <p className="trusted-answer-text">{block.text}</p>}
          {sourceIdSet(block).length > 0 && (
            <div className="evidence-links" aria-label="回答依据">
              {sourceIdSet(block).map(evidenceId => (
                <button type="button" key={evidenceId} onClick={() => onEvidenceSelect(evidenceId)}>[{evidenceId}]</button>
              ))}
            </div>
          )}
          </div>
        ))}
      </section>
    </div>
  )
}

function SourceExcerpt({ source, index }) {
  const { section, body, preview } = getSourcePresentation(source.text)
  const bodyWithoutImages = body.replace(/!\[[^\]]*\]\([^)]*\)/g, '')
  const images = Array.isArray(source.images) ? source.images.slice(0, 2) : []
  return (
    <div className="source-content">
      <div className="source-card-header">
        <span className="source-num">{index + 1}</span>
        <div>
          <div className="source-document-name">📄 {source.docName || '知识库文档'}</div>
          {section && <div className="source-section-path">📍 {section}</div>}
        </div>
      </div>
      {preview && <p className="source-preview">{preview}</p>}
      {images.length > 0 && (
        <div className="source-images" aria-label="原文图片">
          {images.map((image, imageIndex) => (
            <img
              className="source-image"
              key={image}
              src={image}
              alt={`参考来源图片 ${imageIndex + 1}`}
              loading="lazy"
              onError={event => { event.currentTarget.hidden = true }}
            />
          ))}
        </div>
      )}
      {bodyWithoutImages && (
        <details className="source-original">
          <summary>查看原文</summary>
          <div className="source-original-content" dangerouslySetInnerHTML={{ __html: renderMarkdown(bodyWithoutImages) }} />
        </details>
      )}
      <details className="source-retrieval-details">
        <summary>检索详情</summary>
        <div className="source-metrics">
          <span>综合相关度 {source.score ?? '-'}</span>
          <span>关键词匹配 {source.bm25Score ?? '-'}</span>
          {source.factors?.semantic !== undefined && <span>语义匹配 {source.factors.semantic}</span>}
          {source.factors?.coverage !== undefined && <span>词覆盖 {source.factors.coverage}</span>}
          {source.factors?.phraseMatch && <span>精确短语命中</span>}
        </div>
      </details>
    </div>
  )
}

function RetrievalInsight({ queryEnhancement, ragMeta }) {
  const insight = buildRagInsight({ queryEnhancement, ragMeta })
  const details = insight.technicalDetails
  if (!insight.visible) return null

  return (
    <section className="rag-insight-panel" aria-label="本次检索说明">
      <div className="rag-insight-header">
        <div className="rag-insight-heading">
          <span className="rag-insight-icon" aria-hidden="true">🔎</span>
          <div>
            <h3>本次检索说明</h3>
            <p>{insight.summary}</p>
          </div>
        </div>
        <span className="rag-insight-status">已完成</span>
      </div>

      {insight.strategyLabels.length > 0 && (
        <div className="rag-insight-methods">
          <span className="rag-insight-methods-label">本次采用</span>
          <div className="rag-insight-chips">
            {insight.strategyLabels.map(label => <span className="rag-insight-chip" key={label}>{label}</span>)}
          </div>
        </div>
      )}

      {(insight.memoryMessage || insight.reflectionMessage) && (
        <div className="rag-insight-notes">
          {insight.memoryMessage && <p>💬 {insight.memoryMessage}</p>}
          {insight.reflectionMessage && <p>✓ {insight.reflectionMessage}</p>}
        </div>
      )}

      {insight.hasTechnicalDetails && (
        <details className="rag-insight-details">
          <summary>
            <span>查看检索过程</span>
            <span className="rag-insight-details-hint">查询理解、查找范围与处理步骤</span>
          </summary>
          <div className="rag-insight-details-body">
            {details.originalQuery && <div><span>本次问题</span><p>{details.originalQuery}</p></div>}
            {details.rewrittenQuery && details.rewrittenQuery !== details.originalQuery && <div><span>系统理解为</span><p>{details.rewrittenQuery}</p></div>}
            {details.totalQueries && <div><span>查找范围</span><p>围绕问题从 {details.totalQueries} 个角度查找相关内容。</p></div>}
            {details.expandedQueries.length > 0 && <div><span>补充查找</span><p>{details.expandedQueries.join('；')}</p></div>}
            {details.hydeDoc && <div><span>检索描述</span><p>{details.hydeDoc}</p></div>}
            {details.planLength && <div><span>处理步骤</span><p>系统将问题拆分为 {details.planLength} 个步骤后再汇总。</p></div>}
            {details.rounds && <div><span>核对次数</span><p>经过 {details.rounds} 轮查找与核对。</p></div>}
            {details.stepCount && <div><span>工具协作</span><p>完成了 {details.stepCount} 个处理步骤。</p></div>}
            {details.toolCount && <div><span>工具使用</span><p>本次调用了 {details.toolCount} 项辅助能力。</p></div>}
            {details.fallbackMessage && <div><span>处理说明</span><p>{details.fallbackMessage}</p></div>}
            {details.strategies.length > 0 && <div><span>完整处理方式</span><p>{details.strategies.join('、')}</p></div>}
          </div>
        </details>
      )}
    </section>
  )
}

function VideoRecommendationCard({ video, onPlay, onResolve, onTryNext, hasNext, isResolving, isResolved }) {
  const duration = video.duration_seconds ? `时长 ${video.duration_seconds} 秒` : '时长未标注'
  const solved = Number(video.resolve_count || 0)
  const isPrimary = video.guidanceRole !== 'fallback'
  return (
    <article className="video-recommendation-card">
      <div className={`video-guidance-badge ${isPrimary ? 'primary' : 'fallback'}`}>
        {isPrimary ? '建议先看' : `备用方案 ${video.guidancePosition || ''}`}
      </div>
      <div className="video-card-heading">
        <span className="video-category-icon" aria-hidden="true">{VIDEO_CATEGORY_ICONS[video.category] || '🎬'}</span>
        <div>
          <div className="video-category-label">
            {video.category || '操作视频'}
            {video.source_provider === 'iflytek-h5' && <span className="video-official-badge">官方视频</span>}
          </div>
          <h3>{video.title}</h3>
        </div>
      </div>
      {video.description && <p className="video-description">{video.description}</p>}
      {video.guidanceReason && <p className="video-guidance-reason">💡 {video.guidanceReason}</p>}
      {video.matchReasons?.length > 0 && (
        <div className="video-match-reasons" aria-label="推荐原因">
          {video.matchReasons.slice(0, 3).map((reason, index) => <span key={index}>{reason}</span>)}
        </div>
      )}
      <div className="video-metadata">
        <span>⏱ {duration}</span>
        {video.product_model && <span>📱 {video.product_model}</span>}
        {solved > 0 && <span>✅ {solved} 人已解决</span>}
      </div>
      <div className="video-card-actions">
        <button type="button" className="video-play-button" onClick={() => onPlay(video)}>▶ 播放视频</button>
        <button type="button" className="video-resolve-button" onClick={() => onResolve(video)} disabled={isResolved || isResolving}>
          {isResolved ? '✓ 已反馈解决' : isResolving ? '提交中…' : '这条视频帮我解决了'}
        </button>
        {hasNext && !isResolved && <button type="button" className="video-next-button" onClick={onTryNext}>未解决，换一个方案</button>}
      </div>
    </article>
  )
}

function VideoPlayerDialog({ video, loadError, onError, onClose }) {
  const fallbackUrl = video.source_page_url || (/^https:\/\//.test(video.video_url || '') ? video.video_url : '')
  const playbackUrl = video.playback_url || video.video_url
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.78)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={event => event.stopPropagation()} style={{ background: '#000', borderRadius: 14, maxWidth: 820, width: '100%', overflow: 'hidden', boxShadow: '0 20px 60px rgba(0,0,0,.45)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '11px 16px', background: '#111', color: '#fff' }}>
          <div style={{ minWidth: 0, fontSize: 14, fontWeight: 600 }}>
            {video.title}
            {video.source_provider === 'iflytek-h5' && <span style={{ marginLeft: 8, color: '#91caff', fontSize: 11 }}>科大讯飞官方视频</span>}
          </div>
          <button type="button" onClick={onClose} aria-label="关闭视频" style={{ width: 36, height: 36, flex: '0 0 auto', background: 'none', border: 0, color: '#fff', fontSize: 20, cursor: 'pointer' }}>×</button>
        </div>
        <video
          src={playbackUrl}
          poster={video.thumbnail_url || undefined}
          controls
          playsInline
          webkit-playsinline="true"
          x5-playsinline="true"
          preload="metadata"
          onError={onError}
          style={{ width: '100%', display: loadError ? 'none' : 'block', maxHeight: '70vh', background: '#000' }}
        />
        {loadError && (
          <div style={{ padding: '34px 20px', textAlign: 'center', color: '#f5f5f5', fontSize: 13, lineHeight: 1.8, background: '#111' }}>
            <div>视频暂时无法在页面内加载，请检查网络后重试。</div>
            {fallbackUrl && <a href={fallbackUrl} target="_blank" rel="noreferrer" style={{ display: 'inline-block', marginTop: 12, color: '#91caff', fontWeight: 700 }}>打开官方视频来源 ↗</a>}
          </div>
        )}
        <div style={{ padding: '10px 16px', background: '#111', color: '#aaa', fontSize: 12 }}>
          {video.category || '操作视频'} {video.product_model ? `· ${video.product_model}` : ''} {video.resolve_count > 0 ? `· ${video.resolve_count} 人标记已解决` : ''}
        </div>
      </div>
    </div>
  )
}


function AuthPage({ onLogin }) {
  const [isLogin, setIsLogin] = useState(true)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [nickname, setNickname] = useState('')
  const [passwordVisible, setPasswordVisible] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!username.trim() || !password || loading) return
    if (!isLogin && password.length < 8) {
      setError('密码至少需要 8 位。')
      return
    }
    setError(''); setLoading(true)
    try {
      const res = await fetch(`${API}${isLogin ? '/auth/login' : '/auth/register'}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(isLogin ? { username: username.trim(), password } : { username: username.trim(), password, nickname: nickname.trim() }),
      })
      const data = await res.json()
      if (data.ok) {
        onLogin(data.data.user)
      } else setError(data.error || (isLogin ? '用户名或密码不正确，请重新输入。' : '账号创建失败，请检查后重试。'))
    } catch { setError('网络错误，请确保后端服务已启动') }
    setLoading(false)
  }

  const switchMode = nextIsLogin => {
    setIsLogin(nextIsLogin)
    setError('')
    setPasswordVisible(false)
  }

  return (
    <div className="auth-page">
      <main className="auth-page__shell">
        <span className="auth-page__glyph" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none"><rect x="3.5" y="5" width="11" height="9" rx="3" stroke="currentColor" strokeWidth="1.8"/><path d="M9.5 16.5 12.6 19" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/><rect x="12.5" y="9" width="8" height="8" rx="3.5" stroke="currentColor" strokeWidth="1.8"/><path d="M16.5 19 18.7 21" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>
        </span>

        <section className="auth-page__brand" aria-labelledby="auth-platform-title">
          <span className="auth-page__brand-mark" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none"><rect x="3.5" y="5" width="11" height="9" rx="3" stroke="currentColor" strokeWidth="1.8"/><path d="M9.5 16.5 12.6 19" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/><rect x="12.5" y="9" width="8" height="8" rx="3.5" stroke="currentColor" strokeWidth="1.8"/><path d="M16.5 19 18.7 21" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>
          </span>
          <h1 id="auth-platform-title">讯飞翻译机 · 售后服务平台</h1>
          <p className="auth-page__lead">为商家和顾客提供产品资料、智能问答与操作视频支持。</p>
          <ul className="auth-page__features">
            <li>
              <span className="auth-page__feature-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path d="M6 6.5A2.5 2.5 0 0 1 8.5 4h7A2.5 2.5 0 0 1 18 6.5v6a2.5 2.5 0 0 1-2.5 2.5h-5l-3.8 3.2V6.5Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"/><path d="M8.5 9.5h7M8.5 12.5h4.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg></span>
              <div><strong>产品专属售后问答</strong><p>针对不同翻译机型号提供相应的使用与售后说明</p></div>
            </li>
            <li>
              <span className="auth-page__feature-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><rect x="5" y="3.5" width="14" height="17" rx="2.5" stroke="currentColor" strokeWidth="1.6"/><path d="M8.5 8.5h7M8.5 12h7M8.5 15.5h4.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg></span>
              <div><strong>资料与来源支持</strong><p>回答附有资料出处，重要信息可以查证和追溯</p></div>
            </li>
            <li>
              <span className="auth-page__feature-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.6"/><path d="M10 8.8v6.4l5.2-3.2z" fill="currentColor"/></svg></span>
              <div><strong>操作视频与人工引导</strong><p>配套教学视频，必要时引导联系人工客服</p></div>
            </li>
          </ul>
        </section>

        <section className="auth-page__card" aria-label={isLogin ? '账号登录' : '创建账号'}>
          <div className="auth-page__mobile-brand">
            <span className="auth-page__brand-mark" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none"><rect x="3.5" y="5" width="11" height="9" rx="3" stroke="currentColor" strokeWidth="1.8"/><path d="M9.5 16.5 12.6 19" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/><rect x="12.5" y="9" width="8" height="8" rx="3.5" stroke="currentColor" strokeWidth="1.8"/><path d="M16.5 19 18.7 21" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>
            </span>
            <div><strong>讯飞翻译机 · 售后服务平台</strong><p>产品资料、智能问答与操作视频支持</p></div>
          </div>

          <h2>欢迎使用</h2>
          <p className="auth-page__card-subtitle">登录后进入你的售后服务空间</p>

          <div className="auth-page__tabs" role="tablist" aria-label="登录或注册">
            <button type="button" role="tab" aria-selected={isLogin} onClick={() => switchMode(true)}>登录</button>
            <button type="button" role="tab" aria-selected={!isLogin} onClick={() => switchMode(false)}>注册</button>
          </div>

          <form className="auth-page__form" onSubmit={handleSubmit} noValidate>
            <div className="auth-page__field">
              <label htmlFor="auth-username">用户名</label>
              <input id="auth-username" type="text" autoComplete="username" placeholder="请输入用户名" value={username} onChange={event => setUsername(event.target.value)} disabled={loading} required />
            </div>

            <div className="auth-page__field">
              <label htmlFor="auth-password">密码</label>
              <div className="auth-page__password-wrap">
                <input id="auth-password" type={passwordVisible ? 'text' : 'password'} autoComplete={isLogin ? 'current-password' : 'new-password'} placeholder="请输入密码" value={password} onChange={event => setPassword(event.target.value)} maxLength={128} disabled={loading} required />
                <button type="button" className="auth-page__password-toggle" aria-label={passwordVisible ? '隐藏密码' : '显示密码'} aria-pressed={passwordVisible} onClick={() => setPasswordVisible(value => !value)} disabled={loading}>
                  {passwordVisible
                    ? <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 5l16 14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/><path d="M9.6 7.2A8.6 8.6 0 0 1 12 6.8c5.5 0 9 5.2 9 5.2a14.3 14.3 0 0 1-3 3.4M7.2 8.6A14 14 0 0 0 3 12s3.5 5.2 9 5.2a8.7 8.7 0 0 0 3-.6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>
                    : <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M3 12s3.5-5.5 9-5.5 9 5.5 9 5.5-3.5 5.5-9 5.5S3 12 3 12Z" stroke="currentColor" strokeWidth="1.6"/><circle cx="12" cy="12" r="2.6" stroke="currentColor" strokeWidth="1.6"/></svg>}
                </button>
              </div>
              {!isLogin && <p className="auth-page__field-hint">密码至少 8 位</p>}
            </div>

            {!isLogin && <div className="auth-page__field">
              <label htmlFor="auth-nickname">昵称（可选）</label>
              <input id="auth-nickname" type="text" autoComplete="nickname" placeholder="请输入昵称" value={nickname} onChange={event => setNickname(event.target.value)} disabled={loading} />
            </div>}

            <div className={`auth-page__message${error ? ' auth-page__message--error' : ''}`} role="alert" aria-live="assertive">
              {error && <><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.6"/><path d="M12 8v4.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/><circle cx="12" cy="16" r="1.1" fill="currentColor"/></svg><span>{error}</span></>}
            </div>

            <button type="submit" className="auth-page__submit" disabled={loading || !username.trim() || !password}>
              {loading && <span className="auth-page__spinner" aria-hidden="true" />}
              {loading ? (isLogin ? '正在登录…' : '正在创建账号…') : (isLogin ? '登录' : '创建账号')}
            </button>
          </form>
        </section>
      </main>
      <p className="auth-page__footer">账号权限由系统自动识别</p>
    </div>
  )
}

export default function App() {
  const supportRouteIntent = window.location.pathname === '/support' || window.location.pathname.startsWith('/support/')
  const supportChannelCode = getSupportChannelCode(window.location)
  const supportMode = supportRouteIntent
  const [user, setUser] = useState(null)
  const [authLoading, setAuthLoading] = useState(!supportMode)
  const [activeTab, setActiveTab] = useState('start')

  const [documents, setDocuments] = useState([])
  const [selectedDoc, setSelectedDoc] = useState(null)
  const [uploadedFile, setUploadedFile] = useState(null)
  const [uploadLoading, setUploadLoading] = useState(false)
  const [uploadStatus, setUploadStatus] = useState([])
  const [ragQuestion, setRagQuestion] = useState('')
  const [lastAskedQuestion, setLastAskedQuestion] = useState('')
  const [ragAnswer, setRagAnswer] = useState('')
  const [ragAnswerBlocks, setRagAnswerBlocks] = useState([])
  const [ragTrust, setRagTrust] = useState(null)
  const [ragTraceId, setRagTraceId] = useState(null)
  const [ragSources, setRagSources] = useState([])
  const [selectedEvidenceId, setSelectedEvidenceId] = useState(null)
  const [answerFeedbackOutcome, setAnswerFeedbackOutcome] = useState(null)
  const [answerFeedbackLoading, setAnswerFeedbackLoading] = useState(false)
  const [feedbackSummary, setFeedbackSummary] = useState([])
  const [feedbackSummaryLoading, setFeedbackSummaryLoading] = useState(false)
  const [feedbackSummaryError, setFeedbackSummaryError] = useState('')
  const [feedbackSummaryRefresh, setFeedbackSummaryRefresh] = useState(0)
  const [ragLoading, setRagLoading] = useState(false)
  const [ragHistory, setRagHistory] = useState([])
  const [queryEnhancement, setQueryEnhancement] = useState(null)
  const [ragMode, setRagMode] = useState('auto')
  const [ragReflection, setRagReflection] = useState(false)
  const [ragMeta, setRagMeta] = useState(null)
  const [llmAvailable, setLlmAvailable] = useState(false)
  // 流式深度思考状态
  const [ragThinking, setRagThinking] = useState([])        // 思考步骤列表
  const [ragThinkingExpanded, setRagThinkingExpanded] = useState(true)  // 思考面板折叠
  const [ragStreamingDone, setRagStreamingDone] = useState(false)  // 流式是否完成
  const [ragThinkStart, setRagThinkStart] = useState(0)      // 思考开始时间
  const [ragThinkElapsed, setRagThinkElapsed] = useState(0)  // 思考耗时（完成后定格，避免重渲染时 Date.now() 持续累加）
  const [ragAnswerTarget, setRagAnswerTarget] = useState('')  // 打字机目标文本
  const [ragAnswerDisplay, setRagAnswerDisplay] = useState('')// 打字机当前显示文本
  const [showMdPreview, setShowMdPreview] = useState(false)
  const [mdContent, setMdContent] = useState('')
  const [stats, setStats] = useState({ translationCount: 0, ragCount: 0, docCount: 0, charCount: 0 })
  const [recommendedVideos, setRecommendedVideos] = useState([])
  const [recommendedSops, setRecommendedSops] = useState([])
  const [videoGuidance, setVideoGuidance] = useState(null)
  const [activeGuidanceIndex, setActiveGuidanceIndex] = useState(0)
  const [ragQaId, setRagQaId] = useState(null)
  const [resolvedVideoIds, setResolvedVideoIds] = useState(() => new Set())
  const [resolvingVideoId, setResolvingVideoId] = useState(null)
  const [playingVideo, setPlayingVideo] = useState(null)  // 当前正在播放的视频（弹窗播放器）
  const [videoLoadError, setVideoLoadError] = useState(false)  // 视频加载失败标记
  const [supportChannel, setSupportChannel] = useState(null)
  const [supportChannelLoading, setSupportChannelLoading] = useState(Boolean(supportChannelCode))
  const [supportChannelError, setSupportChannelError] = useState('')
  const [products, setProducts] = useState([])
  const [productLine, setProductLine] = useState('')
  const [productKey, setProductKey] = useState('')
  const fileInputRef = useRef(null)
  // 对话记忆 sessionId（每次进入 RAG 页面生成一个，清除记忆时重新生成）
  const sessionIdRef = useRef('rag-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6))

  const isAdminUser = user?.role === 'admin'
  const isCustomerExperience = supportMode || !isAdminUser
  const canUseAdminRagControls = isAdminUser && !supportMode
  const manualProduct = selectedProduct(products, productKey)
  const ragScopePayload = supportMode
    ? { supportChannelCode }
    : manualProduct
      ? { productKey: manualProduct.productKey }
      : {}
  const hasRequiredProduct = canUseAdminRagControls || Boolean(supportChannel || manualProduct)
  const tabs = supportMode || !isAdminUser
    ? [{ key: 'rag', label: '智能问答', icon: '🤖' }]
    : [
        { key: 'start', label: '资料管理', icon: '📚' },
        { key: 'rag', label: '智能问答', icon: '🤖' },
        { key: 'video-studio', label: '视频工坊', icon: '🎬' },
        { key: 'stats', label: '使用统计', icon: '📊' },
      ]

  useEffect(() => {
    // 清理旧版本遗留的可被脚本读取的认证信息；新版本只使用 HttpOnly Cookie。
    localStorage.removeItem('token')
    localStorage.removeItem('user')
    if (supportMode) {
      setAuthLoading(false)
      return undefined
    }
    let active = true
    fetch(`${API}/auth/me`)
      .then(r => r.json())
      .then(data => { if (active && data.ok) setUser(data.data) })
      .catch(() => {})
      .finally(() => { if (active) setAuthLoading(false) })
    return () => { active = false }
  }, [supportMode])

  useEffect(() => {
    if (!supportMode) return undefined
    if (!supportChannelCode) {
      setSupportChannelLoading(false)
      setSupportChannelError('商品二维码格式无效，请重新扫描')
      setSupportChannel(null)
      return undefined
    }
    let active = true
    setSupportChannelLoading(true)
    setSupportChannelError('')
    setSupportChannel(null)
    fetch(`${API}/support-channels/resolve/${encodeURIComponent(supportChannelCode)}`)
      .then(async response => {
        const data = await response.json()
        if (!response.ok || !data.ok || !data.data) throw new Error(data.error || '该产品支持入口暂不可用')
        if (active) {
          setSupportChannel(data.data)
          setActiveTab('rag')
        }
      })
      .catch(error => {
        if (active) setSupportChannelError(error.message || '该产品支持入口暂不可用')
      })
      .finally(() => { if (active) setSupportChannelLoading(false) })
    return () => { active = false }
  }, [supportMode, supportChannelCode])

  useEffect(() => {
    if (supportMode && supportChannel) setActiveTab('rag')
  }, [supportMode, supportChannel])

  useEffect(() => {
    if (user && user.role !== 'admin') setActiveTab('rag')
  }, [user])

  useEffect(() => {
    if (activeTab !== 'stats' || !isAdminUser) return undefined
    let active = true
    setFeedbackSummaryLoading(true)
    setFeedbackSummaryError('')
    fetch(`${API}/rag/feedback-summary?limit=50`)
      .then(async response => {
        const data = await response.json()
        if (!response.ok || !data.ok) throw new Error(data.error || '读取顾客反馈失败')
        if (active) setFeedbackSummary(Array.isArray(data.data) ? data.data : [])
      })
      .catch(error => { if (active) setFeedbackSummaryError(error.message || '读取顾客反馈失败') })
      .finally(() => { if (active) setFeedbackSummaryLoading(false) })
    return () => { active = false }
  }, [activeTab, isAdminUser, feedbackSummaryRefresh])

  useEffect(() => {
    if (user) { loadDocuments(); loadProducts(); loadStats(); checkLlmStatus() }
    // 登录身份变化才重新加载；这些加载函数不持有需要追踪的渲染状态。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user])

  const checkLlmStatus = async () => {
    try {
      const r = await fetch(`${API}/health`)
      const d = await r.json()
      setLlmAvailable(d.llm?.available || d.agentEnabled || false)
    } catch { setLlmAvailable(false) }
  }

  const apiHeaders = () => ({
    'Content-Type': 'application/json',
    ...(supportMode && supportChannelCode ? { 'X-Support-Channel': supportChannelCode } : {})
  })
  const supportApiFetch = async (path, options) => {
    let response = await fetch(path, options)
    if (!supportMode || response.status !== 401 || !supportChannelCode || String(path).includes('/support-channels/resolve/')) {
      return response
    }

    // 顾客可能把扫码页在微信里保留很久。匿名会话到期时重新解析同一条
    // 有效渠道，换取新的 HttpOnly Cookie，再安全地重试一次原请求。
    const renewed = await fetch(`${API}/support-channels/resolve/${encodeURIComponent(supportChannelCode)}`, {
      cache: 'no-store'
    })
    const renewedData = await renewed.json().catch(() => null)
    if (!renewed.ok || !renewedData?.ok || !renewedData.data) return response
    setSupportChannel(renewedData.data)
    response = await fetch(path, options)
    return response
  }

  const resetRagResult = () => {
    setRagAnswer(''); setRagAnswerTarget(''); setRagAnswerDisplay(''); setRagAnswerBlocks([]); setRagTrust(null); setRagTraceId(null); setRagSources([])
    setQueryEnhancement(null); setRagMeta(null); setRecommendedVideos([]); setRecommendedSops([])
    setVideoGuidance(null); setActiveGuidanceIndex(0)
    setRagQaId(null); setSelectedEvidenceId(null); setAnswerFeedbackOutcome(null); setAnswerFeedbackLoading(false); setResolvedVideoIds(new Set()); setResolvingVideoId(null)
  }

  const resetProductConversation = () => {
    resetRagResult()
    setLastAskedQuestion('')
    setRagThinking([])
    setRagStreamingDone(false)
    sessionIdRef.current = 'rag-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
  }

  const handleProductLineChange = nextProductLine => {
    setProductLine(nextProductLine)
    setProductKey('')
    resetProductConversation()
  }

  const handleProductKeyChange = nextProductKey => {
    setProductKey(nextProductKey)
    resetProductConversation()
  }

  const guidanceVideos = useMemo(() => {
    if (!videoGuidance?.primaryVideo) return recommendedVideos
    return [videoGuidance.primaryVideo, ...(videoGuidance.fallbackVideos || [])]
  }, [videoGuidance, recommendedVideos])

  const activeGuidanceVideo = guidanceVideos[activeGuidanceIndex] || guidanceVideos[0] || null
  const handleTryNextVideo = () => {
    if (activeGuidanceIndex < guidanceVideos.length - 1) setActiveGuidanceIndex(index => index + 1)
  }

  const handleVideoResolve = async (video) => {
    if (resolvedVideoIds.has(video.id) || resolvingVideoId === video.id) return
    setResolvingVideoId(video.id)
    try {
      const response = await supportApiFetch(`${API}/video/${video.id}/resolve`, {
        method: 'POST',
        headers: apiHeaders(),
        body: JSON.stringify({ qaId: ragQaId })
      })
      const data = await response.json()
      if (!data.ok) throw new Error(data.error || '提交反馈失败')

      setResolvedVideoIds(previous => new Set([...previous, video.id]))
      if (data.counted) {
        const updateResolveCount = item => Number(item.id) === Number(video.id)
          ? { ...item, resolve_count: Number(item.resolve_count || 0) + 1 }
          : item
        setRecommendedVideos(previous => previous.map(updateResolveCount))
        setPlayingVideo(previous => previous ? updateResolveCount(previous) : previous)
      }
    } catch (error) {
      alert(`反馈提交失败：${error.message}`)
    } finally {
      setResolvingVideoId(null)
    }
  }

  const handleEvidenceSelect = (evidenceId) => {
    setSelectedEvidenceId(evidenceId)
    const sourceElement = document.getElementById(`rag-source-${evidenceId}`)
    sourceElement?.closest('details')?.setAttribute('open', '')
    requestAnimationFrame(() => sourceElement?.scrollIntoView({ behavior: 'smooth', block: 'center' }))
  }

  const handleAnswerFeedback = async (outcome) => {
    if (!ragTraceId || answerFeedbackLoading) return
    setAnswerFeedbackLoading(true)
    try {
      const response = await supportApiFetch(`${API}/rag/feedback`, {
        method: 'POST',
        headers: apiHeaders(),
        body: JSON.stringify({ traceId: ragTraceId, outcome, reasonCode: outcome === 'unsolved' ? 'unspecified' : '' })
      })
      const data = await response.json()
      if (!data.ok) throw new Error(data.error || '提交反馈失败')
      setAnswerFeedbackOutcome(data.data.outcome)
    } catch (error) {
      alert(`反馈提交失败：${error.message}`)
    } finally {
      setAnswerFeedbackLoading(false)
    }
  }

  const applyTrustedRagFinal = (data) => {
    if (data.traceId) setRagTraceId(data.traceId)
    if (data.trust) setRagTrust(data.trust)
    if (data.answerBlocks) setRagAnswerBlocks(normalizeAnswerBlocks(data.answerBlocks, data.answer || ''))
    if (data.sources) setRagSources(data.sources)
  }

  const loadDocuments = async () => {
    try {
      const r = await fetch(`${API}/documents/list`, { headers: apiHeaders() })
      const d = await r.json()
      if (d.ok) setDocuments(d.data)
    } catch {}
  }

  const loadProducts = async () => {
    try {
      const response = await fetch(`${API}/support-channels/products`, { headers: apiHeaders() })
      const data = await response.json()
      setProducts(data.ok && Array.isArray(data.data) ? data.data : [])
    } catch {
      setProducts([])
    }
  }

  // 自动选择第一个已就绪的文档
  useEffect(() => {
    if (documents.length > 0 && !selectedDoc) {
      const ready = documents.find(doc => doc.status === 1)
      if (ready) handleSelectDoc(ready)
    }
    // 仅由文档列表变化触发自动选择，避免选择动作自身造成重复请求。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documents])

  useEffect(() => {
    if (!shouldPollDocumentJobs(documents)) return undefined
    const timer = setInterval(() => {
      loadDocuments()
      loadStats()
    }, 2000)
    return () => clearInterval(timer)
    // 轮询生命周期由服务端返回的文档任务状态决定。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documents])

  // 打字机效果：逐字显示 answer
  useEffect(() => {
    if (!ragAnswerTarget) { setRagAnswerDisplay(''); return }
    let idx = 0
    const timer = setInterval(() => {
      idx++
      setRagAnswerDisplay(ragAnswerTarget.slice(0, idx))
      if (idx >= ragAnswerTarget.length) clearInterval(timer)
    }, 20) // 每 20ms 一个字
    return () => clearInterval(timer)
  }, [ragAnswerTarget])

  // 思考完成时定格耗时：只在 ragStreamingDone 变为 true 时计算一次，
  // 避免后续打字机重渲染反复读取 Date.now() 导致计时器一直走
  useEffect(() => {
    if (ragStreamingDone && ragThinkStart) {
      setRagThinkElapsed(((Date.now() - ragThinkStart) / 1000).toFixed(1))
    }
  }, [ragStreamingDone, ragThinkStart])

  // 完成时默认保留思考过程，用户仍可在完成后手动折叠。
  useEffect(() => {
    if (ragStreamingDone && ragThinking.length > 0) setRagThinkingExpanded(true)
  }, [ragStreamingDone, ragThinking.length])

  const loadStats = async () => { try { const r = await fetch(`${API}/rag/stats`, { headers: apiHeaders() }); const d = await r.json(); if (d.ok) setStats(prev => ({ ...prev, ragCount: d.data?.total || 0 })) } catch {} }
  const loadRagHistory = async () => { try { const r = await fetch(selectedDoc ? `${API}/rag/history?documentId=${selectedDoc.id}` : `${API}/rag/history`, { headers: apiHeaders() }); const d = await r.json(); if (d.ok) setRagHistory(d.data) } catch {} }



  const handleFileChange = (e) => { const f = e.target.files?.[0]; if (f) { setUploadedFile(f); setMdContent(''); setShowMdPreview(false) } }

  const handleLoadFile = async () => {
    if (!uploadedFile) return; setUploadLoading(true); setUploadStatus(['正在上传文件...'])
    const fd = new FormData(); fd.append('file', uploadedFile)
    try {
      const r = await fetch(`${API}/documents/upload`, { method: 'POST', body: fd })
      const d = await r.json()
      if (d.ok) {
        const queuedText = d.data.duplicated
          ? '检测到相同文件，已复用已有文档任务'
          : d.data.job?.queueAvailable === false
            ? '任务已保存，队列暂不可用，系统会自动恢复'
            : d.data.statusName === 'queued'
              ? '已入队，等待后台解析'
              : `任务状态：${d.data.statusName || '已创建'}`
        setUploadStatus([`文件上传成功：${uploadedFile.name}`, `文件类型：${String(d.data.type || '').toUpperCase()}`, queuedText])
        if (uploadedFile.name.toLowerCase().endsWith('.md')) { const reader = new FileReader(); reader.onload = e => { setMdContent(e.target.result); setShowMdPreview(true) }; reader.readAsText(uploadedFile) }
        await loadDocuments(); await loadStats()
      } else setUploadStatus(p => [...p, `上传失败: ${d.error}`])
    } catch { setUploadStatus(p => [...p, '网络错误']) }
    setUploadLoading(false)
  }

  const handleSelectDoc = async (doc) => {
    setSelectedDoc(doc); setRagAnswer(''); setRagSources([])
    try { const r = await fetch(`${API}/documents/${doc.id}`, { headers: apiHeaders() }); const d = await r.json(); if (d.ok && d.data.content) { setMdContent(d.data.content); setShowMdPreview(true) } } catch {}
  }

  const handleDeleteDoc = async (e, docId) => {
    e.stopPropagation()
    if (!window.confirm('确定要删除该文档吗？')) return
    try {
      const r = await fetch(`${API}/documents/${docId}`, { method: 'DELETE', headers: apiHeaders() })
      const d = await r.json()
      if (d.ok) {
        if (selectedDoc?.id === docId) { setSelectedDoc(null); setMdContent('') }
        loadDocuments(); loadStats()
      } else setUploadStatus([`删除失败：${d.error || '请稍后重试'}`])
    } catch {}
  }

  const handleReparseDoc = async (e, docId) => {
    e.stopPropagation()
    if (!window.confirm('确定要重新解析该文档吗？')) return
    try {
      const r = await fetch(`${API}/documents/${docId}/reparse`, { method: 'POST', headers: apiHeaders() })
      const d = await r.json()
      if (d.ok) {
        setUploadStatus(['已创建重新解析任务，正在等待后台处理'])
        await loadDocuments()
      } else {
        setUploadStatus([`重新解析失败：${d.error || '请稍后重试'}`])
      }
    } catch { setUploadStatus(['网络错误，请稍后重试']) }
  }

  const handleRetryDoc = async (e, docId) => {
    e.stopPropagation()
    if (!window.confirm('确定要重新提交此文档吗？')) return
    try {
      const r = await fetch(`${API}/documents/${docId}/retry`, { method: 'POST', headers: apiHeaders() })
      const d = await r.json()
      if (d.ok) {
        setUploadStatus(['已创建重试任务，正在等待后台处理'])
        await loadDocuments()
      } else setUploadStatus([`重试失败：${d.error || '请稍后重试'}`])
    } catch { setUploadStatus(['网络错误，请稍后重试']) }
  }

  const handleCancelDoc = async (e, docId) => {
    e.stopPropagation()
    if (!window.confirm('确定要取消此文档处理任务吗？')) return
    try {
      const r = await fetch(`${API}/documents/${docId}/cancel`, { method: 'POST', headers: apiHeaders() })
      const d = await r.json()
      if (d.ok) {
        setUploadStatus([d.data.pending ? '已请求取消，Worker 会在安全边界停止任务' : '文档任务已取消'])
        await loadDocuments()
      } else setUploadStatus([`取消失败：${d.error || '请稍后重试'}`])
    } catch { setUploadStatus(['网络错误，请稍后重试']) }
  }

  // SSE 流式深度思考（ReAct / Plan-Solve）
  const handleRagAskStream = async () => {
    if (!canUseAdminRagControls || !ragQuestion.trim()) return
    setRagLoading(true); resetRagResult()
    setRagThinking([]); setRagThinkingExpanded(true); setRagStreamingDone(false)
    setRagThinkStart(Date.now())

    const controller = new AbortController()
    try {
      const r = await fetch(`${API}/rag/ask-stream`, {
        method: 'POST',
        headers: apiHeaders(),
        body: JSON.stringify({
          question: ragQuestion.trim(),
          mode: ragMode,
          sessionId: sessionIdRef.current,
          ...ragScopePayload
        }),
        signal: controller.signal
      })
      if (!r.ok) {
        const err = await r.json().catch(() => ({ error: `HTTP ${r.status}` }))
        throw new Error(err.error || `HTTP ${r.status}`)
      }

      const reader = r.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })

        // 解析 SSE 事件
        const lines = buf.split('\n')
        buf = lines.pop() // 保留不完整的最后一行
        let eventType = ''
        for (const line of lines) {
          if (line.startsWith('event: ')) {
            eventType = line.slice(7).trim()
          } else if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6))
              if (eventType === 'answer') {
                setRagAnswer(data.answer)
                setRagAnswerTarget(data.answer)
                setRagMeta(prev => ({ ...prev, answerSource: data.answerSource }))
                if (data.trust) setRagTrust(data.trust)
              } else if (eventType === 'route') {
                // 路由智能体决策结果
                setRagMeta(prev => ({ ...prev, router: data }))
              } else if (eventType === 'done') {
                setRagMeta(prev => ({ ...prev, agent: data.agent, router: data.router || prev?.router, memory: data.memory || prev?.memory }))
                if (data.qaId) setRagQaId(data.qaId)
                applyTrustedRagFinal(data)
                if (data.queryEnhancement) setQueryEnhancement(data.queryEnhancement)
                if (data.recommendedVideos) setRecommendedVideos(data.recommendedVideos)
                if (data.recommendedSops) setRecommendedSops(data.recommendedSops)
                if (data.videoGuidance) setVideoGuidance(data.videoGuidance)
                setRagStreamingDone(true)
              } else if (eventType === 'error') {
                const errMsg = '深度思考失败：' + (data.message || '')
                setRagAnswer(errMsg)
                setRagAnswerTarget(errMsg)
              } else if (eventType === 'token') {
                // 流式 token：追加到当前 reasoning 步骤的 rawContent
                setRagThinking(prev => {
                  const rev = [...prev].reverse()
                  const idx = rev.findIndex(s => s.type === 'reasoning')
                  if (idx === -1) {
                    return [...prev, { type: 'reasoning', round: data.round, rawContent: data.token, thought: '', action: '' }]
                  }
                  const realIdx = prev.length - 1 - idx
                  return prev.map((s, i) =>
                    i === realIdx ? { ...s, rawContent: (s.rawContent || '') + data.token } : s
                  )
                })
              } else if (eventType === 'reasoning') {
                // 完整 reasoning：补充 thought/action 元信息
                setRagThinking(prev => {
                  const rev = [...prev].reverse()
                  const idx = rev.findIndex(s => s.type === 'reasoning')
                  if (idx === -1) {
                    return [...prev, { ...data, ts: Date.now() }]
                  }
                  const realIdx = prev.length - 1 - idx
                  return prev.map((s, i) =>
                    i === realIdx ? { ...s, thought: data.thought || '', action: data.action || '', rawContent: data.rawContent || s.rawContent } : s
                  )
                })
              } else {
                // 思考过程事件：status / search / plan
                setRagThinking(prev => [...prev, { ...data, ts: Date.now() }])
              }
            } catch { /* 忽略解析错误 */ }
            eventType = ''
          }
        }
      }
      // 流结束后，处理 buf 中可能残留的末行
      if (buf.trim()) {
        const lastLines = buf.split('\n')
        let eventType = ''
        for (const line of lastLines) {
          if (line.startsWith('event: ')) {
            eventType = line.slice(7).trim()
          } else if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6))
              if (eventType === 'done') {
                setRagMeta(prev => ({ ...prev, agent: data.agent, router: data.router || prev?.router }))
                if (data.qaId) setRagQaId(data.qaId)
                applyTrustedRagFinal(data)
                if (data.queryEnhancement) setQueryEnhancement(data.queryEnhancement)
                if (data.recommendedVideos) setRecommendedVideos(data.recommendedVideos)
                if (data.recommendedSops) setRecommendedSops(data.recommendedSops)
                if (data.videoGuidance) setVideoGuidance(data.videoGuidance)
                setRagStreamingDone(true)
              } else if (eventType === 'answer') {
                setRagAnswer(data.answer)
                setRagAnswerTarget(data.answer)
                if (data.trust) setRagTrust(data.trust)
              }
            } catch {}
            eventType = ''
          }
        }
      }
    } catch (err) {
      if (err.name !== 'AbortError') setRagAnswer('深度思考失败：' + err.message)
    }
    setRagLoading(false)
    loadRagHistory(); loadStats()
  }

  // SSE 多工具智能体
  const handleRagAskAgent = async () => {
    if (!canUseAdminRagControls || !ragQuestion.trim()) return
    setRagLoading(true); resetRagResult()
    setRagThinking([]); setRagThinkingExpanded(true); setRagStreamingDone(false)
    setRagThinkStart(Date.now())

    try {
      const r = await fetch(`${API}/rag/ask-agent`, {
        method: 'POST',
        headers: apiHeaders(),
        body: JSON.stringify({
          question: ragQuestion.trim(),
          sessionId: sessionIdRef.current,
          ...ragScopePayload
        })
      })
      if (!r.ok) {
        const err = await r.json().catch(() => ({ error: `HTTP ${r.status}` }))
        throw new Error(err.error || `HTTP ${r.status}`)
      }

      const reader = r.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const lines = buf.split('\n')
        buf = lines.pop()
        let eventType = ''
        for (const line of lines) {
          if (line.startsWith('event: ')) {
            eventType = line.slice(7).trim()
          } else if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6))
              if (eventType === 'answer') {
                setRagAnswer(data.answer)
                setRagAnswerTarget(data.answer)
                setRagMeta(prev => ({ ...prev, answerSource: data.answerSource }))
                if (data.trust) setRagTrust(data.trust)
              } else if (eventType === 'done') {
                setRagMeta(prev => ({ ...prev, agent: data.agent }))
                if (data.qaId) setRagQaId(data.qaId)
                applyTrustedRagFinal(data)
                if (data.recommendedVideos) setRecommendedVideos(data.recommendedVideos)
                if (data.recommendedSops) setRecommendedSops(data.recommendedSops)
                if (data.videoGuidance) setVideoGuidance(data.videoGuidance)
                setRagStreamingDone(true)
              } else if (eventType === 'error') {
                const errMsg = '智能体失败：' + (data.message || '')
                setRagAnswer(errMsg); setRagAnswerTarget(errMsg)
              } else {
                // status / tool_call / tool_result → 思考面板
                setRagThinking(prev => [...prev, { ...data, type: eventType, ts: Date.now() }])
              }
            } catch {}
            eventType = ''
          }
        }
      }
    } catch (err) {
      if (err.name !== 'AbortError') setRagAnswer('智能体失败：' + err.message)
    }
    setRagLoading(false)
    loadRagHistory(); loadStats()
  }

  const handleRagAsk = async () => {
    if (supportMode && !supportChannel) return
    if (!hasRequiredProduct) return
    // 只有显式深度推理模式走 SSE。auto 与顾客端共用 /rag/ask，
    // 让相同问题、产品范围和默认策略使用完全相同的召回与重排管线。
    if (canUseAdminRagControls && (ragMode === 'react' || ragMode === 'plan-solve')) {
      return handleRagAskStream()
    }
    // 多工具智能体走独立 SSE 端点
    if (canUseAdminRagControls && ragMode === 'tool-agent') {
      return handleRagAskAgent()
    }

    const question = ragQuestion.trim()
    if (!question) return
    setLastAskedQuestion(question)
    setRagLoading(true); resetRagResult(); setRagThinking([]); setRagStreamingDone(false)
    try {
      const body = {
        question,
        sessionId: sessionIdRef.current,
        ...ragScopePayload
      }
      if (canUseAdminRagControls) body.mode = ragMode
      if (canUseAdminRagControls && ragMode === 'reflection') {
        body.reflection = true
      }
      if (canUseAdminRagControls && ragReflection && ragMode !== 'reflection') body.reflection = true
      if (isCustomerExperience) setRagQuestion('')
      const r = await supportApiFetch(`${API}/rag/ask`, { method: 'POST', headers: apiHeaders(), body: JSON.stringify(body) })
      const d = await r.json()
      if (d.ok) {
        setRagAnswer(d.data.answer)
        setRagAnswerBlocks(normalizeAnswerBlocks(d.data.answerBlocks, d.data.answer))
        setRagTrust(d.data.trust || null)
        setRagTraceId(d.data.traceId || null)
        setRagSources(d.data.sources || [])
        setQueryEnhancement(d.data.queryEnhancement || null)
        setRagMeta({ agent: d.data.agent, router: d.data.router, memory: d.data.memory, reflection: d.data.reflection, answerSource: d.data.answerSource })
        setRecommendedVideos(d.data.recommendedVideos || [])
        setRecommendedSops(d.data.recommendedSops || [])
        setVideoGuidance(d.data.videoGuidance || null)
        setRagQaId(d.data.qaId || null)
        setRagStreamingDone(true)
        loadRagHistory(); loadStats()
      } else setRagAnswer('问答失败：' + d.error)
    } catch { setRagAnswer('网络错误') }
    setRagLoading(false)
  }

  const handleLogout = async () => {
    await fetch(`${API}/auth/logout`, { method: 'POST' }).catch(() => {})
    localStorage.removeItem('token')
    localStorage.removeItem('user')
    setUser(null)
    setActiveTab('start')
    setDocuments([])
    setProducts([])
    setProductLine('')
    setProductKey('')
    setSelectedDoc(null)
    setUploadedFile(null)
    setUploadStatus([])
    setMdContent('')
    setShowMdPreview(false)
    setRagQuestion('')
    setLastAskedQuestion('')
    setRagAnswer('')
    setRagAnswerTarget('')
    setRagAnswerDisplay('')
    setRagAnswerBlocks([])
    setRagTrust(null)
    setRagTraceId(null)
    setRagSources([])
    setRagHistory([])
    setRagThinking([])
    setQueryEnhancement(null)
    setRagMeta(null)
    setRecommendedVideos([])
    setRecommendedSops([])
    setVideoGuidance(null)
    setActiveGuidanceIndex(0)
    setRagQaId(null)
    setSelectedEvidenceId(null)
    setAnswerFeedbackOutcome(null)
    setAnswerFeedbackLoading(false)
    setResolvedVideoIds(new Set())
    setResolvingVideoId(null)
    setPlayingVideo(null)
    setStats({ translationCount: 0, ragCount: 0, docCount: 0, charCount: 0 })
    sessionIdRef.current = 'rag-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
  }

  const handleNewConversation = async () => {
    await fetch(`${API}/rag/clear-session`, {
      method: 'POST',
      headers: apiHeaders(),
      body: JSON.stringify({ sessionId: sessionIdRef.current })
    }).catch(() => {})
    sessionIdRef.current = 'rag-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
    setRagQuestion('')
    setLastAskedQuestion('')
    resetRagResult()
    setRagThinking([])
    setRagStreamingDone(false)
  }

  const mdHtml = useMemo(() => renderMarkdown(mdContent), [mdContent])

  if (authLoading) return <div className="auth-container"><div className="auth-card">正在检查登录状态...</div></div>
  if (!user && !supportMode) return <AuthPage onLogin={u => setUser(u)} />
  if (supportMode && (supportChannelLoading || supportChannelError || !supportChannel)) return (
    <div className="app-container">
      <SupportExperience channel={supportChannel} loading={supportChannelLoading} error={supportChannelError} />
    </div>
  )

  if (isCustomerExperience) {
    const hasCustomerResults = Boolean(ragAnswer || ragSources.length || activeGuidanceVideo || recommendedSops.length)
    const customerKnowledgeReady = supportMode ? Boolean(supportChannel) : documents.length > 0
    return (
      <CustomerQaPage
        user={user}
        supportMode={supportMode}
        supportChannel={supportChannel}
        products={products}
        productLine={productLine}
        productKey={productKey}
        selectedProduct={manualProduct}
        onProductLineChange={handleProductLineChange}
        onProductKeyChange={handleProductKeyChange}
        question={ragQuestion}
        onQuestionChange={setRagQuestion}
        onAsk={handleRagAsk}
        onNewConversation={handleNewConversation}
        onLogout={handleLogout}
        canAsk={Boolean(ragQuestion.trim() && customerKnowledgeReady && hasRequiredProduct && !ragLoading)}
        loading={ragLoading}
        lastQuestion={lastAskedQuestion}
        documentsReady={customerKnowledgeReady}
        hasResults={hasCustomerResults}
      >
        {hasCustomerResults && <div className="customer-results">
          {ragAnswer && <section className="customer-answer" aria-label="售后助手回答">
            <div className="customer-answer__heading">
              <span className="customer-assistant-mark" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none">
                  <rect x="3.5" y="5" width="11" height="9" rx="3" stroke="currentColor" strokeWidth="1.8" />
                  <path d="M9.5 16.5 12.6 19" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                  <rect x="12.5" y="9" width="8" height="8" rx="3.5" stroke="currentColor" strokeWidth="1.8" />
                  <path d="M16.5 19 18.7 21" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                </svg>
              </span>
              <h2>售后助手回答</h2>
            </div>
            <div className="rag-answer-box">
              {ragTrust && <div className={`trust-badge trust-badge--${trustBadge(ragTrust).tone}`}>
                <strong>{trustBadge(ragTrust).label}</strong>
                <span>{trustBadge(ragTrust).message}</span>
              </div>}
              {ragTrust?.level === 'refuse' && ragTrust.suggestions?.length > 0 && (
                <div className="trust-suggestions">建议：{ragTrust.suggestions.map((item, index) => <span key={item}>{index > 0 && '；'}{item}</span>)}</div>
              )}
              {ragAnswerBlocks.length > 0
                ? <TrustedAnswerReader blocks={ragAnswerBlocks} onEvidenceSelect={handleEvidenceSelect} />
                : <AnswerReader answer={ragAnswer} />}
              {ragTraceId && <div className="answer-feedback" aria-label="回答是否解决问题">
                <span>这个回答解决你的问题了吗？</span>
                <button type="button" aria-pressed={answerFeedbackOutcome === 'solved'} className={answerFeedbackOutcome === 'solved' ? 'selected' : ''} disabled={answerFeedbackLoading} onClick={() => handleAnswerFeedback('solved')}>已解决</button>
                <button type="button" aria-pressed={answerFeedbackOutcome === 'unsolved'} className={answerFeedbackOutcome === 'unsolved' ? 'selected' : ''} disabled={answerFeedbackLoading} onClick={() => handleAnswerFeedback('unsolved')}>未解决</button>
                {answerFeedbackLoading && <em role="status">正在提交反馈…</em>}
                {!answerFeedbackLoading && answerFeedbackOutcome && <em role="status" aria-live="polite">{answerFeedbackOutcome === 'solved' ? '已记录，感谢反馈。' : '已记录，管理员可在使用统计中查看。'}</em>}
              </div>}
            </div>
            <div className="customer-support-note">
              <strong>需要人工帮助？</strong>
              <p>若按回答操作后仍未解决，或设备存在进水、冒烟、起火等安全风险，请停止使用并联系人工客服。服务时间为 09:00—18:00。</p>
            </div>
          </section>}

          {ragSources.length > 0 && <details className="customer-sources">
            <summary>参考资料：{ragSources[0]?.docName || '售后知识库'}{ragSources.length > 1 ? ` 等 ${ragSources.length} 条` : ''}</summary>
            <div className="customer-source-list">
              {ragSources.map((source, index) => (
                <article
                  id={`rag-source-${source.evidenceId || index}`}
                  key={source.evidenceId || `${source.docName || 'source'}-${index}`}
                  className={`customer-source-item ${selectedEvidenceId === source.evidenceId ? 'customer-source-item--selected' : ''}`}
                >
                  <SourceExcerpt source={source} index={index} />
                </article>
              ))}
            </div>
          </details>}

          {activeGuidanceVideo && <section className="video-recommendations" aria-label="推荐操作视频">
            <div className="video-recommendations-heading">
              <div><span aria-hidden="true">🎬</span> 相关教学视频</div>
              <span>{videoGuidance?.diagnosis?.label ? `适用于：${videoGuidance.diagnosis.label}` : '根据当前问题推荐'}</span>
            </div>
            <div className="video-recommendation-grid video-guidance-grid">
              <VideoRecommendationCard
                key={activeGuidanceVideo.id}
                video={activeGuidanceVideo}
                onPlay={selectedVideo => { setVideoLoadError(false); setPlayingVideo(selectedVideo) }}
                onResolve={handleVideoResolve}
                onTryNext={handleTryNextVideo}
                hasNext={activeGuidanceIndex < guidanceVideos.length - 1}
                isResolving={resolvingVideoId === activeGuidanceVideo.id}
                isResolved={resolvedVideoIds.has(activeGuidanceVideo.id)}
              />
            </div>
          </section>}

          {recommendedSops.length > 0 && <section className="customer-sop-list" aria-label="相关操作指南">
            <h3>相关操作指南</h3>
            {recommendedSops.map(sop => <article key={sop.id}>
              <strong>{sop.title}</strong>
              <span>
                {sop.difficulty === 'easy' ? '简单' : sop.difficulty === 'medium' ? '中等' : '较复杂'}
                {sop.estimated_duration ? ` · 约 ${sop.estimated_duration} 秒` : ''}
                {sop.completion_check ? ` · 完成标志：${sop.completion_check}` : ''}
              </span>
            </article>)}
          </section>}
        </div>}

        {playingVideo && <VideoPlayerDialog video={playingVideo} loadError={videoLoadError} onError={() => setVideoLoadError(true)} onClose={() => setPlayingVideo(null)} />}
      </CustomerQaPage>
    )
  }

  return (
    <div className="app-container">
      <div className="app-header">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h1>科大讯飞翻译机智能助手</h1>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 14, color: '#666' }}>{user.nickname || user.username}</span>
            <button className="btn btn-outline btn-sm" onClick={handleLogout}>退出</button>
          </div>
        </div>
        {isAdminUser ? <div className="subtitle">科大讯飞硬件产品智能使用助手，支持：
          <ul><li>🤖 自然语言问答（多策略 RAG 检索）</li><li>🎬 操作视频推荐（精准定位步骤）</li><li>📋 SOP 操作指南</li><li>📄 文档管理（PDF/Word/TXT/MD）</li><li>📊 使用统计</li></ul>
        </div> : <div className="subtitle">选择你的翻译机型号，获取对应的使用说明、售后解答和操作指引。</div>}
      </div>

      {supportMode && <SupportExperience channel={supportChannel} loading={supportChannelLoading} error={supportChannelError} />}

      <div className="tab-bar">
        {tabs.map(tab => (<div key={tab.key} className={`tab-item ${activeTab === tab.key ? 'active' : ''}`} onClick={() => { setActiveTab(tab.key); if (tab.key === 'rag') loadRagHistory() }}>{tab.icon} {tab.label}</div>))}
      </div>

      {activeTab === 'start' && isAdminUser && (<>
        {documents.length > 0 && (
          <div className="card">
            <div className="card-title">📚 可用知识库（{documents.length}）</div>
            <div className="doc-list">
              {documents.map(doc => {
                const task = getDocumentJobPresentation(doc)
                return (
                  <div key={doc.id} className={`doc-list-item ${selectedDoc?.id === doc.id ? 'selected' : ''}`} onClick={() => handleSelectDoc(doc)}>
                    <span className="doc-icon">{doc.file_type === 'pdf' ? '📕' : doc.file_type === 'docx' ? '📘' : doc.file_type === 'md' ? '📝' : '📄'}</span>
                    <div className="doc-info-text">
                      <div className="doc-name">{doc.original_name}</div>
                      <div className={`doc-meta doc-meta--${task.tone}`} title={doc.job?.errorMessage || doc.error_message || ''}>
                        {doc.scope === 'public' ? '🌐' : '🔒'} {documentScopeLabel(doc)} · {(doc.file_size / 1024).toFixed(1)} KB · {doc.chunk_count || 0} 个语义块 · {task.text}{doc.mineru_task_id ? ' · 🔍MinerU' : ''}
                      </div>
                      {task.poll && <div className="document-job-progress" aria-label={`文档任务进度：${task.progress}%`} title={task.text}><span style={{ width: `${task.progress}%` }} /></div>}
                    </div>
                    {canManageDocument(doc) && <div className="document-job-actions">
                      {task.showCancel && <button className="doc-cancel-btn" onClick={(e) => handleCancelDoc(e, doc.id)} title="取消任务">⏹️</button>}
                      {task.showRetry && <button className="doc-reparse-btn" onClick={(e) => handleRetryDoc(e, doc.id)} title="重新提交">↻</button>}
                      {!task.poll && !task.showRetry && <button className="doc-reparse-btn" onClick={(e) => handleReparseDoc(e, doc.id)} title="重新解析">🔄</button>}
                      <button className="doc-delete-btn" onClick={(e) => handleDeleteDoc(e, doc.id)} title="删除文档">🗑️</button>
                    </div>}
                  </div>
                )
              })}
            </div>
          </div>
        )}

        <div className="card">
          <div className="card-title">📄 加载产品文档</div>
          <div className="upload-area" onClick={() => fileInputRef.current?.click()}><div className="upload-icon"></div><p>点击上传文档文件（PDF / Word / TXT / MD）</p>{uploadedFile && <div className="file-name"><span>{uploadedFile.name}</span><span style={{ color: '#999' }}>{(uploadedFile.size / 1024).toFixed(1)} KB</span></div>}</div>
          <input ref={fileInputRef} type="file" accept=".pdf,.doc,.docx,.txt,.md" style={{ display: 'none' }} onChange={handleFileChange} />
          <button className="btn btn-primary btn-full" onClick={handleLoadFile} disabled={!uploadedFile || uploadLoading}>{uploadLoading ? <><span className="spinner"></span> 上传中...</> : '上传文档'}</button>
          {uploadStatus.length > 0 && <div className="form-group" style={{ marginTop: 16 }}><label>上传状态</label><div className="status-box">{uploadStatus.map((s, i) => (<div key={i} className="status-item">{i === uploadStatus.length - 1 && uploadLoading ? <span className="spinner"></span> : <span className="check">✅</span>}<span>{s}</span></div>))}</div></div>}
          {mdContent && <div style={{ marginTop: 16 }}><div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}><label style={{ margin: 0 }}>Markdown 预览</label><button className="btn btn-outline btn-sm" onClick={() => setShowMdPreview(!showMdPreview)}>{showMdPreview ? '收起' : '展开'}</button></div>{showMdPreview && <div className="md-preview" dangerouslySetInnerHTML={{ __html: mdHtml }} />}</div>}
        </div>

        {user?.role === 'admin' && !supportMode && <SupportChannelManager apiFetch={supportApiFetch} publicAppUrl={window.location.origin} />}
      </>)}



      {activeTab === 'rag' && (<>
        <div className="card">
          <div className="card-title">🤖 RAG 智能问答</div>
          <div style={{ fontSize: 13, color: '#888', marginBottom: 16 }}>
            {isAdminUser ? (documents.length > 0
              ? <span style={{ color: '#52c41a' }}>📚 正在检索 {documents.length} 个可用文档（公共知识库 + 我的文档）</span>
              : <span style={{ color: '#fa8c16' }}>⚠️ 暂无可用知识库，请上传并完成解析</span>)
              : hasRequiredProduct
                ? <span style={{ color: '#52c41a' }}>已进入 {supportChannel?.productModel || manualProduct?.displayName} 专属问答</span>
                : <span style={{ color: '#fa8c16' }}>请选择你的翻译机型号</span>}
          </div>
          {!supportMode && <ProductSelector
            products={products}
            productLine={productLine}
            productKey={productKey}
            onProductLineChange={handleProductLineChange}
            onProductKeyChange={handleProductKeyChange}
          />}
          {supportMode && supportChannel && <ProductSelector
            products={[{
              productKey: supportChannel.productKey,
              productLine: supportChannel.productLine,
              productModel: supportChannel.productModel,
              displayName: supportChannel.productModel
            }]}
            productLine={supportChannel.productLine}
            productKey={supportChannel.productKey}
            locked
          />}
          {isAdminUser && !supportMode && !manualProduct && <p className="product-selector__hint">管理员未选择型号时，将使用全部现有资料进行测试。</p>}
          {isAdminUser && <div className="form-row" style={{ marginBottom: 12 }}>
            <div className="form-group">
              <label>检索策略 {!llmAvailable && <span style={{ color: '#ff4d4f', fontSize: 11 }}>（需配置 LLM）</span>}</label>
              <select value={ragMode} onChange={e => { setRagMode(e.target.value); setRagReflection(false) }}
                style={!llmAvailable && ragMode !== 'default' ? { borderColor: '#ff4d4f' } : {}}>
                <option value="auto">🧠 智能路由（自动选择最优策略）</option>
                <option value="default">默认（HyDE + 多查询融合）</option>
                <option value="react" disabled={!llmAvailable}>ReAct（多轮推理检索）{!llmAvailable ? ' — 未配置LLM' : ''}</option>
                <option value="plan-solve" disabled={!llmAvailable}>Plan-and-Solve（先分解再检索）{!llmAvailable ? ' — 未配置LLM' : ''}</option>
                <option value="reflection" disabled={!llmAvailable}>Reflection（反思优化）{!llmAvailable ? ' — 未配置LLM' : ''}</option>
                <option value="tool-agent" disabled={!llmAvailable}>🤖 多工具智能体（检索+视频+摘要）{!llmAvailable ? ' — 未配置LLM' : ''}</option>
              </select>
            </div>
            <div className="form-group" style={{ display: 'flex', alignItems: 'flex-end', paddingBottom: 2 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13 }}>
                <input type="checkbox" checked={ragReflection || ragMode === 'reflection'} onChange={e => setRagReflection(e.target.checked)} disabled={ragMode === 'reflection'} style={{ width: 16, height: 16 }} />
                答案反思优化
              </label>
            </div>
          </div>}
          {isAdminUser && ragMode !== 'default' && <div style={{ marginBottom: 12, padding: '8px 12px', background: '#fff7e6', borderRadius: 6, fontSize: 12, color: '#ad6800', lineHeight: 1.6 }}>
            {ragMode === 'auto' && '🧠 智能路由：AI 自动分析问题类型，选择最优检索策略（简单题→默认，推理题→ReAct，对比题→Plan-Solve）'}
            {ragMode === 'react' && '💡 ReAct 模式：AI 会多轮思考+检索，适合需要深度推理的复杂问题，耗时较长'}
            {ragMode === 'plan-solve' && '💡 Plan-and-Solve 模式：AI 先分解问题再并行检索，适合多角度查询'}
            {ragMode === 'reflection' && '💡 Reflection 模式：AI 生成回答后会自我审阅并优化，提升答案质量'}
            {ragMode === 'tool-agent' && '🤖 多工具智能体：AI 自主决定调用知识库检索、视频推荐、文档摘要等工具，适合复杂多步骤任务'}
          </div>}
          {!hasRequiredProduct && <p className="product-selector__warning">请先选择产品型号，再开始提问。</p>}
          <div className="form-group"><label>提问</label><textarea value={ragQuestion} onChange={e => setRagQuestion(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && ragQuestion.trim() && documents.length > 0 && hasRequiredProduct && !ragLoading) { e.preventDefault(); handleRagAsk() } }} placeholder="请输入您关于产品使用或售后的问题...（Enter 提交，Shift+Enter 换行）" rows={3} /></div>
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button className="btn btn-primary" style={{ flex: 1 }} onClick={handleRagAsk} disabled={!ragQuestion.trim() || documents.length === 0 || !hasRequiredProduct || ragLoading}>{ragLoading ? <><span className="spinner"></span> {isAdminUser ? '跨文档检索并生成回答中...' : '正在查找答案...'}</> : '提交问题'}</button>
            <button className="btn btn-outline btn-sm" style={{ minWidth: 90 }} onClick={async () => { await fetch(`${API}/rag/clear-session`, { method: 'POST', headers: apiHeaders(), body: JSON.stringify({ sessionId: sessionIdRef.current }) }).catch(() => {}); sessionIdRef.current = 'rag-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); setRagMeta(null); alert(isAdminUser ? '对话记忆已清除' : '已开始新对话') }}>{isAdminUser ? '🧹 清除记忆' : '新对话'}</button>
          </div>

          {/* DeepSeek 风格深度思考面板 */}
          {isAdminUser && (ragMode === 'react' || ragMode === 'plan-solve' || ragMode === 'auto' || ragMode === 'tool-agent') && ragThinking.length > 0 && (
            <div className="think-panel">
              <div className="think-header" onClick={() => setRagThinkingExpanded(!ragThinkingExpanded)}>
                <span className="think-icon">{ragStreamingDone ? '✅' : <span className="think-dot" />}</span>
                <span className="think-title">
                  {ragStreamingDone
                    ? `思考完成（${ragThinkElapsed}s）`
                    : '深度思考中...'}
                </span>
                <span className="think-arrow">{ragThinkingExpanded ? '▾' : '▸'}</span>
              </div>
              {ragThinkingExpanded && (
                <div className="think-body">
                  {ragThinking.map((step, i) => {
                    if (step.type === 'reasoning') {
                      const thoughtText = step.rawContent || step.thought || ''
                      return (
                        <div key={i} className="think-thought-block">
                          <div className="think-thought-text">{thoughtText}</div>
                        </div>
                      )
                    }
                    if (step.type === 'search') {
                      return (
                        <div key={i} className="think-search-inline">
                          <span className="think-search-icon">🔍</span>
                          <span className="think-search-label">已检索</span>
                          <span className="think-search-count">{step.count} 条相关内容</span>
                        </div>
                      )
                    }
                    if (step.type === 'status') {
                      return <div key={i} className="think-status-text">{step.text}</div>
                    }
                    if (step.type === 'plan') {
                      return (
                        <div key={i} className="think-plan-block">
                          <div className="think-plan-label">📋 分解为 {step.steps?.length || 0} 个子问题：</div>
                          {(step.steps || []).map((s, j) => (
                            <div key={j} className="think-plan-dot">· {s}</div>
                          ))}
                        </div>
                      )
                    }
                    if (step.type === 'tool_call') {
                      const toolNames = { search_knowledge_base: '🔍 知识库检索', search_videos: '🎬 视频检索', get_sop: '📋 SOP查询', summarize_topic: '📝 主题摘要', list_documents: '📂 文档列表' }
                      return (
                        <div key={i} className="think-search-inline">
                          <span className="think-search-icon">📤</span>
                          <span className="think-search-label">{toolNames[step.tool] || step.tool}</span>
                          {step.args?.query && <span className="think-search-count">“{step.args.query}”</span>}
                          {step.args?.text && <span className="think-search-count">“{step.args.text.substring(0, 20)}...”</span>}
                          {step.args?.topic && <span className="think-search-count">“{step.args.topic}”</span>}
                        </div>
                      )
                    }
                    if (step.type === 'tool_result') {
                      return (
                        <div key={i} className="think-status-text" style={{ color: '#52c41a' }}>✅ {step.tool} 返回结果</div>
                      )
                    }
                    return null
                  })}
                  {!ragStreamingDone && <span className="think-cursor">▊</span>}
                </div>
              )}
            </div>
          )}
          {ragAnswer && <div className="rag-answer-box">
            <div className="rag-answer-label">AI 回答</div>
            {ragTrust && <div className={`trust-badge trust-badge--${trustBadge(ragTrust).tone}`}>
              <strong>{trustBadge(ragTrust).label}</strong>
              <span>{trustBadge(ragTrust).message}</span>
            </div>}
            {ragTrust?.level === 'refuse' && ragTrust.suggestions?.length > 0 && (
              <div className="trust-suggestions">建议：{ragTrust.suggestions.map((item, index) => <span key={item}>{index > 0 && '；'}{item}</span>)}</div>
            )}
            {ragAnswerBlocks.length > 0 && !(ragAnswerTarget && ragAnswerDisplay !== ragAnswerTarget)
              ? <TrustedAnswerReader blocks={ragAnswerBlocks} onEvidenceSelect={handleEvidenceSelect} />
              : <AnswerReader
                  answer={ragAnswerTarget && ragAnswerDisplay !== ragAnswerTarget ? ragAnswerDisplay : ragAnswer}
                  streaming={Boolean(ragAnswerTarget && ragAnswerDisplay !== ragAnswerTarget)}
                />}
            {ragTraceId && <div className="answer-feedback" aria-label="回答是否解决问题">
              <span>这个回答解决你的问题了吗？</span>
              <button type="button" aria-pressed={answerFeedbackOutcome === 'solved'} className={answerFeedbackOutcome === 'solved' ? 'selected' : ''} disabled={answerFeedbackLoading} onClick={() => handleAnswerFeedback('solved')}>已解决</button>
              <button type="button" aria-pressed={answerFeedbackOutcome === 'unsolved'} className={answerFeedbackOutcome === 'unsolved' ? 'selected' : ''} disabled={answerFeedbackLoading} onClick={() => handleAnswerFeedback('unsolved')}>未解决</button>
              {answerFeedbackLoading && <em role="status">正在提交反馈…</em>}
              {!answerFeedbackLoading && answerFeedbackOutcome && <em role="status" aria-live="polite">{answerFeedbackOutcome === 'solved' ? '已记录，感谢反馈。' : '已记录，管理员可在使用统计中查看。'}</em>}
            </div>}
          </div>}

          {isAdminUser && <RetrievalInsight queryEnhancement={queryEnhancement} ragMeta={ragMeta} />}
          {ragSources.length > 0 && <section className="rag-sources-box" aria-label="回答参考依据">
            <div className="rag-sources-heading">
              <div>
                <div className="lang-label">参考依据</div>
                <p>以下文档片段用于生成本次回答，可按需展开查看。</p>
              </div>
              <span>{ragSources.length} 条</span>
            </div>
            <div className="rag-source-list">
              {ragSources.map((src, i) => <article id={`rag-source-${src.evidenceId || i}`} key={src.evidenceId || `${src.docName || 'source'}-${i}`} className={`rag-source-item ${selectedEvidenceId === src.evidenceId ? 'rag-source-item--selected' : ''}`}>
                <SourceExcerpt source={src} index={i} />
                <div className="source-score">
                  {src.sourceType === 'sop' && <span>📋 标准流程</span>}
                  {src.productModel && <span>适用：{src.productModel}</span>}
                  {src.supportedClaims?.length > 0 && <span className="source-claim">支持本回答中的 {src.supportedClaims.length} 项内容</span>}
                </div>
              </article>)}
            </div>
          </section>}

          {/* 只展示有可靠问题匹配的操作视频 */}
          {activeGuidanceVideo && (
            <section className="video-recommendations" aria-label="推荐操作视频">
              <div className="video-recommendations-heading">
                <div><span aria-hidden="true">🎬</span> 视频解决方案</div>
                <span>{videoGuidance?.diagnosis?.label ? `已识别：${videoGuidance.diagnosis.label}` : '按问题相关度推荐'}</span>
              </div>
              {videoGuidance?.diagnosis?.evidence?.length > 0 && <p className="video-diagnosis-note">根据“{videoGuidance.diagnosis.evidence.slice(0, 2).join('、')}”判断，先从最可能解决当前问题的方案开始。</p>}
              <div className="video-recommendation-grid video-guidance-grid">
                <VideoRecommendationCard
                  key={activeGuidanceVideo.id}
                  video={activeGuidanceVideo}
                  onPlay={(selectedVideo) => { setVideoLoadError(false); setPlayingVideo(selectedVideo) }}
                  onResolve={handleVideoResolve}
                  onTryNext={handleTryNextVideo}
                  hasNext={activeGuidanceIndex < guidanceVideos.length - 1}
                  isResolving={resolvingVideoId === activeGuidanceVideo.id}
                  isResolved={resolvedVideoIds.has(activeGuidanceVideo.id)}
                />
              </div>
            </section>
          )}

          {/* 推荐SOP操作指南 */}
          {recommendedSops.length > 0 && (
            <div style={{ marginTop: 12, padding: '12px 14px', background: '#fff7e6', borderRadius: 8, border: '1px solid #ffd591' }}>
              <div style={{ fontWeight: 600, marginBottom: 8, fontSize: 13 }}>📋 相关操作指南（SOP）</div>
              {recommendedSops.map(s => (
                <div key={s.id} style={{ padding: '8px 10px', background: '#fff', borderRadius: 6, marginBottom: 6, border: '1px solid #ffe7ba' }}>
                  <div style={{ fontWeight: 500, fontSize: 13 }}>{s.title}</div>
                  <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>
                    {s.difficulty === 'easy' ? '🟢 简单' : s.difficulty === 'medium' ? '🟡 中等' : '🔴 困难'}
                    {s.estimated_duration ? ` · 约${s.estimated_duration}秒` : ''}
                    {s.completion_check ? ` · 完成标志：${s.completion_check}` : ''}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="card"><div className="card-title">📋 问答历史</div>{ragHistory.length === 0 ? <div style={{ textAlign: 'center', color: '#999', padding: '30px 0' }}>暂无问答记录</div> : <div className="rag-history-list">{ragHistory.slice(0, 1).map(item => (<div key={item.id} className="rag-history-item"><div className="rag-q"><span className="rag-q-label">Q</span><span>{item.question}</span></div><div className="rag-a"><span className="rag-a-label">A</span><span>{item.answer.substring(0, 100)}{item.answer.length > 100 ? '...' : ''}</span></div><div className="rag-meta">{item.original_name || '跨文档检索'} · {new Date(item.created_at).toLocaleString('zh-CN')}</div></div>))}</div>}</div>
      </>)}



      {activeTab === 'stats' && isAdminUser && (<>
        <div className="stats-grid">
          <div className="stat-card green"><div className="stat-value">{stats.ragCount}</div><div className="stat-label">智能问答次数</div></div>
          <div className="stat-card orange"><div className="stat-value">{documents.length}</div><div className="stat-label">知识库文档</div></div>
          <div className="stat-card" style={{ background: 'linear-gradient(135deg, #722ed1 0%, #9254de 100%)' }}><div className="stat-value">{recommendedVideos.length}</div><div className="stat-label">推荐视频</div></div>
        </div>
        <div className="card feedback-summary-card">
          <div className="card-title feedback-summary-title">
            <span>顾客回答反馈</span>
            <button type="button" onClick={() => setFeedbackSummaryRefresh(value => value + 1)} disabled={feedbackSummaryLoading}>刷新</button>
          </div>
          {feedbackSummaryLoading && <div className="feedback-summary-state">正在读取真实顾客反馈…</div>}
          {!feedbackSummaryLoading && feedbackSummaryError && <div className="feedback-summary-state feedback-summary-state--error">{feedbackSummaryError}</div>}
          {!feedbackSummaryLoading && !feedbackSummaryError && feedbackSummary.length === 0 && <div className="feedback-summary-state">暂无顾客反馈。顾客点击“已解决”或“未解决”后会显示在这里。</div>}
          {!feedbackSummaryLoading && !feedbackSummaryError && feedbackSummary.length > 0 && <div className="feedback-summary-list">
            {feedbackSummary.map((item, index) => <article key={`${item.question}-${item.productModel}-${index}`}>
              <div className="feedback-summary-question">{item.question}</div>
              <div className="feedback-summary-meta">
                <span>{customerProductDisplayName({ productModel: item.productModel }) || '未指定型号'}</span>
                <span className="feedback-count feedback-count--solved">已解决 {Number(item.solvedCount || 0)}</span>
                <span className="feedback-count feedback-count--unsolved">未解决 {Number(item.unsolvedCount || 0)}</span>
                <time>{item.latestAt ? new Date(item.latestAt).toLocaleString('zh-CN') : ''}</time>
              </div>
            </article>)}
          </div>}
        </div>
        <div className="card"><div className="card-title">ℹ️ 系统信息</div><div style={{ fontSize: 14, lineHeight: 2 }}>
          <div>产品定位：科大讯飞硬件产品智能使用助手</div>
          <div>RAG 引擎：BM25 + 向量语义检索 + 多因子重排 + LLM 增强生成</div>
          <div>视频推荐：关键词匹配 + 短视频优先（20s~5min）</div>
          <div>数据库：MySQL（持久化存储）</div>
          <div>支持文档格式：PDF / Word / TXT / Markdown</div>
          <div>用户：{user.username}（{user.nickname}）</div>
        </div></div>
      </>)}

      {activeTab === 'video-studio' && user.role === 'admin' && <SopVideoStudio api={API} />}

      {/* 视频播放弹窗 */}
      {playingVideo && <VideoPlayerDialog video={playingVideo} loadError={videoLoadError} onError={() => setVideoLoadError(true)} onClose={() => setPlayingVideo(null)} />}
    </div>
  )
}
