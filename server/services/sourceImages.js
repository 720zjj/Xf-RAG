const LOCAL_IMAGE_PATTERN = /!\[[^\]]*\]\(\s*(\/uploads\/images\/(\d+)\/([^\s/)]+))\s*\)/g
const IMAGE_EXTENSION_PATTERN = /\.(?:jpe?g|png|gif|bmp|webp|tiff)$/i

function isSafeImageFilename(filename) {
  try {
    const decoded = decodeURIComponent(filename)
    return !decoded.includes('/') && !decoded.includes('\\') && IMAGE_EXTENSION_PATTERN.test(decoded)
  } catch {
    return false
  }
}

// 只接受当前文档由解析流程生成的本地图片链接，避免把外链或其他文档的图片带给用户。
export function extractSourceImageUrls(markdown, docId) {
  const currentDocId = String(docId)
  const urls = new Set()

  for (const match of String(markdown || '').matchAll(LOCAL_IMAGE_PATTERN)) {
    const [, url, imageDocId, filename] = match
    if (imageDocId === currentDocId && isSafeImageFilename(filename)) urls.add(url)
  }

  return [...urls]
}

// 图片常与说明文字被切到相邻检索块；未在命中块内时，再从原文附近补充图片。
export function findNearbySourceImages({ docId, chunkText, documentContent, contextChars = 500 }) {
  const inlineImages = extractSourceImageUrls(chunkText, docId)
  if (inlineImages.length > 0) return inlineImages

  const content = String(documentContent || '')
  const excerpt = String(chunkText || '').trim()
  if (!content || !excerpt) return []

  const position = content.indexOf(excerpt)
  if (position < 0) return []

  const start = Math.max(0, position - contextChars)
  const end = Math.min(content.length, position + excerpt.length + contextChars)
  return extractSourceImageUrls(content.slice(start, end), docId)
}
