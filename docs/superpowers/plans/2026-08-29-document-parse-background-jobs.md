# Document Parse Background Jobs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make document parsing a durable, observable, retryable BullMQ background job without changing the RAG API contracts unrelated to document management.

**Architecture:** The Web API persists the file, document and task record, then enqueues a deterministic BullMQ job ID. A separate Node Worker performs parsing, chunking and embedding while persisting stage/progress in MySQL. MySQL is the user-facing task history and a reconciliation source; Redis/BullMQ provides durable delivery, delayed retries and Worker recovery.

**Tech Stack:** Node.js 22, Express 5, MySQL 8, Redis 7, BullMQ 6.3.1, ioredis 6.0.0, React 18, Vite 6, Node Test Runner.

**Spec:** `docs/superpowers/specs/2026-08-28-document-parse-background-jobs-design.md`

## Global Constraints

- Keep numeric legacy `documents.status`: `0=processing`, `1=completed`, `2=failed`; add `3=queued`, `4=cancelled` and expose a `statusName` for the UI.
- Use `REDIS_URL`, defaulting only in local development to `redis://127.0.0.1:6379`; the configured Redis container is local-only and persistent at `D:\DockerData\redis`.
- Use `bullmq@6.3.1` and `ioredis@6.0.0`; do not add Docker Compose or cloud deployment in this change.
- SHA-256 de-duplication is per document owner, never across users.
- Web error responses and persisted user-visible errors must not expose paths, stack traces, secrets, or MinerU payloads.
- The Worker, not `server/index.js` and not an Express route, is the only process allowed to parse, chunk, or embed a newly submitted document.
- Preserve existing owner-only document management and exclude every non-`completed` document from retrieval.

---

## File Structure

- `server/init.sql` — declares `documents.file_hash` and durable `document_jobs` schema for a clean installation.
- `server/migrate.js` — upgrades an existing database with the same columns, indexes and table idempotently, including recovery jobs for legacy `status=0` documents without task history.
- `server/services/documentJobState.js` — pure status/progress/error helpers, with no database or Redis import.
- `server/services/documentJobService.js` — MySQL task lifecycle, hash de-duplication, authorization-sensitive retry/cancel, and reconciliation queries.
- `server/queues/documentQueue.js` — Redis/BullMQ configuration, deterministic enqueue/remove helpers, bounded Redis operation timeouts, and graceful close.
- `server/services/documentProcessingService.js` — HTTP-independent parse → chunk → embed workflow that reports durable stage boundaries.
- `server/workers/documentWorker.js` — executable Worker entry point; bridges BullMQ events to the processing and job services.
- `server/routes/documents.js` — HTTP orchestration only: upload file, create/retry/reparse/cancel jobs, read status and safely delete.
- `server/index.js` — invokes non-destructive queue reconciliation after the database is available; it never starts a Worker.
- `src/documentJobPresentation.js` — pure UI display/polling/action policy for a document task.
- `src/App.jsx`, `src/index.css` — replaces simulated upload completion with true task status, polling and controls.
- `test/documentJobState.test.js`, `test/documentQueue.test.js`, `test/documentJobService.test.js`, `test/documentProcessingService.test.js`, `test/documentJobPresentation.test.js`, `test/documentJobWiring.test.js` — focused unit and wiring coverage.
- `.env.example`, `README.md`, `package.json`, `package-lock.json` — local configuration, start instructions and scripts/dependencies.

### Task 1: Extend the schema and compatible status contract

**Files:**
- Modify: `server/init.sql:15-35`
- Modify: `server/migrate.js:41-155`
- Modify: `test/migration.test.js`

**Interfaces:**
- Produces table `document_jobs` and unique nullable index `uq_documents_user_file_hash (user_id, file_hash)`.
- Produces `documents.file_hash CHAR(64) NULL`; existing status values remain unchanged.
- Consumed by Task 3 through SQL fields `id`, `document_id`, `user_id`, `job_type`, `status`, `progress`, `stage`, `attempts_made`, `max_attempts`, `cancel_requested`, `queue_job_id`, `error_message`, `created_at`, `started_at`, `finished_at`, and `updated_at`.

