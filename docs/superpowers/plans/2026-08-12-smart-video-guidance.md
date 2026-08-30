# 智能视频引导 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不修改视频素材的前提下，让问答页根据用户问题先推荐最合适的一条视频，并在用户确认未解决时再给出下一条方案。

**Architecture:** `recommendations.js` 从问题中识别“学习操作”或“故障排查”意图，并用标题、标签、型号、症状词和视频类型词对现有视频排序。三个 RAG 接口都返回同一份视频引导计划；前端初始只展示主推荐，用户点击“未解决，换一个方案”才切换到备用视频，已解决反馈沿用现有接口。

**Tech Stack:** Node.js、Express、MySQL、React、Vite、node:test。

## Global Constraints

- 不新增、重录、修改视频、封面或章节数据。
- 不请求外部视频或字体服务。
- 无可靠匹配时不返回视频引导计划。
- 用户对同一视频的“已解决”反馈仍只计一次。
- 现有三个问答接口的 `recommendedVideos` 字段保持兼容。

---

### Task 1: 视频意图识别与引导计划

**Files:**
- Modify: `server/services/recommendations.js`
- Test: `test/recommendations.test.js`

**Interfaces:**
- Produces: `classifyVideoNeed(question): { kind: 'troubleshoot'|'learn'|'general', label: string, evidence: string[] }`
- Produces: `buildVideoGuidance(question, videos): { diagnosis, primaryVideo, fallbackVideos } | null`
- Produces: `findVideoRecommendations(question, filters)` 的视频项包含 `guidanceRole` 与 `guidanceReason`。

- [ ] **Step 1: 写失败测试，证明“连接失败”优先排障视频**

```js
const guidance = buildVideoGuidance('WiFi 连不上怎么办', [
  { id: 1, title: 'WiFi 连接教程', tags: ['WiFi'], resolve_count: 0 },
  { id: 2, title: 'WiFi 连接失败排查', tags: ['WiFi'], resolve_count: 0 }
])
assert.equal(guidance.diagnosis.kind, 'troubleshoot')
assert.equal(guidance.primaryVideo.id, 2)
```

- [ ] **Step 2: 运行失败测试**

Run: `node --test test/recommendations.test.js`

Expected: FAIL，因为 `buildVideoGuidance` 尚未导出。

- [ ] **Step 3: 最小实现问题分类和计划构建**

```js
export function classifyVideoNeed(question) {
  const text = String(question || '')
  if (/连不上|无法|失败|异常|错误|搜不到|没反应|排查/.test(text)) {
    return { kind: 'troubleshoot', label: '故障排查', evidence: ['识别到故障描述'] }
  }
  if (/怎么|如何|教程|步骤|操作|使用|设置/.test(text)) {
    return { kind: 'learn', label: '操作学习', evidence: ['识别到学习需求'] }
  }
  return { kind: 'general', label: '相关操作', evidence: [] }
}
```

对候选视频的标题、标签、分类、简介中的“排查/失败/重置/修复”和“教程/演示/操作/入门/设置”词添加意图加分；`buildVideoGuidance` 只在至少一条可靠视频时返回主推荐和最多两条备用方案。

- [ ] **Step 4: 运行推荐测试**

Run: `node --test test/recommendations.test.js`

Expected: PASS。

### Task 2: 三条问答链路统一下发视频引导计划

**Files:**
- Modify: `server/routes/rag.js`
- Test: `test/ragExperienceWiring.test.js`

**Interfaces:**
- Consumes: `buildVideoGuidance(effectiveQuestion, recommendedVideos)`。
- Produces: `/api/rag/ask` 的 `data.videoGuidance`，以及 `/ask-stream`、`/ask-agent` 的 `done.videoGuidance`。

- [ ] **Step 1: 写失败接线测试**

```js
assert.match(source, /videoGuidance/)
assert.match(source, /buildVideoGuidance/)
```

- [ ] **Step 2: 运行接线测试并确认失败**

Run: `node --test test/ragExperienceWiring.test.js`

Expected: FAIL，因为路由尚未下发 `videoGuidance`。

- [ ] **Step 3: 扩展统一推荐函数和三处响应**

```js
const videoGuidance = buildVideoGuidance(effectiveQuestion, recommendedVideos)
return { recommendedVideos, recommendedSops, videoGuidance }
```

普通问答响应包含 `videoGuidance`；两个 SSE 的 `done` 事件包含相同字段。保留全部 `recommendedVideos` 供前端切换备用方案，不改变 `qaId` 保存逻辑。

- [ ] **Step 4: 运行接线测试**

Run: `node --test test/ragExperienceWiring.test.js`

Expected: PASS。

### Task 3: 主推荐与“未解决换方案”交互

**Files:**
- Modify: `src/App.jsx`
- Modify: `src/index.css`
- Test: `test/ragExperienceWiring.test.js`

**Interfaces:**
- Consumes: `videoGuidance = { diagnosis, primaryVideo, fallbackVideos }`。
- Produces: 初始展示 `primaryVideo`，`handleTryNextVideo()` 依次展示 `fallbackVideos`，不发送任何反馈请求。

- [ ] **Step 1: 写失败接线测试**

```js
assert.match(source, /videoGuidance/)
assert.match(source, /handleTryNextVideo/)
assert.match(source, /未解决，换一个方案/)
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `node --test test/ragExperienceWiring.test.js`

Expected: FAIL，因为前端尚未处理备用视频。

- [ ] **Step 3: 最小实现单卡片引导交互**

新增 `videoGuidance`、`activeGuidanceIndex` 状态，在每次新问答和退出登录时重置。卡片标题显示“建议先看”或“备用方案 N”，展示诊断标签和选择原因；当存在下一条备用视频且当前视频未标记解决时，展示按钮 `未解决，换一个方案`，仅切换本地状态。点击“这条视频帮我解决了”后保持现有 POST 反馈及锁定逻辑。

- [ ] **Step 4: 运行前端接线测试**

Run: `node --test test/ragExperienceWiring.test.js`

Expected: PASS。

### Task 4: 全量验证

**Files:**
- Verify: `test/`
- Verify: `src/`、`server/`

- [ ] **Step 1: 运行完整测试**

Run: `npm.cmd test`

Expected: 0 failures。

- [ ] **Step 2: 构建前端与检查后端语法**

Run: `npm.cmd run build; node --check server/routes/rag.js; node --check server/services/recommendations.js`

Expected: exit 0。

- [ ] **Step 3: 重启后端并检查服务健康状态**

Run: `Invoke-WebRequest -UseBasicParsing http://127.0.0.1:3000/api/health`

Expected: HTTP 200 与 `ok: true`。
