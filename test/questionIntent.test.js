import test from 'node:test'
import assert from 'node:assert/strict'
import {
  getDirectSupportIntent,
  isDirectSupportEvidence,
  isGettingStartedEvidence,
  isGettingStartedQuestion,
  isFactoryResetEvidence,
  isFactoryResetQuestion,
  isLiquidDamageEvidence,
  isLiquidDamageQuestion,
  isOfflinePackageEvidence,
  isOfflinePackageQuestion,
  isNetworkSetupEvidence,
  isNetworkSetupQuestion,
  isTranslationReplayEvidence,
  isTranslationReplayQuestion,
  isTranslationLanguageSwitchEvidence,
  isTranslationLanguageSwitchQuestion
} from '../server/services/questionIntent.js'

test('direct support intent distinguishes covered troubleshooting from misleading nearby settings', () => {
  assert.equal(getDirectSupportIntent('第一次使用翻译机怎么操作？'), '')
  assert.equal(getDirectSupportIntent('翻译机没有声音怎么办？'), 'no-sound')
  assert.equal(getDirectSupportIntent('翻译速度很慢怎么办？'), 'translation-slow')
  assert.equal(getDirectSupportIntent('翻译结果不准确怎么办？'), 'translation-inaccurate')
  assert.equal(getDirectSupportIntent('出国没有网络还能翻译吗？'), 'offline-translation-capability')
  assert.equal(isDirectSupportEvidence('翻译结果不准确怎么办？', 'Q8：翻译结果不准确怎么办？ 减少背景噪音，正常语速说话。'), true)
  assert.equal(isDirectSupportEvidence('翻译速度很慢怎么办？', '设置 → 播报语速'), false)
})

test('双屏 2.0 的官方拍照翻译视频属于直接证据', () => {
  const question = '如何使用拍照翻译？'
  assert.equal(getDirectSupportIntent(question), 'photo-translation')
  assert.equal(isDirectSupportEvidence(
    question,
    '科大讯飞官方 H5 为讯飞双屏翻译机 2.0 提供《拍照翻译》使用视频。请在回答下方播放《拍照翻译》官方视频。'
  ), true)
  assert.equal(isDirectSupportEvidence(question, '翻译机支持多种翻译方式和摄像头。'), false)
})

test('明确功能名会锚定同名官方 H5 视频而不误用相邻功能', () => {
  const question = '怎么使用会议翻译？'
  assert.equal(getDirectSupportIntent(question), 'official-video-会议翻译')
  assert.equal(isDirectSupportEvidence(
    question,
    '科大讯飞官方 H5 为讯飞双屏翻译机 2.0 提供《会议翻译》使用视频。请播放《会议翻译》官方视频。'
  ), true)
  assert.equal(isDirectSupportEvidence(
    question,
    '科大讯飞官方 H5 为讯飞双屏翻译机 2.0 提供《群组翻译》使用视频。'
  ), false)
})

test('已有直接资料的翻译记录查询与首次激活不再依赖模型扩写', () => {
  assert.equal(getDirectSupportIntent('如何查看以前的翻译记录？'), 'translation-history')
  assert.equal(isDirectSupportEvidence(
    '如何查看以前的翻译记录？',
    '【章节：辅助功能 > 翻译记录】自动保存翻译历史。可查看、复听历史翻译内容。支持通过 APP 同步到手机。'
  ), true)
  assert.equal(getDirectSupportIntent('双屏翻译机第一次怎么激活？'), 'first-activation-video')
  assert.equal(isDirectSupportEvidence(
    '双屏翻译机第一次怎么激活？',
    '科大讯飞官方 H5 提供《快速上手》使用视频，请在回答下方播放《快速上手》官方视频。'
  ), true)
})