- [ ] **Step 1: Write schema expectations that fail before the migration exists**

```js
test('文档后台任务表和去重字段在初始化脚本中声明', () => {
  const combined = loadInitStatements().join('\n')
  assert.match(combined, /CREATE TABLE IF NOT EXISTS document_jobs\b/)
  assert.match(combined, /file_hash CHAR\(64\) DEFAULT NULL/)
  assert.match(combined, /UNIQUE INDEX uq_documents_user_file_hash \(user_id, file_hash\)/)
  assert.match(combined, /status VARCHAR\(20\) NOT NULL DEFAULT 'queued'/)
})
```

- [ ] **Step 2: Run the focused migration test and observe the missing-table failure**

Run: `node --test test/migration.test.js`

Expected: the new assertion fails because `document_jobs` and `file_hash` do not exist in `init.sql`.

- [ ] **Step 3: Add the clean-install schema and idempotent old-database upgrades**

Add `file_hash CHAR(64) DEFAULT NULL` to `documents`, add the nullable unique index, and add this table to `server/init.sql`:

```sql
CREATE TABLE IF NOT EXISTS document_jobs (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  document_id INT NOT NULL,
  user_id INT NOT NULL,
  job_type VARCHAR(20) NOT NULL DEFAULT 'parse',
  status VARCHAR(20) NOT NULL DEFAULT 'queued',
  progress TINYINT NOT NULL DEFAULT 0,
  stage VARCHAR(30) NOT NULL DEFAULT 'queued',
  attempts_made INT NOT NULL DEFAULT 0,
  max_attempts INT NOT NULL DEFAULT 3,
  cancel_requested TINYINT(1) NOT NULL DEFAULT 0,
  queue_job_id VARCHAR(64) DEFAULT NULL,
  error_message VARCHAR(1000) DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  started_at DATETIME DEFAULT NULL,
  finished_at DATETIME DEFAULT NULL,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_dj_document_created (document_id, created_at),
  INDEX idx_dj_user_created (user_id, created_at),
  INDEX idx_dj_active (status, created_at),
  UNIQUE INDEX uq_dj_queue_job (queue_job_id),
  FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;
```

In `runMigrations`, use the existing `ensureColumn` and `ensureIndex` helpers for `documents.file_hash` and `uq_documents_user_file_hash`; `CREATE TABLE IF NOT EXISTS` handles existing installations for the new table. Do not remap legacy numeric status rows.

- [ ] **Step 4: Run the migration test and syntax validation**

Run: `node --test test/migration.test.js && npm run db:migrate`

Expected: test passes; local MySQL migration completes without altering existing completed documents.

- [ ] **Step 5: Commit the isolated schema change**

```bash
git add server/init.sql server/migrate.js test/migration.test.js
git commit -m "feat: add durable document job schema"
```

### Task 2: Add BullMQ and the deterministic queue boundary

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `.env.example`
- Create: `server/queues/documentQueue.js`
- Create: `test/documentQueue.test.js`

**Interfaces:**
- Produces `getDocumentQueue()`, `enqueueDocumentJob(job)`, `removeQueuedDocumentJob(jobId)`, and `closeDocumentQueue()`.
- `enqueueDocumentJob({ id, documentId, userId, jobType })` adds queue name `document-parse` with deterministic `jobId: document-<id>` and returns the BullMQ job. The non-numeric prefix is required by BullMQ 6.
- Consumed by Tasks 3–5 and 7.

- [ ] **Step 1: Write pure queue option tests before installing or importing BullMQ**

```js
import { buildDocumentJobOptions, parseRedisUrl } from '../server/queues/documentQueue.js'

test('文档任务使用数据库 ID、三次重试和指数退避', () => {
  assert.deepEqual(buildDocumentJobOptions(42), {
    jobId: 'document-42', attempts: 3, backoff: { type: 'exponential', delay: 10000 },
    removeOnComplete: 1000, removeOnFail: false
  })
})

test('本地 Redis URL 只使用明确配置或本机默认值', () => {
  assert.equal(parseRedisUrl('redis://127.0.0.1:6379').host, '127.0.0.1')
})
```

