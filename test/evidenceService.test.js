import test from 'node:test'
import assert from 'node:assert/strict'
import { selectEvidence, toPublicSources } from '../server/services/evidenceService.js'

const duplicateWifi = {
  docId: 1,
  chunkId: 11,
  docName: '售后FAQ',
  text: '先核对密码和网络本身是否可用，再重新连接 WiFi。',
  score: 0.9,
  bm25Score: 1.2,
  factors: { coverage: 0.8 },
  metadata: { productLine: '翻译机', productModel: '讯飞翻译机4.0', effectiveStatus: 'active', riskLevel: 'low' }
}

const safetyChunk = {
  docId: 2,
  chunkId: 21,
  docName: '安全说明',
  text: '设备进水后应立即停止使用，避免充电和反复开机。',
  score: 0.7,
  bm25Score: 0.8,
  factors: { coverage: 0.9 },
  metadata: { productLine: '翻译机', productModel: '讯飞翻译机4.0', effectiveStatus: 'active', riskLevel: 'high' }
}

test('证据选择去除近似重复片段并编号', () => {
  const evidence = selectEvidence([
    duplicateWifi,
    { ...duplicateWifi, chunkId: 12, score: 0.8 },
    safetyChunk
  ])

  assert.deepEqual(evidence.map(item => item.evidenceId), ['E1', 'E2'])
  assert.equal(evidence[0].chunkId, 11)
  assert.equal(evidence[1].chunkId, 21)
})

test('安全问题优先选择高风险安全资料', () => {
  const evidence = selectEvidence([duplicateWifi, safetyChunk], { question: '翻译机进水后该怎么做？' })

  assert.equal(evidence[0].title, '安全说明')
  assert.equal(evidence[0].selectionReason, 'safety')
})

test('同名 FAQ 即使分数较低也优先于 Agent 扩展出的高分无关片段', () => {
  const exactFaq = {
    docId: 7,
    chunkId: 165,
    docName: '售后FAQ',
    text: 'Q12：翻译机进水了怎么办？立即关机，不要尝试充电或开机，并尽快联系售后。',
    score: 0.66,
    metadata: { productLine: '翻译机', productModel: '翻译机4.0', effectiveStatus: 'active', riskLevel: 'low' }
  }
  const unrelatedHighScore = {
    ...safetyChunk,
    text: '设备过热时应移到阴凉位置，等待几分钟后再尝试使用。',
    score: 1.01
  }

  const selected = selectEvidence([unrelatedHighScore, exactFaq], { question: '翻译机进水了怎么办' })

  assert.equal(selected[0].chunkId, 165)
  assert.match(selected[0].excerpt, /立即关机/)
})

test('宽泛新手问题优先完整首次翻译流程而不是高分局部功能', () => {
  const onboarding = {
    docId: 4,
    chunkId: 107,
    docName: '快速入门指南',
    text: '【章节：首次翻译操作 > 语音翻译（最常用）】 1. 选择翻译语种。 2. 长按左侧中文键说中文。',
    score: 0.62,
    metadata: { productLine: '翻译机', productModel: '翻译机4.0', effectiveStatus: 'active' }
  }
  const photo = {
    ...duplicateWifi,
    text: '解锁后左划找到拍照翻译应用图标，打开拍照翻译。',
    score: 0.96
  }

  const selected = selectEvidence([photo, onboarding], { question: '我不知道怎么用这个翻译机' })

  assert.equal(selected[0].chunkId, 107)
})

