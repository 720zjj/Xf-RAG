const SECTION_PREFIX = /^【章节：([^】]+)】\s*/

function toPlainPreview(text) {
  return String(text || '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/^#{1,6}\s+.*$/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}

export function getSourcePresentation(text, previewLength = 150) {
  const raw = String(text || '').trim()
  const sectionMatch = raw.match(SECTION_PREFIX)
  const body = raw.slice(sectionMatch?.[0].length || 0).trim()
  const plainPreview = toPlainPreview(body)
  const limit = Math.max(1, Number(previewLength) || 150)
  const preview = plainPreview.length > limit ? `${plainPreview.slice(0, limit)}…` : plainPreview

  return {
    section: sectionMatch?.[1] || '',
    body,
    preview
  }
}
