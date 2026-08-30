import test from 'node:test'
import assert from 'node:assert/strict'
import { getSopVideoRendererSupport, selectWebmMimeType } from '../src/sopVideoRenderer.js'

test('优先选择兼容性最高的 WebM 编码格式', () => {
  const MediaRecorder = {
    isTypeSupported(type) {
      return type === 'video/webm;codecs=vp8' || type === 'video/webm'
    }
  }

  assert.equal(selectWebmMimeType(MediaRecorder), 'video/webm;codecs=vp8')
})

test('缺少 Canvas captureStream 或 MediaRecorder 时给出可用性提示', () => {
  assert.deepEqual(getSopVideoRendererSupport({}), {
    supported: false,
    reason: '当前浏览器不支持在本地生成 WebM 视频'
  })

  const supported = getSopVideoRendererSupport({
    MediaRecorder: { isTypeSupported: () => true },
    document: { createElement: () => ({ captureStream() {} }) }
  })
  assert.deepEqual(supported, { supported: true, mimeType: 'video/webm;codecs=vp9' })
})

