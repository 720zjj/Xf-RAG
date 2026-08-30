import crypto from 'crypto'

const MAX_STEP_SCENES = 7
const MAX_TITLE_LENGTH = 180
const MAX_STEP_BODY_LENGTH = 360
const MAX_NOTE_LENGTH = 180
const MAX_PREPARATION_ITEMS = 8

function toText(value, fallback = '') {
  if (typeof value !== 'string' && typeof value !== 'number') return fallback
  return String(value).replace(/\s+/g, ' ').trim() || fallback
}

function assertLength(value, label, maxLength) {
  if (value.length > maxLength) throw new TypeError(`${label}不能超过 ${maxLength} 个字符`)
  return value
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

function textList(value, label) {
  const items = parseList(value).map(item => {
    if (typeof item === 'object' && item !== null) {
      return toText(item.content || item.text || item.title || item.description)
    }
    return toText(item)
  }).filter(Boolean)
  if (items.length > MAX_PREPARATION_ITEMS) throw new TypeError(`${label}不能超过 ${MAX_PREPARATION_ITEMS} 项`)
  return items.map(item => assertLength(item, label, MAX_NOTE_LENGTH))
}

function normalizeStep(value, index) {
  if (typeof value === 'string' || typeof value === 'number') {
    const body = toText(value)
    return body ? { title: `第 ${index + 1} 步`, body: assertLength(body, '步骤内容', MAX_STEP_BODY_LENGTH), notes: [] } : null
  }
  if (!value || typeof value !== 'object') return null

  const title = assertLength(toText(value.title || value.name || value.label, `第 ${index + 1} 步`), '步骤标题', MAX_TITLE_LENGTH)
  const body = toText(value.description || value.content || value.instruction || value.action || value.text || value.step || value.title)
  if (!body) return null
  const note = toText(value.detail || value.tip || value.note || value.reminder)
  return { title, body: assertLength(body, '步骤内容', MAX_STEP_BODY_LENGTH), notes: note ? [assertLength(note, '步骤提示', MAX_NOTE_LENGTH)] : [] }
}

function stepDuration(text) {
  return Math.max(4, Math.min(6, 3 + Math.ceil(String(text).length / 7)))
}

function addTimedScene(scenes, scene) {
  const startTime = scenes.reduce((total, item) => total + item.durationSeconds, 0)
  scenes.push({
    ...scene,
    startTime,
    endTime: startTime + scene.durationSeconds
  })
}

/**
 * Convert a reviewed SOP record into a deterministic, browser-renderable video storyboard.
 * The renderer intentionally creates a captioned draft, not a substitute for filmed product footage.
 */
export function buildSopVideoStoryboard(sop) {
  if (!sop || typeof sop !== 'object') throw new TypeError('需要有效的 SOP')

  const title = assertLength(toText(sop.title, '未命名操作指南'), 'SOP 标题', MAX_TITLE_LENGTH)
  const steps = parseList(sop.steps).map(normalizeStep).filter(Boolean)
  if (!steps.length) throw new TypeError('至少需要一个有效步骤才能生成视频')

  const prerequisites = textList(sop.prerequisites, '前置条件')
  const warnings = textList(sop.warnings, '注意事项')
  const completionCheck = assertLength(toText(sop.completion_check || sop.completionCheck), '完成确认', MAX_STEP_BODY_LENGTH)
  const shownSteps = steps.slice(0, MAX_STEP_SCENES)
  const truncatedStepCount = Math.max(0, steps.length - shownSteps.length)
  const productLine = assertLength(toText(sop.product_line || sop.productLine, '翻译机'), '产品线', 80)
  const productModel = assertLength(toText(sop.product_model || sop.productModel), '产品型号', 120)
  const category = assertLength(toText(sop.category, '操作指南'), '分类', 80)
  const scenes = []

  addTimedScene(scenes, {
    id: 'intro',
    kind: 'intro',
    title,
    body: [productLine, productModel, category].filter(Boolean).join(' · '),
    durationSeconds: 4,
    notes: [],
    warnings: []
  })

  if (prerequisites.length || warnings.length) {
    addTimedScene(scenes, {
      id: 'preparation',
      kind: 'preparation',
      title: '开始前请确认',
      body: prerequisites.length ? '准备完成后，再开始操作。' : '请留意以下提示。',
      durationSeconds: 5,
      notes: prerequisites,
      warnings
    })
  }

  shownSteps.forEach((step, index) => {
    addTimedScene(scenes, {
      id: `step-${index + 1}`,
      kind: 'step',
      title: step.title,
      body: step.body,
      durationSeconds: stepDuration(step.body),
      notes: step.notes,
      warnings: [],
      stepNumber: index + 1
    })
  })

  if (completionCheck || truncatedStepCount) {
    const notice = truncatedStepCount ? `本视频展示前 ${shownSteps.length} 步，还有 ${truncatedStepCount} 个步骤请查看 SOP。` : ''
    addTimedScene(scenes, {
      id: 'completion',
      kind: 'completion',
      title: '完成确认',
      body: completionCheck || notice,
      durationSeconds: 4,
      notes: notice && completionCheck ? [notice] : [],
      warnings: []
    })
  }

  const chapters = scenes.map((scene, index) => ({
    title: scene.title,
    startTime: scene.startTime,
    endTime: scene.endTime,
    stepNumber: scene.stepNumber || null,
    keywords: [category, scene.kind === 'step' ? scene.body : scene.title].filter(Boolean).join(' '),
    chapterIndex: index + 1
  }))

  const fingerprintPayload = {
    sourceSopId: Number.isInteger(Number(sop.id)) ? Number(sop.id) : null,
    title,
    productLine,
    productModel,
    category,
    durationSeconds: scenes.reduce((total, scene) => total + scene.durationSeconds, 0),
    scenes: scenes.map(({ id, kind, title: sceneTitle, body, durationSeconds, notes, warnings, stepNumber }) => ({ id, kind, title: sceneTitle, body, durationSeconds, notes, warnings, stepNumber })),
    chapters
  }

  return {
    ...fingerprintPayload,
    scenes,
    chapters,
    truncatedStepCount,
    notice: truncatedStepCount ? `本视频只展示前 ${shownSteps.length} 步，还有 ${truncatedStepCount} 个步骤请查看 SOP。` : '',
    fingerprint: crypto.createHash('sha256').update(JSON.stringify(fingerprintPayload)).digest('hex')
  }
}

export const SOP_VIDEO_MAX_STEP_SCENES = MAX_STEP_SCENES