- [ ] **Step 2: Run the new test and verify it fails because the queue module does not exist**

Run: `node --test test/documentQueue.test.js`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `server/queues/documentQueue.js`.

- [ ] **Step 3: Add exact dependencies, environment documentation and queue implementation**

Run: `npm install bullmq@6.3.1 ioredis@6.0.0`

Add to `.env.example`:

```ini
# 文档后台任务：本机 Docker Redis
REDIS_URL=redis://127.0.0.1:6379
DOCUMENT_WORKER_CONCURRENCY=2
DOCUMENT_JOB_MAX_ATTEMPTS=3
DOCUMENT_QUEUE_TIMEOUT_MS=5000
```

Implement `documentQueue.js` using one lazily-created `IORedis(process.env.REDIS_URL || 'redis://127.0.0.1:6379', { maxRetriesPerRequest: null })`, a BullMQ `Queue('document-parse', { connection })`, and the tested job options. `removeQueuedDocumentJob` must call `getJob(String(jobId))` and only remove `waiting`, `paused`, or `delayed` jobs; it must return `false` for an active/missing job rather than throwing.

- [ ] **Step 4: Verify options and a real local Redis round trip**

Run: `node --test test/documentQueue.test.js`

Run: `node -e "import('./server/queues/documentQueue.js').then(async m => { const q=m.getDocumentQueue(); await q.waitUntilReady(); console.log('Redis queue ready'); await m.closeDocumentQueue() })"`

Expected: unit tests pass and the second command prints `Redis queue ready` against `127.0.0.1:6379`.

- [ ] **Step 5: Commit queue dependencies and boundary module**

```bash
git add package.json package-lock.json .env.example server/queues/documentQueue.js test/documentQueue.test.js
git commit -m "feat: add BullMQ document queue"
```

### Task 3: Implement task state, de-duplication, and MySQL lifecycle services

**Files:**
- Create: `server/services/documentJobState.js`
- Create: `server/services/documentJobService.js`
- Create: `test/documentJobState.test.js`
- Create: `test/documentJobService.test.js`

**Interfaces:**
- `DOCUMENT_STATUS = { processing: 0, completed: 1, failed: 2, queued: 3, cancelled: 4 }`.
- `getDocumentStatusName(number)`, `isTerminalJobStatus(name)`, `sanitizeDocumentJobError(error)`, and `clampProgress(value)` are pure functions.
- `createDocumentJobService({ pool, enqueueDocumentJob, removeQueuedDocumentJob })` returns `createUploadJob`, `createReparseJob`, `getLatestJob`, `requestCancel`, `createRetryJob`, `markProcessing`, `reportProgress`, `markCompleted`, `markFailed`, `markCancelled`, and `reconcileQueuedJobs`.
- Task 4 consumes lifecycle methods; Task 5 consumes upload/reparse/retry/cancel/read methods.

- [ ] **Step 1: Write failing state-machine tests**

```js
import { DOCUMENT_STATUS, getDocumentStatusName, isTerminalJobStatus, sanitizeDocumentJobError } from '../server/services/documentJobState.js'

test('兼容的文档状态映射包含 queued 和 cancelled', () => {
  assert.equal(DOCUMENT_STATUS.completed, 1)
  assert.equal(getDocumentStatusName(3), 'queued')
  assert.equal(getDocumentStatusName(4), 'cancelled')
})

test('用户可见错误不会泄露路径或堆栈', () => {
  assert.equal(sanitizeDocumentJobError(new Error('ENOENT: D:\\uploads\\secret.pdf')), '文档处理失败，请重试或检查文件格式')
})
```

Add fake-pool tests that assert the service creates a `queued` document/job pair in one transaction, invokes `enqueueDocumentJob` with the new job ID, returns a same-owner hash duplicate without enqueuing, and lets only the owner retry/cancel.

