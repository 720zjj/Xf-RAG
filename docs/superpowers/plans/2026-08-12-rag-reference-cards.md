# RAG Reference Cards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make RAG answers easy to scan by turning raw retrieval output into compact, expandable evidence cards.

**Architecture:** Keep the API response unchanged. Add a small pure presentation module that extracts a section path and plain preview from a source chunk, then use it in `SourceExcerpt`. CSS owns the hierarchy, responsive layout, image thumbnails, and hidden retrieval diagnostics.

**Tech Stack:** React, existing `marked` and DOMPurify rendering, CSS, Node built-in test runner.

## Global Constraints

- Do not change database, RAG retrieval, answer prompts, or public API response fields.
- Keep original source text available in an explicit user-controlled expansion.
- Keep source image URLs authenticated and render at most two thumbnails per evidence card.
- Hide BM25, rerank, semantic, and coverage values by default without removing them.
- Do not add external fonts, images, or dependencies.

---

### Task 1: Source presentation helpers

**Files:**
- Create: `src/sourcePresentation.js`
- Create: `test/sourcePresentation.test.js`

**Interfaces:**
- Produces: `getSourcePresentation(text, previewLength = 150)` returning `{ section, body, preview }`.
- Consumes: raw text returned by the existing RAG `sources` response.

- [x] **Step 1: Write the failing test**

```js
test('章节化来源会显示章节路径和不带 Markdown 标题的摘要', () => {
  const result = getSourcePresentation('【章节：使用指南 > 充电说明】\n## 充电说明\n使用 5V/1A 适配器充电。')
  assert.equal(result.section, '使用指南 > 充电说明')
  assert.equal(result.preview, '使用 5V/1A 适配器充电。')
})
```

- [x] **Step 2: Run test to verify it fails**

Run: `node --test test/sourcePresentation.test.js`

Expected: module-not-found failure because `src/sourcePresentation.js` does not exist.

- [x] **Step 3: Write minimal implementation**

```js
export function getSourcePresentation(text, previewLength = 150) {
  const raw = String(text || '').trim()
  const match = raw.match(/^【章节：([^】]+)】\s*/)
  const body = raw.slice(match?.[0].length || 0).trim()
  const preview = body.replace(/^#{1,6}\s+.*$/gm, '').replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\s+/g, ' ').trim()
  return { section: match?.[1] || '', body, preview: preview.slice(0, previewLength) }
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `node --test test/sourcePresentation.test.js`

Expected: PASS.

### Task 2: Evidence card UI and responsive styling

**Files:**
- Modify: `src/App.jsx`
- Modify: `src/index.css`
- Modify: `test/ragExperienceWiring.test.js`

**Interfaces:**
- Consumes: `getSourcePresentation(source.text)` and existing `source.images`, score fields, and document name.
- Produces: compact evidence cards with `<details>` for original text and retrieval diagnostics.

- [x] **Step 1: Write the failing wiring assertion**

```js
assert.match(source, /getSourcePresentation/)
assert.match(source, /查看原文/)
assert.match(source, /检索详情/)
```

- [x] **Step 2: Run test to verify it fails**

Run: `node --test test/ragExperienceWiring.test.js`

Expected: assertion failure because the compact card is not rendered yet.

- [x] **Step 3: Implement the evidence card**

```jsx
<details className="source-original">
  <summary>查看原文</summary>
  <div dangerouslySetInnerHTML={{ __html: renderMarkdown(body) }} />
</details>
<details className="source-retrieval-details">
  <summary>检索详情</summary>
  <span>相关度 {source.score}</span>
</details>
```

- [x] **Step 4: Apply card styles**

```css
.rag-source-item { display: block; border-radius: 12px; }
.source-preview { display: -webkit-box; -webkit-line-clamp: 2; overflow: hidden; }
.source-original h1, .source-original h2 { font-size: 15px; }
```

- [x] **Step 5: Run focused tests and build**

Run: `node --test test/sourcePresentation.test.js test/ragExperienceWiring.test.js && npm run build`

Expected: all tests pass and Vite build exits 0.

### Task 3: Regression verification

**Files:**
- Verify: `src/App.jsx`
- Verify: `src/index.css`
- Verify: `test/`

- [x] **Step 1: Run full verification**

Run: `npm test && npm run build && git diff --check`

Expected: all tests pass, build exits 0, and no whitespace errors are reported.

- [ ] **Step 2: Inspect the RAG page manually**

Verify: answer remains the dominant card; each reference defaults to document name, chapter, two-line preview, optional images, and closed original text; the technical metrics appear only after opening `检索详情`.
