# 扫码产品支持 V1 设计

## 目标

让管理员为每个产品型号生成一个二维码。普通测试用户扫码后，登录现有账号即可直接进入该型号的可信 RAG 问答页面，不需要手动选择型号，也看不到管理入口。

这是一版单平台、单管理员知识库的测试功能：管理员维护公共资料，普通用户使用资料。它不是多商家 SaaS，也不提供匿名访问、短信登录、支付或微信小程序。

## 用户与边界

| 身份 | 能做什么 | 不能做什么 |
| --- | --- | --- |
| 管理员（`ADMIN_USERNAMES`） | 上传和维护公共资料、管理 SOP/视频、创建/下载/停用/重置二维码、查看既有问题汇总 | 无 |
| 普通用户 | 扫码、登录/注册、提问、查看可信来源和视频、提交“已解决/未解决”反馈 | 管理二维码、查看或修改知识库、进入管理导航 |

普通用户使用现有账号体系和 HttpOnly Cookie。每人使用自己的测试账号；不使用共享账号，也不保存“匿名访客”身份。

## 用户流程

```text
管理员选择 T9 / X1 / 4.0 等型号
    -> 创建或启用二维码
    -> 下载 SVG/PNG 并放入淘宝商品页、包裹卡或客服回复

普通用户扫码 https://<PUBLIC_APP_URL>/support/<channelCode>
    -> 未登录：显示现有登录/注册页，登录后保留原地址
    -> 已登录：解析二维码配置，自动进入“智能问答”
    -> 每次检索固定携带 channel 的 productLine + productModel
    -> 可信回答、证据、视频和反馈沿用现有 RAG 链路
```

二维码不是身份凭证，只是“进入哪个产品帮助页”的定位符；登录仍由 JWT Cookie 完成。二维码被停用、已过期或不存在时，页面明确提示“该产品帮助入口不可用”，不调用问答接口。

## 架构

### 数据模型

新增 `support_channels` 表：

| 列 | 用途 |
| --- | --- |
| `id` | 自增主键 |
| `channel_code` | 唯一、URL 安全、随机生成的二维码编号（至少 128 bit 熵） |
| `product_line` / `product_model` | 扫码后强制使用的检索过滤条件 |
| `display_name` | 面向用户展示的名称，例如“讯飞翻译机 T9 使用帮助” |
| `is_active` | 管理员停用入口而不删除历史记录 |
| `created_by` | 创建入口的管理员用户 ID |
| `created_at` / `updated_at` | 审计与排序 |

建立唯一索引 `uq_support_channels_code`、查询索引 `idx_support_channels_creator_active`。删除管理员账户时不保留可访问入口；外键 `created_by` 使用 `ON DELETE CASCADE`。

`server/init.sql` 声明建表，`server/migrate.js` 增加现有数据库所需的兼容索引/字段保证。V1 不复制文档或 RAG 数据：现有 `buildKnowledgeScope` 已允许普通用户读取已就绪管理员资料，可信问答继续以登录用户身份记录 trace 与反馈。

### 后端接口

新增 `server/routes/supportChannels.js` 和 `server/services/supportChannelService.js`。

管理接口均为 `authMiddleware + requireAdmin`：

| 接口 | 行为 |
| --- | --- |
| `GET /api/support-channels` | 列出二维码及当前状态 |
| `POST /api/support-channels` | 创建一个型号入口；拒绝空型号、过长字段和重复有效型号 |
| `PUT /api/support-channels/:id` | 修改展示名称、型号或启用状态 |
| `POST /api/support-channels/:id/rotate` | 原编号立即失效，生成新编号 |
| `GET /api/support-channels/:id/qrcode.svg` | 生成并下载包含 `PUBLIC_APP_URL/support/<channelCode>` 的 SVG 二维码 |

普通用户接口只允许已登录用户读取最小配置：

