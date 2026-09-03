const VALID_KINDS = new Set(['conclusion', 'step', 'notice', 'scope', 'related', 'details'])

function cleanText(value) {
  return String(value || '').trim()
}

function numberedStepItems(value) {
  const text = cleanText(value)
    .replace(/\n+/g, ' ')
    .replace(/([。！？；;])(?=\d+(?:[、．)]\s*|\.\s+))/g, '$1 ')
  const items = []
  // ASCII dots only mark a numbered item when followed by whitespace. This
  // prevents product/version numbers such as "2.0" from becoming a fake
  // second step while continuing to support "1. step" list syntax.
  const marker = String.raw`\d+(?:[、．)]\s*|\.\s+)`
  const pattern = new RegExp(`(?:^|\\s)(\\d+)(?:[、．)]\\s*|\\.\\s+)(.*?)(?=\\s+${marker}|$)`, 'g')
  for (const match of text.matchAll(pattern)) {
    const item = cleanText(match[2])
    if (item) items.push(item)
  }
  return items
}

export function parseStepPresentation(value) {
  const text = cleanText(value)
  const methodPattern = /(?:^|\n|\s)(?:\d+[.、．)]\s*)?(方法[一二三四五六七八九十\d]+(?:\s*[（(][^）)\n]+[）)])?)\s*[:：]/g
  const matches = [...text.matchAll(methodPattern)]
  if (matches.length > 0) {
    const methods = matches.map((match, index) => ({
      title: cleanText(match[1]),
      steps: numberedStepItems(text.slice(match.index + match[0].length, matches[index + 1]?.index ?? text.length))
    })).filter(method => method.steps.length > 0)
    if (methods.length > 0) return { type: 'methods', methods }
  }

  const steps = numberedStepItems(text)
  return steps.length > 1 ? { type: 'steps', steps } : { type: 'text', text }
}

export function sourceIdSet(block) {
  return [...new Set((Array.isArray(block?.evidenceIds) ? block.evidenceIds : []).map(cleanText).filter(Boolean))]
}

function formatGroupedText(kind, texts) {
  const lines = texts.flatMap(text => cleanText(text).split(/\n+/).map(cleanText).filter(Boolean))
  if (kind === 'step') {
    return lines.map((line, index) => `${index + 1}、${line.replace(/^\d+[.、．)]\s*/, '')}`).join('\n')
  }
  if (kind === 'notice' && lines.length > 1) {
    return lines.map(line => /^[-•]/.test(line) ? line.replace(/^[-•]\s*/, '• ') : `• ${line}`).join('\n')
  }
  return lines.join('\n')
}

export function normalizeAnswerBlocks(answerBlocks, fallbackAnswer = '') {
  const normalized = (Array.isArray(answerBlocks) ? answerBlocks : [])
    .map(block => ({
      kind: VALID_KINDS.has(block?.kind) ? block.kind : 'details',
      text: cleanText(block?.text),
      evidenceIds: sourceIdSet(block)
    }))
    .filter(block => block.text)
  const grouped = new Map()
  for (const block of normalized) {
    const current = grouped.get(block.kind) || { kind: block.kind, texts: [], evidenceIds: [] }
    current.texts.push(block.text)
    current.evidenceIds.push(...block.evidenceIds)
    grouped.set(block.kind, current)
  }
  const blocks = [...grouped.values()].map(group => ({
    kind: group.kind,
    text: formatGroupedText(group.kind, group.texts),
    evidenceIds: [...new Set(group.evidenceIds)]
  }))
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
