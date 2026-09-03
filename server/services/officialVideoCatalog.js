const OFFICIAL_HOST = 'static.xftrans.cn'
const OFFICIAL_SOURCE_PAGE = 'https://h5.xftrans.cn/wechatServer/serverH5/entry/self-service.html#/instruction-new'

const MODEL_SOURCES = {
  '翻译机4.0': `${OFFICIAL_SOURCE_PAGE}?activeIndex=1`,
  '翻译机2.0': `${OFFICIAL_SOURCE_PAGE}?activeIndex=0`
}

function officialVideo({ externalId, title, productModel, category, path, thumbnailPath, playbackUrl = '', tags }) {
  return Object.freeze({
    externalId,
    title,
    description: `科大讯飞官方使用指南视频：${title}。适用于${productModel === '翻译机2.0' ? '讯飞双屏翻译机 2.0' : '翻译机 4.0'}。`,
    brand: '科大讯飞',
    productLine: '翻译机',
    productModel,
    category,
    tags: [...new Set([title, category, productModel, '官方视频', ...(tags || [])])],
    durationSeconds: 0,
    videoUrl: `https://${OFFICIAL_HOST}${path}`,
    playbackUrl,
    thumbnailUrl: `https://${OFFICIAL_HOST}${thumbnailPath}`,
    sourceProvider: 'iflytek-h5',
    sourcePageUrl: MODEL_SOURCES[productModel],
    sourcePriority: 100
  })
}

export const OFFICIAL_VIDEO_CATALOG = Object.freeze([
  officialVideo({
    externalId: 'cce19559:voice', title: '语音翻译', productModel: '翻译机4.0', category: '翻译功能',
    path: '/static/files/use-guide/fyj/lc/voice.mp4', thumbnailPath: '/static/files/use-guide/fyj/lc/voice.png',
    tags: ['按键翻译', '中文键', '外文键', '对话翻译']
  }),
  officialVideo({
    externalId: 'cce19559:auto-trans', title: '免按键翻译', productModel: '翻译机4.0', category: '翻译功能',
    path: '/static/files/use-guide/fyj/lc/auto_trans.mp4', thumbnailPath: '/static/files/use-guide/fyj/lc/auto_trans.png',
    tags: ['免按键', '自动翻译', '连续对话']
  }),
  officialVideo({
    externalId: 'cce19559:session', title: '面对面翻译', productModel: '翻译机4.0', category: '翻译功能',
    path: '/static/files/use-guide/fyj/lc/session.mp4', thumbnailPath: '/static/files/use-guide/fyj/lc/session.png',
    tags: ['面对面', '会话翻译', '双人对话']
  }),
  officialVideo({
    externalId: 'cce19559:ocr', title: '拍照翻译', productModel: '翻译机4.0', category: '拍照翻译',
    path: '/static/files/use-guide/fyj/lc/ocr.mp4', thumbnailPath: '/static/files/use-guide/fyj/lc/ocr.png',
    tags: ['照片翻译', '图片翻译', '相机', 'OCR']
  }),
  officialVideo({
    externalId: 'f7a055c0:quick-start', title: '快速上手', productModel: '翻译机2.0', category: '基础使用',
    path: '/static/files/user-guide/fyj_tb/v1/01_base_v1.mp4', thumbnailPath: '/static/files/user-guide/fyj_tb/v1/01_base_v1.jpg',
    playbackUrl: 'https://cloud.video.taobao.com/play/u/null/p/1/e/6/t/1/518142012362.mp4',
    tags: ['首次使用', '第一次使用', '新机激活', '开机', '入门', '快速上手']
  }),
  officialVideo({
    externalId: 'f7a055c0:voice', title: '语音翻译', productModel: '翻译机2.0', category: '翻译功能',
    path: '/static/files/user-guide/fyj_tb/v1/voice.mp4', thumbnailPath: '/static/files/user-guide/fyj_tb/v1/voice.jpg',
    tags: ['按键翻译', '对话翻译', '口语翻译']
  }),
  officialVideo({
    externalId: 'f7a055c0:denoise', title: '强降噪', productModel: '翻译机2.0', category: '语音功能',
    path: '/static/files/user-guide/fyj_tb/v1/denoise.mp4', thumbnailPath: '/static/files/user-guide/fyj_tb/v1/denoise.jpg',
    tags: ['降噪', '嘈杂环境', '声音']
  }),
  officialVideo({
    externalId: 'f7a055c0:meeting', title: '会议翻译', productModel: '翻译机2.0', category: '翻译功能',
    path: '/static/files/user-guide/fyj_tb/v1/talk_v3.mp4', thumbnailPath: '/static/files/user-guide/fyj_tb/v1/talk_v3.jpg',
    playbackUrl: 'https://cloud.video.taobao.com/play/u/null/p/1/e/6/t/1/518177674048.mp4',
    tags: ['会议', '多人会议', '会议记录']
  }),
  officialVideo({
    externalId: 'f7a055c0:listening', title: '旁听同传', productModel: '翻译机2.0', category: '翻译功能',
    path: '/static/files/user-guide/fyj_tb/v1/tape.mp4', thumbnailPath: '/static/files/user-guide/fyj_tb/v1/tape.jpg',
    tags: ['旁听', '同传', '同声传译', '实时字幕']
  }),
  officialVideo({
    externalId: 'f7a055c0:call', title: '通话翻译', productModel: '翻译机2.0', category: '翻译功能',
    path: '/static/files/user-guide/fyj_tb/v1/sitelecom.mp4', thumbnailPath: '/static/files/user-guide/fyj_tb/v1/sitelecom.jpg',
    playbackUrl: 'https://cloud.video.taobao.com/play/u/null/p/1/e/6/t/1/525386076064.mp4',
    tags: ['通话', '电话翻译', '远程沟通']
  }),
  officialVideo({
    externalId: 'f7a055c0:ocr', title: '拍照翻译', productModel: '翻译机2.0', category: '拍照翻译',
    path: '/static/files/use-guide/fyj_tb/v1/ocr.mp4', thumbnailPath: '/static/files/use-guide/fyj_tb/v1/ocr.jpg',
    playbackUrl: 'https://cloud.video.taobao.com/play/u/null/p/1/e/6/t/1/518141628845.mp4',
    tags: ['照片翻译', '图片翻译', '相机', 'OCR']
  }),
  officialVideo({
    externalId: 'f7a055c0:group', title: '群组翻译', productModel: '翻译机2.0', category: '翻译功能',
    path: '/static/files/user-guide/fyj_tb/v1/meeting.mp4', thumbnailPath: '/static/files/user-guide/fyj_tb/v1/meeting.jpg',
    playbackUrl: 'https://cloud.video.taobao.com/play/u/null/p/1/e/6/t/1/518097705641.mp4',
    tags: ['群组', '多人翻译', '群聊']
  }),
  officialVideo({
    externalId: 'f7a055c0:subtitle', title: '同声字幕', productModel: '翻译机2.0', category: '翻译功能',
    path: '/static/files/user-guide/fyj_tb/v1/assist.mp4', thumbnailPath: '/static/files/user-guide/fyj_tb/v1/assist.jpg',
    playbackUrl: 'https://cloud.video.taobao.com/play/u/null/p/1/e/6/t/1/518097661584.mp4',
    tags: ['同声字幕', '实时字幕', '字幕翻译', '同传']
  }),
  officialVideo({
    externalId: 'f7a055c0:speech', title: '演讲翻译', productModel: '翻译机2.0', category: '翻译功能',
    path: '/static/files/user-guide/fyj_tb/v1/lecture.mp4', thumbnailPath: '/static/files/user-guide/fyj_tb/v1/lecture.jpg',
    playbackUrl: 'https://cloud.video.taobao.com/play/u/null/p/1/e/6/t/1/518141928236.mp4',
    tags: ['演讲', '演讲翻译', '讲座']
  }),
  officialVideo({
    externalId: 'f7a055c0:assistant', title: '讯飞翻译助手', productModel: '翻译机2.0', category: '基础使用',
    path: '/static/files/user-guide/fyj_tb/v1/iflytransassistant.mp4', thumbnailPath: '/static/files/user-guide/fyj_tb/v1/iflytransassistant.jpg',
    tags: ['翻译助手', '手机助手', '配套应用']
  }),
  officialVideo({
    externalId: 'f7a055c0:records', title: '记录导出', productModel: '翻译机2.0', category: '基础使用',
    path: '/static/files/user-guide/fyj_tb/v1/records.mp4', thumbnailPath: '/static/files/user-guide/fyj_tb/v1/records.jpg',
    playbackUrl: 'https://cloud.video.taobao.com/play/u/null/p/1/e/6/t/1/518142352135.mp4',
    tags: ['记录导出', '翻译记录', '导出记录', '同步记录']
  })
])