test('只把宽泛的翻译机新手问法识别为入门意图', () => {
  assert.equal(isGettingStartedQuestion('我不知道怎么用这个翻译机'), true)
  assert.equal(isGettingStartedQuestion('翻译机怎么用'), true)
  assert.equal(isGettingStartedQuestion('怎么用这个翻译机'), true)
  assert.equal(isGettingStartedQuestion('这台翻译机如何操作'), true)
  assert.equal(isGettingStartedQuestion('第一次使用怎么操作？'), true)
  assert.equal(isGettingStartedQuestion('翻译机怎么使用拍照翻译'), false)
  assert.equal(isGettingStartedQuestion('首次使用时必须连接 WiFi 吗？'), false)
  assert.equal(isGettingStartedQuestion('手机怎么用'), false)
})

test('识别恢复出厂与进液问题所需的直接操作证据', () => {
  assert.equal(isFactoryResetQuestion('如何恢复出厂设置？'), true)
  assert.equal(isFactoryResetEvidence('进入设置 → 系统 → 关于本机 → 恢复出厂'), true)
  assert.equal(isFactoryResetEvidence('系统异常时可以考虑重置'), false)
  assert.equal(isLiquidDamageQuestion('翻译机掉进水里还能用吗？'), true)
  assert.equal(isLiquidDamageEvidence('设备掉进水里仍可能损坏，应停止继续使用并联系官方售后检查。'), true)
  assert.equal(isLiquidDamageEvidence('设备支持日常防水。'), false)
  assert.equal(isOfflinePackageQuestion('离线语言包怎么下载？'), true)
  assert.equal(isOfflinePackageQuestion('没有网络还能翻译吗？'), false)
  assert.equal(isOfflinePackageEvidence('进入更多设置 → 离线包管理，提前下载所需语言包。'), true)
})

test('识别翻译结果复听能力，并区分自动播报和播放故障', () => {
  assert.equal(isTranslationReplayQuestion('翻译结果可以重新播放吗？'), true)
  assert.equal(isTranslationReplayQuestion('译文能不能再次播放？'), true)
  assert.equal(isTranslationReplayQuestion('历史翻译怎么复听？'), true)
  assert.equal(isTranslationReplayQuestion('翻译结果无法重新播放怎么办？'), false)
  assert.equal(isTranslationReplayQuestion('翻译结果会自动播报吗？'), false)

  assert.equal(isTranslationReplayEvidence('翻译结果自动语音播报，也可点读复听。'), true)
  assert.equal(isTranslationReplayEvidence('可查看、复听历史翻译内容。'), true)
  assert.equal(isTranslationReplayEvidence('翻译结果自动朗读，支持调节音量。'), false)
  assert.equal(isTranslationReplayEvidence('当前版本不支持翻译结果复听。'), false)
})

test('入门证据要求首次翻译操作和常用语音翻译章节', () => {
  assert.equal(isGettingStartedEvidence('首次翻译操作 > 语音翻译（最常用）'), true)
  assert.equal(isGettingStartedEvidence('第四章 拍照翻译 > 使用方法'), false)
})

test('区分连接 Wi-Fi 的基础操作与联网故障排查', () => {
  assert.equal(isNetworkSetupQuestion('翻译机怎么连接 Wi-Fi？'), true)
  assert.equal(isNetworkSetupQuestion('如何设置 WLAN？'), true)
  assert.equal(isNetworkSetupQuestion('怎么联网'), true)
  assert.equal(isNetworkSetupQuestion('WiFi 密码正确但还是连不上怎么办？'), false)
  assert.equal(isNetworkSetupQuestion('WiFi 已连接但不能上网怎么办？'), false)
})

