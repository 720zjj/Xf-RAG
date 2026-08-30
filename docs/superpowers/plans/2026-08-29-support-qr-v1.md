# 扫码产品支持 V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 管理员可为固定产品型号生成二维码；普通登录用户扫码后自动进入固定型号的可信 RAG 问答，且不显示管理功能。

**Architecture:** 在现有单管理员公共知识库模型上增加 `support_channels`，二维码仅保存随机入口编号和固定产品过滤条件。扫码 URL 由 SPA 解析；登录后读取受保护的最小配置，并复用现有认证、知识范围、可信 RAG、视频和反馈链路，不增加匿名 API 或第二套问答实现。

**Tech Stack:** React 18、Vite 6、Express 5、MySQL 8、Node.js 22、`qrcode@^1.5.4`、Node built-in test runner。

**Spec:** `docs/superpowers/specs/2026-08-29-support-qr-v1-design.md`

## Global Constraints

- 普通用户始终通过现有 HttpOnly JWT Cookie 登录；二维码不是身份凭证。
- 管理员身份继续由 `ADMIN_USERNAMES` 配置决定，所有管理 API 必须执行 `authMiddleware` 后再执行 `requireAdmin`。
- support 模式固定 `productLine` 和 `productModel`，不得让页面提交其他型号。
- 已停用、未知或格式非法的二维码不能调用 RAG，且不得回退至通用资料。
- V1 不实现匿名访问、多租户、对象存储、支付、小程序或短信/微信登录。
- 新代码使用 ESM、无分号风格、中文面向用户错误文案；不输出密钥、Cookie 或完整内部异常。
- 每个行为先写 Node 测试并观察失败，再写最小实现；每个任务完成后运行指定测试并提交。

---

## File Structure

| 文件 | 职责 |
| --- | --- |
| `server/services/supportChannelService.js` | 校验入口数据、生成随机 code、数据库 CRUD、二维码 URL 构造和普通用户解析 |
| `server/routes/supportChannels.js` | 管理员 CRUD/轮换/SVG 下载与登录用户 resolve HTTP 边界 |
| `server/middleware/auth.js` | 导出可复用的 `requireAdmin` 中间件 |
| `server/init.sql`、`server/migrate.js` | 持久化二维码入口及旧数据库索引兼容 |
| `src/supportChannelLocation.js` | 从 `/support/:code` 解析二维码入口的纯函数 |
| `src/SupportChannelManager.jsx` | 管理员创建、下载、复制、停用和轮换二维码的界面 |
| `src/SupportExperience.jsx` | 扫码用户产品横幅、加载/无效入口提示 |
| `src/App.jsx` | 登录后解析二维码、强制 RAG 型号过滤、切换为问答专用页面 |
| `.env.example`、`README.md` | `PUBLIC_APP_URL`、二维码测试与生产配置说明 |

## Task 1: Support channel domain service and admin guard

**Files:**
- Create: `server/services/supportChannelService.js`
- Create: `test/supportChannelService.test.js`
- Modify: `server/middleware/auth.js`
- Modify: `test/auth.test.js`
- Test: `test/auth.test.js`

**Interfaces:**

```js
export const CHANNEL_CODE_PATTERN = /^[A-Za-z0-9_-]{20,80}$/
export function parsePublicAppUrl(raw, { production = false } = {})
export function normalizeSupportChannelInput(input)
export function generateChannelCode(randomBytesFn)
export function createSupportChannelService({ query, publicAppUrl, codeFactory })
// returns { list, create, update, rotate, resolve, buildSupportUrl }

export function requireAdmin(req, res, next)
```

- [ ] **Step 1: Write failing domain and guard tests**

Create tests that import the missing service and assert the exact validation boundary:

```js
test('二维码入口编号使用 URL 安全的至少 128 bit 随机值', () => {
  const code = generateChannelCode(size => Buffer.alloc(size, 7))
  assert.match(code, CHANNEL_CODE_PATTERN)
  assert.ok(code.length >= 22)
})

test('二维码配置必须包含展示名称、产品线和产品型号', () => {
  assert.throws(() => normalizeSupportChannelInput({ displayName: 'T9', productLine: '', productModel: '' }), /产品线/)
})

test('普通用户会被 requireAdmin 拒绝', () => {
  const response = createResponseRecorder()
  requireAdmin({ user: { role: 'user' } }, response, () => assert.fail('不应继续'))
  assert.equal(response.statusCode, 403)
})
```

- [ ] **Step 2: Run the focused tests and observe the expected failure**

