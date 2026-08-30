import test from 'node:test'
import assert from 'node:assert/strict'
import { buildRagInsight } from '../src/ragInsightPresentation.js'

test('把默认检索策略转换成用户易懂的检索说明', () => {
  const insight = buildRagInsight({
    queryEnhancement: {
      originalQuery: '怎么用',
      rewrittenQuery: '翻译机的基础使用方法',
      totalQueries: 4,
      strategies: ['HyDE(假设性文档)', '规则查询重写', '多扩展查询', 'BM25关键词', '多向量检索', '多因子重排']
    },
    ragMeta: {
      router: { mode: 'default', reason: '简单操作类问题，默认多查询检索即可' }
    }
  })

  assert.equal(insight.visible, true)
  assert.equal(insight.modeLabel, '快速检索')
  assert.match(insight.summary, /简单操作类问题/)
  assert.deepEqual(insight.strategyLabels, ['问题理解', '多路查找', '关键词检索', '语义检索', '结果筛选'])
  assert.equal(insight.technicalDetails.totalQueries, 4)
  assert.equal(insight.technicalDetails.rewrittenQuery, '翻译机的基础使用方法')
})

test('没有查询增强数据时仍以自然语言展示记忆和深度处理结果', () => {
  const insight = buildRagInsight({
    ragMeta: {
      router: { mode: 'react', reason: '需要拆分多个步骤后再回答' },
      memory: { resolved: true, originalQuestion: '它怎么连', resolvedQuestion: '翻译机怎么连接 WiFi' },
      agent: { mode: 'react', rounds: 2, plan: ['确认产品', '查询连接方式'], toolCalls: [{ tool: 'searchKnowledge', args: { query: '翻译机连接 WiFi' } }] },
      reflection: { applied: true }
    }
  })

  assert.equal(insight.modeLabel, '深度分析')
  assert.match(insight.summary, /拆分多个步骤/)
  assert.equal(insight.memoryMessage, '已结合上文，将问题理解为“翻译机怎么连接 WiFi”。')
  assert.equal(insight.reflectionMessage, '回答已完成复核与优化。')
  assert.equal(insight.technicalDetails.rounds, 2)
  assert.equal(insight.technicalDetails.planLength, 2)
  assert.equal(insight.technicalDetails.toolCount, 1)
})

test('未知技术策略不会暴露给主卡片，但会保留在可展开的技术细节中', () => {
  const insight = buildRagInsight({
    queryEnhancement: {
      strategies: ['自定义实验策略'],
      hydeDoc: '用户可能需要翻译机的开机步骤。'
    }
  })

  assert.deepEqual(insight.strategyLabels, [])
  assert.equal(insight.technicalDetails.strategies[0], '自定义实验策略')
  assert.equal(insight.technicalDetails.hydeDoc, '用户可能需要翻译机的开机步骤。')
})
