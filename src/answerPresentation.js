const SECTION_DEFINITIONS = [
  { key: 'conclusion', title: '问题结论', type: 'paragraphs', aliases: ['问题结论', '结论'] },
  { key: 'steps', title: '操作步骤', type: 'steps', aliases: ['操作步骤', '操作方法', '处理步骤'] },
  { key: 'notice', title: '注意事项', type: 'bullets', aliases: ['注意事项', '温馨提示', '提示'] },
  { key: 'product', title: '适用产品和版本', type: 'paragraphs', aliases: ['适用产品和版本', '适用产品', '适用版本'] },
  { key: 'sources', title: '文档来源', type: 'bullets', aliases: ['文档来源', '参考来源', '资料来源'] },
  { key: 'related', title: '相关问题', type: 'bullets', aliases: ['相关问题', '延伸问题'] }
]

function cleanText(value) {
  return String(value || '')
    .replace(/<(script|style|iframe|object|embed|form)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<[^>]*>/g, '')
    .replace(/```/g, '')
    .replace(/(\*\*|__|`)/g, '')
    .replace(/^\s{0,3}#{1,6}\s*/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/\r/g, '')
    .trim()
}

function findSection(line) {
  const raw = cleanText(line)
  const label = raw.replace(/[：:]+$/, '').replace(/\s+/g, '')
  for (const section of SECTION_DEFINITIONS) {
    for (const alias of section.aliases) {
      const inline = raw.match(new RegExp(`^${alias}[：:]\\s*(.+)$`))
      if (inline) {
        const inlineContent = inline[1].trim()
        if (/^[（(](?:如适用|可选)[）)]$/.test(inlineContent)) return section
        return { ...section, inlineContent }
      }
      if (alias === label || label.startsWith(alias)) return section
    }
  }
  return null
}

function listItem(value) {
  return cleanText(value).replace(/^\s*(?:\d+[.、)|）]|[-*+•])\s*/, '').trim()
}

function toParagraphs(lines) {
  const paragraphs = []
  let current = []
  const commit = () => {
    const text = current.map(line => {
      const value = String(line || '')
      return /^\s*(?:[-*+•]|\d+[.、)|）])\s*/.test(value) ? listItem(value) : cleanText(value)
    }).filter(Boolean).join(' ').trim()
    if (text) paragraphs.push(text)
    current = []
  }

  for (const line of lines) {
    if (!String(line).trim()) commit()
    else current.push(line)
  }
  commit()
  return paragraphs
}

function toList(lines) {
  return lines.map(listItem).filter(Boolean)
}

export function parseAnswerSections(answer) {
  const sections = []
  let current = { key: 'details', title: '说明', type: 'paragraphs', lines: [] }

  const commit = () => {
    const content = current.type === 'paragraphs' ? toParagraphs(current.lines) : toList(current.lines)
    if (content.length > 0) sections.push({ key: current.key, title: current.title, type: current.type, content })
  }

  for (const line of String(answer || '').split('\n')) {
    const section = findSection(line)
    if (section) {
      commit()
      current = { ...section, lines: section.inlineContent ? [section.inlineContent] : [] }
    } else {
      current.lines.push(line)
    }
  }
  commit()
  return sections
}

export function toStreamingPlainText(answer) {
  return String(answer || '')
    .split('\n')
    .map(line => {
      const cleaned = cleanText(line)
      if (!cleaned) return ''
      return /^\s*(?:[-*+•]|\d+[.、)|）])\s*/.test(line) ? `• ${listItem(line)}` : cleaned
    })
    .filter((line, index, lines) => line || (index > 0 && lines[index - 1]))
    .join('\n')
    .trim()
}

export const ANSWER_SECTION_META = Object.fromEntries(
  SECTION_DEFINITIONS.map(section => [section.key, { title: section.title, type: section.type }])
)
