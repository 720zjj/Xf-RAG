const GETTING_STARTED_PATTERN = /(不会用|不知道怎么用|不懂怎么用|不清楚怎么用|不知道如何使用|不会操作|新手入门|入门教程|(?:怎么|如何|怎样)(?:使用|操作|用)(?:这个|这台)?翻译机|(?:这个|这台)?翻译机(?:怎么|如何|怎样)(?:使用|操作|用))/
const FIRST_USE_HOW_TO_PATTERN = /(?:第一次|首次)(?:使用|拿到)(?:这个|这台)?(?:翻译机|设备)?(?:时|后)?(?:应该|要|该)?(?:怎么|如何|怎样)(?:操作|使用|用)/
const SPECIFIC_FEATURE_PATTERN = /(拍照|离线|联网|网络|wi-?fi|热点|方言|录音|充电|开机|关机|升级|绑定|设置|二维码|恢复出厂)/i
const NETWORK_TERM_PATTERN = /(wi[\s-]?fi|wlan|无线网络|联网)/i
const NETWORK_SETUP_PATTERN = /(怎么|如何|怎样|连接|接入|设置)/
const NETWORK_TROUBLESHOOTING_PATTERN = /(连不上|无法连接|连接失败|不能上网|上不了网|密码(?:正确|错误)|搜不到|找不到|断开|掉线)/
const TRANSLATION_CONTEXT_PATTERN = /(翻译|互译)/
const TRANSLATION_LANGUAGE_TARGET_PATTERN = /(语言|语种|中英|英中|中文|英语|英文|源语言|目标语言|语言对)/
const TRANSLATION_LANGUAGE_ACTION_PATTERN = /(怎么|如何|怎样|切换|选择|更换|换成|改成|设置)/
const TRANSLATION_LANGUAGE_FALSE_INTENT_PATTERN = /(无法|不能|不行|失败|异常|错误|不准确|没反应|故障|确认(?:已)?选择|重启|男声|女声|男女声|声音设置|语音播报|音色|系统(?:显示)?语言|显示语言|界面语言|菜单语言|离线包|语言包|离线翻译)/
// “常见问题”是官方资料的文档类型/章节前缀，不代表当前片段属于故障排查；
// 只按片段中的具体故障、系统语言或重启动作排除相邻证据。
const TRANSLATION_LANGUAGE_FALSE_EVIDENCE_PATTERN = /(无法(?:进行)?翻译|翻译不准确|故障排查|语种(?:判断|识别)错误|确认(?:已)?选择(?:了)?正确|重启设备|系统(?:显示)?语言|显示语言|界面语言|菜单语言|男声|女声|播报声音|语音播报|音色)/
const TRANSLATION_LANGUAGE_OFFLINE_EVIDENCE_PATTERN = /(离线包|语言包|离线翻译管理)/
const TRANSLATION_LANGUAGE_PRIMARY_INTERFACE_PATTERN = /(语音翻译界面|翻译界面|主屏幕|主界面|下拉菜单|语言栏|源语言|目标语言)/
const TRANSLATION_LANGUAGE_EVIDENCE_CONTEXT_PATTERN = /(翻译|互译|源语言|目标语言|语言对)/
const TRANSLATION_LANGUAGE_EVIDENCE_TARGET = '(?:翻译(?:语言|语种)|需要翻译的(?:语言|语种)|源语言|目标语言|语言对|语种)'
const TRANSLATION_LANGUAGE_EVIDENCE_ACTION = new RegExp(
  `(?:(?:在|从|进入|打开|点击|主屏幕|主界面|下拉菜单|翻译界面|语音翻译界面|屏幕(?:下方|底部)|语言栏).{0,80}(?:上滑|下拉|点击|选择|切换).{0,50}${TRANSLATION_LANGUAGE_EVIDENCE_TARGET}|(?:上滑|下拉|点击|选择|切换).{0,50}${TRANSLATION_LANGUAGE_EVIDENCE_TARGET})`
)
const TRANSLATION_REPLAY_CONTEXT_PATTERN = /(翻译结果|翻译内容|译文|翻译记录|历史翻译)/
const TRANSLATION_REPLAY_ACTION_PATTERN = /(?:(?:重新|再次|重复|再)(?:播放|播报|朗读|收听|听)|重播|回放|复听|点读)/
const TRANSLATION_REPLAY_TROUBLESHOOTING_PATTERN = /(无法|不能|不行|失败|没反应|没声音|无声音|故障)/
const TRANSLATION_REPLAY_EVIDENCE_PATTERN = /(点读复听|复听|重新播放|再次播放|重复播放|重播|回放)/
const FACTORY_RESET_QUESTION_PATTERN = /(恢复出厂(?:设置)?|恢复到出厂|出厂设置|重置(?:翻译机|设备|系统))/
const FACTORY_RESET_EVIDENCE_PATTERN = /设置.{0,30}系统.{0,30}关于本机.{0,30}恢复出厂/
const LIQUID_DAMAGE_QUESTION_PATTERN = /(进水|掉进水|浸水|液体(?:接触|进入)|洒到(?:水|饮料)|被水泡)/
const LIQUID_DAMAGE_EVIDENCE_PATTERN = /(进水|掉进水|浸水|液体接触)/
const LIQUID_DAMAGE_ACTION_PATTERN = /(停止(?:继续)?使用|不要继续充电|不要尝试充电|不要.*反复开机|联系(?:官方)?售后|不代表可以浸水)/
const OFFLINE_PACKAGE_QUESTION_PATTERN = /(离线(?:语言)?包|离线翻译)/
const OFFLINE_PACKAGE_ACTION_PATTERN = /(下载|安装|开启|开通|启用|怎么用|如何用|怎样用)/
const OFFLINE_PACKAGE_EVIDENCE_PATTERN = /更多设置.{0,20}离线包管理/

