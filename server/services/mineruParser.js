import fs from 'fs'
import path from 'path'
import dotenv from 'dotenv'
dotenv.config()

const MINERU_API_KEY = process.env.MINERU_API_KEY
const MINERU_API_URL = process.env.MINERU_API_URL || 'https://mineru.net'
const MAX_ZIP_BYTES = Math.max(1, Number(process.env.MAX_MINERU_ZIP_MB) || 200) * 1024 * 1024
const MAX_EXTRACTED_BYTES = Math.max(
  MAX_ZIP_BYTES,
  Math.max(1, Number(process.env.MAX_MINERU_EXTRACTED_MB) || 300) * 1024 * 1024
)

/**
 * 使用 MinerU API 解析文档为 Markdown
 * 流程：批量上传 -> 轮询结果 -> 下载 zip -> 提取 markdown + 图片
 * 返回: { content, metadata }
 */
export async function parseWithMineru(filePath, fileType, docId = null) {
  if (!MINERU_API_KEY) {
    throw new Error('MinerU API Key 未配置，请在 .env 中设置 MINERU_API_KEY')
  }

  const fileName = path.basename(filePath)
  console.log(`[MinerU] 开始解析文件: ${fileName}`)

  // 1. 申请上传链接
  const batchRes = await requestBatchUpload(fileName)
  const { batch_id, file_urls } = batchRes
  const uploadUrl = file_urls[0]
  console.log(`[MinerU] 获得上传链接, batch_id: ${batch_id}`)

  // 2. 上传文件
  await uploadFile(filePath, uploadUrl)
  console.log(`[MinerU] 文件上传成功`)

  // 3. 轮询任务结果
  const taskResult = await pollTaskResult(batch_id)
  console.log(`[MinerU] 解析完成, state: ${taskResult.state}`)

  // 4. 下载 zip 并提取 markdown + 图片
  const result = await downloadAndExtractAll(taskResult.full_zip_url, docId)
  console.log(`[MinerU] Markdown 提取成功, 长度: ${result.content.length}, 图片: ${result.images.length} 张`)

  return {
    content: result.content,
    metadata: {
      task_id: batch_id,
      batch_id: batch_id,
      zip_url: taskResult.full_zip_url,
      pages: taskResult.total_pages || 0,
      model: 'pipeline',
      images: result.images
    }
  }
}

/**
 * 申请批量上传链接
 */
async function requestBatchUpload(fileName) {
  const res = await fetch(`${MINERU_API_URL}/api/v4/file-urls/batch`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${MINERU_API_KEY}`
    },
    body: JSON.stringify({
      files: [{ name: fileName, data_id: `doc_${Date.now()}` }],
      model_version: 'pipeline'
    })
  })

  const data = await res.json()
  if (data.code !== 0) {
    throw new Error(`MinerU 申请上传链接失败: ${data.msg}`)
  }

  return {
    batch_id: data.data.batch_id,
    file_urls: data.data.file_urls
  }
}

/**
 * 上传文件到指定 URL
 */
async function uploadFile(filePath, uploadUrl) {
  const fileBuffer = fs.readFileSync(filePath)

  const res = await fetch(uploadUrl, {
    method: 'PUT',
    body: fileBuffer
  })

  if (!res.ok) {
    throw new Error(`MinerU 文件上传失败, HTTP ${res.status}`)
  }
}

/**
 * 轮询批量任务结果，直到完成或失败
 * 使用 /api/v4/extract-results/batch/{batch_id} 接口
 */
async function pollTaskResult(batchId, maxWait = 300000, interval = 3000) {
  const startTime = Date.now()

  while (Date.now() - startTime < maxWait) {
    const res = await fetch(`${MINERU_API_URL}/api/v4/extract-results/batch/${batchId}`, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${MINERU_API_KEY}`
      }
    })

    const data = await res.json()
    if (data.code !== 0) {
      throw new Error(`MinerU 查询批量结果失败: ${data.msg}`)
    }

    // 批量结果返回 extract_result 数组
    const results = data.data.extract_result || []
    if (results.length === 0) {
      await sleep(interval)
      continue
    }

    // 取第一个文件的结果
    const result = results[0]
    const { state, full_zip_url, err_msg, extract_progress } = result

    if (state === 'done') {
      return {
        state,
        full_zip_url,
        total_pages: extract_progress?.total_pages || 0
      }
    }

    if (state === 'failed') {
      throw new Error(`MinerU 解析失败: ${err_msg || '未知错误'}`)
    }

    // 打印进度
    if (extract_progress) {
      console.log(`[MinerU] 解析进度: ${extract_progress.extracted_pages}/${extract_progress.total_pages} 页`)
    } else {
      console.log(`[MinerU] 任务状态: ${state}`)
    }

    // 等待后重试
    await sleep(interval)
  }

  throw new Error('MinerU 解析超时（超过 5 分钟）')
}

