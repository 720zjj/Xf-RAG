const VALID_KINDS = new Set(['conclusion', 'step', 'notice', 'scope', 'related', 'details'])

function cleanText(value) {
  return String(value || '').trim()
}

export function sourceIdSet(block) {
  return [...new Set((Array.isArray(block?.evidenceIds) ? block.evidenceIds : []).map(cleanText).filter(Boolean))]
}

export function normalizeAnswerBlocks(answerBlocks, fallbackAnswer = '') {
  const blocks = (Array.isArray(answerBlocks) ? answerBlocks : [])
    .map(block => ({
      kind: VALID_KINDS.has(block?.kind) ? block.kind : 'details',
      text: cleanText(block?.text),
      evidenceIds: sourceIdSet(block)
    }))
    .filter(block => block.text)
  if (blocks.length > 0) return blocks
  const fallback = cleanText(fallbackAnswer)
  return fallback ? [{ kind: 'details', text: fallback, evidenceIds: [] }] : []
}

export function trustBadge(trust) {
  const message = cleanText(trust?.message)
  if (trust?.level === 'refuse') return { tone: 'warning', label: '暂不能确认', message }
  if (trust?.level === 'cautious') return { tone: 'caution', label: '资料有限', message }
  return { tone: 'supported', label: '资料支持', message: message || '回答依据当前有效资料生成。' }
}
