const IDENTITY_QUESTION_PATTERNS = [
  /^你(?:是)?(?:谁|什么)$/,
  /^你是(?:干什么|干嘛|做什么)的?$/,
  /^你(?:能|可以|会)(?:做|回答|帮)(?:什么|哪些|啥)/,
  /^(?:这个)?(?:智能|售后)?助手(?:是)?(?:做什么|干什么|干嘛|有什么用)/,
  /^(?:请)?(?:简单)?介绍一下你自己$/
]

function normalizeQuestion(question) {
  return String(question || '')
    .replace(/[，。！？、,.!?；;：:\s]/g, '')
    .trim()
}

export function isAssistantIdentityQuestion(question) {
  const text = normalizeQuestion(question)
  return IDENTITY_QUESTION_PATTERNS.some(pattern => pattern.test(text))
}

export function buildAssistantIdentityAnswer() {
  const answerBlocks = [
    {
      kind: 'conclusion',
      text: '我是科大讯飞翻译机智能售后助手，可以帮你查询翻译机的使用方法、常见问题排查和官方操作视频。',
      evidenceIds: []
    },
    {
      kind: 'details',
      text: '页面锁定型号，是为了让型号专属的菜单路径、按键操作、功能规格和视频准确匹配；联网、开机、充电等通用问题仍会优先给出可执行的排查建议。',
      evidenceIds: []
    },
    {
      kind: 'notice',
      text: '涉及冒烟、起火、进水等安全风险时，请立即停止使用并联系人工客服；我不会提供拆机、刷机等高风险操作。',
      evidenceIds: []
    }
  ]
  const answer = answerBlocks.map(block => block.text).join('\n\n')
  return {
    answer,
    answerBlocks,
    trust: {
      level: 'answer',
      reasonCode: 'assistant-identity',
      message: '这是助手自身能力说明，不受产品型号限制。',
      suggestions: [],
      thresholdVersion: null
    },
    sources: [],
    answerSource: 'assistant-identity'
  }
}
