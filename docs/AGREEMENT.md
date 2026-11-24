# Agreement · 签署语义与运维

一个只做「签合同」的应用。**签署人没有账号，链接即签名权**；不发送邮件、不接验证码服务，链接由运营者手动发给对方。

## 1. 跑起来

```bash
npm ci
npm run dev                 # http://localhost:3000（Windows 用 --webpack，脚本已处理）
npm run build && npm start  # 生产；prestart 会检查索引
```

数据库二选一：

- Mongo：`MONGODB_URL` + `MONGODB_DB`，`DATA_SOURCE=mongo`（开发里显式写 mongo 即可，不再需要额外开关）。
- 本地 JSON：`DATA_SOURCE=local` + `LOCAL_DATA_DIR`，仅开发/E2E；生产需 `ALLOW_LOCAL_IN_PRODUCTION=1`，会打印显著警告。

## 2. 环境变量

| 变量 | 作用 |
|---|---|
| `MONGODB_URL` / `MONGODB_DB` | 数据库。只指向本地或专用库 |
| `JWT_SECRET` | 签署 cookie / 打印链接 / 图案会话的签名密钥 |
| `ADMIN_SESSION_SECRET` | 管理会话专用；轮换会注销所有管理员窗口 |
| `PATTERN_UNLOCK_PASSWORD` | 遗留单图案锁，仅供旧页面/`/api/auth/pattern`；管理入口实际用 `AdminGate` 里的两个手势（HMAC v2） |
| `AGREEMENT_BASE_URL` | 生成签署链接的地址；留 localhost 时忽略它，按请求 Host 派生（Vercel 可直接用） |
| `AGREEMENT_INTEGRATION_SECRET` | 宿主后端查询状态的 Bearer 密钥 |
| `AGREEMENT_PUBLIC` | `1` 时启动自检强制 `AGREEMENT_BASE_URL` 为 https 公网地址 |
| `AGREEMENT_LINK_KEY` | 邀请链接加密密钥（≥32 字符；缺失会退回 JWT_SECRET）。v2 密文用 AAD 绑定 `agreementId:signerId` |
| `AGREEMENT_LINK_KEYS_PREVIOUS` | 轮换窗口内的旧链接密钥（逗号分隔，每项 ≥32；只读，不再签发） |
| `AGREEMENT_EVIDENCE_PRIVATE_KEY` | Ed25519 私钥（32 字节 seed / PKCS#8 / PEM），用于证据摘要签名 |
| `AGREEMENT_EVIDENCE_PUBLIC_KEYS` | 轮换后仅用于验签的旧公钥：`kid:x,kid:x` |
| `AGREEMENT_REQUIRE_EVIDENCE_SIG` | `1` = 生产必须有可解析的证据私钥，否则拒绝启动 |
| `CHROMIUM_BIN` | PDF 用的 Chromium/headless shell 路径 |
| `DATA_SOURCE` | `auto` / `local` / `mongo` |
| `ALLOW_LOCAL_IN_PRODUCTION` | 仅演示/E2E；生产本地存储必须显式打开 |
| `ALLOW_REMOTE_DB` | 兼容用：非生产下 `DATA_SOURCE` 留空/auto 时允许远程 Mongo（新写法直接用 `DATA_SOURCE=mongo`） |
| `RATE_LIMIT_DISABLED` | `1` 关闭公开端点限流（仅测试用；生产启动会拒绝） |
| `ADMIN_GATE_SECRET` | 手势摘要的 HMAC 密钥（≥16，**专用**；不设置则保持无密钥摘要，并提示） |
| `ADMIN_TOTP_KEY` | TOTP 密钥的加密密钥（≥16；缺省回退 `ADMIN_GATE_SECRET`/`ADMIN_SESSION_SECRET`） |
| `ADMIN_SESSION_HOURS` | 单次管理会话的绝对上限（默认 12 小时） |
| `ADMIN_REMEMBER_DAYS` | 勾选“记住这台设备”时的天数（默认 7） |

## 3. 发出与签署

1. 运营者创建草稿（标题、正文、同意文案、签署人）。草稿支持两类签署人来源：
   由甲方/乙方两位当事人的邮箱自动派生，或在 `signers` 里显式指定（可加第三方；
   显式列表优先）。
2. `send`：冻结 `contentHash`，为每位签署人生成独立链接（**明文只返回一次**；
   `links` 接口可随时取回同一条链接；只有 `rotateLink` 会让旧链接失效，且已签署的人拒绝轮换）。
