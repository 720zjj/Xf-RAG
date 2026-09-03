const DEFAULT_TIMEOUT_MS = 8000
const MIN_TIMEOUT_MS = 1000
const MAX_TIMEOUT_MS = 30000
const JOB_ID_PATTERN = /^[A-Za-z0-9_-]{1,80}$/

function text(value, fallback = '') {
  if (typeof value !== 'string' && typeof value !== 'number') return fallback
  return String(value).replace(/\s+/g, ' ').trim() || fallback
}

function parseList(value) {
  if (Array.isArray(value)) return value
  if (typeof value !== 'string') return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function safeHttpUrl(value) {
  const raw = text(value)
  if (!raw) return ''
  try {
    const parsed = new URL(raw)
    return ['http:', 'https:'].includes(parsed.protocol) ? parsed.toString() : ''
  } catch {
    return ''
  }
}

function listText(value) {
  return parseList(value).map((item, index) => {
    if (typeof item === 'string' || typeof item === 'number') return text(item)
    if (!item || typeof item !== 'object') return ''
    const title = text(item.title || item.name || item.label, `第 ${index + 1} 步`)
    const body = text(item.description || item.content || item.instruction || item.action || item.text || item.step)
    const detail = text(item.detail || item.tip || item.note || item.reminder)
    return [title, body, detail].filter(Boolean).join('：')
  }).filter(Boolean)
}

export function getOpenMaicVideoConfig(env = process.env) {
  const rawBaseUrl = text(env.OPENMAIC_BASE_URL)
  const requestedTimeout = Number(env.OPENMAIC_TIMEOUT_MS)
  const timeoutMs = Number.isFinite(requestedTimeout)
    ? Math.min(MAX_TIMEOUT_MS, Math.max(MIN_TIMEOUT_MS, Math.round(requestedTimeout)))
    : DEFAULT_TIMEOUT_MS

  if (!rawBaseUrl) {
    return {
      configured: false,
      baseUrl: '',
      accessCode: '',
      timeoutMs,
      reason: '尚未配置 OPENMAIC_BASE_URL'
    }
  }

  let url
  try {
    url = new URL(rawBaseUrl)
  } catch {
    return { configured: false, baseUrl: '', accessCode: '', timeoutMs, reason: 'OPENMAIC_BASE_URL 不是有效网址' }
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    return { configured: false, baseUrl: '', accessCode: '', timeoutMs, reason: 'OPENMAIC_BASE_URL 只允许不含账号密码的 HTTP(S) 地址' }
  }
  url.search = ''
  url.hash = ''

  return {
    configured: true,
    baseUrl: url.toString().replace(/\/$/, ''),
    accessCode: text(env.OPENMAIC_ACCESS_CODE),
    timeoutMs,
    reason: ''
  }
}

function requestHeaders(config, hasBody = false) {
  const headers = { Accept: 'application/json' }
  if (hasBody) headers['Content-Type'] = 'application/json'
  if (config.accessCode) headers.Authorization = `Bearer ${config.accessCode}`
  return headers
}

async function requestJson(pathname, options = {}) {
  const config = options.config || getOpenMaicVideoConfig()
  if (!config.configured) throw new Error(config.reason)
  const request = options.fetchImpl || globalThis.fetch
  if (typeof request !== 'function') throw new Error('当前 Node.js 环境不支持访问 OpenMAIC')

  let response
  try {
    response = await request(`${config.baseUrl}${pathname}`, {
      method: options.method || 'GET',
      headers: requestHeaders(config, options.body !== undefined),
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
      signal: AbortSignal.timeout(config.timeoutMs)
    })
  } catch (error) {
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') throw new Error('连接 OpenMAIC 超时', { cause: error })
    throw new Error('无法连接 OpenMAIC 服务', { cause: error })
  }

  const data = await response.json().catch(() => null)
  if (!response.ok || data?.success === false) {
    const message = text(data?.error || data?.message, `OpenMAIC 请求失败（HTTP ${response.status}）`)
    throw new Error(message.slice(0, 300))
  }
  if (!data || typeof data !== 'object') throw new Error('OpenMAIC 返回了无法识别的响应')
  return data
}

export function buildOpenMaicVideoRequirement(sop) {
  if (!sop || typeof sop !== 'object') throw new TypeError('需要有效的 SOP')
  const title = text(sop.title, '产品操作指南')
  const productLine = text(sop.product_line || sop.productLine, '翻译机')
  const productModel = text(sop.product_model || sop.productModel, '对应型号')
  const category = text(sop.category, '操作指南')
  const prerequisites = listText(sop.prerequisites)
  const steps = listText(sop.steps)
  const warnings = listText(sop.warnings)
  const completionCheck = text(sop.completion_check || sop.completionCheck)
  if (!steps.length) throw new TypeError('SOP 没有可用于生成视频的有效步骤')

  const numbered = values => values.map((item, index) => `${index + 1}. ${item}`).join('\n')
  const section = (name, values, fallback = '无') => `${name}：\n${values.length ? numbered(values) : fallback}`

  return `你是一名克制、严谨的消费电子售后教学设计师。请为淘宝顾客制作一份可导出为 MP4 的中文线性微教程课堂草稿。

【成片目标】
- 时长控制在 45–75 秒，16:9，节奏平稳，适合手机和电脑观看。
- 只使用讲解型幻灯片场景，按照“问题说明 → 准备 → 分步操作 → 完成确认 → 仍未解决时联系人工客服”的顺序。
- 不要测验、PBL、课堂讨论、虚拟老师、数字人、人物对话、夸张转场、科幻 HUD 或营销口号。
- 视觉采用简洁留白、低饱和中性色与少量品牌蓝；每屏只表达一个动作，字幕每行尽量不超过 18 个汉字。
- 旁白使用自然、书面的简体中文短句，不使用“首先呢”“大家好”等 AI 视频套话。

【真实性边界】
- 下方 SOP 是唯一事实来源。不得改变步骤顺序，不得补造按钮名称、菜单位置、功能、参数或完成标志。
- 只有材料中明确提供的真实产品图片、截图或录屏才能作为设备画面；当前输入若没有视觉素材，请使用中性的编号步骤卡、方向箭头和抽象示意图。
- 严禁生成假的设备界面、按键位置、产品外观、手部操作或品牌标识；无法确认的画面必须留白或标注“以设备实际界面为准”。
- 警告内容必须完整保留，并用清晰但不过度惊吓的方式呈现。

【课程信息】
标题：${title}
产品线：${productLine}
型号：${productModel}
类别：${category}

${section('开始前准备', prerequisites)}

操作步骤：
${numbered(steps)}

${section('安全与注意事项', warnings)}

完成确认：${completionCheck || '按 SOP 原文确认操作结果；不要自行补造成功标志。'}

请生成可供管理员逐场景审核和修改的课堂草稿。不要声称已经实拍，也不要把生成式画面描述为真实设备画面。`
}

export async function checkOpenMaicVideoService(options = {}) {
  const config = options.config || getOpenMaicVideoConfig()
  if (!config.configured) {
    return { configured: false, reachable: false, ready: false, reason: config.reason, capabilities: {} }
  }
  try {
    const data = await requestJson('/api/health', { ...options, config })
    const capabilities = data.capabilities && typeof data.capabilities === 'object' ? data.capabilities : {}
    return {
      configured: true,
      reachable: true,
      ready: data.status === 'ok' || data.ok === true || data.success === true,
      version: text(data.version),
      capabilities: {
        tts: capabilities.tts === true,
        imageGeneration: capabilities.imageGeneration === true,
        videoGeneration: capabilities.videoGeneration === true
      },
      reason: ''
    }
  } catch (error) {
    return { configured: true, reachable: false, ready: false, reason: error.message, capabilities: {} }
  }
}

export async function submitOpenMaicVideoDraft(sop, options = {}) {
  const config = options.config || getOpenMaicVideoConfig()
  const status = options.status || await checkOpenMaicVideoService({ ...options, config })
  if (!status.ready) throw new Error(status.reason || 'OpenMAIC 服务尚未就绪')

  const data = await requestJson('/api/generate-classroom', {
    ...options,
    config,
    method: 'POST',
    body: {
      requirement: buildOpenMaicVideoRequirement(sop),
      enableWebSearch: false,
      enableImageGeneration: false,
      enableVideoGeneration: false,
      enableTTS: status.capabilities?.tts === true,
      agentMode: 'default'
    }
  })
  if (!JOB_ID_PATTERN.test(text(data.jobId))) throw new Error('OpenMAIC 未返回有效的任务编号')
  return normalizeOpenMaicJob(data)
}

export async function getOpenMaicVideoDraftJob(jobId, options = {}) {
  const normalizedJobId = text(jobId)
  if (!JOB_ID_PATTERN.test(normalizedJobId)) throw new TypeError('OpenMAIC 任务编号无效')
  const data = await requestJson(`/api/generate-classroom/${encodeURIComponent(normalizedJobId)}`, options)
  return normalizeOpenMaicJob(data)
}

export function normalizeOpenMaicJob(data) {
  const result = data?.result && typeof data.result === 'object' ? data.result : {}
  const status = text(data?.status, 'queued')
  return {
    jobId: text(data?.jobId),
    status,
    step: text(data?.step),
    progress: Math.min(100, Math.max(0, Number(data?.progress) || 0)),
    message: text(data?.message),
    scenesGenerated: Math.max(0, Number(data?.scenesGenerated) || 0),
    totalScenes: Math.max(0, Number(data?.totalScenes) || 0),
    done: data?.done === true || status === 'succeeded' || status === 'failed',
    error: text(data?.error),
    classroomId: text(result.classroomId || result.id),
    classroomUrl: safeHttpUrl(result.url)
  }
}

export const OPENMAIC_VIDEO_JOB_ID_PATTERN = JOB_ID_PATTERN
