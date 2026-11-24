# Agreement · 设计文档包（给接手者 / 评审 AI）

> 最后核对：2026-11-23。本项目**不需要任何版本控制工具**即可构建、测试与验收：
> 产物的来源由 `.next/BUILD_INFO.json` 的 `sourceHash` 证明（当前 `ff43f8820956e9f7`）。
> 本目录只保留 4 份当前有效的文档。

## 1. 阅读顺序

1. **README.md**（本文件）：现状快照、命令、已知缺口。
2. **ARCHITECTURE.md**：模块边界、数据模型、状态机、哈希与校验、安全边界。
3. **AGREEMENT.md**：签署语义、链接与证据、运维注意事项。
4. **PLUGIN-V2.md**：把签署能力装进别的 Next.js App 的方案与当前进度。

## 2. 当前技术栈（实测）

| 项 | 版本 / 事实 |
|---|---|
| Next.js | 16.4.6（App Router） |
| React / React DOM | 19.3.1 |
| Node | `engines >=24`，`.nvmrc` 26；本机实测 24.18.0 |
| 数据库 | MongoDB（运行时原生 driver）；Prisma 6.19.3 仅用于 schema 与导入工具 |
| 构建器 | Windows：`next build --webpack`；dev 也是 `next dev --webpack` |
| Linux | 同一份源码、Node 26 下，默认 Turbopack 的 build 与 dev 均通过（WSL2 Ubuntu 24.04 实测） |
| 管理登录 | 两个手势（HMAC v2）+ 可选 TOTP；`agreement_admin` HttpOnly cookie |

**为什么默认不用 Turbopack**：Windows 10/11 + Node 26 下，Turbopack build 以 `0xC0000005` 崩溃，
dev 编译 `/admin/login` 时进程退出，均无诊断输出；Linux 同版本正常。当前 `--webpack` 是平台规避，
不是根因修复。

## 2b. 界面与主题（当前设计）

- **宽度**：管理端与协议页 1080；详情弹窗 720；核验页 760；签署页桌面 760 文档 + 320 摘要栏（≥1080 两栏，窄屏单栏）。
- **管理端头部**：标题区 + `[刷新图标] │ [EN / 中文]`；刷新是 34px 无边框圆形 SVG（loading 时旋转），竖线随主题变色。
- **页脚**：`SiteFooter` 渲染 `© 起年–今年 名称 · 权利文案` + 主题图标；文案来自 Prisma `Meta.app_footer_*`，
  经 `/api/meta` 的公开投影读取（PUT 仍需管理员）。
- **夜间模式**：`/verify`、`/manager`、`/sign/*` 跟随 `theme`；`/print/*` 与 `/admin*` 固定浅色。
  暗色下 modal / chip / stamp / consent 有显式覆盖（见 `ARCHITECTURE.md` §10）。
- **弹窗**：统一 1080 / 720 / 680 三档，Esc 关闭、焦点循环、锁滚动、归还焦点。
- **打印**：独立浅色版式，页脚「编号 + 第 x / y 页」，附件清单与签名图不跨页。

### 界面截图（2026-11-23）

| 管理端头部（浅色） | 管理端头部（暗色） |
|---|---|
| ![light](screenshots/manager-header-light.png) | ![dark](screenshots/manager-header-dark.png) |

| 管理端列表（暗色） | 详情弹窗（暗色） |
|---|---|
| ![list](screenshots/manager-list-dark.png) | ![detail](screenshots/manager-detail-dark.png) |

| 核验结果（暗色） | 签署页（暗色） |
|---|---|
| ![verify](screenshots/verify-dark.png) | ![sign](screenshots/sign-dark.png) |

## 3. 运行与验证

```bash
npm ci
npm run dev            # next dev --webpack
npm run build          # next build --webpack + 写入 .next/BUILD_INFO.json
npm start              # prestart 检查生产索引
npm test               # 常规套件：55 文件 / 321 条
TEST_MONGO=1 npm test  # 含内存副本集用例
node scripts/e2e-manager.mjs           # 浏览器 E2E，local 存储
node scripts/e2e-manager.mjs --mongo   # 同一套流程，Mongo 存储
```

最近一次证据（源码哈希 `d9ae375408b1babb`）：

