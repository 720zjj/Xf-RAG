import fs from 'fs'

import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const pdfParse = require('pdf-parse')

// mammoth 支持 ESM
import mammoth from 'mammoth'

/**
 * 解析文档，提取纯文本内容
 * @param {string} filePath - 文件路径
 * @param {string} fileType - 文件类型 (pdf, docx, md, txt)
 * @returns {Promise<string>} 提取的文本内容
 */
export async function parseDocument(filePath, fileType) {
  switch (fileType) {
    case 'pdf':
      return parsePDF(filePath)
    case 'docx':
      return parseDocx(filePath)
    case 'md':
      return parseMarkdown(filePath)
    case 'txt':
      return parseTxt(filePath)
    default:
      throw new Error(`不支持的文件类型: ${fileType}`)
  }
}

// PDF 解析
async function parsePDF(filePath) {
  const dataBuffer = fs.readFileSync(filePath)
  const data = await pdfParse(dataBuffer)
  return data.text || ''
}

// Word 解析
async function parseDocx(filePath) {
  const result = await mammoth.extractRawText({ path: filePath })
  return result.value || ''
}

// Markdown 解析（去除标记，提取纯文本）
async function parseMarkdown(filePath) {
  let content = fs.readFileSync(filePath, 'utf-8')
  // 去除 markdown 标记
  content = content
    .replace(/^#{1,6}\s+/gm, '')       // 标题
    .replace(/\*\*(.+?)\*\*/g, '$1')    // 粗体
    .replace(/\*(.+?)\*/g, '$1')        // 斜体
    .replace(/`(.+?)`/g, '$1')          // 行内代码
    .replace(/```[\s\S]*?```/g, '')     // 代码块
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // 链接
    .replace(/^[-*+]\s+/gm, '')         // 列表
    .replace(/^\d+\.\s+/gm, '')         // 有序列表
    .replace(/^>\s+/gm, '')             // 引用
    .replace(/^---+$/gm, '')            // 分隔线
    .replace(/\|/g, ' ')                // 表格
  return content.trim()
}

// 纯文本
async function parseTxt(filePath) {
  return fs.readFileSync(filePath, 'utf-8')
}
