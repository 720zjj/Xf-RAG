import test from 'node:test'
import assert from 'node:assert/strict'

test('旧版含下划线的视频文件名可通过资源白名单', async () => {
  const { isVideoAssetFilename } = await import('../server/routes/uploadAssets.js')

  assert.equal(typeof isVideoAssetFilename, 'function')
  assert.equal(isVideoAssetFilename('video_1.webm'), true)
})