| 闸门 | 结果 |
|---|---|
| 常规测试 | 55 文件 / **321 通过 / 0 失败** |
| Mongo 测试 | 见 `docs/e2e/results-mongo.json`（需本机 mongod 二进制） |
| 构建 | `BUILD_EXIT=0`，`BUILD_ID=gJFzmpE5P1xtqb0oh_qUY`，`sourceHash` 与当前树一致（271 文件） |
| E2E（local） | **63/63**，`requests=97` |
| E2E（Mongo） | 同一套 63 项 |
| PDF 基线 | 两份合同各 2 页；文本哈希与仓库基线一致（`93e512…`、`4e2b25…`） |

E2E 现在会自动寻找 Chromium（`E2E_CHROME` → `CHROMIUM_BIN` → Playwright 缓存，覆盖 macOS/Linux/Windows），
并在启动时比对 `BUILD_INFO.sourceHash`；源码与构建不一致会直接显示 "build is stale"。

## 4. 数据源与生产保护

- `DATA_SOURCE=auto|local|mongo`。切换就是改这一个变量：`local` 用本地 JSON，`mongo` 用数据库。
- 生产环境默认要求 Mongo；`DATA_SOURCE=local` 会被 instrumentation 拒绝，除非显式 `ALLOW_LOCAL_IN_PRODUCTION=1`（仅演示/E2E）。
- 生产索引：`npm run db:indexes:prod`（默认 dry-run）；执行用 `--apply --confirm=<dbName>`，校验唯一索引后退出。
- 非生产（开发）里显式 `DATA_SOURCE=mongo` 直接生效；只有「设了 `MONGODB_URL` 但 `DATA_SOURCE` 空着/auto」这种隐式情况会被拒绝，提示改成 `mongo` 或 `local`。`ALLOW_REMOTE_DB=1` 作为兼容的逃生门保留。
- 本地 JSON 仅用于开发与 E2E；e2e 使用临时 `LOCAL_DATA_DIR`，并断言开发数据目录未被改动。

## 5. 完整性与校验（一句话版）

- 合同发出时冻结 `contentHash`。**hashV 4** 在 v3 基础上绑定附件元数据；完成时写 `completionHash`。
- `/api/verify/signature` 返回 `contentMatch`、`termEndMatch`、`completionMatch`、`legacy`、`requiresSeal`；任一为 false 时 `verified=false`。
- 缺封存：v3 且已完成（status/completedAt/全员已签）→ `completionMatch=false`；v1/v2 旧记录 → `null`，页面显示"未封存"。
- 摘要由 Ed25519 服务端私钥签名（`AGREEMENT_EVIDENCE_PRIVATE_KEY`）；改库内摘要或事件会验签失败。公开公钥随 `/verify` 与证据包导出。

## 6. 已知缺口（评审重点）

1. **Turbopack 仅 Windows 崩溃**；Linux 可用，但尚未在 Linux 上跑 e2e 后切换默认构建器。
2. **生产系统与 Node 版本未确认**；只测了 Windows 26、WSL Ubuntu 26 与 macOS 24。
3. **Prisma 引擎/db push 未验证**：npm 12 拦截 postinstall，新机器上 `prisma generate` 会因下载引擎失败；`build` 已不调用 Prisma。
4. **导入工具不得用于生产库**：逻辑与 DB 测试已补，但真实 Prisma 导入链路未跑通。
5. **微信内签署**：签署页已加"请用浏览器打开"提示；iOS/Android 真机仍未验证。
6. **签名画布与打印像素**：e2e 覆盖到签署页加载与链接校验，未驱动真实笔迹；PDF 基线只校验页数与文本。
7. **限流是进程内计数**：签署 20 次/分、核验 60 次/分，多实例部署需在网关再加一层。
8. **Vercel 限制**：函数内没有 Chromium，PDF 与证据包（含 PDF）不可用；签署/核验/事件链不受影响。
9. **TSA 是 best effort**：失败不阻塞签名，但证书会标注缺失。

## 7. 给评审 AI 的入口

- 数据模型与字段：`prisma/schema.prisma`；运行时仓储：`packages/agreement/src/core/storage.js`。
- 签署与校验：`packages/agreement/src/core/service.js`（`fingerprintInput`、`verifySignature`、`completionSeal`）。
- 路由与鉴权：`src/proxy.js`、`src/lib/requireAdmin.js`、`src/lib/publicRoutes.js`。
- 限流与体积：`src/lib/rateLimit.js`、`src/lib/httpBody.js`。
- 测试：`tests/*.test.mjs`；E2E：`scripts/e2e-manager.mjs`；产物在 `docs/e2e/`。
- 独立实测报告：`docs/Research-Report-2026-11-23.md`。