export const GETTING_STARTED_QUERY = '翻译机 4.0 第一次使用 开机 解锁 语音翻译界面 选择翻译语种 免按键翻译'

const DIRECT_SUPPORT_INTENTS = Object.freeze([
  {
    id: 'offline-translation-capability',
    question: text => /(?:没有|没|无)网络.{0,12}(?:还能|可以|能否|能不能)?.{0,6}翻译|出国.{0,12}(?:没有|没|无)网络/.test(text),
    evidence: text => /离线翻译/.test(text) && /(无需网络连接|无网络(?:时|环境|翻译))/.test(text) && /(下载|语言包)/.test(text)
  },
  {
    id: 'translation-slow',
    question: text => /(翻译|识别|响应).{0,8}(?:速度)?(?:很)?慢|翻译延迟/.test(text),
    // 当前资料只有“播报语速”设置，没有“翻译处理变慢”的排障说明。
    evidence: () => false
  },
  {
    id: 'no-sound',
    question: text => /(?:没有|没|无)(?:声音|声)|不出声|听不到(?:声音|播报)/.test(text),
    // “切换男女声”不能作为“设备无声”的故障排查依据。
    evidence: () => false
  },
  {
    id: 'network-support-escalation',
    question: text => /(wi-?fi|wlan|无线网络|网络|联网|连接)/i.test(text) && /(找谁|联系谁|客服|售后|谁处理)/.test(text),
    evidence: text => /客服联系方式/.test(text) && /(客服热线|在线咨询|微信服务号)/.test(text)
  },
  {
    id: 'network-troubleshooting',
    question: text => (NETWORK_TROUBLESHOOTING_PATTERN.test(text) || /搜索不到/.test(text)) && /(wi-?fi|wlan|无线网络|网络|联网|路由器|密码)/i.test(text),
    evidence: text => /无法连接\s*Wi[\s-]?Fi\s*怎么办/i.test(text) && /(密码|路由器|重新连接|重试)/.test(text)
  },
  {
    id: 'translation-inaccurate',
    question: text => /(翻译|识别).{0,8}(?:不准|不准确|错误|有误)/.test(text),
    evidence: text => /翻译结果不准确怎么办/.test(text) && /(背景噪音|正常语速|标准.*发音)/.test(text)
  },
  {
    id: 'device-heat',
    question: text => /(发热|发烫|温度过高|很烫)/.test(text),
    evidence: text => /设备发热严重怎么办/.test(text) && /(温度过高|停止使用|联系售后)/.test(text)
  },
  {
    id: 'charging-failure',
    question: text => /(充不进|充不进去|无法充电|充电.{0,8}(?:没反应|不亮|失败))/.test(text),
    evidence: text => /充电时指示灯不亮/.test(text) && /(适配器|数据线)/.test(text) && /(接口|灰尘|异物)/.test(text)
  },
  {
    id: 'disassembly',
    question: text => /(自行|自己|能否|可以).{0,8}(?:拆机|拆开|更换内部|维修)|拆机维修/.test(text),
    evidence: text => /切勿拆卸翻译机|尝试自行修理|不要自行拆开设备|不要尝试.{0,20}拆机操作/.test(text)
  },
  {
    id: 'record-sync',
    question: text => /(翻译记录|对话记录|历史记录).{0,15}(?:同步|导出|手机|电脑)/.test(text),
    evidence: text => /翻译记录怎么导出/.test(text) && /记录导出/.test(text)
  },
  {
    id: 'translation-history',
    question: text => /(?:查看|查找|找到|看)(?:以前|之前|历史)?(?:的)?(?:翻译记录|翻译内容|历史翻译)|(?:翻译记录|历史翻译).{0,10}(?:在哪|哪里|怎么查看|如何查看)/.test(text),
    evidence: text => /翻译记录/.test(text) && /自动保存翻译历史/.test(text) && /(?:查看|复听)历史翻译内容/.test(text)
  },
  {
    id: 'first-activation-video',
    question: text => /(?:第一次|首次).{0,10}(?:激活|开通)|(?:激活|开通).{0,10}(?:怎么|如何|怎样)/.test(text),
    evidence: text => /官方\s*H5/.test(text) && /《快速上手》使用视频/.test(text) && /播放《快速上手》官方视频/.test(text)
  },
  {
    id: 'call-translation',
    question: text => /通话翻译/.test(text) && /(怎么|如何|怎样|使用|操作)/.test(text),
    evidence: text => /通话翻译怎么使用/.test(text) && /联网/.test(text) && /蓝牙/.test(text)
  },
  {
    id: 'group-translation',
    question: text => /群组翻译/.test(text) && /(怎么|如何|怎样|使用|操作)/.test(text),
    evidence: text => /群组翻译怎么使用/.test(text) && /会议室/.test(text) && /(扫码|二维码)/.test(text)
  },
  {
    id: 'face-to-face-translation',
    question: text => /面对面翻译/.test(text) && /(怎么|如何|怎样|使用|操作|进入|切换)/.test(text),
    evidence: text => /怎么进入面对面翻译/.test(text) && /左侧边缘向右轻滑/.test(text)
  },
  {
    id: 'photo-translation',
    question: text => /拍照翻译/.test(text) && /(怎么|如何|怎样|使用|操作)/.test(text),
    evidence: text => /拍照翻译/.test(text) && (
      /(右上角|向左滑|左滑)/.test(text)
      || (/官方\s*H5/.test(text) && /(《拍照翻译》使用视频|播放《拍照翻译》官方视频)/.test(text))
    )
  },
  {
    id: 'voice-translation',
    question: text => /语音翻译/.test(text) && /(怎么|如何|怎样|使用|操作|进行)/.test(text),
    evidence: text => /翻译机\s*4\.0\s*怎么使用语音翻译/.test(text) && /解锁/.test(text) && /语种/.test(text)
  },
  ...['会议翻译', '同声字幕', '演讲翻译', '旁听同传', '强降噪', '免按键翻译'].map(feature => ({
    id: `official-video-${feature}`,
    question: text => text.includes(feature) && /(怎么|如何|怎样|使用|操作)/.test(text),
    evidence: text => text.includes(feature)
      && /官方\s*H5/.test(text)
      && (text.includes(`《${feature}》使用视频`) || text.includes(`播放《${feature}》官方视频`))
  }))
])

