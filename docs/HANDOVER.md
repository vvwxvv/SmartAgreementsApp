# HANDOVER（当前状态）

> 最后核对：2026-11-23。本项目**不依赖任何版本控制工具**：构建与 e2e 用源码哈希
> （`.next/BUILD_INFO.json` 的 `sourceHash`）证明产物来源，可直接从文件夹复制运行。
> 架构细节见 `design/ARCHITECTURE.md`；未完成事项见 `docs/未来方案.md`；
> 实测报告见 `docs/Research-Report-2026-11-23.md`。

## 1. 状态快照

| 项 | 事实 |
|---|---|
| Next / React | 16.4.6 / 19.3.1 |
| Node | `engines >=24`，`.nvmrc` 26；本机实测 24.18.0 |
| 构建 | Windows `--webpack`；Linux Node 26 默认 Turbopack 已验证 |
| 测试 | 55 文件 / **321 条，全部通过**（不含 Mongo 用例） |
| E2E | local **63/63**；`--mongo` 见 `docs/e2e/results-mongo.json`（需本地 Mongo 二进制） |
| 最近构建 | `BUILD_ID=gJFzmpE5P1xtqb0oh_qUY`，`sourceHash=d9ae375408b1babb`，`files=271`（清理后） |
| 数据库 | MongoDB 运行时原生 driver；Prisma 6.19.3 仅 schema 与导入 |

## 2. 应用做什么

创建合同 → 发出（冻结内容 + 每人一条链接）→ 签署人打开链接手写签名 → 保存证据 → PDF → 对外查询状态。
签署人没有账号，链接即签名权；不发邮件。

不做：项目/成员/权限、access 发放、模板后台、实名认证。

## 3. 常用命令

```bash
npm ci
npm run dev                 # next dev --webpack
npm run build               # next build --webpack + .next/BUILD_INFO.json
npm start                   # prestart 检查索引
npm test                    # 常规（321 条，无需 Mongo）
TEST_MONGO=1 npm test       # 含内存副本集
npm run db:indexes:prod     # 生产索引（默认 dry-run）
node scripts/e2e-manager.mjs           # local（自动寻找 Chromium）
node scripts/e2e-manager.mjs --mongo   # Mongo
npm run pdf:baseline        # 需要 CHROMIUM_BIN 或 Playwright 缓存
```

构建与 e2e 的对应关系：`npm run build` 写入 `{sourceHash, files, builtAt, node, next}`；
e2e 启动时重算当前源码哈希并比对 `buildSourceHash`，不一致会明确提示 "build is stale"，
并把 `buildFresh=false` 记进 `docs/e2e/results.json`。

## 4. 环境变量

`MONGODB_URL`、`MONGODB_DB`、`JWT_SECRET`、`ADMIN_SESSION_SECRET`、`AGREEMENT_BASE_URL`、
`AGREEMENT_INTEGRATION_SECRET`、`AGREEMENT_LINK_KEY`、`CHROMIUM_BIN`、`DATA_SOURCE`。
`ADMIN_SESSION_HOURS`（默认 12）控制单次会话上限；`ADMIN_REMEMBER_DAYS`（默认 7）控制“记住这台设备”；
`ADMIN_GATE_SECRET` 给手势摘要加盐（专用，不从会话密钥借用）；`ADMIN_TOTP_KEY` 给 TOTP 密钥加密；`AGREEMENT_PUBLIC=1` 时启动强制 https 公网基址。`PATTERN_UNLOCK_PASSWORD` 仅被遗留的 `/api/auth/pattern` 与部分生成器页面使用；
**管理入口实际用的是 `AdminGate` 里的两个手势**（见 §6）。
演示/E2E 才允许 `ALLOW_LOCAL_IN_PRODUCTION=1`；生产不得设置。
`RATE_LIMIT_DISABLED=1` 只用于测试，关闭公开端点限流。

## 5. 安全不变量

