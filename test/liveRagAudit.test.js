import test from 'node:test'
import assert from 'node:assert/strict'
import { evaluateLiveCase, loadLiveAuditCases } from '../scripts/run-live-rag-audit.js'

const baseCase = {
  id: 'T1',
  question: '怎么切换语言？',
  productModel: '翻译机2.0',
  expectedTrust: 'answer',
  requiredAnyGroups: [['语种列表']],
  forbidden: ['底部上滑'],
  expectedSourceTitlesAny: ['官方常见问题']
}

test('实时回归题库可以加载且覆盖两个首发型号', () => {
  const cases = loadLiveAuditCases()
  assert.ok(cases.length >= 16)
  assert.deepEqual([...new Set(cases.map(item => item.productModel))].sort(), ['翻译机2.0', '翻译机4.0'])
})

test('实时回归检查答案关键点、来源和普通用户字段边界', () => {
  const result = evaluateLiveCase(baseCase, {
    ok: true,
    data: {
      answer: '进入语音翻译，在语种列表中选择需要的语种。',
      trust: { level: 'answer' },
      sources: [{ documentName: '讯飞双屏翻译机2.0官方常见问题.md' }],
      answerBlocks: [{ kind: 'step', text: '进入语种列表。' }]
    }
  })
  assert.equal(result.passed, true)
})

test('实时回归能发现串型号、禁用内容和管理员元数据泄露', () => {
  const result = evaluateLiveCase(baseCase, {
    ok: true,
    data: {
      answer: '从屏幕底部上滑。',
      trust: { level: 'answer' },
      sources: [{ title: '其他资料' }],
      recommendedVideos: [{ title: '4.0 教程', product_model: '翻译机4.0' }],
      retrievalMode: 'vector'
    }
  })
  assert.equal(result.passed, false)
  assert.ok(result.failures.some(message => message.includes('关键点')))
  assert.ok(result.failures.some(message => message.includes('禁用内容')))
  assert.ok(result.failures.some(message => message.includes('串型号')))
  assert.ok(result.failures.some(message => message.includes('管理员字段')))
})

test('拒答题不允许宽泛视频或 SOP 推荐', () => {
  const result = evaluateLiveCase({
    id: 'T2', question: '支持卫星联网吗？', productModel: '翻译机4.0', expectedTrust: 'refuse',
    requiredAnyGroups: [['不能确认']], forbidRecommendations: true
  }, {
    ok: true,
    data: {
      answer: '当前资料不能确认是否支持。',
      trust: { level: 'refuse' },
      sources: [],
      recommendedVideos: [{ title: '联网教程', product_model: '翻译机4.0' }]
    }
  })
  assert.equal(result.passed, false)
  assert.ok(result.failures.some(message => message.includes('不应推荐')))
})

test('上线回归题库覆盖 39 次问答与连续会话', () => {
  const cases = loadLiveAuditCases(new URL('./fixtures/rag-launch-audit.json', import.meta.url))
  assert.equal(cases.length, 39)
  assert.equal(cases.filter(item => item.sessionGroup === 'wifi-followup').length, 4)
  assert.equal(cases.filter(item => item.requireOfficialVideo).length, 12)
})

test('官方视频必须位于首位且来源为科大讯飞 H5', () => {
  const testCase = {
    id: 'TV', question: '怎么使用会议翻译？', productModel: '翻译机2.0', expectedTrust: 'answer',
    expectedPrimaryVideoTitle: '会议翻译', requireOfficialVideo: true
  }
  const wrong = evaluateLiveCase(testCase, {
    ok: true,
    data: {
      answer: '请查看会议翻译视频。', trust: { level: 'answer' }, sources: [{ title: '官方索引' }],
      recommendedVideos: [
        { title: '语音翻译', product_model: '翻译机2.0', source_provider: 'iflytek-h5' },
        { title: '会议翻译', product_model: '翻译机2.0', source_provider: 'iflytek-h5' }
      ]
    }
  })
  assert.equal(wrong.passed, false)
  assert.ok(wrong.failures.some(message => message.includes('首条视频')))
})
