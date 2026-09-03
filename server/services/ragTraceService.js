import { randomUUID } from 'node:crypto'

const OUTCOMES = new Set(['solved', 'unsolved'])

function nullableNumber(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.round(parsed) : null
}

function cleanText(value, maxLength = 1000) {
  return String(value || '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ' ').trim().slice(0, maxLength)
}

function asJson(value) {
  return JSON.stringify(value && typeof value === 'object' ? value : {})
}

async function withTransaction(pool, action) {
  if (typeof pool.getConnection !== 'function') return action(pool)
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const result = await action(connection)
    await connection.commit()
    return result
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

function errorWithStatus(message, status) {
  const error = new Error(message)
  error.status = status
  return error
}

export function createRagTraceService({ pool, createId = randomUUID } = {}) {
  if (!pool || typeof pool.query !== 'function') throw new TypeError('pool.query is required')

  async function persistTrace({
    userId,
    qaId = null,
    endpoint = 'ask',
    question = '',
    effectiveQuestion = '',
    productLine = '',
    productModel = '',
    trust = {},
    timing = {},
    usage = null,
    metadata = {},
    evidence = []
  } = {}) {
    const traceId = createId()
    const tokenUsage = usage && typeof usage === 'object' ? usage : {}
    await withTransaction(pool, async connection => {
      await connection.query(
        `INSERT INTO rag_answer_traces
          (id, qa_id, user_id, endpoint, question_snapshot, effective_question, product_line, product_model,
           trust_level, reason_code, threshold_version, retrieval_ms, rerank_ms, generation_ms, total_ms,
           metadata, prompt_tokens, completion_tokens, total_tokens)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          traceId, qaId, userId, cleanText(endpoint, 32), cleanText(question, 10000), cleanText(effectiveQuestion, 10000),
          cleanText(productLine, 50), cleanText(productModel, 100), cleanText(trust.level || 'refuse', 20),
          cleanText(trust.reasonCode || 'no-relevant-evidence', 64), cleanText(trust.thresholdVersion, 64) || null,
          nullableNumber(timing.retrievalMs), nullableNumber(timing.rerankMs), nullableNumber(timing.generationMs), nullableNumber(timing.totalMs),
          asJson(metadata), nullableNumber(tokenUsage.promptTokens), nullableNumber(tokenUsage.completionTokens), nullableNumber(tokenUsage.totalTokens)
        ]
      )

      for (const item of Array.isArray(evidence) ? evidence : []) {
        await connection.query(
          `INSERT INTO rag_answer_evidence
            (trace_id, evidence_id, source_type, document_id, chunk_id, sop_id, source_title, excerpt,
             retrieval_score, rerank_score, factors, selection_reason)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            traceId, cleanText(item.evidenceId, 16), cleanText(item.sourceType || 'document_chunk', 32),
            item.documentId ?? null, item.chunkId ?? null, item.sopId ?? null, cleanText(item.title, 255), cleanText(item.excerpt, 16000),
            Number.isFinite(Number(item.retrievalScore)) ? Number(item.retrievalScore) : null,
            Number.isFinite(Number(item.rerankScore)) ? Number(item.rerankScore) : null,
            asJson(item.factors), cleanText(item.selectionReason || 'best-match', 32)
          ]
        )
      }
    })
    return traceId
  }

  async function saveFeedback({ traceId, userId, outcome, reasonCode = '', comment = '' } = {}) {
    if (!OUTCOMES.has(outcome)) throw errorWithStatus('反馈结果只能是 solved 或 unsolved', 400)
    const [[trace]] = await pool.query(
      'SELECT id, qa_id FROM rag_answer_traces WHERE id = ? AND user_id = ? LIMIT 1',
      [traceId, userId]
    )
    if (!trace) throw errorWithStatus('问答记录不存在或无权反馈', 404)
    await pool.query(
      `INSERT INTO rag_answer_feedback (trace_id, qa_id, user_id, outcome, reason_code, comment)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE outcome = VALUES(outcome), reason_code = VALUES(reason_code),
                               comment = VALUES(comment), qa_id = VALUES(qa_id), updated_at = CURRENT_TIMESTAMP`,
      [traceId, trace.qa_id ?? null, userId, outcome, cleanText(reasonCode, 64) || null, cleanText(comment, 1000)]
    )
    return { traceId, outcome }
  }

  async function listKnowledgeGaps({ canManage = false, productModel = '', reasonCode = '', limit = 50 } = {}) {
    if (!canManage) throw errorWithStatus('无权查看知识缺口', 403)
    const clauses = ['f.outcome = "unsolved"']
    const params = []
    if (productModel) { clauses.push('t.product_model = ?'); params.push(productModel) }
    if (reasonCode) { clauses.push('f.reason_code = ?'); params.push(reasonCode) }
    params.push(Math.max(1, Math.min(Number(limit) || 50, 200)))
    const [rows] = await pool.query(
      `SELECT t.question_snapshot AS question, t.product_line AS productLine, t.product_model AS productModel,
              f.reason_code AS reasonCode, COUNT(*) AS unresolvedCount, MAX(f.updated_at) AS latestAt
       FROM rag_answer_feedback f
       JOIN rag_answer_traces t ON t.id = f.trace_id
       WHERE ${clauses.join(' AND ')}
       GROUP BY t.question_snapshot, t.product_line, t.product_model, f.reason_code
       ORDER BY unresolvedCount DESC, latestAt DESC
       LIMIT ?`,
      params
    )
    return rows
  }

  async function listFeedbackSummary({ canManage = false, productModel = '', limit = 50 } = {}) {
    if (!canManage) throw errorWithStatus('无权查看顾客反馈', 403)
    const clauses = []
    const params = []
    if (productModel) { clauses.push('t.product_model = ?'); params.push(productModel) }
    params.push(Math.max(1, Math.min(Number(limit) || 50, 200)))
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : ''
    const [rows] = await pool.query(
      `SELECT t.question_snapshot AS question, t.product_line AS productLine, t.product_model AS productModel,
              SUM(f.outcome = "solved") AS solvedCount,
              SUM(f.outcome = "unsolved") AS unsolvedCount,
              COUNT(*) AS feedbackCount, MAX(f.updated_at) AS latestAt
       FROM rag_answer_feedback f
       JOIN rag_answer_traces t ON t.id = f.trace_id
       ${where}
       GROUP BY t.question_snapshot, t.product_line, t.product_model
       ORDER BY latestAt DESC
       LIMIT ?`,
      params
    )
    return rows.map(row => ({
      ...row,
      solvedCount: Number(row.solvedCount || 0),
      unsolvedCount: Number(row.unsolvedCount || 0),
      feedbackCount: Number(row.feedbackCount || 0)
    }))
  }

  return Object.freeze({ persistTrace, saveFeedback, listKnowledgeGaps, listFeedbackSummary })
}