export function isTrustedOfficialVideoUrl(value) {
  try {
    const url = new URL(String(value || ''))
    return url.protocol === 'https:' && url.hostname === OFFICIAL_HOST &&
      url.pathname.startsWith('/static/files/') && url.pathname.toLowerCase().endsWith('.mp4') &&
      !url.username && !url.password && !url.search && !url.hash
  } catch {
    return false
  }
}

export function isTrustedOfficialThumbnailUrl(value) {
  try {
    const url = new URL(String(value || ''))
    return url.protocol === 'https:' && url.hostname === OFFICIAL_HOST &&
      url.pathname.startsWith('/static/files/') && /\.(?:png|jpe?g)$/i.test(url.pathname) &&
      !url.username && !url.password && !url.search && !url.hash
  } catch {
    return false
  }
}

export function isTrustedPlaybackVideoUrl(value) {
  if (!value) return true
  try {
    const url = new URL(String(value))
    return url.protocol === 'https:' && url.hostname === 'cloud.video.taobao.com' &&
      /^\/+play\/u\/(?:null|\d+)\/p\/1\/e\/6\/t\/1\/\d+\.mp4$/i.test(url.pathname) &&
      !url.username && !url.password && !url.search && !url.hash
  } catch {
    return false
  }
}

export function getOfficialVideoCatalog() {
  return OFFICIAL_VIDEO_CATALOG.map(item => ({ ...item, tags: [...item.tags] }))
}

export function selectOfficialVideos(externalIds) {
  if (!Array.isArray(externalIds)) throw new TypeError('请选择要导入的官方视频')
  const requested = [...new Set(externalIds.map(value => String(value || '').trim()).filter(Boolean))]
  if (requested.length === 0 || requested.length > OFFICIAL_VIDEO_CATALOG.length) throw new TypeError('请选择 1-16 条官方视频')
  const byId = new Map(OFFICIAL_VIDEO_CATALOG.map(item => [item.externalId, item]))
  const selected = requested.map(id => byId.get(id))
  if (selected.some(item => !item)) throw new TypeError('包含不在可信目录中的视频')
  return selected.map(item => ({ ...item, tags: [...item.tags] }))
}

export const OFFICIAL_VIDEO_PROVIDER = 'iflytek-h5'