- [ ] **Step 2: Run the focused service tests and verify module-not-found failures**

Run: `node --test test/documentJobState.test.js test/documentJobService.test.js`

Expected: FAIL because both service modules are absent.

- [ ] **Step 3: Implement pure state helpers and the transaction-backed service**

Implement status constants and an allow-list error sanitizer in `documentJobState.js`. In `documentJobService.js`:

```js
export function createDocumentJobService({ pool, enqueueDocumentJob, removeQueuedDocumentJob }) {
  return Object.freeze({
    createUploadJob,
    createReparseJob,
    getLatestJob,
    requestCancel,
    createRetryJob,
    markProcessing,
    reportProgress,
    markCompleted,
    markFailed,
    markCancelled,
    reconcileQueuedJobs
  })
}
```

Hash with `crypto.createHash('sha256')` and `fs.createReadStream`, not a whole-file `readFile`. Perform duplicate lookup using `user_id` and `file_hash`; delete only the just-uploaded duplicate file after confirming it lies inside `UPLOAD_DIR`. Commit document/job inserts together; if enqueue fails, leave the task queued with a safe queue-unavailable error so reconciliation can repair it. Map task completion/failure/cancellation to both the job row and the compatible document status.

- [ ] **Step 4: Run focused state/service tests and the legacy suite**

Run: `node --test test/documentJobState.test.js test/documentJobService.test.js test/migration.test.js test/documentAccess.test.js`

Expected: all tests pass; fake pool assertions prove no cross-user duplicate check occurs.

- [ ] **Step 5: Commit the lifecycle service**

```bash
git add server/services/documentJobState.js server/services/documentJobService.js test/documentJobState.test.js test/documentJobService.test.js
git commit -m "feat: persist document job lifecycle"
```

### Task 4: Move parsing into an independent Worker with retry-safe progress

**Files:**
- Create: `server/services/documentProcessingService.js`
- Create: `server/workers/documentWorker.js`
- Modify: `server/index.js:15,120-135`
- Modify: `package.json`
- Create: `test/documentProcessingService.test.js`
- Create: `test/documentJobWiring.test.js`

**Interfaces:**
- `createDocumentProcessor(dependencies).process({ jobId, documentId, userId, filePath, fileType })` returns `{ content, chunkCount, metadata, frontMatter }` or throws a classified error.
- Processor dependencies are `parseWithMineru`, `parseDocument`, `readTextFile`, `parseFrontMatter`, `chunkDocument`, `storeDocumentChunks`, `invalidateAllChunks`, `reportProgress`, and `isCancelRequested`.
- `startDocumentWorker()` starts queue `document-parse` at `DOCUMENT_WORKER_CONCURRENCY` and closes cleanly on `SIGINT`/`SIGTERM`.

- [ ] **Step 1: Write processing and Worker boundary tests**

```js
test('处理器按 parse、chunk、embed 顺序记录真实进度', async () => {
  const calls = []
  const processor = createDocumentProcessor({
    parseDocument: async () => '正文', chunkDocument: () => [{ content: '正文' }],
    storeDocumentChunks: async () => 1, reportProgress: async (_, stage, progress) => calls.push([stage, progress]),
    isCancelRequested: async () => false, parseWithMineru: async () => { throw new Error('unused') },
    readTextFile: async () => '正文', parseFrontMatter: text => ({ body: text, metadata: {} }), invalidateAllChunks: () => {}
  })
  await processor.process({ jobId: 1, documentId: 9, userId: 2, filePath: 'fixture.docx', fileType: 'docx' })
  assert.deepEqual(calls, [['parsing', 20], ['chunking', 55], ['embedding', 75], ['finalizing', 100]])
})

test('取消请求会在下一安全边界阻止写入向量', async () => {
  let checks = 0
  let writes = 0
  const processor = createDocumentProcessor({
    parseDocument: async () => '正文', chunkDocument: () => [{ content: '正文' }],
    storeDocumentChunks: async () => { writes++; return 1 }, reportProgress: async () => {},
    isCancelRequested: async () => ++checks >= 2, parseWithMineru: async () => { throw new Error('unused') },
    readTextFile: async () => '正文', parseFrontMatter: text => ({ body: text, metadata: {} }), invalidateAllChunks: () => {}
  })
  await assert.rejects(
    processor.process({ jobId: 2, documentId: 10, userId: 2, filePath: 'fixture.docx', fileType: 'docx' }),
    error => error.code === 'DOCUMENT_JOB_CANCELLED'
  )
  assert.equal(writes, 0)
})
```

