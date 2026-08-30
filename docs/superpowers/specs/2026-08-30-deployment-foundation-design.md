# 部署与运行保障：第一阶段设计

## 目标

让项目从本机手动启动的 API、前端、Redis 和 Worker，变成可在一台安装 Docker 的机器上以一条命令启动的完整服务。该阶段保留本地磁盘上传，并为后续公网域名、对象存储和错误监控留出明确边界。

## 已知现状

- Express API 已同时提供前端构建产物、`/api/live` 和依赖数据库的 `/api/health`。
- MySQL、Redis、文档 Worker 和 API 已能独立运行，但没有 Compose 编排；上传文件在本地 `UPLOAD_DIR`。
- Docker Desktop 与 Docker Compose 已安装，但未创建本项目容器或迁移真实数据库。
- 支持二维码 V1 已在 `codex/support-qr-v1` 分支完成，生产二维码依赖真实 HTTPS 的 `PUBLIC_APP_URL`。

## 范围与非目标

本阶段实现：

1. 一份 Docker 镜像，构建 Vite 前端并运行 Express API 或独立文档 Worker。
2. Compose 编排 MySQL、Redis、一次性迁移、API 和 Worker；API 对外提供完整 SPA 与 API。
3. 命名数据卷：MySQL、Redis、上传文件和本地模型缓存。API 与 Worker 共享上传卷。
4. 统一的生产配置预检、请求 ID 与不含敏感信息的 JSON 请求日志。
5. 可执行的 MySQL 备份脚本、显式确认才能运行的恢复脚本，以及 README 运行/备份/恢复说明。
6. 自动化配置、Compose 和部署文档测试；本地构建与现有完整测试继续通过。

本阶段不实现：

- 实际购买域名、配置 DNS、签发 HTTPS 证书、连接云服务器或发布到公网；这些需要用户提供服务器和域名权限。
- S3、OSS、COS 等对象存储；上传仍保存至 Compose 数据卷。
- 第三方错误监控账号、短信/微信登录、多商家隔离，或 30 题真实 RAG 测评。
- 自动执行真实数据库迁移、备份、恢复或删除 Docker 数据卷。

## 架构

```text
浏览器/二维码
      │ HTTPS（由部署机器上的反向代理在后续阶段提供）
      ▼
API 容器：Express + 已构建 SPA
      ├──────────────► MySQL 容器（mysql-data 卷）
      ├──────────────► Redis 容器（redis-data 卷）
      └────共享──────► uploads-data 卷 ◄────共享──── 文档 Worker 容器
                              │
                         model-cache 卷
```

### 启动顺序

1. MySQL 和 Redis 先通过各自健康检查。
2. `migrate` 一次性容器运行幂等 `node server/migrate.js`。
3. API 与 Worker 只在迁移成功后启动；API 健康检查请求 `/api/health`。
4. API 重启时不会删除任何数据；Worker 接到 `SIGTERM` 后停止领取新任务并安全退出。

### 镜像和配置

- 使用基于 Debian 的 Node 22 多阶段镜像，避免本地 ONNX/Transformer 依赖在 Alpine 上的二进制兼容风险。
- 构建阶段执行 `npm ci`、`npm run build`；运行阶段只保留生产依赖、`server`、`dist` 和必要根目录资源。
- Compose 使用同一镜像启动 `migrate`、`api` 和 `worker`，通过环境变量选择命令。
- Docker Compose 读取本机 `.env` 的密钥类配置，但强制容器内 `DB_HOST=mysql`、`REDIS_URL=redis://redis:6379`、`UPLOAD_DIR=/data/uploads`；避免把主机 `localhost` 错误传给容器。
- 新增 `deploy/.env.compose.example`，提供容器专用的数据库账号、根密码、JWT、管理员和二维码域名占位示例；真实值不提交。

### 配置预检与日志

- `validateRuntimeConfig(env)` 作为纯函数，校验运行环境、端口、MySQL 主机/用户名/库名、Redis URL、上传目录、JWT 示例值和生产环境 HTTPS `PUBLIC_APP_URL`。它不打印密钥。
- API 在启动监听前执行预检；Worker 在创建 BullMQ Worker 前执行相同预检。开发测试保留合理默认值；生产缺失/示例配置应快速失败并给出中文可行动错误。
- 每个 HTTP 请求生成或接收受格式约束的 `X-Request-ID`，响应回传该值。完成时输出一行 JSON：事件名、请求 ID、方法、路径、状态和耗时；不记录 Cookie、Authorization、请求正文、SQL 或完整异常。
- 顶层错误日志仅输出请求 ID 和稳定错误代码/名称，用户响应继续保持现有通用中文错误。

### 备份与恢复

- `scripts/backup-mysql.js` 通过 `docker compose exec -T mysql` 流式运行 `mysqldump --single-transaction --routines --events`，写入指定的 `.sql` 文件；脚本要求输出路径不存在且备份非空。
- `scripts/restore-mysql.js` 只接受已存在的 `.sql` 文件和 `--confirm-restore` 参数，才会将其流式输入容器的 `mysql` 客户端。它不主动停止服务或删除数据；README 明确要求先创建新备份再恢复。
- 二者只在用户明确执行时改变外部状态，自动化测试只验证参数、命令拼装与安全拒绝逻辑。

## 验收标准

1. `docker compose config` 可在从示例配置创建的本地 `.env` 下解析，且服务/数据卷/依赖顺序正确。
2. API 镜像在构建阶段产出前端，并以 `/api/live`、`/api/health` 作为 liveness/readiness 依据。
3. API 与 Worker 共用 `uploads-data`，迁移成功才启动，Redis 和 MySQL 都持久化。
4. 生产环境的缺失或示例密钥、HTTP/localhost 公网二维码地址、非法 Redis 地址在网络连接前被拒绝。
5. 备份不覆盖现有文件；恢复没有明确确认参数不会启动。
6. `npm test`、`npm run build` 和部署相关的静态/纯函数测试通过。

## 手工发布边界

代码完成后仍需要用户提供或亲自处理：服务器地址、域名 DNS、HTTPS 反向代理/证书、真实 `.env` 密钥、首次数据库迁移、管理员/普通用户扫码验收，以及 30 题真实 RAG 观察结果。只有这些完成后，才可以称为公网正式上线。
