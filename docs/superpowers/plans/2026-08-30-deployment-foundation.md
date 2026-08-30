# 部署与运行保障第一阶段 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让项目在一台安装 Docker 的电脑上可重复启动 API、前端、MySQL、Redis 和文档 Worker，并具备配置预检、请求日志和可控备份恢复。

**Architecture:** 使用 Node 22 Debian 多阶段镜像构建 Vite 前端，并复用同一运行镜像启动一次性迁移、Express API 和 BullMQ Worker。Compose 管理 MySQL、Redis、启动依赖和共享数据卷；API 提供 SPA 与健康检查。运行时配置在进程联网前校验，备份/恢复脚本只通过明确命令接触 Compose 中的 MySQL。

**Tech Stack:** Node.js 22、Express 5、Vite 6、MySQL 8.4、Redis 7、BullMQ、Docker Compose v2、Node built-in test runner。

**Spec:** `docs/superpowers/specs/2026-08-30-deployment-foundation-design.md`

## Global Constraints

- 不运行真实数据库迁移、恢复、删除 Docker 卷或公网发布；自动化只验证 Compose 配置和纯函数。
- 容器内 API 与 Worker 必须使用同一 `UPLOAD_DIR=/data/uploads` 卷；MySQL、Redis、上传和模型缓存都必须持久化。
- 生产环境要求非示例的 `JWT_SECRET`、有效 MySQL/Redis 配置，以及 HTTPS、非 localhost 的 `PUBLIC_APP_URL`；错误不得打印密钥、Cookie、Authorization、请求正文或 SQL。
- API 继续提供 `/api/live` 和 `/api/health`；二维码的认证与固定型号行为不能改动。
- 恢复脚本必须要求 `--confirm-restore`，备份必须拒绝覆盖已有文件。
- 新代码使用 ESM、无分号风格、中文面向用户错误；每个任务先写失败测试，再作最小实现。

---

## 文件结构

| 文件 | 职责 |
| --- | --- |
| `server/config/runtimeConfig.js` | 纯运行环境校验与启动前断言，不打印机密。 |
| `server/middleware/requestContext.js` | 请求 ID、JSON 请求完成日志、稳定内部错误元数据。 |
| `server/services/transformersRuntime.js` | 将 Transformers.js 缓存明确放到 `MODEL_CACHE_DIR`。 |
| `Dockerfile` / `.dockerignore` | 构建 SPA 和可复用 Node 运行镜像。 |
| `docker-compose.yml` | MySQL、Redis、migrate、api、worker 与持久化依赖图。 |
| `deploy/.env.compose.example` | 不含真实机密的 Compose 配置模板。 |
| `scripts/backup-mysql.js` | 只追加新 `.sql` 文件的 MySQL 备份入口。 |
| `scripts/restore-mysql.js` | 需显式确认的 MySQL 恢复入口。 |
| `test/runtimeConfig.test.js` | 配置预检和请求上下文的纯函数测试。 |
| `test/deploymentArtifacts.test.js` | Compose、镜像、备份/恢复安全契约测试。 |
| `README.md` / `.env.example` / `package.json` | 本机、局域网、Docker、备份恢复的用户入口。 |

## Task 1: 运行配置、请求 ID 和模型缓存

**Files:**

- Create: `server/config/runtimeConfig.js`
- Create: `server/middleware/requestContext.js`
- Create: `server/services/transformersRuntime.js`
- Create: `test/runtimeConfig.test.js`
- Modify: `server/index.js`
- Modify: `server/workers/documentWorker.js`
- Modify: `server/services/embedding.js`
- Modify: `server/services/localLLM.js`

**Interfaces:**

```js
export function validateRuntimeConfig(env = process.env) // { ok, errors }
export function assertRuntimeConfig(env = process.env) // throws Chinese Error when invalid
export function createRequestId(value, randomUuid = crypto.randomUUID) // string
export function requestContextMiddleware(req, res, next)
export function requestLogMiddleware(logger = console.log)
export function configureTransformersRuntime({ runtimeEnv = process.env, transformersEnv }) // cacheDir string
```