- 每个非公开 API 必须在路由内调用 `requireAdmin`；不能只依赖 `src/proxy.js`。
- CSRF：拒绝 `Origin: null`；无 Origin 且 `Sec-Fetch-Site: cross-site` 拒绝。
- 请求体：合同草稿 256 KB、签名提交 640 KB、当事人 64 KB（各自路由内按实际字节判断）。
- 上传接口已退役；签名图仅接受 PNG，≤300 KB，且要求真实墨迹。
- `/sign/*` 与 `/print/*` 必须有 `X-Frame-Options: DENY`、`frame-ancestors 'none'`、`no-referrer`、`nosniff`。
- 公开端点限流：签署 20 次/分（IP+token）、核验 60 次/分（IP）；手势解锁另有全局 100 次/15 分钟上限。
- 管理手势摘要为 HMAC（v2，密钥仅 `ADMIN_GATE_SECRET`），旧摘要成功解锁后自动升级；无密钥时 v2 记录拒绝解锁。
- 打印 key 10 分钟过期（`<exp>.<hmac(print:<id>:<exp>)>`），不能长期复用。
- 请求体流式读取，实际字节超限即中断（不依赖 `Content-Length`）。
- 管理手势 5 次/15 分钟/IP；管理图案只存在于服务端（DB hash 或 env），不得进客户端包。

## 6. 管理入口（实况）

| 步骤 | 机制 |
|---|---|
| `/admin/login` | 画两个**不同的**手势（各 4–9 点）；服务端比对 `AdminGate` 里的 HMAC 摘要（旧 sha256 会升级） |
| 第二因素（可选） | 启用 TOTP 后，手势正确还需 6 位动态码；同一时间步不可复用 |
| 成功 | 签发 HttpOnly `agreement_admin`（HMAC v2）；默认是**会话 cookie**，关浏览器即失效 |
| `/manager` | 只需上面的 cookie；页面本身不再弹第二道图案锁；响应带 `Cache-Control: no-store` |
| 退出 | `POST /api/admin/logout` 清 cookie + 回登录页；回退按钮不会看到旧页面 |
| 遗留在别处的 `ManagerAuthGate` | 仍在 `LayoutMainContent` 中，部分生成器页面会额外要求 `PATTERN_UNLOCK_PASSWORD`；`/manager` 不使用它 |

`/login`（单图案旧入口）已改为 302 到 `/admin/login`，因为它的接口现在要求管理员 cookie，
直接访问必然 401。

## 6a. TOTP 第二因素（2026-11-23）

- 启用：`npm run init:totp [-- --mongo]`，按输出把密钥加到验证器 App；密钥只显示一次。
- 存储：AES-256-GCM 加密（密钥 `ADMIN_TOTP_KEY` → `ADMIN_GATE_SECRET` → `ADMIN_SESSION_SECRET`）。
- 校验：RFC 6238，SHA-1 / 6 位 / 30 秒，允许 ±1 步；`totpLastStep` 防同码重放。
- 恢复：丢失验证器 → `npm run init:totp -- --force`（旧码立即失效）；轮换加密密钥后同样需要重新绑定。
- 未启用时行为不变（仅两手势），`/api/admin/gate` 会返回 `totp:false`。

## 6b. 会话策略（2026-11-23）

- 默认：**每次重新打开网站都要手势**——cookie 不带 `Max-Age`，浏览器退出即丢弃；token 另设 12 小时绝对上限。
- 可选：登录页勾选“记住这台设备 7 天”，才会写 `Max-Age=604800` 的持久 cookie。
- 旧版（v1）7 天 cookie 在升级后被判定无效，所有管理员需要重新画一次手势。
- 轮换 `ADMIN_SESSION_SECRET` 仍是最快的“全员下线”手段。

## 6c. 可观测性（2026-11-23）

| 端点 | 权限 | 用途 |
|---|---|---|
| `GET /api/health` | 公开 | 存活探针（不查库），返回 uptime 与 `x-request-id` |
| `GET /api/health/deep` | 管理员 | 就绪探针：数据源可读、合同数 |
| `GET /api/metrics` | 管理员 | 进程内计数：`sign_ok/fail`、`pdf_ok/fail`、`tsa_ok/fail`、`gate_ok/fail`、`verify_ok/fail`、`rate_limited` |

- 每个响应都有 `x-request-id`；5xx 日志是单行 JSON（含 rid），不含 token/签名图。
- 指标是**进程内**计数，重启归零；多实例需在日志/网关侧聚合。
- 日志通过 stdout 输出：`{"ts","level","event","rid",...}`。

## 7. 完整性与校验