| 接口 | 行为 |
| --- | --- |
| `GET /api/support-channels/resolve/:channelCode` | 返回已启用入口的 `displayName`、`productLine`、`productModel`；不返回管理员、内部 ID 或知识库内容 |

路由由 `server/index.js` 挂载。二维码 SVG 由后端使用 `qrcode` 依赖生成；不将二维码写入磁盘。`PUBLIC_APP_URL` 在生产环境必须是 HTTPS 的绝对 URL，不能是示例值或 localhost；开发环境允许 `http://localhost:<port>`。

### 前端

保持单页应用，利用既有 Express SPA fallback，因此 `/support/<channelCode>` 刷新后仍能加载前端。

- `src/supportChannelLocation.js`：纯函数，解析和校验当前 URL 中的 support code，供单元测试使用。
- `src/SupportChannelManager.jsx`：仅管理员可见的二维码管理卡片，包含创建、列表、下载、复制链接、停用、重置。
- `src/SupportExperience.jsx`：普通用户扫码后的窄版产品帮助头部，展示产品名称、当前型号、返回登录前路径错误和入口失效提示。
- `src/App.jsx`：仅负责识别 support 模式、登录后解析入口、把型号传入现有 RAG 请求，并在 support 模式隐藏开始页、统计与资料管理区域；问答阅读器、视频、可信度、来源和反馈不复制实现。

扫码页面必须把 `productLine` 与 `productModel` 传给现有 `/api/rag/ask`（及后续使用的流式端点），不允许用户在 support 模式修改为其他型号。这样会复用已有的“型号无资料即拒答”能力，避免跨型号回答。

## 安全与错误处理

- 所有二维码管理操作只允许管理员；普通用户访问返回 403。
- 普通用户必须先完成登录，任何二维码入口都不绕过 `authMiddleware`。
- `resolve` 只公开产品配置，不公开文档、来源全文、管理员信息或任意数据库 ID。
- support 模式下二维码无效、停用或网络失败时，不发送 RAG 请求，也不回退到通用资料。
- 管理员轮换二维码时，旧链接立即失效；停用不会删除历史 RAG trace。
- 请求继续使用同源 HttpOnly Cookie、既有 CORS/CSP 和 RAG 限流。二维码管理写操作增加单独限流，防止批量滥用。

## 非目标

- 不做匿名顾客访问、手机号验证码、微信 OAuth 或小程序。
- 不做多商家租户、品牌皮肤、收费套餐或订单系统。
- 不把普通用户的个人资料纳入扫码问答检索。
- 不在本子项目迁移对象存储、部署容器或引入错误监控；这些属于 Plan 5 的运行保障子项目，二维码仅新增 `PUBLIC_APP_URL` 配置约束。

## 验收与测试

1. 管理员可以为型号创建二维码，下载后二维码内容为以 `PUBLIC_APP_URL` 为前缀的 `/support/<channelCode>`。
2. 未登录用户扫码会进入登录页；登录成功后仍保留该 support URL，并自动进入问答。
3. 普通用户只能解析已启用的二维码，拿到固定产品型号；停用、轮换和未知二维码不能进入问答。
4. support 模式发送的 RAG 请求携带固定型号；现有型号隔离测试仍通过。
5. 管理接口对普通用户返回 403；普通用户页面不显示文档上传、统计或二维码管理入口。
6. 普通用户能在扫码页面看到现有可信回答、来源、视频和“已解决/未解决”反馈。
7. 单元测试覆盖编号生成、URL 解析、产品字段校验、失效入口和管理员授权；路由/前端接线测试覆盖上述关键路径。
8. `npm test` 与 `npm run build` 均通过。

## 上线前配置

```dotenv
# 生产示例；域名和 TLS 配置由后续部署子项目提供
PUBLIC_APP_URL=https://help.example.com
```

管理员先在 `.env` 中配置 `ADMIN_USERNAMES`、`ADMIN_REGISTRATION_KEY`、生产长度的 `JWT_SECRET`，完成数据库迁移，再创建二维码。测试用户以普通账号注册或登录。