Add wiring assertions that `server/index.js` no longer imports/calls `recoverStaleDocumentJobs`, exports no Worker startup, and package scripts include `worker:documents`.

- [ ] **Step 2: Run focused tests and verify missing module/script failures**

Run: `node --test test/documentProcessingService.test.js test/documentJobWiring.test.js`

Expected: FAIL because the processing service and Worker entry point are absent; wiring test finds the old stale-job recovery call.

- [ ] **Step 3: Implement processing service and Worker entry point**

Extract the parser choice from `documents.js` into `documentProcessingService.js`: text files use `readTextFile` plus front matter; MinerU is preferred when configured; PDF/DOCX use local parsing otherwise; unsupported formats throw a classified non-retryable error. Check cancellation before parsing, after parsing, after chunking and before document chunk storage. Only after `storeDocumentChunks` succeeds may the Worker mark the document completed.

In `documentWorker.js`, create a BullMQ `Worker` with `concurrency: Math.max(1, Number(process.env.DOCUMENT_WORKER_CONCURRENCY) || 2)`, `maxStalledCount: 1`, and the same Redis connection. Claim the MySQL job, call the processor, and call lifecycle methods to mark completed/cancelled/failed. Configure BullMQ attempts/backoff through Task 2 options; deterministic parser errors must call `job.discard()` before throwing. Add `worker:documents`:

```json
"worker:documents": "node --max-old-space-size=8192 server/workers/documentWorker.js"
```

Replace the startup stale-failure mutation in `server/index.js` with `reconcileQueuedJobs()` after `checkDatabase()`; failures log a safe warning and do not prevent the API from starting.

- [ ] **Step 4: Run the Worker-focused tests and start/stop smoke check**

Run: `node --test test/documentProcessingService.test.js test/documentJobWiring.test.js`

Run in one terminal: `npm run worker:documents`

Expected: tests pass and Worker logs that it is connected to `document-parse`; stopping it with Ctrl+C closes BullMQ and Redis without an unhandled rejection.

- [ ] **Step 5: Commit independent processing**

```bash
git add server/services/documentProcessingService.js server/workers/documentWorker.js server/index.js package.json test/documentProcessingService.test.js test/documentJobWiring.test.js
git commit -m "feat: process documents in background worker"
```

### Task 5: Convert document routes to task orchestration APIs

**Files:**
- Modify: `server/routes/documents.js:1-320`
- Create: `test/documentRoutesJobs.test.js`

**Interfaces:**
- `POST /api/documents/upload` returns HTTP 202 with `{ ok: true, data: { id, status, statusName, job } }` for a new or duplicate document.
- `POST /api/documents/:id/reparse`, `POST /api/documents/:id/retry`, and `POST /api/documents/:id/cancel` are owner-only task actions.
- `GET /api/documents/:id/job` returns the newest owner-visible task.
- `GET /api/documents/list` includes `latest_job_id`, `job_status`, `job_progress`, `job_stage`, `job_error_message`, and `status_name`.

- [ ] **Step 1: Write failing route-helper tests with injected service fakes**

Extract a small `createDocumentRouteHandlers({ jobService, filePolicy })` factory so tests can call handlers with fake request/response objects. Cover:

