import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildOpenMaicVideoRequirement,
  checkOpenMaicVideoService,
  getOpenMaicVideoConfig,
  getOpenMaicVideoDraftJob,
  normalizeOpenMaicJob,
  submitOpenMaicVideoDraft
} from '../server/services/openMaicVideoService.js'

const sop = {
  title: '翻译机联网设置',
  product_line: '翻译机',
  product_model: '讯飞翻译机4.0',
  category: '网络设置',
  prerequisites: ['翻译机已开机'],
  steps: [
    { title: '打开设置', description: '在主界面进入设置' },
    { title: '连接网络', action: '选择 WLAN 并输入密码', detail: '等待显示已连接' }
  ],
  warnings: ['不要连接来源不明的网络'],
  completion_check: '状态栏显示 Wi-Fi 图标'
}

function jsonResponse(data, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return data }
  }
}

test('OpenMAIC 未配置时保持禁用，且不暴露伪就绪状态', () => {
  assert.deepEqual(getOpenMaicVideoConfig({}), {
    configured: false,
    baseUrl: '',
    accessCode: '',
    timeoutMs: 8000,
    reason: '尚未配置 OPENMAIC_BASE_URL'
  })
  assert.equal(getOpenMaicVideoConfig({ OPENMAIC_BASE_URL: 'file:///tmp/openmaic' }).configured, false)
})

test('高品质草稿提示词保留 SOP 事实并禁止伪造产品画面', () => {
  const requirement = buildOpenMaicVideoRequirement(sop)
  assert.match(requirement, /翻译机联网设置/)
  assert.match(requirement, /选择 WLAN 并输入密码/)
  assert.match(requirement, /状态栏显示 Wi-Fi 图标/)
  assert.match(requirement, /严禁生成假的设备界面/)
  assert.match(requirement, /不要测验、PBL、课堂讨论、虚拟老师/)
})

test('OpenMAIC 探活只返回能力，不泄露访问码', async () => {
  const config = getOpenMaicVideoConfig({
    OPENMAIC_BASE_URL: 'http://127.0.0.1:3200/',
    OPENMAIC_ACCESS_CODE: 'secret'
  })
  const seen = []
  const status = await checkOpenMaicVideoService({
    config,
    fetchImpl: async (url, options) => {
      seen.push({ url, options })
      return jsonResponse({ status: 'ok', version: '1.0.0', capabilities: { tts: true } })
    }
  })
  assert.equal(status.ready, true)
  assert.equal(status.capabilities.tts, true)
  assert.equal(seen[0].url, 'http://127.0.0.1:3200/api/health')
  assert.equal(seen[0].options.headers.Authorization, 'Bearer secret')
  assert.equal(JSON.stringify(status).includes('secret'), false)
})

test('提交草稿关闭网页搜索和生成式图片视频，只按能力启用 TTS', async () => {
  const config = getOpenMaicVideoConfig({ OPENMAIC_BASE_URL: 'https://openmaic.example.test' })
  let submitted
  const job = await submitOpenMaicVideoDraft(sop, {
    config,
    status: { ready: true, capabilities: { tts: true } },
    fetchImpl: async (_url, options) => {
      submitted = JSON.parse(options.body)
      return jsonResponse({ success: true, jobId: 'job_123', status: 'queued', step: 'queued' }, 202)
    }
  })
  assert.equal(job.jobId, 'job_123')
  assert.equal(submitted.enableWebSearch, false)
  assert.equal(submitted.enableImageGeneration, false)
  assert.equal(submitted.enableVideoGeneration, false)
  assert.equal(submitted.enableTTS, true)
  assert.match(submitted.requirement, /SOP 是唯一事实来源/)
})

test('任务查询拒绝路径型编号并规范化最终课堂链接', async () => {
  await assert.rejects(() => getOpenMaicVideoDraftJob('../health'), /任务编号无效/)
  assert.deepEqual(normalizeOpenMaicJob({
    jobId: 'abc', status: 'succeeded', progress: 120, result: { id: 'room-1', url: 'https://example.test/classroom/room-1' }
  }), {
    jobId: 'abc', status: 'succeeded', step: '', progress: 100, message: '', scenesGenerated: 0,
    totalScenes: 0, done: true, error: '', classroomId: 'room-1', classroomUrl: 'https://example.test/classroom/room-1'
  })
  assert.equal(normalizeOpenMaicJob({
    jobId: 'abc', status: 'succeeded', result: { url: 'javascript:alert(1)' }
  }).classroomUrl, '')
})
