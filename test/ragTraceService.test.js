import test from 'node:test'
import assert from 'node:assert/strict'
import { createRagTraceService } from '../server/services/ragTraceService.js'

function createFakePool() {
  const calls = []
  return {
    calls,
    async query(sql, params = []) {
      calls.push({ sql, params })
      if (/SELECT id, qa_id FROM rag_answer_traces/.test(sql)) return [[{ id: params[0], qa_id: 9 }]]
      if (/SELECT 1 FROM rag_answer_traces/.test(sql)) return [[{ 1: 1 }]]
      if (/FROM rag_answer_feedback/.test(sql) && /GROUP BY/.test(sql)) return [[]]
      return [{ affectedRows: 1 }]
    }
  }
}

const evidence = [{
  evidenceId: 'E1',
  sourceType: 'document_chunk',
  documentId: 3,
  chunkId: 7,
  title: '用户操作手册',
  excerpt: '已下载的离线包可在无网络时使用。',
  retrievalScore: 0.5,
  rerankScore: 0.8,
  factors: { coverage: 1 },
  selectionReason: 'best-match'
}]

test('没有真实 usage 时 trace 将 Token 写为 null 并保存证据快照', async () => {
  const pool = createFakePool()
  const service = createRagTraceService({ pool, createId: () => 'trace-1' })

  const traceId = await service.persistTrace({
    userId: 7,
    qaId: 9,
    endpoint: 'ask',
    question: '没有网络时还能翻译吗？',
    trust: { level: 'answer', reasonCode: 'supported', thresholdVersion: 'v1' },
    timing: { retrievalMs: 3, rerankMs: 2, generationMs: 4, totalMs: 12 },
    usage: null,
    evidence
  })

  assert.equal(traceId, 'trace-1')
  assert.equal(pool.calls.length, 2)
  assert.deepEqual(pool.calls[0].params.slice(-3), [null, null, null])
  assert.match(pool.calls[1].sql, /INSERT INTO rag_answer_evidence/)
  assert.equal(pool.calls[1].params[1], 'E1')
})

test('用户只能更新自己答案的反馈', async () => {
  const pool = createFakePool()
  const service = createRagTraceService({ pool })

  const result = await service.saveFeedback({
    traceId: 'trace-1',
    userId: 7,
    outcome: 'unsolved',
    reasonCode: 'missing-material',
    comment: '还需要该型号的说明书'
  })

  assert.equal(result.outcome, 'unsolved')
  assert.match(pool.calls[0].sql, /WHERE id = \? AND user_id = \?/)
  assert.match(pool.calls[1].sql, /ON DUPLICATE KEY UPDATE/)
})

test('无权限用户不能读取知识缺口聚合', async () => {
  const service = createRagTraceService({ pool: createFakePool() })

  await assert.rejects(
    () => service.listKnowledgeGaps({ userId: 7, canManage: false }),
    error => error.status === 403
  )
})
