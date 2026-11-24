# Agreement — 架构与集成说明（当前状态）

> 一个只做「签合同」的 Next.js App Router 应用。签署人没有账号，**链接即签名权**；正文与签名记录同文档；证据可重算，可选 RFC 3161 时间戳。
> 本文对应 2026-11-23 的代码：Next 16.4.6 / React 19.3.1 / Prisma 6.19.3（仅 schema 与导入）。

## 1. 定位与边界

**做**：创建合同 → 发出（冻结内容 + 每人一条链接）→ 签署人打开链接签名 → 保存证据 → 导出 PDF → 对外查询状态。

**不做**：项目/成员/角色/权限、access 发放、模板后台、邮件/短信发送、实名认证。签署系统只回答「谁、何时、从哪、对哪一版内容、签了什么」。

## 2. 模块布局

| 层 | 位置 | 职责 |
|---|---|---|
| 业务核心 | `packages/agreement/src/core` | 见下方"核心模块"表；`service.js` 只是 105 行的装配层 |
| 存储适配 | `core/adapters/mongo.js`、宿主 `src/agreement/storage/index.js` | Mongo 与本地 JSON；`mongodb` 懒加载 |
| Next 适配 | `packages/agreement/src/next` | P1 预览（`defineAgreement`/catch-all），本宿主**未使用** |
| React 组件 | `packages/agreement/src/react` | P1 预览导出；本宿主用自己的页面实现 |
| 宿主装配 | `src/agreement/instance.js` | env / Mongo / Chromium 只在这里出现 |
| 路由 | `src/app` | 薄路由：`/sign/[token]`（含 `/decline`）、`/print/[id]`、`/api/*`、`/manager`、`/verify` |
| 边缘 | `src/proxy.js` | Next 16 的 proxy 约定（原 middleware）：鉴权、CSRF、安全头 |
| 硬化 | `src/lib/rateLimit.js`、`src/lib/httpBody.js` | 公开端点限流、请求体字节上限 |
| 观测 | `src/lib/observability.js`、`/api/health*`、`/api/metrics` | 请求 ID、健康检查、进程内计数、JSON 日志 |

## 3. 数据模型（`prisma/schema.prisma`）

### Agreement

`id`、`number @unique`（`AGR-YYYY-NNNN`）、`createdById`、`title`/`body`/`consentText`（+ `*En`）、`status`（DRAFT/SENT/COMPLETED/VOIDED，EXPIRED 派生）、`contentHash`、`hashV`、`revision`、`signDeadline`/`expiresAt`、`termMonths`、`termEnd`、`termEndExplicit`、`effectiveAt`/`effectiveMode`、`sentAt`/`completedAt`/`completionHash`/`completionHashV`/`voidedAt`/`voidReason`、`renewalOf`/`renewedFrom`/`renewalStatus`/`renewalDeadline`。

### AgreementSigner（一位签署人一行）

`agreementId`、`email`/`label`/`order`、`accessTokenHash`（+ 加密的 `accessTokenEnc`）、`signedAt`（服务器时间）、`signedIp`、`uaHash`、`signatureImage`（base64 PNG）、`signatureHash`（64 hex）、`signatureSig`/`signatureKeyId`/`signatureSigAlg`（Ed25519）、`contentHash`、`declinedAt`/`declineReason`、`tsaToken`/`tsaTime`/`tsaUrl`。

### 其他

`SigningEvent`（审计：draft.created/sent/linksViewed/signed/completed/voided/declined，带 `hash + prevHash`）、`AgreementAttachment`（一文件一文档）、`PartyInfo`、`Counter`（按年原子发号）、`Meta`、`AdminGate`。

## 4. 状态机

```
DRAFT --send--> SENT --all signed--> COMPLETED
  |               |--void--> VOIDED
  |               |--decline--> DECLINED --void--> VOIDED
  |               |--deadline--> EXPIRED (derived)
  |--void--> VOIDED
```

- `DECLINED`：任一签署人拒绝即整份停止（其余链接仍可读、不可签），运营者随后作废/重发/续签。

- 只有 DRAFT 可改正文/签署人；send 后 `contentHash` 冻结，send 只允许一次。
- 草稿校验（标题/正文/同意文案长度、签署人数量与邮箱、模板变量、当事人邮箱）全部在**分配编号之前**完成；失败不再消耗 `AGR-YYYY-NNNN`。
- 签署只允许 SENT；同一签署人重复提交返回 `alreadySigned`；`DECLINED` 后签署请求返回 409。
- 最后一人签完，同一请求内 `transition(SENT→COMPLETED)`，写 `completedAt`、派生 `termEnd`、写 `completionHash`。

## 5. 哈希与校验

