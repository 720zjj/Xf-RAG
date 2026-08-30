import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DOCUMENT_STATUS,
  clampProgress,
  getDocumentStatusName,
  isTerminalJobStatus,
  sanitizeDocumentJobError
} from '../server/services/documentJobState.js'

test('兼容的文档状态映射包含 queued 和 cancelled', () => {
  assert.equal(DOCUMENT_STATUS.processing, 0)
  assert.equal(DOCUMENT_STATUS.completed, 1)
  assert.equal(getDocumentStatusName(3), 'queued')
  assert.equal(getDocumentStatusName(4), 'cancelled')
})

test('任务状态正确识别终态并限制进度范围', () => {
  assert.equal(isTerminalJobStatus('completed'), true)
  assert.equal(isTerminalJobStatus('failed'), true)
  assert.equal(isTerminalJobStatus('processing'), false)
  assert.equal(clampProgress(-4), 0)
  assert.equal(clampProgress(51.7), 52)
  assert.equal(clampProgress(180), 100)
})

test('用户可见错误不会泄露本机路径或堆栈', () => {
  assert.equal(
    sanitizeDocumentJobError(new Error('ENOENT: D:\\uploads\\secret.pdf')),
    '文档处理失败，请重试或检查文件格式'
  )
  assert.equal(
    sanitizeDocumentJobError(Object.assign(new Error('无可解析文本'), { code: 'DOCUMENT_EMPTY' })),
    '未提取到可用文本，请检查文件内容'
  )
})
