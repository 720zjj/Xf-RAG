export const DOCUMENT_STATUS = Object.freeze({
  processing: 0,
  completed: 1,
  failed: 2,
  queued: 3,
  cancelled: 4
})

const STATUS_NAMES = Object.freeze(Object.fromEntries(
  Object.entries(DOCUMENT_STATUS).map(([name, value]) => [value, name])
))

const TERMINAL_JOB_STATUSES = new Set(['completed', 'failed', 'cancelled'])

export function getDocumentStatusName(status) {
  return STATUS_NAMES[Number(status)] || 'unknown'
}

export function isTerminalJobStatus(status) {
  return TERMINAL_JOB_STATUSES.has(String(status))
}

export function clampProgress(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return 0
  return Math.max(0, Math.min(100, Math.round(number)))
}

export function sanitizeDocumentJobError(error) {
  const code = String(error?.code || '')
  if (code === 'DOCUMENT_EMPTY') return '未提取到可用文本，请检查文件内容'
  if (code === 'DOCUMENT_UNSUPPORTED') return '该文件格式暂不支持解析'
  if (code === 'DOCUMENT_CANCELLED') return '任务已取消'
  if (code === 'MINERU_UNAVAILABLE') return '解析服务暂时不可用，系统将自动重试'

  const message = String(error?.message || '')
  if (/ENOENT|EACCES|\\|\/[a-zA-Z0-9_.-]+|stack/i.test(message)) {
    return '文档处理失败，请重试或检查文件格式'
  }
  return '文档处理失败，请重试或检查文件格式'
}