### 内容指纹

- v1（旧）：标题、正文、同意文案、截止时间、签署人列表。
- v2：新增期限规则与签署人顺序；到期日仅在被显式设置时进入哈希。
- **v3**：在 v2 基础上把 `v:3, sealRequired:true` 写入哈希；签署人按 `(order,email,id)` 排序。
- **v4（当前，2026-11-23）**：在 v3 基础上把附件纳入哈希：`attachments: [{name,size,sha256}]`（按名称排序）。
  附件字节单独存放在 `AgreementAttachment`，哈希只绑定元数据 + 文件摘要。v1–v3 记录继续按原版本验证。

### 完成封存

`completionSeal` 覆盖 agreementId、number、contentHash、completedAt、termEnd、全部签署人的 signedAt/signatureHash。完成时写 `completionHash`（以及 `completionHashV=1`）。

### `verifySignature` 语义

返回：

| 字段 | 含义 |
|---|---|
| `match` / `computed` / `stored` | 单个签署人的证据摘要是否与存档一致 |
| `contentMatch` | 重算合同指纹是否等于发出时冻结值 |
| `termEndMatch` | 按期限规则重算的到期日是否等于库内值 |
| `completionMatch` | 完成封存是否一致；v3 已完成但缺封存 → false；v1/v2 无封存 → null |
| `requiresSeal` | v3 且（COMPLETED / completedAt / 全员已签） |
| `legacy` | hashV=1，页面必须显示"旧版摘要，覆盖有限" |

`verified = match && contentMatch !== false && termEndMatch && completionMatch !== false
              && evidenceSignature.status !== "invalid" && completionSignature.status !== "invalid"`。

### 边界

- 摘要本身是 SHA-256，但由 Ed25519 服务端私钥签名；改库内摘要会导致验签失败。
  审计事件另有 `hash + prevHash` 链，删事件会显示断链。
- PDF 渲染使用库内已存哈希，不重算；重算只发生在 `/api/verify/signature`。
- TSA 为 best effort，缺失不影响签名本身。

## 6. 鉴权、CSRF 与安全头

- 管理入口：两个手势解锁；摘要以 **HMAC-SHA256（`v2:` 前缀）** 存于 `AdminGate`，密钥来自专用 `ADMIN_GATE_SECRET`（不从会话密钥借用，避免轮换会话时锁死入口）。旧的无密钥摘要会在一次成功解锁后自动升级；没有密钥时 v2 记录拒绝解锁。成功后签发 HttpOnly `agreement_admin`（token v2）。
  默认是**会话 cookie**（无 `Max-Age`，关浏览器失效，12 小时绝对上限）；勾选“记住这台设备”才写 7 天持久 cookie。
  旧 v1 cookie 一律视为无效。
- 登录后的跳转只接受站内路径（拒绝 `//host`），避免开放重定向。
- 会话密钥：`JWT_SECRET`；`ADMIN_SESSION_SECRET` 用于管理会话相关 HMAC。
- 每个非公开 API 必须调用 `requireAdmin`（路由内二次校验，不单独信任 proxy）。
- CSRF：拒绝 `Origin: null`；无 Origin 且 `Sec-Fetch-Site: cross-site` 拒绝；其余依赖 SameSite=Lax。
- 请求体上限按路由声明：合同草稿 256 KB、签名提交 640 KB、当事人 64 KB（`src/lib/httpBody.js`，按实际字节判断）。
- 公开端点限流（进程内固定窗口）：签署 20 次/分（IP+token）、核验 60 次/分（IP）；`RATE_LIMIT_DISABLED=1` 仅供测试。
- 邀请链接密文 v2：AES-256-GCM，AAD=`agreementId:signerId`（跨记录互换必失败），带 `kid` 支持轮换；
  v1 旧密文仍可读，并在 `getLinks` 时自动重封为 v2。
- 证据 Ed25519：`signatureHash` / `completionHash` 由服务端私钥签名（`signatureSig` / `completionSig`），
  公钥随 `/verify` 与 `evidence-key.json` 导出；旧公钥可用 `AGREEMENT_EVIDENCE_PUBLIC_KEYS` 继续验签。
- 审计事件链：`SigningEvent.hash = sha256(内容 + prevHash)`，追加经独立 per-agreement 队列（与签署锁分开，避免重入）；
  `verifyEventChain` 按链走而非按时间排序（同毫秒事件也能验）；证据包含 `manifest.events`。
- 夜间模式：`/verify`、`/manager`、`/sign/*` 跟随 `theme`；`/print/*` 与 `/admin*` 固定浅色（打印与入口锁不继承暗色）。
  暗色下 `.ag-modal-card` / `.aw-form-panel` / `.aw-chip.is-on` / `.ag-stamp` / `.ag-consent` 有显式覆盖。
