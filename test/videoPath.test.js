import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'

test('旧版含下划线的视频文件路径可用于安全发布回滚', async () => {
  const { localVideoPath } = await import('../server/routes/video.js')

  assert.equal(typeof localVideoPath, 'function')
  assert.equal(path.basename(localVideoPath('/uploads/videos/video_1.webm') || ''), 'video_1.webm')
})
