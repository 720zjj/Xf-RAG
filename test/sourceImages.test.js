import test from 'node:test'
import assert from 'node:assert/strict'
import { extractSourceImageUrls, findNearbySourceImages } from '../server/services/sourceImages.js'

test('只提取当前文档的本地图片地址', () => {
  const urls = extractSourceImageUrls(`
![设置图](/uploads/images/8/wifi.png)
![其他文档](/uploads/images/9/private.jpg)
![外部图](https://example.com/unsafe.png)
`, 8)

  assert.deepEqual(urls, ['/uploads/images/8/wifi.png'])
})

test('命中文字块附近的图片会作为来源附件返回', () => {
  const content = '打开网络设置，选择 WiFi。\n\n![WiFi 设置](/uploads/images/8/wifi-guide.webp)\n\n输入密码后连接成功。'

  assert.deepEqual(
    findNearbySourceImages({ docId: 8, chunkText: '打开网络设置，选择 WiFi。', documentContent: content }),
    ['/uploads/images/8/wifi-guide.webp']
  )
})