3. 签署人打开 `/sign/<token>`：直接看到全文，自己的签名框在合同末尾，画完点「签署并保存」。
   不同意时可以点「拒绝签署」并填理由（≤500 字）：合同变为 `DECLINED`，其余人不能继续签。
4. 页面每 6 秒轮询（切回标签页也刷新），一方签完后另一方可见第一个人的签名；任一方拒绝后所有人看到「已被拒绝」与理由。
5. 最后一人签完，同一请求内把合同置为 `COMPLETED`。

### 证据包（争议时一次性交付）

`GET /api/manager/agreements/<id>/evidence`（管理员）返回一个 ZIP：

- `README.txt`：这份包是什么、如何手工校验；
- `manifest.json`：合同、每位签署人的证据记录、逐人校验结果、每个文件的 SHA-256；
- `agreement.pdf`：与「下载 PDF」同一份字节；
- `signatures/<signerId>.png`：签名图原样；
- `attachments/<id>-<name>`：附件原件；
- `evidence-key.json`：Ed25519 公钥（alg/kid/x/fingerprint）；
- `tsa/<signerId>.tsr`：RFC 3161 时间戳（可用 `openssl ts -reply -in … -text` 复验）；
- `manifest.events`：审计事件链校验结果。

| 字段 | 说明 |
|---|---|
| `signedAt` | 服务器时间，不是浏览器时间 |
| `signedIp` | 请求来源 IP（`x-forwarded-for` 首段） |
| `uaHash` | 浏览器 UA 的 SHA-256 |
| `signatureHash` | 证据摘要，完整 64 hex |
| `contentHash` | 发出时冻结；签署时提交的值必须一致 |
| `signatureImage` | 裁白后的 PNG（base64，无前缀） |
| `tsaToken` / `tsaTime` / `tsaUrl` | RFC 3161 时间戳（best effort） |

### 附件（2026-11-23）
- 支持 PDF / PNG / JPG / WEBP / TXT / DOCX / XLSX；最多 5 个、单个 ≤5 MB、总计 ≤15 MB；
- 签名图下限 60×24 像素、墨迹 ≥0.1%（2026-11-23 从 100×50 下调：真实触控板签名 609×68 曾被拒）；
- 每个附件单独一条 `AgreementAttachment` 文档（base64 载荷），合同上只存 `{id,name,mime,size,sha256}`；
- 只有 `DRAFT` 可增删；`send` 后冻结，附件元数据进入 hashV 4 的内容指纹；
- 签署页、打印/PDF、证据包都会列出附件；证据包内附原件与各自 SHA-256。

## 4. 证据与校验

每次签署的证据（v1）：

```json
{
  "v": 1,
  "agreement": { "id", "number", "title", "contentSha256" },
  "signer": { "id", "label", "email" },
  "signedAt": "2026-11-10T12:07:06.574Z",
  "ip": "127.0.0.1",
  "userAgentSha256": "…",
  "signatureImageSha256": "…"
}
```

`signatureHash = SHA-256(canonicalJSON(evidence))`；证书编号 `CERT-<前16位>` 只用于人工念读。
签署时同一摘要会由服务端 Ed25519 私钥签名，落库为 `signatureSig` / `signatureKeyId`；完成时对 `completionHash` 同样签名。

`/verify` 与 `/api/verify/signature` 会：

- 重算证据摘要（`match`）；
- 重算合同指纹（`contentMatch`）；
- 重算到期日（`termEndMatch`）；
- 重算完成封存（`completionMatch`）；
- 返回 `legacy` 与 `requiresSeal`。

### 哈希版本与封存

- **hashV 3**：哈希输入含 `v:3, sealRequired:true`；签署人按 `(order,email,id)` 排序。
- **hashV 4（当前）**：再叠加附件元数据 `[{name,size,sha256}]`（按名称排序）。附件只能在**草稿**阶段增删；
  发出后冻结，改动会改变 `contentHash`。
- 完成时写 `completionHash`，覆盖 `completedAt`、最终 `termEnd` 与全部签署人的签名摘要。
- v3 记录只要出现完成信号（COMPLETED / completedAt / 全员已签），缺封存即 `completionMatch=false`、`verified=false`。
- v1/v2 旧记录没有封存时返回 `null`，页面显示「未封存」，不会伪装成 true。
- v1 只覆盖标题、正文、同意文案、截止时间与签署人，不覆盖期限字段；页面必须显示「旧版摘要，覆盖有限」。

