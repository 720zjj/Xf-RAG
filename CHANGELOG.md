# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 规范，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### 新增
- ESLint 代码规范：新增 `eslint.config.js` 与 `npm run lint`，覆盖后端、脚本、测试与前端 JSX
- Docker 部署 CI 验证：GitHub Actions 增加 `deploy` job，构建镜像、启动 Compose 并探活 `/api/live` 与 `/api/health`

### 修复
- 移除从未挂载的模拟翻译路由 `server/routes/translate.js`（`translations` 表不存在于迁移），并修正 README 中"翻译工具"的不实宣传
- 扫码锁定型号后，通用的“第一次使用”等问法可直接命中当前型号资料，无需顾客重复说明型号
- 补全联网、无法开机、充电、发热、翻译准确性与翻译记录等常见问题的直接证据判定，保留跨型号隔离
- 新增 4.0 与双屏 2.0 共用的非侵入式基础售后排查，覆盖无法开机、无法充电、异常发热和设备无声
- 产品检索改为分层边界：常见非侵入式故障在本型号无直接资料时可谨慎复用另一首发型号的直接文档答案，菜单、组合键、能力、参数和视频仍严格隔离
- 支持语种、无网络翻译等高频口语问法优先直接回答；存在当前型号官方资料时隔离旧通用数字，避免 2.0 与 4.0 的语种数量和离线包规则混用
- 微信内置浏览器允许播放已核验的官方视频回退地址，并补充移动端内联播放属性

### 测试
- 新增 `memoryAgent` 会话存储与指代消解回退测试
- 新增 `ragEngine` 纯逻辑测试（BM25、TF-IDF、查询扩展/重写、HyDE、重排、回答生成）
- 新增 `embedding.cosine` 测试

## [v1.0.0] - 2026-08-30

首个公开发布版本，基于已验收的 Docker 部署与扫码产品支持功能。

### 新增
- 智能硬件产品知识库 RAG 问答：文档上传、后台解析任务、混合检索、可信回答与来源追溯
- 多工具 Agent（知识库检索、主题摘要、文档管理、SOP 查询、视频检索）
- SOP 与操作视频推荐、视频章节与解决状态记录
- 产品资料隔离与型号级过滤，拒绝跨型号回退与无依据编造
- 扫码产品支持二维码入口（`/support/<channelCode>`），支持管理、停用与轮换
- Docker Compose 一键部署：API、文档 Worker、MySQL、Redis，命名卷持久化
- MySQL 备份与恢复脚本（含部署升级前强制备份演练流程）
- MCP stdio Server，向外部 Agent 客户端暴露知识库能力
- GitHub Actions CI：MySQL 迁移、测试与生产构建

### 工程化
- 文档后台任务串行化测试，避免并发内存耗尽导致的假失败
- 运行时部署配置校验、请求查询串脱敏、Docker 就绪依赖诚实化
