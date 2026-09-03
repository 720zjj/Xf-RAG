import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

test('媒体安全策略允许已核验的淘宝播放入口及其两个 CDN 跳转域名', () => {
  const source = fs.readFileSync(new URL('../server/index.js', import.meta.url), 'utf8')

  assert.match(source, /media-src[^;]*https:\/\/static\.xftrans\.cn/)
  assert.match(source, /media-src[^;]*https:\/\/cloud\.video\.taobao\.com/)
  assert.match(source, /media-src[^;]*https:\/\/video-sh\.cloudvideocdn\.taobao\.com/)
  assert.match(source, /media-src[^;]*https:\/\/video-zb\.cloudvideocdn\.taobao\.com/)
  assert.doesNotMatch(source, /media-src[^;]*https:\/\/\*\.taobao\.com/)
})