```js
test('上传只创建队列任务并返回 202，不在路由里解析', async () => {
  const res = createFakeResponse()
  await handlers.upload({ user: { id: 7 }, file: fixtureFile }, res)
  assert.equal(res.statusCode, 202)
  assert.equal(fakeJobService.createUploadJob.calls.length, 1)
  assert.equal(fakeParser.calls.length, 0)
})

test('非所有者不能重试、取消或读取最新任务', async () => {
  const res = createFakeResponse()
  const hiddenService = {
    createRetryJob: async () => null,
    requestCancel: async () => null,
    getLatestJob: async () => null
  }
  const protectedHandlers = createDocumentRouteHandlers({ jobService: hiddenService, filePolicy })
  await protectedHandlers.retry({ user: { id: 99 }, params: { id: '8' } }, res)
  assert.equal(res.statusCode, 404)
})
```

- [ ] **Step 2: Run the focused route test and confirm the existing direct parser path fails it**

Run: `node --test test/documentRoutesJobs.test.js`

Expected: FAIL because handlers are not exported and upload still imports/starts parser promises.

- [ ] **Step 3: Replace HTTP-process parsing with service calls**

Keep Multer, extension/signature checks, file-size limits, scoped list/detail/image access, and resource cleanup. Move hashing and duplicate clean-up into Task 3 service. Delete the `parsePromise` and `reparsePromise` chains plus direct `parseDocument`, `parseWithMineru`, `chunkDocument`, and `storeDocumentChunks` imports from the route.

Use a latest-job correlated join in list/detail reads, for example:

```sql
LEFT JOIN document_jobs dj ON dj.id = (
  SELECT j.id FROM document_jobs j
  WHERE j.document_id = d.id ORDER BY j.id DESC LIMIT 1
)
```

Return safe `statusName` and task summary. Preserve owner checks on reparse, retry, cancel and delete. Reject deletion of a queued/processing document with HTTP 409; the user must cancel it first, then delete only after it reaches a terminal state, so a Worker never reads a deleted file.

- [ ] **Step 4: Run route and existing document tests**

Run: `node --test test/documentRoutesJobs.test.js test/migration.test.js test/documentAccess.test.js test/uploadAssets.test.js`

Expected: task route tests pass; there is no parser invocation in the upload request path.

- [ ] **Step 5: Commit API orchestration**

```bash
git add server/routes/documents.js test/documentRoutesJobs.test.js
git commit -m "feat: queue document uploads and task actions"
```

### Task 6: Show real job progress and task actions in the React interface

**Files:**
- Create: `src/documentJobPresentation.js`
- Create: `test/documentJobPresentation.test.js`
- Modify: `src/App.jsx:405-505,785-800`
- Modify: `src/index.css:1430-1490`

**Interfaces:**
- `getDocumentJobPresentation(document)` returns `{ text, tone, progress, showRetry, showCancel, poll }`.
- `shouldPollDocumentJobs(documents)` returns true only for `queued`/`processing` documents.
- App calls `POST /retry` and `POST /cancel`; it refreshes documents immediately and polls at 2000 ms while `shouldPollDocumentJobs` is true.

- [ ] **Step 1: Write UI presentation tests first**

```js
import { getDocumentJobPresentation, shouldPollDocumentJobs } from '../src/documentJobPresentation.js'

test('排队任务显示服务端阶段和进度，不假装完成', () => {
  assert.deepEqual(getDocumentJobPresentation({ statusName: 'queued', job_progress: 0, job_stage: 'queued' }), {
    text: '已入队，等待解析', tone: 'pending', progress: 0, showRetry: false, showCancel: true, poll: true
  })
})

test('只有活跃文档启动轮询', () => {
  assert.equal(shouldPollDocumentJobs([{ statusName: 'completed' }, { statusName: 'processing' }]), true)
  assert.equal(shouldPollDocumentJobs([{ statusName: 'failed' }]), false)
})
```

- [ ] **Step 2: Run presentation tests and observe the missing-module failure**

Run: `node --test test/documentJobPresentation.test.js`

Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Implement presentation policy and wire it into App.jsx**