/**
 * 下载 zip 文件并提取 markdown 内容和图片
 * 图片保存到 uploads/images/{docId}/ 目录
 * 同时更新 markdown 中的图片路径为本地 URL
 */
async function downloadAndExtractAll(zipUrl, docId) {
  const res = await fetch(zipUrl)
  if (!res.ok) {
    throw new Error(`下载 zip 文件失败, HTTP ${res.status}`)
  }

  const declaredLength = Number(res.headers.get('content-length') || 0)
  if (declaredLength > MAX_ZIP_BYTES) throw new Error('MinerU 结果压缩包过大')
  const reader = res.body.getReader()
  const chunks = []
  let downloaded = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    downloaded += value.byteLength
    if (downloaded > MAX_ZIP_BYTES) {
      await reader.cancel()
      throw new Error('MinerU 结果压缩包超过大小限制')
    }
    chunks.push(Buffer.from(value))
  }
  const buffer = Buffer.concat(chunks, downloaded)

  // 使用 JSZip 解析 zip
  const JSZip = (await import('jszip')).default
  const zip = await JSZip.loadAsync(buffer)
  const declaredExtracted = Object.values(zip.files).reduce((sum, file) => sum + Number(file?._data?.uncompressedSize || 0), 0)
  if (declaredExtracted > MAX_EXTRACTED_BYTES) throw new Error('MinerU 解压结果过大')

  // 提取 full.md
  let markdownContent = ''
  for (const [name, file] of Object.entries(zip.files)) {
    if (name.endsWith('full.md')) {
      markdownContent = await file.async('string')
      break
    }
  }

  if (!markdownContent) {
    // 尝试查找任何 .md 文件
    for (const [name, file] of Object.entries(zip.files)) {
      if (name.endsWith('.md')) {
        markdownContent = await file.async('string')
        break
      }
    }
  }

  if (!markdownContent) {
    throw new Error('zip 文件中未找到 Markdown 文件')
  }

  // 提取图片
  const images = []
  const imageDir = path.resolve(process.env.UPLOAD_DIR || './uploads', 'images', docId ? String(docId) : 'unknown')
  if (!fs.existsSync(imageDir)) fs.mkdirSync(imageDir, { recursive: true })

  const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.tiff']
  for (const [name, file] of Object.entries(zip.files)) {
    if (file.dir) continue // 跳过目录
    const ext = path.extname(name).toLowerCase()
    if (imageExtensions.includes(ext)) {
      const imgFileName = path.basename(name)
      const imgBuffer = await file.async('nodebuffer')
      const imgPath = path.join(imageDir, imgFileName)
      fs.writeFileSync(imgPath, imgBuffer)
      // 记录图片信息，用于更新 markdown 路径
      images.push({
        originalPath: name, // zip 中的相对路径，如 images/xxx.jpg
        localFileName: imgFileName,
        localPath: imgPath,
        url: `/uploads/images/${docId || 'unknown'}/${imgFileName}`
      })
    }
  }

  // 更新 markdown 中的图片路径
  for (const img of images) {
    // 匹配各种可能的图片引用格式
    // ![alt](images/xxx.jpg) 或 ![](images/xxx.jpg)
    const escapedOriginal = img.originalPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const regex = new RegExp(`!\\[([^\\]]*)\\]\\(${escapedOriginal}\\)`, 'g')
    markdownContent = markdownContent.replace(regex, `![$1](${img.url})`)

    // 也匹配只有文件名的引用
    const baseName = img.localFileName
    const escapedBase = baseName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const regex2 = new RegExp(`!\\[([^\\]]*)\\]\\((?:[^)]*[/\\\\])?${escapedBase}\\)`, 'g')
    markdownContent = markdownContent.replace(regex2, `![$1](${img.url})`)
  }

  return { content: markdownContent, images }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}
