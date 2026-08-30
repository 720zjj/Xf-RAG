import test from 'node:test'
import assert from 'node:assert/strict'
import { chunkDocument } from '../server/services/chunkStore.js'

test('章节切块不会把相邻章节混入同一个检索块', () => {
  const chunks = chunkDocument(`
# 讯飞翻译机快速入门

## 充电说明
使用附带的 Micro USB 数据线和 5V/1A 电源适配器充电。充电时电量指示灯亮红色，充满后变为绿色。

## 常见问题速查
无法连接 WiFi 时重启设备，确认密码正确，并靠近路由器。翻译不准确时请靠近麦克风说话。

## 下一步
完成充电后，请阅读联网和翻译功能说明。
`, 500)

  assert.equal(chunks.length, 3)
  assert.match(chunks[0], /章节：讯飞翻译机快速入门 > 充电说明/)
  assert.match(chunks[0], /5V\/1A/)
  assert.doesNotMatch(chunks[0], /常见问题|下一步/)
  assert.match(chunks[1], /章节：讯飞翻译机快速入门 > 常见问题速查/)
  assert.doesNotMatch(chunks[1], /充电说明|下一步/)
})

test('表格和图片说明保留在所属章节的同一检索块', () => {
  const chunks = chunkDocument(`
# 使用指南

## 故障排查
| 问题 | 解决方法 |
| --- | --- |
| 开机无反应 | 检查电量后重试 |

![电源按键](/uploads/images/8/power-button.png)
图：电源按键位置。

## 下一步
请继续查看联网设置。
`, 500)

  assert.equal(chunks.length, 2)
  assert.match(chunks[0], /\| 开机无反应 \| 检查电量后重试 \|/)
  assert.match(chunks[0], /!\[电源按键\]/)
  assert.match(chunks[0], /图：电源按键位置/)
  assert.doesNotMatch(chunks[0], /下一步/)
})

test('超长章节正文会在本章节内拆分且不重复末句', () => {
  const chunks = chunkDocument(`
# 使用指南

## 联网说明
第一段用于确认设备已打开网络设置并选择可用的无线网络，然后输入正确密码完成连接。第二段用于确认路由器距离合适并关闭飞行模式，避免网络连接反复中断。第三段用于确认连接成功后可以开始使用在线翻译服务。第四段用于提示用户在网络恢复后重新执行一次翻译，确认服务能够稳定使用。
`, 120)

  assert.equal(chunks.length, 2)
  const merged = chunks.map(chunk => chunk.replace(/^【章节：[^】]+】\n/, '')).join('')
  assert.equal((merged.match(/第四段用于提示用户在网络恢复后重新执行一次翻译，确认服务能够稳定使用。/g) || []).length, 1)
})
