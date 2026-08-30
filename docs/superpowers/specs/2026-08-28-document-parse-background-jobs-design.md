# Document Parsing Background Jobs Design

## Goal

Move document parsing, chunking, and embedding from the Web API process into a durable background worker. Uploads must return quickly, queued work must survive a Web or Worker restart, and users must be able to see real progress, failure reasons, retry a failed document, or cancel it.

This first version targets one local machine: MySQL and the Web API run as they do today; Redis runs in Docker; the document Worker is a separate Node.js process. Cloud deployment and Docker Compose are intentionally out of scope.

## Current problem

`POST /api/documents/upload` and `POST /api/documents/:id/reparse` start a Promise inside the Web process. If that process is stopped, the Promise disappears. `recoverStaleDocumentJobs` can only turn the old `processing` document into a failure, so it cannot resume the work. The frontend also displays a timed success sequence before parsing and indexing have actually completed.

## Architecture

```
Browser
  -> Web API (upload, task creation, status/retry/cancel endpoints)
     -> MySQL: documents + document_jobs
     -> Redis: BullMQ document-parse queue
        -> Document Worker (parse -> chunk -> embed)
           -> MySQL: document content, chunks, job progress/status
```

The Web process never parses a document. Its responsibilities are to persist the uploaded file, calculate its SHA-256 hash, create a document and task record, and enqueue work.

The Worker is started with `npm run worker:documents`. It consumes a BullMQ queue with a conservative default concurrency of two jobs. It owns parsing, semantic chunking, vector creation, and all progress updates.

Redis is bound to `127.0.0.1:6379` and persists its data under `D:\DockerData\redis`. The application reads its connection from `REDIS_URL`, defaulting to `redis://127.0.0.1:6379` for local development.

## Durable delivery and restart recovery

The database task row is created before attempting to add the BullMQ job. BullMQ's deterministic `jobId` is derived from that row as `document-<database task ID>`; the prefix is required because BullMQ 6 rejects pure numeric custom IDs.

If Redis is temporarily unavailable, the document and task remain `queued`; the API bounds queue operations with `DOCUMENT_QUEUE_TIMEOUT_MS` and returns an actionable queue-unavailable error instead of hanging or pretending the document is running. On Web API startup, a reconciliation pass adds every active database task whose BullMQ job is missing to the queue using its deterministic job ID. Adding the same BullMQ job ID is idempotent.

BullMQ persists waiting, delayed, and retry information in Redis. A Worker shutdown releases its lock; BullMQ marks a stalled active job and retries it according to the retry policy. When a BullMQ job reaches final failure, the Worker synchronizes that result into MySQL. A Web restart does not stop the Worker at all. These properties mean accepted work is either visible as a queued/failed task in MySQL or present in BullMQ; it is never silently discarded.

## Status model

Keep the existing numeric `documents.status` values so old data and unrelated consumers continue to work:

| Document status | Value | Meaning |
| --- | ---: | --- |
| `processing` | 0 | A Worker owns the current parse task. |
| `completed` | 1 | Content and chunks are ready for retrieval. |
| `failed` | 2 | The final attempt failed; a user may retry it. |
| `queued` | 3 | The task is persisted and awaiting a Worker. |
| `cancelled` | 4 | The user cancelled the task; it is not searchable. |

The API exposes both the compatible number and a `statusName`, so the frontend does not need to embed numeric state knowledge.

`document_jobs.status` is explicit: `queued`, `processing`, `completed`, `failed`, or `cancelled`. A document has one current task and may have historical tasks created by retry or reparse.

## Database changes

Add these columns to `documents`:

- `file_hash CHAR(64) NULL`: SHA-256 of the original file bytes.
- an index/unique constraint on `(user_id, file_hash)` once legacy NULL rows are allowed.

Add `document_jobs`:

- `id BIGINT` primary key; this is the deterministic BullMQ job ID.
- `document_id`, `user_id`, `job_type` (`parse` or `reparse`).
- `status`, `progress` (0-100), and `stage` (`queued`, `parsing`, `chunking`, `embedding`, `finalizing`).
- `attempts_made`, `max_attempts`, `cancel_requested`.
- `queue_job_id`, `error_message`, `created_at`, `started_at`, `finished_at`, and `updated_at`.
- indexes for a document's newest task, user task history, and active task reconciliation.

Foreign keys cascade with document deletion. To prevent a Worker from reading a deleted file, the API rejects deletion while a job is queued or processing. The user cancels the task first, waits for a terminal status, then deletes the file and database row.

## Upload, de-duplication, and reparse flow

