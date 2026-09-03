export const DEFAULT_TRUST_POLICY = Object.freeze({
  minRerankScore: 0.5,
  thresholdVersion: '2026-08-29-v1'
})

const UNSAFE_PATTERN = /(管理员密码|管理员账号|api[\s_-]?key|访问令牌|忽略(?:前文|之前|资料|指令)|系统提示|system\s*prompt)/i
const UNSAFE_DEVICE_MODIFICATION_PATTERN = /(刷机|解除系统限制|解锁\s*bootloader|bootloader|获取\s*root|root\s*权限)/i
const UNSUPPORTED_HEALTH_CAPABILITY_PATTERN = /(测量|检测|监测|测)(?:血压|血糖|心率|血氧|体温)/i

const REFUSALS = Object.freeze({
  'unsafe-request': {
    userMessage: '这个请求不属于产品资料问答范围，我不能提供账号、密码、密钥或执行忽略规则的要求。',
    suggestions: ['请改为咨询产品功能、操作步骤或故障现象。']
  },
  'unsafe-device-modification': {
    userMessage: '当前资料没有提供安全、受支持的刷机或解除系统限制方法，不能依据相近内容给出这类高风险操作步骤。',
    suggestions: ['如设备功能异常，请联系官方售后确认受支持的系统恢复或检修方式。']
  },
  'unsupported-health-capability': {
    userMessage: '当前产品资料没有说明翻译机具备血压、血糖、心率、血氧或体温等医疗健康测量能力，因此无法确认支持这类功能。',
    suggestions: ['请使用具备相应资质的专用测量设备；如需确认产品功能，请联系人工客服。']
  },
  'model-not-covered': {
    userMessage: '当前知识库没有该型号对应的有效资料，不能把其他型号的说明套用过来。',
    suggestions: ['请确认产品型号和地区版本。', '请补充该型号的官方说明书或规格资料。']
  },
  'no-active-material': {
    userMessage: '当前没有可用的有效资料可以作为回答依据，因此暂不能确认。',
    suggestions: ['请先上传或重新解析相关官方资料。']
  },
  'no-relevant-evidence': {
    userMessage: '当前资料没有覆盖这个问题的核心能力或操作，不能根据相近内容推测。',
    suggestions: ['请补充直接说明该功能或场景的官方资料。', '可以换一种更具体的产品使用描述后再问。']
  },
  'low-retrieval-confidence': {
    userMessage: '检索到的资料相关度不足，暂不能据此给出可靠结论。',
    suggestions: ['请补充更具体的功能名称、报错现象或产品型号。']
  }
})

function normalizeModel(value) {
  const normalized = String(value || '').replace(/[\s　]/g, '').toLowerCase()
  // “翻译机4.0”是型号主名；“标准版/星火版（中国大陆）”是资料适用范围。
  // 主名相同的资料可以进入后续证据判断，范围差异仍由来源和 limitedScope 向用户展示。
  const translatorModel = normalized.match(/翻译机\d+(?:\.\d+)?/)
  if (translatorModel) return translatorModel[0]
  return normalized.replace(/[（(][^）)]*[）)]/g, '')
}

export function modelMatches(left, right) {
  const normalizedLeft = normalizeModel(left)
  const normalizedRight = normalizeModel(right)
  return Boolean(normalizedLeft && normalizedRight && normalizedLeft === normalizedRight)
}

function refusal(reasonCode, policy, model = '') {
  const template = REFUSALS[reasonCode] || REFUSALS['no-relevant-evidence']
  const modelSuffix = model ? `（${model}）` : ''
  return {
    level: 'refuse',
    reasonCode,
    userMessage: reasonCode === 'model-not-covered'
      ? `当前知识库没有${modelSuffix}对应的有效资料，不能把其他型号的说明套用过来。`
      : template.userMessage,
    suggestions: template.suggestions,
    thresholdVersion: policy.thresholdVersion
  }
}

/**
 * A deterministic gate for evidence availability. It intentionally does not
 * ask an LLM whether a source is trustworthy, so all RAG entry points make
 * the same refusal decision from the same evidence set.
 */
export function decideTrust({
  question,
  requestedModel = '',
  detectedModel = '',
  availableModels = [],
  evidence = [],
  modelEvidenceMissing = false,
  policy = DEFAULT_TRUST_POLICY
} = {}) {
  const currentPolicy = { ...DEFAULT_TRUST_POLICY, ...(policy || {}) }
  const text = String(question || '').trim()
  const explicitModel = String(detectedModel || requestedModel || '').trim()

  if (UNSUPPORTED_HEALTH_CAPABILITY_PATTERN.test(text)) return refusal('unsupported-health-capability', currentPolicy)
  if (UNSAFE_DEVICE_MODIFICATION_PATTERN.test(text)) return refusal('unsafe-device-modification', currentPolicy)
  if (UNSAFE_PATTERN.test(text)) return refusal('unsafe-request', currentPolicy)

  if (explicitModel) {
    if (!availableModels.some(model => modelMatches(model, explicitModel))) {
      return refusal('model-not-covered', currentPolicy, explicitModel)
    }
    if (modelEvidenceMissing) return refusal('model-not-covered', currentPolicy, explicitModel)
  }

  if (!Array.isArray(evidence) || evidence.length === 0) {
    return refusal('no-active-material', currentPolicy)
  }

  if (!evidence.some(item => item?.coversQuestion === true)) {
    return refusal('no-relevant-evidence', currentPolicy)
  }

  const bestScore = Math.max(...evidence.map(item => Number(item?.rerankScore) || 0))
  if (bestScore < currentPolicy.minRerankScore) {
    return refusal('low-retrieval-confidence', currentPolicy)
  }

  if (evidence.some(item => item?.limitedScope)) {
    return {
      level: 'cautious',
      reasonCode: 'limited-evidence',
      userMessage: '以下内容仅在当前资料的适用范围内成立；未被资料明确说明的细节暂不能确认。',
      suggestions: ['如需确认更多版本或地区差异，请补充对应的官方资料。'],
      thresholdVersion: currentPolicy.thresholdVersion
    }
  }

  return {
    level: 'answer',
    reasonCode: 'supported',
    userMessage: '回答依据当前有效资料生成。',
    suggestions: [],
    thresholdVersion: currentPolicy.thresholdVersion
  }
}