**边界（当前）**：摘要仍是 SHA-256，但已由 Ed25519 服务端私钥签名；改库内摘要会导致验签失败。
审计事件另有 `hash + prevHash` 链，删除中间事件会显示断链。PDF 渲染读取库内哈希，不重算；重算只发生在 verify API。
公钥随 `/verify` 与证据包导出，旧公钥可用 `AGREEMENT_EVIDENCE_PUBLIC_KEYS` 继续验签。

## 5. 访问边界

| 范围 | 谁能进 |
|---|---|
| `/` | 302 到 `/manager` |
| `/manager` | 管理员（两个手势 + 可选 TOTP，`agreement_admin` cookie） |
| `/verify`、`/api/verify*` | 公开 |
| `/api/agreements/*`、`/api/manager/*`、`/api/auth/*` | 管理员（每个路由内 `requireAdmin` 二次校验） |
| `/sign/<token>`、`/sign/<token>/print` | 持有链接的人（链接即签名权） |
| `/print/<id>?k=<hmac>` | 打印服务（短时 key） |
| `/api/sign/*` | 公开（仅凭链接） |
| `/api/integration/*` | Bearer `AGREEMENT_INTEGRATION_SECRET` |

通用生成器 CRUD 的写接口已退役；业务写入只走 `/api/agreements/*` 与 `/api/sign/*`。

## 6. 安全实现

- `src/proxy.js`（Next 16 的 proxy 约定，原 middleware）负责鉴权跳转、CSRF 与 `/sign`、`/print` 的安全头。
- CSRF：拒绝 `Origin: null`；无 Origin 且 `Sec-Fetch-Site: cross-site` 拒绝；其余依赖 SameSite=Lax。
- 请求体上限按路由声明（合同 256 KB、签名 640 KB、当事人 64 KB）；流式读取，缺少或伪造 `Content-Length` 也会在真实字节超限时中断；上传接口已退役。
- 管理手势摘要为 **HMAC（v2）**，密钥来自服务端；旧的无密钥摘要会在一次成功解锁后自动升级。没有密钥时 v2 记录**拒绝解锁**（fail closed）。
- 打印 key 带 10 分钟过期（`<exp>.<hmac>`），泄漏后不能长期重放。
- 公开端点限流：签署 20 次/分（IP+token）、核验 60 次/分（IP）；管理手势 5 次/15 分钟。
- 生产启动时 instrumentation 检查必需密钥；缺失拒绝启动。

## 6b. 界面与主题

- `/verify`、`/manager`、`/sign/*` 跟随 `theme`；`/print/*` 与 `/admin*` 固定浅色。
- 页脚 `SiteFooter`：`© 起年–今年 名称 · 权利文案` + 主题图标；文案来自 Prisma `Meta.app_footer_*`。
- 管理端头部：`[刷新图标] │ [EN / 中文]`，刷新键无边框、loading 旋转。
- 签署页桌面 760 + 320 摘要栏；窄屏单栏 + 吸底操作条。
- 打印版式独立：标题居中、条款 11pt、页脚「编号 + 第 x / y 页」。

## 7. 运维

- 管理手势存于 `AdminGate`（两个 HMAC 摘要，`_id="gate"`）；忘记时运行 `node scripts/reset-admin-gate.mjs` 清空后重新设置。
- TOTP 启用/轮换：`npm run init:totp -- [--mongo] [--force]`；密钥只在命令行显示一次。
- 默认每次重新打开网站都要手势（会话 cookie + 12 小时上限）；勾选“记住这台设备”才会保留 7 天。
- 退出登录会清除 cookie，且 `/manager` 响应带 `no-store`，回退按钮看不到旧内容。
- 旧单图案 `PATTERN_UNLOCK_PASSWORD` 只影响遗留接口/部分生成器页面；`/login` 已重定向到 `/admin/login`。
- 让所有管理会话立刻失效：轮换 `ADMIN_SESSION_SECRET`。
- 回滚窗口后：先跑 `node scripts/realign-counter.mjs`（dry-run）再 `--apply`，把每年 `Counter.seq` 用 `$max` 对齐到实际最大编号。
- PDF 基线：设置 `CHROMIUM_BIN` 后 `npm run pdf:baseline`；脚本会启动临时生产服务器读取临时副本，输出到 `tests/baseline/`。
- 数据导入：见 `docs/导入MongoDB.md`；导入工具在真实 Prisma 链路验证前不得用于生产库。
