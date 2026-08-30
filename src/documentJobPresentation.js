const STAGE_LABELS = Object.freeze({
  queued: '等待解析',
  parsing: '正在解析文档',
  chunking: '正在切分内容',
  embedding: '正在建立向量索引',
  finalizing: '正在完成索引',
  cancelled: '已取消',
  failed: '处理失败'
})

function statusName(document) {
  if (document?.status_name) return document.status_name
  if (document?.statusName) return document.statusName
  const numeric = Number(document?.status)
  return ({ 0: 'processing', 1: 'completed', 2: 'failed', 3: 'queued', 4: 'cancelled' })[numeric] || 'unknown'
}

function jobValue(document, field, fallback) {
  return document?.job?.[field] ?? document?.[`job_${field.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`)}`] ?? fallback
}

function progressValue(document) {
  const value = Number(jobValue(document, 'progress', 0))
  return Number.isFinite(value) ? Math.max(0, Math.min(100, Math.round(value))) : 0
}

function errorValue(document) {
  return String(jobValue(document, 'errorMessage', document?.error_message || '') || '').trim()
}

export function getDocumentJobPresentation(document) {
  const status = statusName(document)
  const progress = progressValue(document)
  const stage = String(jobValue(document, 'stage', status) || status)
  if (status === 'queued') {
    return { text: '已入队，等待解析', tone: 'pending', progress, showRetry: false, showCancel: true, poll: true }
  }
  if (status === 'processing') {
    const label = STAGE_LABELS[stage] || '正在处理文档'
    return { text: `处理中 · ${label} · ${progress}%`, tone: 'processing', progress, showRetry: false, showCancel: true, poll: true }
  }
  if (status === 'completed') {
    return { text: '已就绪', tone: 'completed', progress: 100, showRetry: false, showCancel: false, poll: false }
  }
  if (status === 'cancelled') {
    return { text: '已取消', tone: 'cancelled', progress, showRetry: true, showCancel: false, poll: false }
  }
  const error = errorValue(document)
  return { text: `失败${error ? `：${error}` : ''}`, tone: 'failed', progress: 0, showRetry: true, showCancel: false, poll: false }
}

export function shouldPollDocumentJobs(documents) {
  return Array.isArray(documents) && documents.some(document => getDocumentJobPresentation(document).poll)
}
