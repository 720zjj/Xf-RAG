import test from 'node:test'
import assert from 'node:assert/strict'
import { rankVideos, buildVideoGuidance } from '../server/services/recommendations.js'

const videos = [
  {
    id: 1,
    title: '翻译机连接 WiFi 操作演示',
    description: '演示如何连接无线网络。',
    category: '网络设置',
    tags: ['WiFi', '无线网络'],
    product_model: '翻译机4.0',
    resolve_count: 1,
    view_count: 2,
    chapters: []
  },
  {
    id: 2,
    title: '设备基础使用',
    description: '常见功能说明。',
    category: '基础操作',
    tags: ['WiFi'],
    product_model: '翻译机4.0',
    resolve_count: 999,
    view_count: 9999,
    chapters: []
  },
  {
    id: 3,
    title: '其他型号连接 WiFi',
    description: '网络连接教程。',
    category: '网络设置',
    tags: ['WiFi'],
    product_model: '翻译机5.0',
    resolve_count: 500,
    view_count: 5000,
    chapters: []
  }
]

test('标题精确命中优先于单纯高热度的视频', () => {
  const ranked = rankVideos(videos, { keywords: ['WiFi'], productModel: '翻译机4.0' })

  assert.equal(ranked[0].id, 1)
  assert.deepEqual(ranked[0].matchedKeywords, ['WiFi'])
  assert.match(ranked[0].matchReasons.join(' '), /标题匹配/)
  assert.equal(typeof ranked[0].relevance, 'number')
})

test('型号过滤保留精确型号和通用视频，排除其他型号', () => {
  const ranked = rankVideos([
    ...videos,
    { ...videos[1], id: 4, title: '通用 WiFi 教程', product_model: '' }
  ], { keywords: ['WiFi'], productModel: '翻译机4.0' })

  assert.deepEqual(ranked.map(video => video.id).sort((a, b) => a - b), [1, 2, 4])
})

test('问题中的型号会作为可靠匹配信号参与推荐', () => {
  const ranked = rankVideos([
    { ...videos[0], id: 10, title: '连接教程', tags: [] },
    { ...videos[1], id: 11, product_model: '翻译机5.0', tags: [] }
  ], { keywords: ['4.0'] })

  assert.deepEqual(ranked.map(video => video.id), [10])
  assert.match(ranked[0].matchReasons.join(' '), /型号匹配/)
})

test('没有关键词命中时不返回凑数推荐', () => {
  assert.deepEqual(rankVideos(videos, { keywords: ['蓝牙'] }), [])
})

test('连接失败时优先推荐排障视频，而不是通用教程', () => {
  const guidance = buildVideoGuidance('WiFi 连不上怎么办', [
    { id: 10, title: '翻译机 WiFi 连接教程', description: '演示连接无线网络。', tags: ['WiFi', '连接'], relevance: 40, resolve_count: 0 },
    { id: 11, title: '翻译机 WiFi 连接失败排查', description: '排查无法连接网络的问题。', tags: ['WiFi', '连接', '排查'], relevance: 32, resolve_count: 0 }
  ])

  assert.equal(guidance.diagnosis.kind, 'troubleshoot')
  assert.equal(guidance.primaryVideo.id, 11)
  assert.equal(guidance.fallbackVideos[0].id, 10)
  assert.match(guidance.primaryVideo.guidanceReason, /故障排查/)
})

test('学习操作时优先推荐教程视频，而不是故障排查视频', () => {
  const guidance = buildVideoGuidance('怎么连接 WiFi', [
    { id: 20, title: '翻译机 WiFi 连接教程', description: '演示连接无线网络。', tags: ['WiFi', '连接'], relevance: 32, resolve_count: 0 },
    { id: 21, title: '翻译机 WiFi 连接失败排查', description: '排查无法连接网络的问题。', tags: ['WiFi', '连接', '排查'], relevance: 36, resolve_count: 0 }
  ])

  assert.equal(guidance.diagnosis.kind, 'learn')
  assert.equal(guidance.primaryVideo.id, 20)
})