test('联网操作证据必须包含可执行的网络选择步骤', () => {
  assert.equal(isNetworkSetupEvidence('连接 WiFi： 1. 进入【设置】→【WLAN】。 2. 选择目标网络并输入密码。'), true)
  assert.equal(isNetworkSetupEvidence('【双屏 2.0 怎么联网】1. 首次使用需要联网激活。2. 选择可用的 WiFi，或插入 SIM 卡，按设备页面提示继续。'), true)
  assert.equal(isNetworkSetupEvidence('【日常打开 WiFi】1. 从主界面下拉打开快捷设置。2. 点击 WiFi 开关；需要连接时选择可用的 WiFi。'), true)
  assert.equal(isNetworkSetupEvidence('设备支持 WiFi 和移动网络。'), false)
  assert.equal(isNetworkSetupEvidence('进入通话翻译前请确保翻译机已经联网并打开蓝牙。'), false)
})

test('识别切换翻译语种意图并排除相邻功能与故障问法', () => {
  assert.equal(isTranslationLanguageSwitchQuestion('翻译机怎么切换翻译语言？'), true)
  assert.equal(isTranslationLanguageSwitchQuestion('怎样切换中英语音翻译？'), true)
  assert.equal(isTranslationLanguageSwitchQuestion('怎么选择翻译语种？'), true)
  assert.equal(isTranslationLanguageSwitchQuestion('翻译机怎么切换男女声？'), false)
  assert.equal(isTranslationLanguageSwitchQuestion('怎么切换系统显示语言？'), false)
  assert.equal(isTranslationLanguageSwitchQuestion('离线翻译语言包怎么切换？'), false)
  assert.equal(isTranslationLanguageSwitchQuestion('无法翻译，确认语种正确后还是不行怎么办？'), false)
})

test('翻译语种证据必须直接说明界面动作，不能用相邻资料代替', () => {
  assert.equal(isTranslationLanguageSwitchEvidence('在语音翻译界面从屏幕下方上滑，可选择需要的翻译语种。'), true)
  assert.equal(isTranslationLanguageSwitchEvidence('主屏幕或下拉菜单中选择需要翻译的语种。'), true)
  assert.equal(isTranslationLanguageSwitchEvidence('点击顶部语言栏选择源语言和目标语言。'), true)
  assert.equal(isTranslationLanguageSwitchEvidence('【章节：讯飞翻译机 4.0 官方常见问题 > 翻译机怎么切换翻译语言？】在语音翻译界面上，从屏幕下方往上滑，即可选择所需的语种。'), true)
  assert.equal(isTranslationLanguageSwitchEvidence('【章节：讯飞双屏翻译机 2.0 官方常见问题 > 翻译机怎么切换翻译语言？】1. 打开翻译机，进入“语音翻译”。2. 进入“语种列表”选择需要的语种功能。'), true)
  assert.equal(isTranslationLanguageSwitchEvidence('在语音翻译界面从屏幕下方上滑，可选择需要的翻译语种。已下载的离线包可在无网络时使用。'), true)
  assert.equal(isTranslationLanguageSwitchEvidence('中英互译支持男声/女声切换。'), false)
  assert.equal(isTranslationLanguageSwitchEvidence('进入语音翻译高级设置中的播报声音，选择男声或女声；该功能仅支持部分语种在线翻译。'), false)
  assert.equal(isTranslationLanguageSwitchEvidence('根据屏幕提示选择系统显示语言。'), false)
  assert.equal(isTranslationLanguageSwitchEvidence('进入离线翻译管理，选择语言并下载语言包。'), false)
  assert.equal(isTranslationLanguageSwitchEvidence('在离线翻译管理中选择翻译语种并下载语言包。'), false)
  assert.equal(isTranslationLanguageSwitchEvidence('确认已选择正确的翻译语种，重启设备后重试。'), false)
  assert.equal(isTranslationLanguageSwitchEvidence('【章节：讯飞翻译机官方常见问题 > 无法进行翻译怎么办？】确认已选择正确的翻译语种，重启设备后重试。'), false)
  assert.equal(isTranslationLanguageSwitchEvidence('【章节：讯飞双屏翻译机 2.0 官方常见问题 > 自动语种判断错误怎么办？】如果语种判断错误，可切换语种方向按钮重新识别。'), false)
})