export function getDirectSupportIntent(question) {
  const text = String(question || '').replace(/\s+/g, '')
  return DIRECT_SUPPORT_INTENTS.find(intent => intent.question(text))?.id || ''
}

export function isDirectSupportEvidence(question, value) {
  const intent = getDirectSupportIntent(question)
  if (!intent) return false
  const profile = DIRECT_SUPPORT_INTENTS.find(item => item.id === intent)
  return Boolean(profile?.evidence(String(value || '').replace(/\s+/g, ' ')))
}

export function isGettingStartedQuestion(question) {
  const text = String(question || '').replace(/\s+/g, '')
  const broadHowTo = (text.includes('翻译机') && GETTING_STARTED_PATTERN.test(text)) || FIRST_USE_HOW_TO_PATTERN.test(text)
  return broadHowTo && !SPECIFIC_FEATURE_PATTERN.test(text)
}

export function isGettingStartedEvidence(value) {
  const text = String(value || '')
  return Boolean(
    (/首次翻译操作/.test(text) && /(语音翻译（最常用）|长按左侧中文键)/.test(text)) ||
    (/翻译机\s*4\.0\s*怎么使用语音翻译/.test(text) && /解锁/.test(text) && /语种/.test(text))
  )
}

export function isNetworkSetupQuestion(question) {
  const text = String(question || '').replace(/\s+/g, '')
  return NETWORK_TERM_PATTERN.test(text)
    && NETWORK_SETUP_PATTERN.test(text)
    && !NETWORK_TROUBLESHOOTING_PATTERN.test(text)
}