Run: `node --test test/supportChannelService.test.js test/auth.test.js`

Expected: import error for `supportChannelService.js` and missing export `requireAdmin`.

- [ ] **Step 3: Implement the minimal service and guard**

Use `crypto.randomBytes(18).toString('base64url')`; normalize trimmed strings with strict bounds (`displayName <= 100`, `productLine <= 50`, `productModel <= 100`). Reject `PUBLIC_APP_URL` unless it is an absolute HTTP(S) URL; in production reject `localhost` and non-HTTPS URLs. Add this guard to `auth.js`:

```js
export function requireAdmin(req, res, next) {
  if (!isAdmin(req)) return res.status(403).json({ ok: false, error: '仅管理员可执行此操作' })
  next()
}
```

The service accepts injected `query(sql, params)` and uses parameterized SQL. `resolve(code)` only selects `display_name`, `product_line`, `product_model`, and `channel_code` where `is_active = 1`; unknown/inactive codes return `null`.

- [ ] **Step 4: Run focused tests and verify they pass**

Run: `node --test test/supportChannelService.test.js test/auth.test.js`

Expected: all new domain and authorization cases pass.

- [ ] **Step 5: Commit Task 1**

```bash
git add server/services/supportChannelService.js server/middleware/auth.js test/supportChannelService.test.js test/auth.test.js
git commit -m "feat: add support channel domain service"
```

## Task 2: Persist support channels and migrate existing databases

**Files:**
- Modify: `server/init.sql`
- Modify: `server/migrate.js`
- Modify: `test/migration.test.js`
- Test: `test/migration.test.js`

**Interfaces:**

```sql
CREATE TABLE IF NOT EXISTS support_channels (
  id INT PRIMARY KEY AUTO_INCREMENT,
  channel_code VARCHAR(80) NOT NULL,
  display_name VARCHAR(100) NOT NULL,
  product_line VARCHAR(50) NOT NULL,
  product_model VARCHAR(100) NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_by INT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE INDEX uq_support_channels_code (channel_code),
  INDEX idx_support_channels_creator_active (created_by, is_active, updated_at),
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

- [ ] **Step 1: Add failing schema assertions**

Extend `test/migration.test.js` to require `support_channels`, its unique code index, its creator/active index and its cascading foreign key in `init.sql`; also require `runMigrations` to call `ensureIndex` for both named indexes.

- [ ] **Step 2: Run the schema test and observe failure**

Run: `node --test test/migration.test.js`

Expected: failure because the table and index names are absent.

- [ ] **Step 3: Add schema and migration compatibility**

Append the exact table after `users`-dependent tables in `server/init.sql`. In `runMigrations`, call:

```js
await ensureIndex(conn, dbName, 'support_channels', 'uq_support_channels_code', '`channel_code`', true)
await ensureIndex(conn, dbName, 'support_channels', 'idx_support_channels_creator_active', '`created_by`, `is_active`, `updated_at`')
```

For installations that received an early table variant, use `ensureColumn` for `display_name`, `product_line`, `product_model`, and `is_active` before the index calls. Do not run migration against the developer database in this task.

- [ ] **Step 4: Run schema tests and verify pass**

Run: `node --test test/migration.test.js`

Expected: all existing migration assertions and new support-channel assertions pass.

- [ ] **Step 5: Commit Task 2**

```bash
git add server/init.sql server/migrate.js test/migration.test.js
git commit -m "feat: persist support QR channels"
```

## Task 3: Expose authenticated support-channel APIs and SVG QR download

**Files:**
- Create: `server/routes/supportChannels.js`
- Create: `test/supportChannelRoutes.test.js`
- Modify: `server/index.js`
- Modify: `package.json`
- Modify: `package-lock.json`
- Test: `test/supportChannelRoutes.test.js`

**Interfaces:**

```text
GET    /api/support-channels                         admin list
POST   /api/support-channels                         admin create
PUT    /api/support-channels/:id                     admin edit active/name/model
POST   /api/support-channels/:id/rotate              admin rotate code
GET    /api/support-channels/:id/qrcode.svg          admin SVG attachment
GET    /api/support-channels/resolve/:channelCode    logged-in user resolve
```

- [ ] **Step 1: Add failing route wiring tests**

Create `test/supportChannelRoutes.test.js` that reads route/index source and asserts every admin path is preceded by `authMiddleware, requireAdmin`, resolve uses `authMiddleware` only, and `server/index.js` mounts `/api/support-channels`. Assert the QR response sets `image/svg+xml`, `Content-Disposition: attachment`, and calls `QRCode.toString` with `{ type: 'svg' }`.

- [ ] **Step 2: Run route tests and observe failure**

Run: `node --test test/supportChannelRoutes.test.js`

Expected: failure because the route module and mount do not exist.

- [ ] **Step 3: Install and implement the route**

Run `npm install qrcode@^1.5.4`. Create the router with a service factory bound to `pool.query.bind(pool)` and `process.env.PUBLIC_APP_URL`. Reject invalid numeric IDs with 400. Return 404 for non-existent admin records and unresolved codes; return 409 for a duplicate active model. For QR download, construct only through `service.buildSupportUrl(channel.channel_code)`, then send:

```js
res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8')
res.setHeader('Content-Disposition', `attachment; filename="support-${channel.product_model}.svg"`)
res.send(await QRCode.toString(url, { type: 'svg', errorCorrectionLevel: 'M', margin: 2, width: 360 }))
```

Mount the route before the SPA fallback in `server/index.js`. Use `createRateLimit({ windowMs: 60_000, max: 30 })` for mutation routes and `max: 120` for resolve.

- [ ] **Step 4: Run route and domain tests**

Run: `node --test test/supportChannelService.test.js test/supportChannelRoutes.test.js test/auth.test.js`

Expected: all tests pass and the route source contains no unauthenticated management endpoint.

- [ ] **Step 5: Commit Task 3**

```bash
git add package.json package-lock.json server/routes/supportChannels.js server/index.js test/supportChannelRoutes.test.js
git commit -m "feat: add support QR management APIs"
```

## Task 4: Parse support URLs and render reusable support UI

**Files:**
- Create: `src/supportChannelLocation.js`
- Create: `src/SupportExperience.jsx`
- Create: `src/SupportChannelManager.jsx`
- Create: `test/supportChannelLocation.test.js`
- Modify: `src/index.css`
- Test: `test/supportChannelLocation.test.js`

**Interfaces:**

```js
export function getSupportChannelCode(locationLike)
// '/support/Abcdefghijklmnopqrstuv' -> 'Abcdefghijklmnopqrstuv'
// all other paths or invalid code -> null