- [ ] **Step 1: Write failing configuration and middleware tests**

Create `test/runtimeConfig.test.js` with a complete valid production fixture and assertions:

```js
const validProduction = {
  NODE_ENV: 'production', PORT: '3000', DB_HOST: 'mysql', DB_PORT: '3306',
  DB_USER: 'xf_rag', DB_PASSWORD: 'not-a-placeholder', DB_NAME: 'xf_rag',
  REDIS_URL: 'redis://redis:6379', UPLOAD_DIR: '/data/uploads',
  JWT_SECRET: 'a'.repeat(40), PUBLIC_APP_URL: 'https://help.example.com'
}
assert.deepEqual(validateRuntimeConfig(validProduction), { ok: true, errors: [] })
assert.throws(() => assertRuntimeConfig({ ...validProduction, PUBLIC_APP_URL: 'http://localhost:3000' }), /HTTPS/)
assert.throws(() => assertRuntimeConfig({ ...validProduction, JWT_SECRET: 'your_jwt_secret' }), /JWT_SECRET/)
assert.equal(createRequestId('safe-request_01'), 'safe-request_01')
assert.equal(createRequestId('bad value', () => 'generated-id'), 'generated-id')
```

Use an EventEmitter-backed fake response to prove `X-Request-ID` is returned and one JSON line has only event, requestId, method, path, status and durationMs. Assert a fake cookie and authorization value are absent. Add a fake Transformers env and assert `MODEL_CACHE_DIR=/data/models` becomes its resolved `cacheDir`.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/runtimeConfig.test.js`

Expected: module-not-found failure.

- [ ] **Step 3: Implement minimal runtime safeguards**

Implement numeric `PORT`/`DB_PORT`, non-empty DB host/user/database/upload path, `redis:`/`rediss:` URL and non-placeholder JWT validation. Production additionally requires a 32+ character JWT and the existing `parsePublicAppUrl(value, { production: true })`. Return Chinese errors without secret values.

Accept only incoming IDs matching `^[A-Za-z0-9_-]{8,128}$`; otherwise use `randomUUID()`. Set `req.requestId` and `X-Request-ID`; on `finish`, log exactly `{ event: 'http_request', requestId, method, path, status, durationMs }`. Configure `transformersEnv.cacheDir` only when `MODEL_CACHE_DIR` exists, then import it from both Transformers.js consumers.

Call `assertRuntimeConfig()` after dotenv loads and before API listening or Worker Redis connection. Install request context before routes. Replace the raw top-level HTTP error object log with JSON containing request ID, `err.name` and a bounded `err.code` only.

- [ ] **Step 4: Run focused and full tests**

Run:

```powershell
node --test test/runtimeConfig.test.js test/auth.test.js test/supportChannelService.test.js test/documentWorker.test.js
npm test
```

Expected: focused tests and complete suite pass.

- [ ] **Step 5: Commit Task 1**

```bash
git add server/config/runtimeConfig.js server/middleware/requestContext.js server/services/transformersRuntime.js server/index.js server/workers/documentWorker.js server/services/embedding.js server/services/localLLM.js test/runtimeConfig.test.js
git commit -m "feat: validate runtime deployment configuration"
```

## Task 2: Docker image, Compose topology and configuration template

**Files:**

- Create: `Dockerfile`, `.dockerignore`, `docker-compose.yml`, `deploy/.env.compose.example`, `test/deploymentArtifacts.test.js`
- Modify: `package.json`, `.gitignore`

**Interfaces:**

```yaml
services:
  mysql:    # MySQL 8.4, mysql-data volume, healthcheck
  redis:    # Redis 7, redis-data volume, appendonly and healthcheck
  migrate:  # same app image, node server/migrate.js, one-shot
  api:      # same image, node --max-old-space-size=8192 server/index.js
  worker:   # same image, node --max-old-space-size=8192 server/workers/documentWorker.js