- 发出时冻结 `contentHash`；hashV 3 把 `sealRequired` 绑进哈希；**hashV 4 再绑定附件元数据**；完成写 `completionHash`。
- `/api/verify/signature` 返回 `contentMatch`、`termEndMatch`、`completionMatch`、`legacy`、`requiresSeal`；任一 false → `verified=false`。
- v3 已完成但缺封存 → `completionMatch=false`；v1/v2 无封存 → `null`（页面显示"未封存"）。
- 证据摘要由 Ed25519 服务端私钥签名（`signatureSig` / `completionSig`）；公钥随 `/verify` 与证据包导出。
- 审计事件为 `hash + prevHash` 链，删/改事件可在 `/verify` 的“事件链”行看到。
- 兼容性锚点不再依赖版本控制：`tests/fixtures/pinned-legacy-source.mjs` 保存 v1 两个函数的原文，
  `tests/compat-hash.test.mjs` 校验其摘要。

## 8. 数据源

- `DATA_SOURCE=auto|local|mongo`；生产必须 Mongo。
- 非生产远程 Mongo 需 `ALLOW_REMOTE_DB=1`。
- 本地 JSON 仅开发/E2E；E2E 用临时目录并断言开发数据未变。
- `Counter` 用 `$max`/`$inc` 原子发号；**校验失败不再消耗编号**（校验已前移到创建草稿时）。

## 9. 导入/导出

`npm run export:local`、`npm run import:mongo`（默认 dry-run）、`--apply`、`--allow-merge`。
逻辑与 DB 测试已补；**真实 Prisma 链路未验证**（引擎下载被阻断），导入工具不得用于生产库。
详见 `docs/导入MongoDB.md`。

## 10. 部署

见 `docs/部署与回滚.md`。生产索引：`npm run db:indexes:prod`（dry-run）；`--apply --confirm=<db>` 执行并校验。
首次部署仍需在目标库执行一次并保存输出。

## 11. 已知缺口

1. 生产 OS/Node 版本未确认；只测了 Windows 26、WSL Ubuntu 26 与本机 macOS 24。
2. 微信内提示已加；iOS/Android 真机仍未验证。
3. 无集中日志/告警/定时备份。
4. 导入未生产就绪；`db push` 输出未归档。
5. 签名画布真实笔迹未自动化；PDF 基线只校验页数与文本。
6. 证据已启用 Ed25519 签名与事件链（需配置 `AGREEMENT_EVIDENCE_PRIVATE_KEY`）。
7. 限流是**进程内**计数：多实例部署仍需在网关再加一层。
8. 重置管理手势不会注销已签发的 `agreement_admin`（会话内仍有效）；需要立刻失效请轮换 `ADMIN_SESSION_SECRET`。

## 12. 待决策

- 生产存储后端与主机（Atlas / 自建副本集 / 云主机）。
- 备份与异地副本方式（不再使用版本控制导出）。
- 回滚策略：只向前修复 + 迁移前快照（推荐），还是准备并测试回滚构建。
- 管理手势与各类密钥的正式值、轮换责任人。

## 13. 文档地图

| 文档 | 内容 |
|---|---|
| `design/README.md` | 评审入口与现状快照 |
| `design/ARCHITECTURE.md` | 架构、数据模型、校验、安全 |
| `design/AGREEMENT.md` | 签署语义与运维 |
| `design/PLUGIN-V2.md` | 打包/CLI 方案 |
| `docs/未来方案.md` | 未完成事项与优先级 |
| `docs/部署与回滚.md` | 部署、索引、备份、回滚 |
| `docs/上线检查表.md` | 上线/冒烟/真机/回滚的可勾选清单 |
| `docs/导入MongoDB.md` | 本地数据导入 |
| `docs/Agreement-设计评估.md` | 当前评估与风险排序 |
| `docs/Research-Report-2026-11-23.md` | 独立技术研究 + 实测记录 |
| `docs/UX-Walkthrough-2026-11-23.md` | 真实用户走查（下载范本→UI 录入→签署→核验）+ 截图清单 |

## 14. 变更纪律

- 不拼接不同树状态的测试数字；构建、e2e、产物必须在同一份源码上。
- `docs/e2e/results.json` 记录 `sourceHash`、`buildSourceHash`、`buildFresh`、`buildId`。
- e2e 分 local 与 `--mongo`，任一模式都必须全绿（当前 local 63/63）。
- 修改 `fingerprintInput` / `completionSeal` 必须同时更新 `tests/compat-hash.test.mjs` 的锚定与 `verify-content`。
