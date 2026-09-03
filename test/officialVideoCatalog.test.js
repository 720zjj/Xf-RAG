import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {
  getOfficialVideoCatalog,
  isTrustedOfficialThumbnailUrl,
  isTrustedOfficialVideoUrl,
  isTrustedPlaybackVideoUrl,
  selectOfficialVideos
} from '../server/services/officialVideoCatalog.js'

test('官方视频目录只包含首发两个型号的 16 条 HTTPS 视频', () => {
  const catalog = getOfficialVideoCatalog()
  assert.equal(catalog.length, 16)
  assert.deepEqual([...new Set(catalog.map(item => item.productModel))].sort(), ['翻译机2.0', '翻译机4.0'])
  assert.equal(catalog.filter(item => item.productModel === '翻译机4.0').length, 4)
  assert.equal(catalog.filter(item => item.productModel === '翻译机2.0').length, 12)
  assert.equal(new Set(catalog.map(item => item.externalId)).size, catalog.length)
  for (const item of catalog) {
    assert.equal(item.sourceProvider, 'iflytek-h5')
    assert.equal(item.sourcePriority, 100)
    assert.equal(isTrustedOfficialVideoUrl(item.videoUrl), true)
    assert.equal(isTrustedPlaybackVideoUrl(item.playbackUrl), true)
    assert.equal(isTrustedOfficialThumbnailUrl(item.thumbnailUrl), true)
    assert.doesNotMatch(item.sourcePageUrl, /[?&]code=/)
  }
})

test('双屏 2.0 的已提供兼容播放地址仅允许固定淘宝视频 CDN 路径', () => {
  const catalog = getOfficialVideoCatalog()
  const compatible = catalog.filter(item => item.playbackUrl)
  assert.equal(compatible.length, 8)
  assert.ok(compatible.every(item => item.productModel === '翻译机2.0'))
  assert.equal(isTrustedPlaybackVideoUrl('https://cloud.video.taobao.com/play/u/null/p/1/e/6/t/1/518097661584.mp4'), true)
  assert.equal(isTrustedPlaybackVideoUrl('https://evil.example/play/u/null/p/1/e/6/t/1/518097661584.mp4'), false)
  assert.equal(isTrustedPlaybackVideoUrl('http://cloud.video.taobao.com/play/u/null/p/1/e/6/t/1/518097661584.mp4'), false)
  assert.equal(isTrustedPlaybackVideoUrl('https://cloud.video.taobao.com/play/u/null/p/1/e/6/t/1/518097661584.mp4?code=temp'), false)
})

test('官方地址校验拒绝临时参数、非 HTTPS 和其他域名', () => {
  assert.equal(isTrustedOfficialVideoUrl('http://static.xftrans.cn/static/files/demo.mp4'), false)
  assert.equal(isTrustedOfficialVideoUrl('https://evil.example/static/files/demo.mp4'), false)
  assert.equal(isTrustedOfficialVideoUrl('https://static.xftrans.cn/static/files/demo.mp4?code=temp'), false)
  assert.equal(isTrustedOfficialVideoUrl('https://static.xftrans.cn/static/files/demo.webm'), false)
})

test('导入选择只能引用可信目录里的 externalId', () => {
  const selected = selectOfficialVideos(['cce19559:voice', 'f7a055c0:subtitle', 'cce19559:voice'])
  assert.deepEqual(selected.map(item => item.externalId), ['cce19559:voice', 'f7a055c0:subtitle'])
  assert.throws(() => selectOfficialVideos(['unknown:item']), /可信目录/)
  assert.throws(() => selectOfficialVideos([]), /请选择/)
})

test('官方目录接口仅管理员可用并通过可信目录幂等写入', () => {
  const source = fs.readFileSync(new URL('../server/routes/video.js', import.meta.url), 'utf8')
  assert.match(source, /router\.get\('\/official-catalog', authMiddleware, requireAdmin/)
  assert.match(source, /router\.post\('\/official-catalog\/import', authMiddleware, requireAdmin/)
  assert.match(source, /selectOfficialVideos\(req\.body\?\.externalIds\)/)
  assert.match(source, /ON DUPLICATE KEY UPDATE/)
  assert.doesNotMatch(source, /official-catalog[\s\S]{0,800}req\.body\?\.videoUrl/)
})