```

- [ ] **Step 1: Write failing deployment artifact tests**

Create `test/deploymentArtifacts.test.js`. It must assert the files exist; Compose names `mysql:8.4`, `redis:7`, `migrate`, `api`, `worker`, `uploads-data`, `model-cache`, `DB_HOST: mysql`, `REDIS_URL: redis://redis:6379`, and `condition: service_completed_successfully`; Dockerfile contains `FROM node:22-bookworm-slim AS build` and `npm ci --omit=dev`; package scripts include `compose:config`. Assert the environment example has `MYSQL_ROOT_PASSWORD`, `MYSQL_APP_USER`, `MYSQL_APP_PASSWORD`, `JWT_SECRET`, `PUBLIC_APP_URL`, `APP_BIND_ADDRESS`, and no real credential.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/deploymentArtifacts.test.js`

Expected: missing-file failure.

- [ ] **Step 3: Build the image and Compose definition**

Create a Debian Node 22 multi-stage Dockerfile: the build stage runs `npm ci` then `npm run build`; the runtime stage runs `npm ci --omit=dev`, copies `server`, `dist`, `scripts` and package manifests, and runs as non-root `node`. Add a `.dockerignore` excluding `node_modules`, `dist`, `.env*` except examples, uploads, reports, worktrees and backups. Add `.env.compose` to `.gitignore` so Docker credentials are never staged.

Create Compose with named persistent MySQL and Redis volumes plus shared `uploads-data` and `model-cache` volumes. MySQL/Redis health checks must gate one-shot `migrate`; API and Worker must wait for successful migration, mount the two shared volumes at `/data/uploads` and `/data/models`, and restart unless stopped. Do not expose database or Redis ports. API exposes `${APP_BIND_ADDRESS:-127.0.0.1}:${APP_PORT:-3000}:3000`; setting `APP_BIND_ADDRESS=0.0.0.0` enables LAN testing. Its healthcheck uses Node `fetch('/api/health')`.

Create `deploy/.env.compose.example` with safe placeholders, a development localhost QR URL, and comments requiring production `NODE_ENV=production`, real HTTPS `PUBLIC_APP_URL`, and a 32+ character JWT. Add these scripts:

```json
"compose:config": "docker compose --env-file deploy/.env.compose.example config",
"compose:up": "docker compose --env-file .env.compose up --build -d",
"compose:down": "docker compose --env-file .env.compose down"
```

- [ ] **Step 4: Verify Compose configuration and image build**

Run `node --test test/deploymentArtifacts.test.js`, then `npm run compose:config`, then `docker compose --env-file deploy/.env.compose.example build api worker` as three separate commands. Expected: all pass without starting services or migrating a real database.

- [ ] **Step 5: Commit Task 2**

```bash
git add Dockerfile .dockerignore .gitignore docker-compose.yml deploy/.env.compose.example package.json test/deploymentArtifacts.test.js
git commit -m "feat: add Docker deployment topology"
```

## Task 3: Safe backup and restore commands

**Files:**

- Create: `scripts/backup-mysql.js`, `scripts/restore-mysql.js`, `test/mysqlBackupScripts.test.js`
- Modify: `package.json`

**Interfaces:**

```js
export function parseBackupOutputPath(args, now = new Date())
export function requireRestoreConfirmation(args)
export function buildComposeExecArgs(command)
```

- [ ] **Step 1: Write failing backup/restore tests**

Test a generated backup output under `backups/`, rejection of an existing output, the exact Docker Compose exec prefix and restore refusal without explicit confirmation:

```js
assert.throws(() => requireRestoreConfirmation(['backup.sql']), /confirm-restore/)
assert.equal(requireRestoreConfirmation(['backup.sql', '--confirm-restore']), 'backup.sql')
assert.match(buildComposeExecArgs('mysqldump').join(' '), /docker compose --env-file .env.compose exec -T mysql/)
```

