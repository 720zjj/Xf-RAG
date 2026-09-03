import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const DOCS = [
  {
    path: new URL('../docs/official/讯飞翻译机4.0官方H5使用视频索引.md', import.meta.url),
    model: '翻译机4.0',
    titles: ['语音翻译', '免按键翻译', '面对面翻译', '拍照翻译']
  },
  {
    path: new URL('../docs/official/讯飞双屏翻译机2.0官方H5使用视频索引.md', import.meta.url),
    model: '翻译机2.0',
    titles: ['快速上手', '语音翻译', '强降噪', '会议翻译', '旁听同传', '通话翻译', '拍照翻译', '群组翻译', '同声字幕', '演讲翻译', '讯飞翻译助手', '记录导出']
  }
]

test('official H5 knowledge docs keep model boundaries and document the complete first-release catalog', () => {
  for (const doc of DOCS) {
    const content = fs.readFileSync(doc.path, 'utf8')
    assert.match(content, new RegExp(`product_model: ${doc.model.replace('.', '\\.')}`))
    assert.match(content, /effective_status: active/)
    assert.match(content, /https:\/\/h5\.xftrans\.cn\/wechatServer\/serverH5\/entry\/self-service\.html#\/instruction-new/)
    for (const title of doc.titles) assert.match(content, new RegExp(title))
  }
})

test('dual-screen subtitle guidance states the written-evidence boundary instead of inventing device steps', () => {
  const content = fs.readFileSync(DOCS[1].path, 'utf8')
  assert.match(content, /## 怎么使用同声字幕？/)
  assert.match(content, /官方 H5 页面没有提供《同声字幕》的逐步文字说明/)
  assert.match(content, /assist\.mp4/)
  assert.doesNotMatch(content, /进入【同声字幕】|点击【同声字幕】|打开【同声字幕】/)
})