export function isNetworkSetupEvidence(value) {
  const text = String(value || '')
  return /(连接\s*Wi[\s-]?Fi|Wi[\s-]?Fi\s*连接|连接\s*WLAN)/i.test(text)
    && /(【WLAN】|目标网络|输入密码)/.test(text)
    && /(?:^|\s)1[.、．)]\s*/.test(text)
}

export function isTranslationLanguageSwitchQuestion(question) {
  const text = String(question || '').replace(/\s+/g, '')
  return Boolean(text
    && TRANSLATION_CONTEXT_PATTERN.test(text)
    && TRANSLATION_LANGUAGE_TARGET_PATTERN.test(text)
    && TRANSLATION_LANGUAGE_ACTION_PATTERN.test(text)
    && !TRANSLATION_LANGUAGE_FALSE_INTENT_PATTERN.test(text))
}

export function isTranslationLanguageSwitchEvidence(value) {
  const text = String(value || '').replace(/\s+/g, ' ').trim()
  return Boolean(text
    && TRANSLATION_LANGUAGE_EVIDENCE_CONTEXT_PATTERN.test(text)
    && !TRANSLATION_LANGUAGE_FALSE_EVIDENCE_PATTERN.test(text)
    && !(TRANSLATION_LANGUAGE_OFFLINE_EVIDENCE_PATTERN.test(text) && !TRANSLATION_LANGUAGE_PRIMARY_INTERFACE_PATTERN.test(text))
    && TRANSLATION_LANGUAGE_EVIDENCE_ACTION.test(text))
}

export function isTranslationReplayQuestion(question) {
  const text = String(question || '').replace(/\s+/g, '').replace(/能不能/g, '可以')
  return Boolean(text
    && TRANSLATION_REPLAY_CONTEXT_PATTERN.test(text)
    && TRANSLATION_REPLAY_ACTION_PATTERN.test(text)
    && !TRANSLATION_REPLAY_TROUBLESHOOTING_PATTERN.test(text))
}

export function isTranslationReplayEvidence(value) {
  const text = String(value || '').replace(/\s+/g, ' ').trim()
  return Boolean(text
    && TRANSLATION_REPLAY_CONTEXT_PATTERN.test(text)
    && TRANSLATION_REPLAY_EVIDENCE_PATTERN.test(text)
    && !/(?:不支持|无法|不能).{0,8}(?:复听|重新播放|重播|回放)/.test(text))
}

export function isFactoryResetQuestion(question) {
  return FACTORY_RESET_QUESTION_PATTERN.test(String(question || '').replace(/\s+/g, ''))
}

export function isFactoryResetEvidence(value) {
  return FACTORY_RESET_EVIDENCE_PATTERN.test(String(value || '').replace(/\s+/g, ''))
}

export function isLiquidDamageQuestion(question) {
  return LIQUID_DAMAGE_QUESTION_PATTERN.test(String(question || '').replace(/\s+/g, ''))
}

export function isLiquidDamageEvidence(value) {
  const text = String(value || '').replace(/\s+/g, '')
  return LIQUID_DAMAGE_EVIDENCE_PATTERN.test(text) && LIQUID_DAMAGE_ACTION_PATTERN.test(text)
}

export function isOfflinePackageQuestion(question) {
  const text = String(question || '').replace(/\s+/g, '')
  return OFFLINE_PACKAGE_QUESTION_PATTERN.test(text) && OFFLINE_PACKAGE_ACTION_PATTERN.test(text)
}

export function isOfflinePackageEvidence(value) {
  return OFFLINE_PACKAGE_EVIDENCE_PATTERN.test(String(value || '').replace(/\s+/g, ''))
}