- 上传接口已退役（写请求 405）；签名图只接受 PNG（≤300 KB，且要求真实墨迹）。
- `/sign/*` 与 `/print/*` 由 proxy 设置 `X-Frame-Options: DENY`、`frame-ancestors 'none'`、`Referrer-Policy: no-referrer`、`nosniff`；`/sign` 另加 `no-store` 与 `noindex`。
- 其余页面/API 统一带 `X-Content-Type-Options: nosniff` 与 `Referrer-Policy: strict-origin-when-cross-origin`。
- `/manager` 页面响应带 `Cache-Control: no-store`，退出后回退按钮不会显示旧内容。
- `/api/meta` 的 GET 是公开的**投影**（标题/页脚/菜单/SEO）；PUT 仍需管理员会话。独立页（`/verify`、`/manager`）的页脚
  与主题图标由 `SiteFooter` 渲染，页脚文案来自 Prisma `Meta` 的 `app_footer_*` 字段；`siteMetaServer` 走 `getDb()`，本地模式也生效。

## 7. 数据源

- `DATA_SOURCE=auto|local|mongo`；生产必须 Mongo（除非演示用 `ALLOW_LOCAL_IN_PRODUCTION=1`）。
- 运行时用原生 Mongo driver；仓储接口在 `core/storage.js`，`mongodb` 只在适配器内动态导入。
- `Counter` 用 `$max` 原子推进；回滚窗口后运行 `scripts/realign-counter.mjs`。

## 8. 构建与部署

- Windows：`next build --webpack` / `next dev --webpack`。Linux Node 26 默认 Turbopack 实测可用。
- 构建脚本写 `.next/BUILD_INFO.json`（`sourceHash` / `files` / `builtAt` / `node` / `next`）；e2e 重算源码哈希并记录 `sourceHash`、`buildSourceHash`、`buildFresh`。不依赖版本控制。
- 生产索引：`npm run db:indexes:prod`（dry-run）；`--apply --confirm=<db>` 执行并校验唯一索引。
- 生产启动：`prestart` 检查 `number_unique` 等索引；缺失则拒绝启动。`instrumentation` 还会拒绝：缺少 `AGREEMENT_LINK_KEY`（非演示）、`AGREEMENT_PUBLIC=1` 但基址非 https 公网、生产启用 `RATE_LIMIT_DISABLED`。
- 生产安装流程（已实测）：`npm ci` → `npm run build` → `npm prune --omit=dev` → `next start`。`prisma generate` 不属于默认构建。
- **Vercel**：环境变量与 `.vercelignore` 见 `docs/部署与回滚.md` §2b；函数内无 Chromium，PDF/证据包不可用。

## 9. 测试

- 常规 55 文件 / 321 用例（全部通过）；Mongo 55 文件 / 336 条（335 通过、1 skip）。
- 源码清理后构建 271 文件（原 638），`src/` 177 文件（原 571）。
- E2E 用 headless Chrome over CDP（自动寻找 Chromium）：手势解锁（+TOTP）、UI 建当事人/草稿/发送、链接、签署页、打印 RSC、鉴权/CSRF/体积、续签、到期页、微信 UA 提示、构建新鲜度、**拒签流程、证据包 ZIP**；local 与 `--mongo` 均 63/63。
- PDF 基线：2 页/份，文本哈希与基线一致。

## 10. 界面设计（当前）

- **容器**：1080（管理端/协议）、760（核验）、720（详情弹窗）、680（新建主体弹窗）；签署页 760 文档 + 320 摘要栏。
- **管理端头部**：标题 + `[刷新图标] │ [EN / 中文]`；刷新图标无边框、loading 旋转，竖线 1×18px、`currentColor` 18%。
- **页脚**：`SiteFooter`，版权 + 主题图标；文案来自 `Meta.app_footer_*`（公开投影），`/verify` 用 760 窄版。
- **主题**：`/verify`、`/manager`、`/sign/*` 跟随 `theme`；`/print/*` 与 `/admin*` 固定浅色。
  暗色覆盖集中在 `.ag-modal-card`、`.aw-form-panel`、`.aw-chip`、`.ag-stamp`、`.ag-consent`。
- **模态**：`useModalA11y`（Esc / Tab 循环 / 锁滚动 / 归还焦点），移动端吸附底部操作栏。
- **打印**：独立浅色页，标题居中、条款 11pt/1.85、附件清单不跨页、页脚「编号 + 第 x / y 页」。

截图：`design/screenshots/`（manager-header-light/dark、manager-list-dark、manager-detail-dark、verify-dark、sign-dark）。
