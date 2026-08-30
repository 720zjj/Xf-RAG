import test from 'node:test'
import assert from 'node:assert/strict'
import { getDocumentJobPresentation, shouldPollDocumentJobs } from '../src/documentJobPresentation.js'

test('排队任务显示服务端阶段和进度，不假装完成', () => {
  assert.deepEqual(
    getDocumentJobPresentation({ status_name: 'queued', job_progress: 0, job_stage: 'queued' }),
    { text: '已入队，等待解析', tone: 'pending', progress: 0, showRetry: false, showCancel: true, poll: true }
  )
})

test('处理和失败任务的操作由真实任务状态决定', () => {
  assert.deepEqual(
    getDocumentJobPresentation({ status_name: 'processing', job_progress: 75, job_stage: 'embedding' }),
    { text: '处理中 · 正在建立向量索引 · 75%', tone: 'processing', progress: 75, showRetry: false, showCancel: true, poll: true }
  )
  assert.deepEqual(
    getDocumentJobPresentation({ status_name: 'failed', error_message: '文件格式损坏' }),
    { text: '失败：文件格式损坏', tone: 'failed', progress: 0, showRetry: true, showCancel: false, poll: false }
  )
})

test('仅有活跃任务时才启动轮询', () => {
  assert.equal(shouldPollDocumentJobs([{ status_name: 'completed' }, { status_name: 'processing' }]), true)
  assert.equal(shouldPollDocumentJobs([{ status_name: 'failed' }, { status_name: 'cancelled' }]), false)
})