Mock spawn and filesystem streams, then assert tests create no SQL file and launch no Docker command.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/mysqlBackupScripts.test.js`

Expected: module-not-found failure.

- [ ] **Step 3: Implement stream-safe scripts**

`backup-mysql.js` must create `backups`, refuse to overwrite, and spawn `docker compose --env-file .env.compose exec -T mysql sh -lc` so `mysqldump --single-transaction --routines --events` expands credentials only inside the container. Pipe stdout to a newly created file; reject non-zero exit and zero-byte output, then print its absolute path.

`restore-mysql.js` must require an existing `.sql` file and `--confirm-restore`, display a Chinese warning, then stream the file into the container `mysql` client. It must not use destructive flags, stop services, remove volumes or infer confirmation from any other argument.

Add `"db:backup": "node scripts/backup-mysql.js"` and `"db:restore": "node scripts/restore-mysql.js"` to package scripts.

- [ ] **Step 4: Run focused and full tests**

Run `node --test test/mysqlBackupScripts.test.js test/deploymentArtifacts.test.js`, then `npm test`. Expected: all pass and the test suite never contacts Docker.

- [ ] **Step 5: Commit Task 3**

```bash
git add scripts/backup-mysql.js scripts/restore-mysql.js test/mysqlBackupScripts.test.js package.json
git commit -m "feat: add guarded MySQL backup scripts"
```

## Task 4: Document direct-computer, LAN and production operation

**Files:**

- Modify: `README.md`, `.env.example`, `test/supportChannelReadme.test.js`, `test/deploymentArtifacts.test.js`

**Interfaces:**

```text
同机访问: http://localhost:3000
局域网访问: http://<电脑局域网 IP>:3000 with APP_BIND_ADDRESS=0.0.0.0
公网发布: HTTPS reverse proxy + production PUBLIC_APP_URL
```

- [ ] **Step 1: Write failing documentation assertions**

Extend docs tests to require `docker compose --env-file .env.compose up --build -d`, `http://localhost:3000`, `APP_BIND_ADDRESS=0.0.0.0`, `npm run db:backup`, `--confirm-restore`, and an explicit statement that LAN HTTP is for testing while public QR requires HTTPS/domain.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/supportChannelReadme.test.js test/deploymentArtifacts.test.js`

Expected: a documentation assertion failure.

- [ ] **Step 3: Update operator documentation**

Add an ordered Docker section: copy `deploy/.env.compose.example` to `.env.compose`, replace all credentials, run `npm run compose:config`, then `npm run compose:up`; show log/status/down commands. Explain same-computer access, LAN IP/firewall rules, public reverse-proxy/domain/HTTPS requirements, backup-before-migration, backup and explicit-confirm restore. Preserve QR setup rules and say production QR printing waits for HTTPS.

Add `MODEL_CACHE_DIR=/data/models` to `.env.example` with a comment while preserving existing manual-development defaults.

- [ ] **Step 4: Run final non-destructive verification**

Run `npm test`, `npm run build`, `npm run compose:config`, `docker compose --env-file deploy/.env.compose.example build api worker`, and `npm run eval:rag` as separate commands. Expected: suite/build/config/image build pass; the evaluation can remain 0/30 pending and must not be represented as a quality score. Do not run Compose, migration, backup, restore or public deployment.

- [ ] **Step 5: Commit Task 4**

```bash
git add README.md .env.example test/supportChannelReadme.test.js test/deploymentArtifacts.test.js
git commit -m "docs: explain Docker deployment workflow"
```

## Final Manual Acceptance Checklist

- [ ] On a disposable machine, copy the Compose example to `.env.compose`, set unique non-placeholder secrets and run `npm run compose:up`.
- [ ] Check `http://localhost:3000/api/live` and `/api/health`; upload a disposable document and verify Worker completion after an API restart.
- [ ] On the same Wi-Fi, set `APP_BIND_ADDRESS=0.0.0.0`, allow port 3000 in the host firewall, and open the host IPv4 URL from another computer.
- [ ] Before real data changes, run `npm run db:backup`; trial restore only with a disposable database and `npm run db:restore -- backup.sql --confirm-restore`.
- [ ] Before public QR use, configure HTTPS reverse proxy and `NODE_ENV=production`, set a real `PUBLIC_APP_URL`, then perform administrator/ordinary-user QR acceptance and 30-question RAG measurement.
