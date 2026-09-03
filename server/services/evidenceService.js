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
} from './questionIntent.js'

const MAX_EXCERPT_LENGTH = 1200
const SAFETY_PATTERN = /(进水|拆机|电池|充电|恢复出厂|无响应|安全|危险)/

function text(value) {
  return String(value || '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ' ').replace(/\s+/g, ' ').trim()
}

function numberOrNull(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function metadataFor(item) {
  return item?.metadata || item?.meta || {}
}

function sourceProductModel(item) {
  const metadata = metadataFor(item)
  return Object.hasOwn(metadata, 'sourceProductModel') ? metadata.sourceProductModel : (metadata.productModel || item?.productModel)
}

function isActive(item) {
  const status = String(metadataFor(item).effectiveStatus || item?.effectiveStatus || 'active').toLowerCase()
  return status === 'active'
}

function comparableText(value) {
  return text(value).toLowerCase().replace(/[\p{P}\p{S}\s]/gu, '')
}

function inferCoverage(item) {
  if (typeof item?.coversQuestion === 'boolean') return item.coversQuestion
  const factors = item?.factors || {}
  return factors.phraseMatch === true || Number(factors.coverage) >= 0.34
}

function toEvidence(item, index, selectionReason) {
  const metadata = metadataFor(item)
  const sourceType = item?.sourceType === 'sop' || item?.sopId ? 'sop' : 'document_chunk'
  const excerpt = text(item?.excerpt || item?.text).slice(0, MAX_EXCERPT_LENGTH)
  return {
    evidenceId: `E${index + 1}`,
    sourceType,
    documentId: Number.isInteger(Number(item?.docId ?? item?.documentId)) ? Number(item.docId ?? item.documentId) : null,
    chunkId: Number.isInteger(Number(item?.chunkId ?? item?.id)) && sourceType === 'document_chunk' ? Number(item.chunkId ?? item.id) : null,
    sopId: Number.isInteger(Number(item?.sopId)) ? Number(item.sopId) : null,
    title: text(item?.docName || item?.title || '未命名资料'),
    excerpt,
    productLine: text(metadata.productLine || item?.productLine),
    productModel: text(metadata.productModel || item?.productModel),
    retrievalScore: numberOrNull(item?.bm25Score ?? item?.retrievalScore),
    rerankScore: numberOrNull(item?.score ?? item?.rerankScore),
    factors: item?.factors || null,
    coversQuestion: inferCoverage(item),
    limitedScope: Boolean(item?.limitedScope || metadata.limitedScope),
    selectionReason
  }
}

function candidateScore(item) {
  return Number(item?.score ?? item?.rerankScore ?? 0)
}

function exactQuestionMatch(item, question) {
  const normalizedQuestion = comparableText(question)
  return normalizedQuestion.length >= 4 && comparableText(item?.excerpt || item?.text).includes(normalizedQuestion)
}

/** Normalizes only active retrieved records into a bounded, request-local evidence set. */
export function selectEvidence(retrieved, { limit = 5, question = '', requestedModel = '' } = {}) {
  const safetyQuestion = SAFETY_PATTERN.test(String(question || ''))
  const gettingStartedQuestion = isGettingStartedQuestion(question)
  const translationLanguageSwitchQuestion = isTranslationLanguageSwitchQuestion(question)
  const translationReplayQuestion = isTranslationReplayQuestion(question)
  const factoryResetQuestion = isFactoryResetQuestion(question)
  const liquidDamageQuestion = isLiquidDamageQuestion(question)
  const offlinePackageQuestion = isOfflinePackageQuestion(question)
  const networkSetupQuestion = isNetworkSetupQuestion(question)
  const directSupportIntent = getDirectSupportIntent(question)
  const active = (Array.isArray(retrieved) ? retrieved : [])
    .filter(item => isActive(item) && text(item?.excerpt || item?.text))
    .sort((left, right) => {
      const leftExact = exactQuestionMatch(left, question) ? 1 : 0
      const rightExact = exactQuestionMatch(right, question) ? 1 : 0
      const leftGettingStarted = gettingStartedQuestion && isGettingStartedEvidence(left?.excerpt || left?.text) ? 1 : 0
      const rightGettingStarted = gettingStartedQuestion && isGettingStartedEvidence(right?.excerpt || right?.text) ? 1 : 0
      const leftTranslationLanguage = translationLanguageSwitchQuestion && isTranslationLanguageSwitchEvidence(left?.excerpt || left?.text) ? 1 : 0
      const rightTranslationLanguage = translationLanguageSwitchQuestion && isTranslationLanguageSwitchEvidence(right?.excerpt || right?.text) ? 1 : 0
      const leftTranslationReplay = translationReplayQuestion && isTranslationReplayEvidence(left?.excerpt || left?.text) ? 1 : 0
      const rightTranslationReplay = translationReplayQuestion && isTranslationReplayEvidence(right?.excerpt || right?.text) ? 1 : 0
      const leftFactoryReset = factoryResetQuestion && isFactoryResetEvidence(left?.excerpt || left?.text) ? 1 : 0
      const rightFactoryReset = factoryResetQuestion && isFactoryResetEvidence(right?.excerpt || right?.text) ? 1 : 0
      const leftLiquidDamage = liquidDamageQuestion && isLiquidDamageEvidence(left?.excerpt || left?.text) ? 1 : 0
      const rightLiquidDamage = liquidDamageQuestion && isLiquidDamageEvidence(right?.excerpt || right?.text) ? 1 : 0
      const leftOfflinePackage = offlinePackageQuestion && isOfflinePackageEvidence(left?.excerpt || left?.text) ? 1 : 0
      const rightOfflinePackage = offlinePackageQuestion && isOfflinePackageEvidence(right?.excerpt || right?.text) ? 1 : 0
      const leftNetworkSetup = networkSetupQuestion && isNetworkSetupEvidence(left?.excerpt || left?.text) ? 1 : 0
      const rightNetworkSetup = networkSetupQuestion && isNetworkSetupEvidence(right?.excerpt || right?.text) ? 1 : 0
      const leftDirectSupport = directSupportIntent && isDirectSupportEvidence(question, left?.excerpt || left?.text) ? 1 : 0
      const rightDirectSupport = directSupportIntent && isDirectSupportEvidence(question, right?.excerpt || right?.text) ? 1 : 0
      const leftExactModel = requestedModel && text(sourceProductModel(left)) === requestedModel ? 1 : 0
      const rightExactModel = requestedModel && text(sourceProductModel(right)) === requestedModel ? 1 : 0
      const leftSafety = String(metadataFor(left).riskLevel || left?.riskLevel || '').toLowerCase() === 'high' ? 1 : 0
      const rightSafety = String(metadataFor(right).riskLevel || right?.riskLevel || '').toLowerCase() === 'high' ? 1 : 0
      return rightDirectSupport - leftDirectSupport || rightNetworkSetup - leftNetworkSetup || rightTranslationLanguage - leftTranslationLanguage || rightTranslationReplay - leftTranslationReplay ||
        rightFactoryReset - leftFactoryReset || rightLiquidDamage - leftLiquidDamage || rightOfflinePackage - leftOfflinePackage || rightGettingStarted - leftGettingStarted ||
        ((leftFactoryReset || leftLiquidDamage || leftGettingStarted) && (rightFactoryReset || rightLiquidDamage || rightGettingStarted)
          ? rightExactModel - leftExactModel
          : 0) || rightExact - leftExact ||
        (safetyQuestion ? rightSafety - leftSafety : 0) || candidateScore(right) - candidateScore(left)
    })

  const seen = new Set()
  const selected = []
  for (const item of active) {
    const documentKey = item?.docId ?? item?.documentId ?? item?.sopId ?? item?.title ?? ''
    const key = `${documentKey}:${comparableText(item?.excerpt || item?.text)}`
    if (seen.has(key)) continue
    seen.add(key)
    const highRisk = String(metadataFor(item).riskLevel || item?.riskLevel || '').toLowerCase() === 'high'
    const directTranslationLanguage = translationLanguageSwitchQuestion && isTranslationLanguageSwitchEvidence(item?.excerpt || item?.text)
    const directTranslationReplay = translationReplayQuestion && isTranslationReplayEvidence(item?.excerpt || item?.text)
    const directFactoryReset = factoryResetQuestion && isFactoryResetEvidence(item?.excerpt || item?.text)
    const directLiquidDamage = liquidDamageQuestion && isLiquidDamageEvidence(item?.excerpt || item?.text)
    const directGettingStarted = gettingStartedQuestion && isGettingStartedEvidence(item?.excerpt || item?.text)
    const directOfflinePackage = offlinePackageQuestion && isOfflinePackageEvidence(item?.excerpt || item?.text)
    const directNetworkSetup = networkSetupQuestion && isNetworkSetupEvidence(item?.excerpt || item?.text)
    const directSupport = directSupportIntent && isDirectSupportEvidence(question, item?.excerpt || item?.text)
    const directIntent = directSupport || directNetworkSetup || directTranslationLanguage || directTranslationReplay || directFactoryReset || directLiquidDamage || directOfflinePackage || directGettingStarted
    const selectedEvidence = toEvidence(
      item,
      selected.length,
      safetyQuestion && highRisk ? 'safety' : directIntent ? 'intent-match' : 'best-match'
    )
    // A question that appears verbatim in the current product-scoped material is
    // direct coverage even when its generic rerank factors are conservative.
    // Specific intent guards below still take precedence and can reject a
    // misleading same-word fragment for sensitive operations.
    if (exactQuestionMatch(item, question)) selectedEvidence.coversQuestion = true
    if (translationLanguageSwitchQuestion) selectedEvidence.coversQuestion = directTranslationLanguage
    if (translationReplayQuestion) selectedEvidence.coversQuestion = directTranslationReplay
    if (factoryResetQuestion) selectedEvidence.coversQuestion = directFactoryReset
    if (liquidDamageQuestion) selectedEvidence.coversQuestion = directLiquidDamage
    if (gettingStartedQuestion) selectedEvidence.coversQuestion = directGettingStarted
    if (offlinePackageQuestion) selectedEvidence.coversQuestion = directOfflinePackage
    if (networkSetupQuestion) selectedEvidence.coversQuestion = directNetworkSetup
    if (directSupportIntent) selectedEvidence.coversQuestion = directSupport
    selected.push(selectedEvidence)
    if (selected.length >= limit) break
  }
  return selected
}

/** Removes internal ranking factors before data is returned to the browser. */
export function toPublicSources(evidence) {
  return (Array.isArray(evidence) ? evidence : []).map(item => ({
    evidenceId: item.evidenceId,
    sourceType: item.sourceType,
    documentId: item.documentId,
    chunkId: item.chunkId,
    sopId: item.sopId,
    text: item.excerpt,
    docName: item.title,
    score: item.rerankScore ?? 0,
    bm25Score: item.retrievalScore ?? 0,
    productLine: item.productLine,
    productModel: item.productModel,
    supportedClaims: []
  }))
}