1. Multer writes the upload to the existing upload directory and the API validates its signature.
2. The API computes SHA-256 from the saved bytes.
3. It checks `(user_id, file_hash)`. An identical existing document is returned with its newest task instead of being parsed twice; the newly written duplicate file is removed. De-duplication is per user, so one user's private file is never revealed to another user.
4. For a new file, the API creates `documents` with `queued` plus one `document_jobs` row in a database transaction, then adds the deterministic BullMQ job.
5. The API returns HTTP 202 with document ID, task ID, status, progress, and de-duplication information.
6. Reparse and retry create a new task history row for the same document. Reparse always parses the existing original file; retry is limited to `failed` and `cancelled` documents.

While a document is queued or processing, it is excluded from retrieval. Once completed, the Worker updates the document and chunks, invalidates retrieval caches, then marks the task and document complete.

## Worker and retry behaviour

The Worker extracts the HTTP-independent parse logic into a document processing service and updates progress at durable stage boundaries:

- 5%: claimed by a Worker.
- 20%: parsing source file.
- 55%: content parsed and being chunked.
- 75%: chunks being embedded and stored.
- 100%: document and retrieval index ready.

Transient errors use up to three BullMQ attempts with exponential backoff. Examples include Redis, MinerU, or temporary network failures. Deterministic errors such as an unsupported/corrupt file fail immediately with the reason recorded. A user-triggered retry creates a fresh task record rather than mutating historical failures.

The Worker records a concise, user-safe error message for the UI and keeps a longer server log with the underlying error. Errors never expose API keys, file-system paths, or stack traces to the browser.

During migration, legacy documents with old `documents.status = 0` and no task record are converted to `queued` `migration-recovery` jobs, so upgrading does not leave historical work permanently stuck.

## Cancellation and deletion

For a waiting or delayed job, cancellation removes the BullMQ job and marks the document and task `cancelled` immediately. For an active job, cancellation sets `cancel_requested`; the Worker checks this before and after parsing, chunking, and embedding, then stops at the next safe boundary.

An in-flight external MinerU request cannot be forcibly stopped by BullMQ. In that case, its eventual result is discarded when `cancel_requested` is set, and the task ends as `cancelled` without creating searchable chunks.

Deleting a queued or processing document is rejected. After the user has cancelled the task and it reaches a terminal state, the normal delete endpoint performs file and database cleanup.

## API and frontend

Keep the existing endpoints, with changed asynchronous semantics:

- `POST /api/documents/upload` returns HTTP 202 and the initial task summary.
- `POST /api/documents/:id/reparse` creates and returns a new queued task.

Add:

- `GET /api/documents/:id/job` for the latest task summary and status.
- `POST /api/documents/:id/retry` for owner-only retry of failed/cancelled documents.
- `POST /api/documents/:id/cancel` for owner-only cancellation.

The document list response includes the latest task summary. The frontend removes its simulated parsing success messages. It polls the list or job endpoint every two seconds only while it has queued/processing documents, stops polling at terminal states, shows stage/progress, displays a safe failure reason, and provides retry/cancel actions according to status.

## Files and process boundaries

- `server/services/documentProcessingService.js`: pure parse/chunk/embed workflow used only by the Worker.
- `server/services/documentJobService.js`: database transactions, de-duplication, task status/progress, reconciliation, and safe error handling.
- `server/queues/documentQueue.js`: Redis connection, BullMQ queue configuration, enqueue/remove/reconcile helpers.
- `server/workers/documentWorker.js`: Worker process entry point and BullMQ processor.
- `server/routes/documents.js`: small HTTP orchestration only.
- `server/index.js`: initialise queue reconciliation without importing/starting a Worker.
- `package.json`: adds `worker:documents` and focused task-test commands.

## Verification and acceptance

Automated coverage will include:

- migration creates the new table, columns, indexes, and preserves legacy document statuses;
- same-user SHA-256 de-duplication;
- state transitions and owner-only retry/cancel access;
- transient retry versus deterministic terminal failure;
- cancellation before processing and cancellation during processing;
- reconciliation of a persisted queued row missing from Redis;
- existing document, auth, retrieval, and frontend tests remain green.

Manual acceptance checks:

1. Start Redis, Web, and Worker; upload a document and observe true progress through completion.
2. Stop and restart only the Web service while a task runs; the Worker completes it.
3. Stop a Worker during parsing, restart it, and confirm the task is retried or resumed by the durable queue rather than silently disappearing.
4. Force a parse error; confirm the document UI shows the saved reason and retry produces a new task history record.
5. Cancel a queued and an active task; confirm neither leaves searchable chunks.