export function SupportExperience({ channel, loading, error })
export function SupportChannelManager({ apiFetch, publicAppUrl })
```

- [ ] **Step 1: Write failing URL parser tests**

Test valid URL-safe codes, trailing slash, query string preservation, an invalid short code, an encoded slash, and paths that merely contain the word `support`:

```js
assert.equal(getSupportChannelCode({ pathname: '/support/Abcdefghijklmnopqrstuv', search: '' }), 'Abcdefghijklmnopqrstuv')
assert.equal(getSupportChannelCode({ pathname: '/support/short', search: '' }), null)
assert.equal(getSupportChannelCode({ pathname: '/documents/support/Abcdefghijklmnopqrstuv', search: '' }), null)
```

- [ ] **Step 2: Run URL parser test and observe failure**

Run: `node --test test/supportChannelLocation.test.js`

Expected: module-not-found failure.

- [ ] **Step 3: Implement parser and focused visual components**

Implement parser with `CHANNEL_CODE_PATTERN` duplicated only as a local browser-safe literal (do not import server code into Vite). `SupportExperience` renders exactly one of loading, unavailable error, or a compact brand/product header. `SupportChannelManager` lets an admin submit `displayName`, `productLine`, and `productModel`; it renders a list and buttons calling the APIs from Task 3 for download, copy, enable/disable and rotate. Use `navigator.clipboard.writeText` only after a button click and display the returned URL for browsers where clipboard access fails.

Add scoped CSS classes beginning `support-` and preserve existing desktop/mobile layout.

- [ ] **Step 4: Run URL tests and production build**

Run: `node --test test/supportChannelLocation.test.js && npm run build`

Expected: parser tests pass and Vite compiles the new components.

- [ ] **Step 5: Commit Task 4**

```bash
git add src/supportChannelLocation.js src/SupportExperience.jsx src/SupportChannelManager.jsx src/index.css test/supportChannelLocation.test.js
git commit -m "feat: add support QR user interface"
```

## Task 5: Integrate support mode with login, fixed-model RAG, and administrator controls

**Files:**
- Modify: `src/App.jsx`
- Create: `test/supportChannelWiring.test.js`
- Modify: `test/ragExperienceWiring.test.js`
- Test: `test/supportChannelWiring.test.js`, `test/ragExperienceWiring.test.js`

**Interfaces:**

```js
const supportChannelCode = getSupportChannelCode(window.location)
const supportMode = Boolean(supportChannelCode)
// resolved channel: { displayName, productLine, productModel, channelCode }
```

- [ ] **Step 1: Write failing integration wiring tests**

Create tests that assert `App.jsx` imports all three support modules, resolves `/support/:code` only after a user exists, sends `supportChannel.productLine` and `supportChannel.productModel` in the existing RAG request, and changes `tabs` to `[rag]` in support mode. Assert that the manager is guarded by `user?.role === 'admin'` and invalid support channels render `SupportExperience` without RAG controls.

- [ ] **Step 2: Run wiring tests and observe failure**

Run: `node --test test/supportChannelWiring.test.js test/ragExperienceWiring.test.js`

Expected: support integration assertions fail while all pre-existing RAG assertions continue to pass.

- [ ] **Step 3: Implement orchestration without duplicating RAG**

In `App.jsx`, parse the support code before auth lookup. After `user` exists, call `GET /api/support-channels/resolve/${encodeURIComponent(code)}` and keep one `supportChannel` state plus a loading/error state. Do not redirect away from the current URL during login, so an authenticated response naturally retains the scanned location.

Use a single derived filter in every question request:

```js
const effectiveProductLine = supportChannel?.productLine || productLine
const effectiveProductModel = supportChannel?.productModel || productModel
```

When `supportMode` is true, render `SupportExperience`, set the active tab to `rag` after successful resolve, replace the normal tab list with only intelligent Q&A, hide document/start/statistics content and prevent manual product selector changes. Render `SupportChannelManager` only for an admin outside support mode. Existing `TrustedAnswerReader`, evidence source jump, video recommendation and feedback paths remain unchanged.

- [ ] **Step 4: Run focused UI tests and build**

Run: `node --test test/supportChannelLocation.test.js test/supportChannelWiring.test.js test/ragExperienceWiring.test.js && npm run build`

Expected: all focused tests pass and the production bundle succeeds.

- [ ] **Step 5: Commit Task 5**

```bash
git add src/App.jsx test/supportChannelWiring.test.js test/ragExperienceWiring.test.js
git commit -m "feat: open fixed-model support via QR"
```

## Task 6: Document configuration and complete release verification

**Files:**
- Modify: `.env.example`
- Modify: `README.md`
- Create: `test/supportChannelReadme.test.js`
- Test: `test/supportChannelReadme.test.js`

**Interfaces:**

```dotenv
# 开发：http://localhost:3000；生产必须填写 HTTPS 域名
PUBLIC_APP_URL=http://localhost:3000
```

- [ ] **Step 1: Write failing documentation assertions**

Create a test that requires `.env.example` to include `PUBLIC_APP_URL`, README to explain administrator setup, ordinary test-user login, QR creation/download, the `/support/<code>` test URL, and the fact that QR is not an authentication credential.

- [ ] **Step 2: Run documentation test and observe failure**

Run: `node --test test/supportChannelReadme.test.js`

Expected: failure because the QR configuration guidance is absent.

- [ ] **Step 3: Document the exact local and production procedure**

Add `PUBLIC_APP_URL=http://localhost:3000` to `.env.example`. Add README steps: configure `ADMIN_USERNAMES`, register administrator with `ADMIN_REGISTRATION_KEY`, run `npm run db:migrate`, log in as administrator, create a model QR, log in as a separate ordinary test user, scan/open it, and verify a fixed-model answer. State that production must use an HTTPS domain before printing real QR codes.

- [ ] **Step 4: Run full verification**

Run:

```bash
npm test
npm run build
npm run eval:rag
```

Expected: all automated tests pass, Vite build succeeds, and evaluation report is generated without changing the real-test count.

- [ ] **Step 5: Commit Task 6**

```bash
git add .env.example README.md test/supportChannelReadme.test.js
git commit -m "docs: explain support QR setup"
```

## Manual Acceptance Checklist

- [ ] Run `npm run db:migrate` against a disposable/local database and confirm `support_channels` exists.
- [ ] Admin creates a T9 entry, downloads its SVG, and opens the decoded URL in a private browser window.
- [ ] Private window registers/logs in as a normal user and remains on `/support/<code>` after login.
- [ ] The page opens the T9 support experience, hides normal navigation and sends an actual RAG request with `productModel: 'T9'`.
- [ ] Disabling or rotating the code produces the unavailable state and no RAG request.
- [ ] Normal user receives 403 from an attempted QR management endpoint; admin can list, edit, download, disable and rotate.
- [ ] Existing trusted answer source links, video recommendation and feedback still work in the support page.