Implement the pure module for Chinese labels: queued `已入队，等待解析`, parsing/chunking/embedding `处理中 · <阶段> · <百分比>%`, completed `已就绪`, failed `失败：<safe error>`, and cancelled `已取消`.

In `handleLoadFile`, remove the timed fake steps `正在解析文档内容...`, `构建 BM25 倒排索引...`, and `文档加载成功！`; show only actual upload/queue response. Add an effect that creates one 2000 ms interval only while `shouldPollDocumentJobs(documents)` is true, clears it on cleanup, and calls `loadDocuments`. Add owner-only Retry and Cancel buttons with confirmation; keep reparse as a queued action. Use an inline progress bar and accessible `aria-label` rather than browser alerts for state visibility.

- [ ] **Step 4: Run UI tests and production build**

Run: `node --test test/documentJobPresentation.test.js test/documentAccess.test.js`

Run: `npm run build`

Expected: presentation tests and Vite build pass; document list is not broken by status values 3 and 4.

- [ ] **Step 5: Commit the observable frontend**

```bash
git add src/documentJobPresentation.js test/documentJobPresentation.test.js src/App.jsx src/index.css
git commit -m "feat: show document job progress and controls"
```

### Task 7: Document local operation and verify end-to-end behaviour

**Files:**
- Modify: `README.md:31-55,120-180`
- Modify: `.env.example`
- Modify: `package.json`
- Modify: `test/documentJobWiring.test.js`

**Interfaces:**
- Documents `docker start xf-rag-redis`, `npm run server`, `npm run worker:documents`, and `npm run dev` as the required local processes.
- Adds `test:document-jobs` script: `node --test test/documentJobState.test.js test/documentQueue.test.js test/documentJobService.test.js test/documentProcessingService.test.js test/documentRoutesJobs.test.js test/documentJobPresentation.test.js test/documentJobWiring.test.js`.

- [ ] **Step 1: Add failing wiring assertions for user-facing operational documentation**

```js
test('README documents Redis plus a separate document Worker', () => {
  const readme = fs.readFileSync(new URL('../README.md', import.meta.url), 'utf8')
  assert.match(readme, /docker start xf-rag-redis/)
  assert.match(readme, /npm run worker:documents/)
  assert.doesNotMatch(readme, /当前文档解析任务仍在 Web 进程内/)
})
```

- [ ] **Step 2: Run the wiring test and observe the old limitation text failure**

Run: `node --test test/documentJobWiring.test.js`

Expected: FAIL because README still says parsing runs in the Web process.

- [ ] **Step 3: Update documentation and focused command**

Update README architecture to include Redis and `Document Worker`; add Redis to the data stack; document the three runtime terminals and the recovery/retry/cancel behaviour. Replace the old “future direction” queue limitation with the actual limitation that this first version is single-host. Add the exact `test:document-jobs` script and make `.env.example` describe required local Redis.

- [ ] **Step 4: Run automated verification and manual acceptance sequence**

Run: `npm run test:document-jobs && npm test && npm run build`

Manual sequence:

1. Run `docker start xf-rag-redis`, `npm run server`, `npm run worker:documents`, and `npm run dev`.
2. Upload a valid MD/TXT or PDF/DOCX file and verify status progresses from queued to completed with a non-zero chunk count.
3. Upload the exact same file as the same user and verify no second job is created; upload it as a different user and verify a separate private document is created.
4. Stop/restart only the Web API during an active job and confirm the Worker completes it.
5. Stop the Worker during active parsing, restart it, and verify BullMQ retries/reconciles instead of silently losing the task.
6. Upload an invalid/corrupt document, verify a safe stored failure reason, use Retry, and verify a new task history row appears.
7. Cancel a waiting and active task; verify neither becomes searchable.

Expected: every automated command passes and all seven manual checks meet the design spec.

- [ ] **Step 5: Commit operational documentation and final verification evidence**

```bash
git add README.md .env.example package.json test/documentJobWiring.test.js
git commit -m "docs: document background job operation"
```

After the commit, run `git status --short`, preserve unrelated changes, and record the exact test/build output in the final handoff.
