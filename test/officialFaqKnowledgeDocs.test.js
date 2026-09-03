import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'

const readKnowledge = name => fs.readFile(new URL(`../docs/official/${name}`, import.meta.url), 'utf8')

test('4.0 官方 FAQ 提供已核验的语种切换步骤并保持精确型号范围', async () => {
  const source = await readKnowledge('讯飞翻译机4.0官方常见问题.md')

  assert.match(source, /product_model: 翻译机4\.0/)
  assert.match(source, /## 翻译机怎么切换翻译语言？/)
  assert.match(source, /在语音翻译界面上，从屏幕下方往上滑，即可选择所需的语种。/)
  assert.match(source, /h5\.xftrans\.cn\/wechatServer\/serverH5\/entry\/self-service\.html#\/faq-new/)
  assert.doesNotMatch(source, /product_model: 翻译机2\.0/)
})

test('双屏 2.0 官方 FAQ 只陈述已核验路径并显式阻止套用其他型号', async () => {
  const source = await readKnowledge('讯飞双屏翻译机2.0官方常见问题.md')

  assert.match(source, /product_model: 翻译机2\.0/)
  assert.match(source, /进入“语种列表”选择需要的语种功能/)
  assert.match(source, /可选择“自动检测”/)
  assert.match(source, /没有发布固定语种对的完整逐步文字说明/)
  assert.match(source, /不应套用翻译机 4\.0 的“屏幕下方上滑”路径/)
  assert.match(source, /static\.xftrans\.cn\/static\/files\/user-guide\/fyj_tb\/v1\/voice\.mp4|官方《语音翻译》视频/)
  assert.doesNotMatch(source, /product_model: 翻译机4\.0/)
})
