import { selectEvidence } from './evidenceService.js'
import { decideTrust, modelMatches } from './trustPolicy.js'
import { createTrustedAnswer } from './trustedAnswerService.js'

// Generic hardware model codes in this project always contain a digit. Requiring
// one keeps network and interface names such as Wi-Fi and USB-C from being
// mistaken for an explicit product model while retaining ZY-T9, X1 and V2.0.
const MODEL_PATTERN = /\b(?=[A-Z0-9._-]*\d)([A-Z]{1,8}(?:[-_][A-Z0-9]+|[-_]?\d+(?:\.\d+)?)(?:[-_][A-Z0-9._-]+)?)\b/i
const TRANSLATOR_MODEL_PATTERN = /(翻译机\s*[0-9]+(?:\.[0-9]+)?(?:标准版|星火版)?)/

/** Extract only an explicit model spelling; ambiguous conversational names return empty. */
export function detectExplicitModel(question) {
  const text = String(question || '')
  const code = text.match(MODEL_PATTERN)
  if (code) return code[1]
  const product = text.match(TRANSLATOR_MODEL_PATTERN)
  return product ? product[1].replace(/\s+/g, '') : ''
}

/**
 * Shared pre-generation RAG path. Routes remain responsible for their own
 * retrieval strategy and database persistence, while this function makes the
 * evidence and refusal result identical for /ask, SSE and tool-agent paths.
 */
export async function runTrustedRagRequest({
  endpoint = 'ask',
  question = '',
  effectiveQuestion = question,
  retrieved = [],
  requestedModel = '',
  detectedModel = '',
  availableModels = [],
  generate,
  policy
} = {}) {
  const detected = detectedModel || detectExplicitModel(effectiveQuestion)
  const explicitModel = detected || requestedModel
  const selectedEvidence = selectEvidence(retrieved, { question: effectiveQuestion, requestedModel })
  const evidence = explicitModel
    ? selectedEvidence.filter(item => !item.productModel || modelMatches(item.productModel, explicitModel))
    : selectedEvidence
  const decision = decideTrust({
    question: effectiveQuestion,
    requestedModel,
    detectedModel: detected,
    availableModels,
    evidence,
    modelEvidenceMissing: Boolean(explicitModel && selectedEvidence.length > 0 && evidence.length === 0),
    policy
  })
  const answer = await createTrustedAnswer({
    question: effectiveQuestion,
    evidence,
    decision,
    requestedModel,
    generate
  })
  return { ...answer, evidence, endpoint, effectiveQuestion }
}
