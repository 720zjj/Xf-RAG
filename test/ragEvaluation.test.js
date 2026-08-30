import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildMarkdownReport,
  evaluateCases,
  loadEvaluationCases
} from '../scripts/run-rag-evaluation.js'

test('评测集固定包含 30 条有完整预期的真实问题', () => {
  const cases = loadEvaluationCases()

  assert.equal(cases.length, 30)
  assert.deepEqual(cases.map(item => item.id), Array.from({ length: 30 }, (_, index) => `E${String(index + 1).padStart(2, '0')}`))
  assert.equal(cases.filter(item => item.shouldRefuse).length, 3)
  for (const item of cases) {
    assert.ok(item.question)
    assert.ok(item.correctAnswerPoints.length)
    assert.equal(typeof item.shouldRefuse, 'boolean')
    assert.ok(item.productModel)
  }
})

test('报告只基于录入的实测观察计算命中、引用、拒答、耗时与 Token', () => {
  const cases = loadEvaluationCases()
  const report = evaluateCases(cases, [
    {
      id: 'E01',
      result: 'passed',
      sourceTitles: ['快速入门指南'],
      citationAccurate: true,
      latencyMs: 1200,
      totalTokens: 456
    },
    { id: 'E26', result: 'passed', refusalFollowed: true, latencyMs: 800 },
    { id: 'E29', result: 'failed', refusalFollowed: false, latencyMs: 600 }
  ])

  assert.deepEqual(report.retrieval, { applicable: 1, hit: 1, rate: 1 })
  assert.deepEqual(report.citations, { assessed: 1, accurate: 1, rate: 1 })
  assert.deepEqual(report.refusals, { expected: 2, correct: 1, rate: 0.5 })
  assert.deepEqual(report.performance, { timed: 3, averageLatencyMs: 867, tokenObservations: 1, totalTokens: 456 })
  assert.deepEqual(report.outcomes, { passed: 2, partial: 0, failed: 1, pending: 27 })
  assert.match(buildMarkdownReport(report), /拒答准确率.*50.0%/)
})

test('评测记录兼容表格中使用的中文结论', () => {
  const [firstCase] = loadEvaluationCases()
  const report = evaluateCases([firstCase], [{ id: 'E01', result: '通过' }])

  assert.equal(report.outcomes.passed, 1)
  assert.equal(report.outcomes.partial, 0)
})

test('评测结论同时兼容中英文，并把未知结论保守记为部分通过', () => {
  const cases = loadEvaluationCases().slice(0, 4)
  const report = evaluateCases(cases, [
    { id: 'E01', result: '部分通过' },
    { id: 'E02', result: '失败' },
    { id: 'E03', result: 'passed' },
    { id: 'E04', result: '需要复核' }
  ])

  assert.deepEqual(report.outcomes, { passed: 1, partial: 2, failed: 1, pending: 0 })
})