test('切换翻译语种优先直接操作证据，并将相邻功能标为不覆盖问题', () => {
  const directOperation = {
    docId: 5,
    chunkId: 123,
    docName: '用户操作手册',
    text: '【章节：在线语音翻译】 1. 主屏幕或下拉菜单中选择需要翻译的语种。 2. 按界面提示开始翻译。',
    score: 0.61,
    factors: { coverage: 0.5 },
    metadata: { productLine: '翻译机', productModel: '翻译机4.0', effectiveStatus: 'active' }
  }
  const troubleshooting = {
    ...duplicateWifi,
    chunkId: 160,
    text: '【章节：无法进行翻译怎么办】确认已选择正确的翻译语种，重启设备后重试。',
    score: 1.08,
    factors: { coverage: 1, phraseMatch: true }
  }
  const voiceGender = {
    ...duplicateWifi,
    chunkId: 150,
    text: '中英互译支持男声/女声切换。',
    score: 1.02,
    factors: { coverage: 1, phraseMatch: true }
  }

  const selected = selectEvidence([troubleshooting, voiceGender, directOperation], {
    question: '翻译机怎么切换翻译语言？'
  })

  assert.equal(selected[0].chunkId, 123)
  assert.equal(selected[0].selectionReason, 'intent-match')
  assert.equal(selected[0].coversQuestion, true)
  assert.equal(selected.find(item => item.chunkId === 160).coversQuestion, false)
  assert.equal(selected.find(item => item.chunkId === 150).coversQuestion, false)
})

test('只有相邻资料时不能把切换翻译语种标记为已覆盖', () => {
  const selected = selectEvidence([{
    ...duplicateWifi,
    text: '确认已选择正确的翻译语种，重启设备后重试。',
    factors: { coverage: 1, phraseMatch: true }
  }], { question: '怎么选择翻译语种？' })

  assert.equal(selected.length, 1)
  assert.equal(selected[0].coversQuestion, false)
})

test('官方常见问题原文会被选为两款机型的翻译语种直接证据', () => {
  const officialEvidence = [
    {
      ...duplicateWifi,
      docId: 23,
      chunkId: 238,
      docName: '讯飞翻译机4.0官方常见问题.md',
      text: '【章节：讯飞翻译机4.0官方常见问题 > 翻译机怎么切换翻译语言？】在语音翻译界面上，从屏幕下方往上滑，即可选择所需的语种。',
      score: 0.7
    },
    {
      ...duplicateWifi,
      docId: 24,
      chunkId: 252,
      docName: '讯飞双屏翻译机2.0官方常见问题.md',
      text: '【章节：讯飞双屏翻译机2.0官方常见问题 > 翻译机怎么切换翻译语言？】1. 打开翻译机，进入语音翻译。 2. 进入“语种列表”选择需要的语种。',
      score: 0.69
    }
  ]

  for (const item of officialEvidence) {
    const selected = selectEvidence([{
      ...duplicateWifi,
      chunkId: 160,
      text: '【章节：无法进行翻译怎么办】确认已选择正确的翻译语种，重启设备后重试。',
      score: 1.1
    }, item], { question: '翻译机怎么切换翻译语言？' })

    assert.equal(selected[0].chunkId, item.chunkId)
    assert.equal(selected[0].selectionReason, 'intent-match')
    assert.equal(selected[0].coversQuestion, true)
  }
})

test('重新播放问题优先选择点读复听资料并排除仅自动朗读的片段', () => {
  const selected = selectEvidence([
    {
      ...duplicateWifi,
      chunkId: 150,
      text: '【章节：语音播报】翻译结果自动朗读，支持调节语速和音量。',
      score: 1.1,
      factors: { coverage: 1, phraseMatch: true }
    },
    {
      ...duplicateWifi,
      chunkId: 139,
      text: '【章节：在线语音翻译】翻译结果自动语音播报，支持点读复听。',
      score: 0.7,
      factors: { coverage: 0.5 }
    }
  ], { question: '翻译结果可以重新播放吗？' })

  assert.equal(selected[0].chunkId, 139)
  assert.equal(selected[0].selectionReason, 'intent-match')
  assert.equal(selected[0].coversQuestion, true)
  assert.equal(selected.find(item => item.chunkId === 150).coversQuestion, false)
})

test('失效资料不会进入证据集合，公开来源不泄露内部因素', () => {
  const evidence = selectEvidence([{ ...duplicateWifi, metadata: { ...duplicateWifi.metadata, effectiveStatus: 'deprecated' } }, safetyChunk])
  const sources = toPublicSources(evidence)

  assert.equal(sources.length, 1)
  assert.equal(sources[0].evidenceId, 'E1')
  assert.equal('factors' in sources[0], false)
  assert.equal(sources[0].sourceType, 'document_chunk')
})
