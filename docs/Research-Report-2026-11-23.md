# Agreement（SmartAgreementsApp）技术研究报告

> 初版：2026-11-23 12:20（GMT+8）｜修订：2026-11-23 13:10（含本轮修复复测）
> 研究范围：`~/Desktop/SmartAgreementsApp` 全部 `docs/` + `design/` 文档，以及 `src/`、`packages/agreement`、`prisma/`、`scripts/`、`tests/` 的实际代码。
> 方法：先读文档建立模型 → 逐层读代码核对 → 在**隔离的本地数据目录**里真实跑通全流程（不连任何 Mongo 集群）→ 复算哈希 / 篡改测试 / 生成 PDF。
> 结论强度：下文中标 **【实测】** 的是本机跑出来的结果，标 **【代码】** 的是从实现读出的结论，标 **【文档】** 的是文档自述但本次未独立验证的部分。

---

## 0. 一页摘要（TL;DR）

**这是什么**：一个只做"电子签署"的 Next.js 16 应用。它把一份合同变成一条**一次性 bearer 链接**交给签署人，签署人手写签名后，系统把"谁、何时、从哪个 IP、对哪一版内容、签了什么图"压成一个可复算的 SHA-256 证据记录，可选加 RFC 3161 第三方时间戳，最后打印成 A4 PDF，并在 `/verify` 页对外提供核验。

**它解决什么**：中小规模 B2B/B2C 场景下"把纸合同搬到网页上签，并且事后能证明没被改"的问题。典型场景就是仓库自带的样本：一份《网站制作与维护服务协议》，甲方公司 + 乙方个人，两人手写签名。

**它刻意不做什么**（这是设计里最清醒的部分）：
- 没有签署人账号 —— 链接即签名权；
- 不发邮件/短信 —— 运营者自己复制链接发微信；
- 不做实名认证、人脸、证件、银行卡；
- 不提供 QES（合格电子签名）—— 只有"可验证的签署证据"；
- 不做项目/成员/权限，也不给宿主系统发 access。

**一句话定位**：它回答"谁、何时、从哪、对哪一版内容、签了什么"，不回答"他能不能进你的后台"。

**本次实测结论**：
| 项 | 结果 |
|---|---|
| 依赖安装 | `npm ci` 成功（644 包，1.1 GB；npmmirror 2 分钟） |
| 单元/回归测试 | 初测 **190 条 / 1 失败（缺版本库）**；修复后 **287 条，全部通过** |
| 生产构建 | `npm run build` **EXIT=0**，`BUILD_ID=4S61pQDdGrn7bRPVB2VvE`，`sourceHash=84c5e11ed59fc6d3` |
| 端到端（我实跑） | 解锁 → 建甲方/乙方 → 建草稿发出 → 两人签名 → COMPLETED → 2 页 PDF → `/verify` 返回 `verified=true` |
| 官方 e2e | local **63/63**、`--mongo` **63/63**（含构建新鲜度断言） |
| 篡改检测 | 改库里的金额 38,000→8,000 → `contentMatch=false`、`verified=false`（**证据链有效**） |
| 认证实况 | **两个手势**即可进 `/manager`（此前误判为三道锁，已更正见 §9.1） |

**最需要知道的风险**：证据是无密钥 SHA-256 —— 能发现"改了正文没改哈希"，但拦不住"同时改正文和哈希"的数据库管理员。文档自己写明了这一点，也把 Ed25519 服务端签名列为下一阶段。

---

## 1. 业务理解：这个应用在做什么生意

### 1.1 场景还原

把仓库里的样本协议读一遍就能看出目标客户：

- 甲方：一家小公司（星海科技），有法人代表、地址、座机/手机；
- 乙方：一个自然人（王欣，`isSelf=true`，即"我方"）；
- 合同：18.8 KB Markdown，55 条编号条款，2 张表，12 个月服务期，3.8 万 + 6 千维护费。

这种合同的特点是：**金额不足以请律师走 DocuSign，又比"微信发 Word 让对方回个'收到'"正规得多**。所以产品的价值点不是"法律效力"，而是：

1. 对方不用注册、不用装 App，点链接就能签（微信里发过去最自然）；
2. 签完立刻有一份带签名图、时间、IP、指纹的 PDF，可以存档/发给对方；
3. 事后任何人拿合同编号 + 16 位记录编号，可以在 `/verify` 页自己核一遍，不用信运营者。

### 1.2 「做 / 不做」边界（README §1）

| 做 | 不做（故意） |
|---|---|
| 建草稿、冻结、给每人一条 bearer 链接 | 签署人账号 / 项目 / 角色 / 权限 |
| 在合同页内手写签名 | 邮件/短信投递（运营者复制链接） |
| 存签名图 + IP + UA 摘要 + 内容哈希 | 实名认证 / 人脸 / 证件 / 银行卡 |
| 重算并校验证据链 | 合格电子签名（QES，需 QTSP/CA） |
| A4 PDF（合同 + 签名页 + 证明） | 复杂合同生命周期（只有作废/过期/续签） |
| 服务器间状态查询（integration API） | 宿主应用的权限发放 |

「不做实名」是个关键取舍：因为没有身份核验，签名在法律上更接近"可靠电子签名"的证据材料，而不是法定的"可靠电子签名"。文档 §7 明确写了"不提供 QES"。**这一点在对外话术里必须说清楚，否则客户会误以为是 DocuSign 同类。**

### 1.3 角色与权限

| 角色 | 是谁 | 能做什么 | 认证方式 |
|---|---|---|---|
| 运营者 / 管理员 | 发起合同的人（"operator"） | 建当事人、建草稿、发出、复制链接、延期、改期限、续签、作废、下载 PDF | 图案/手势解锁 + HttpOnly cookie |
| 签署人 | 收到链接的人 | 阅读正文、手写签名、下载自己的副本 | 只有链接（无账号） |
| 打印服务 | 同机 headless Chromium | 渲染 `/print/<id>?k=<hmac>` | 短时 HMAC key |
| 宿主后端 | 别的系统 | 查合同状态 | `Bearer AGREEMENT_INTEGRATION_SECRET` |
| 公众 | 任何人 | 用合同编号查状态；用编号 + 记录编号重算证据 | 无 |

---

## 2. 页面与路由地图

| 路由 | 权限 | 作用 | 关键实现 |
|---|---|---|---|
| `/` | 公开 | 入口 | `src/app/page.jsx` |
| `/admin/login` | 公开 | 管理入口（两个手势） | `AdminGatePageComponent` → `/api/admin/gate/unlock` |
| `/manager` | 管理员 | 面板：合同列表 / 详情 / 当事人通讯录 | `src/app/manager/page.jsx`（634 行，含 `ManagerAuthGate` 二次图案锁） |
| `/sign/[token]` | 持链接者 | 签署页：正文 + 签名板 + 同意条款 | `AgreementSignPageComponent` |
| `/sign/[token]/print` | 持链接者 | 签署人自己的打印版 | `PrintDocument` |
| `/print/[id]?k=` | print key | 运营者/Chromium 的打印源 | 校验 `checkPrintKey` |
| `/verify` | 公开 | 输编号查状态；输记录编号重算证据 | `src/app/verify/page.jsx` |
| `/login` | - | 遗留单图案入口 | 已改为 302 → `/admin/login` |

API 分组：

- 管理端：`/api/agreements/*`（建/发/链接/PDF/作废）、`/api/manager/*`（延期/改期限/续签/当事人）
- 签署端：`/api/sign/[token]`（读）、`/submit`（写）、`/pdf`
- 公开核验：`/api/verify`、`/api/verify/signature`
- 服务间：`/api/integration/agreements/[id]/status`
- 遗留通用 CRUD：`/api/agreement`、`/api/agreement-signer`…（读保留，**写一律 405**，见 `src/proxy.js`）

---

## 3. 端到端业务流程（我实跑的路径）

### 3.1 运营者侧

1. **解锁**：`/admin/login` 画两个不同的手势（至少 4 点、不能相同），命中后服务端签发 `agreement_admin` cookie（默认会话级，关闭浏览器失效；勾选“记住这台设备”才是 7 天）。
2. **建当事人**（通讯录，P2-2a）：`POST /api/manager/party-info`，字段只有 `kind/name/nameEn/contactPerson/legalRepresentative/email/phone/wechat/address/addressEn/postalCode/note/isSelf`。**刻意不存证件/银行账号**。
3. **建草稿**：`POST /api/manager/agreements`，传 `partyA`/`partyB`（当事人 id）+ 标题 + 正文（含 `{{partyA.name}}` 这类变量）+ 期限。服务端会：
   - 编译模板、检查是否还有没填的变量；
   - 从两位当事人的邮箱自动派生签署人（也可显式传 `signers`）；
   - **先发号**（`AGR-YYYY-NNNN`），再落库草稿；
   - 若 `send:true`，紧接着发出。
4. **发出**：`POST /api/agreements/[id]/send`（或建草稿时带 `send`）：
   - 重算并**冻结** `contentHash`；
   - 给每个签署人生成 32 字节 token，存 `sha256(token)`（查表用）+ `AES-256-GCM` 密文（供以后重新复制链接）；
   - 状态 `DRAFT → SENT`、写 `sentAt`、`revision=1`、写审计事件；
   - **明文链接只返回这一次**（但可以随时通过密文再取回，见 §6.3）。
5. **复制链接发微信**：`GET /api/agreements/[id]/links` 可随时取回同一批链接（不轮换）；`POST .../signers/[sid]/link` 可只轮换某一个人（旧链接立刻失效）。
6. **跟踪/运维**：列表显示 `N/M 已签`；可延期（≤30 天且 ≤首次发送 + 30 天）、改期限（仅未签时，且会刷新冻结哈希）、作废（DRAFT/SENT）、续签（生成 `（续签）` 草稿并互链）。

### 3.2 签署人侧

1. 打开 `/sign/<token>`：服务端按 `sha256(token)` 找 signer → 找到 agreement → 返回正文、自己的签名块、**所有签署人**的已签情况。
2. 页面每 6 秒轮询 + 切回标签页刷新 → 一方签完，另一方立刻看到对方的签名图。
3. 在画布上手写 → 点「同意并签署」→ `POST /api/sign/<token>/submit`，带 `{image: dataURL, contentHash}`：
   - 校验图片（PNG/尺寸/墨迹/300 KB）；
   - 重算当前正文 `fingerprint`，与冻结的 `contentHash` 对比，不一致就 409（防"发出后又改正文"）；
   - 写 `signedAt`（**服务器时间**）、`signedIp`、`uaHash`、`signatureHash`、`signatureImage`；
   - 可选 TSA（FreeTSA，8 秒超时，失败不阻塞）；
   - 最后一人签完，同一请求内 `SENT → COMPLETED`，算 `termEnd`，写 `completionHash`。
4. 签完可下载 PDF（`/api/sign/<token>/pdf`），这是签署人自己留的那份副本。

### 3.3 公众侧

`/verify`：

- 输入合同编号 → 状态、签署人数；
- 再输入记录编号（`CERT-` + 前 16 位）→ 重算该次签署的证据摘要，返回 `verified`。

---

## 4. 架构分层

### 4.1 模块表（`design/ARCHITECTURE.md` §2 + 代码核对）

| 层 | 位置 | 职责 | 备注 |
|---|---|---|---|
| 业务核心 | `packages/agreement/src/core` | service / hash / terms / tsa / pdf / storage 契约 / template / signatureImage | 无框架依赖，可移植 |
| 存储适配 | `core/adapters/mongo.js`、`file-db.js`；宿主 `src/agreement/storage/index.js` | Mongo（原生 driver）与本地 JSON | `mongodb` 只在适配器里动态导入 |
| Next 适配 | `packages/agreement/src/next` | API handler、sign/print 页面包装 | 薄 |
| React 组件 | `packages/agreement/src/react` | 签名板、合同纸、打印稿 | 由宿主覆盖样式 |
| 宿主装配 | `src/agreement/instance.js` | env / Mongo / Chromium **只在这里出现** | 关键边界 |
| 路由 | `src/app` | 薄路由，直接调 service | 每个非公开 API 内再 `requireAdmin` |
| 边缘 | `src/proxy.js` | Next 16 的 `proxy`（原 middleware）约定：鉴权跳转、CSRF、安全头 | 故意不信任它 |

这个分层是干净的：`instance.js` 以上全是可移植业务，以下才是"这台机器"。

### 4.2 一次签署的调用链

```
POST /api/sign/[token]/submit
  → src/app/api/sign/[token]/submit/route.js
    → src/agreement/service.js (re-export)
      → packages/agreement/src/core/service.js :: signAgreement()
        → withAgreementLock(agreementId)          进程内串行
        → store.findSignerByTokenHash(sha256(token))
        → fingerprint(agreement, signers) === contentHash ?
        → validateSignatureImage(image)           纯函数，PNG 解析
        → evidenceHash(buildEvidence(...))
        → tsa(signatureHash)                      可选，best effort
        → store.commitSignature({ signedAt: null })  原子 CAS
        → store.appendEvent("signed")
        → store.countUnsigned() → 0 ?
          → store.transition(SENT→COMPLETED)
          → store.setAgreementFields({ completionHash })
```

---

## 5. 数据模型

### 5.1 集合与职责（`prisma/schema.prisma`，运行时用原生 driver）

| 模型 | 一条 = 什么 | 关键字段 | 说明 |
|---|---|---|---|
| `Agreement` | 一份合同 | `number @unique`（`AGR-YYYY-NNNN`）、`status`、`contentHash`、`hashV`、`revision`、`signDeadline`/`expiresAt`、`termMonths`/`termEnd`/`termEndExplicit`、`effectiveAt`/`effectiveMode`、`sentAt`、`completedAt`、`completionHash`、`completionHashV`、`voidedAt`/`voidReason`、`renewalOf`/`renewedFrom`/`renewedBy`/`renewalStatus`/`renewalDeadline`/`renewalClaimAt`、`parties`(Json)、`templateBody` | 正文和签名记录同一文档域，不是"模板+实例"两套 |
| `AgreementSigner` | 一位签署人 | `accessTokenHash @unique`、`accessTokenEnc`、`signedAt`、`signedIp`、`ipHash`、`uaHash`、`signatureImage`(base64 PNG)、`signatureHash`、`contentHash`、`tsaToken`/`tsaTime`/`tsaUrl`、`order`、`partyKey` | `@@unique([agreementId,email])` |
| `SigningEvent` | 审计事件 | `type`（draft.created / sent / linksViewed / signed / completed / voided / expiry.extended / term.changed / renewed / signedAfterVoid）、`at`、`ipHash`、`meta` | 只追加 |
| `PartyInfo` | 当事人通讯录 | 名称/联系人/法人/邮箱/电话/微信/地址 | 明确不存证件与银行信息 |
| `Counter` | 按年发号 | `_id = "AGR-2026"`、`seq` | `$inc` 原子；只升不降 |
| `AdminGate` | 管理手势 | `_id="gate"`、`p1`、`p2`（sha256） | 单例 |
| `Meta` | 应用元信息 | 标题/描述/菜单/SEO | 生成器遗留 |

### 5.2 状态机（`ARCHITECTURE.md` §4）

```
DRAFT --send--> SENT --all signed--> COMPLETED
  |               |--void--> VOIDED
  |               |--deadline--> EXPIRED (派生，不落库)
  |--void--> VOIDED
```

实现细节：
- `EXPIRED` 不是数据库状态，而是 `effectiveStatus()` 在读取时按 `signDeadline||expiresAt < now` 派生（`service.js`）。
- 只有 `DRAFT` 能改正文/签署人；`send` 只允许一次（`transition(id, ["DRAFT"], ...)`）。
- 签署只允许 `SENT`；重复提交返回 `alreadySigned`（不是错误，幂等语义）。
- 作废只允许 `DRAFT`/`SENT`；已完成合同不能作废（文档说"作废属业务/法务决定，不是技术回滚选项"）。

---

## 6. 核心逻辑详解

### 6.1 合同编号：`AGR-YYYY-NNNN`

【代码】`storage.js :: nextAgreementNumber(year)`：

- key = `AGR-2026`，`Counter` 集合里 `$inc seq`；
- 首次使用会 `countDocuments({number: /^AGR-2026-/})` 播种，`$setOnInsert` 保证两个首写者不会都从 0 开始；
- 年份用 `Asia/Shanghai` 取（业务时区，不是服务器时区）；
- 删除合同**不会回退**序号。

【实测】我故意让第一次创建失败（模板变量没填），结果**编号被消耗**：失败那次占掉 `AGR-2026-0001`，成功的是 `AGR-2026-0002`。这不是 bug，但运营要知道：**失败/作废会烧号**，编号不连续是正常的。

### 6.2 内容指纹：hashV 1 → 2 → 3

【代码】`fingerprintInput()`：

- **v1（遗留）**：`title / body / consentText / expiresAt(deadline) / signers[]`。
- **v2**：换成 `title / body / consentText / termMonths / termEndExplicit / termEnd(仅显式时) / effectiveMode / effectiveAt / signers[]`。**刻意不再包含签署截止时间** —— 因为延期是流程操作，不应该让已收的签名失效。
- **v3**：`{ v:3, sealRequired:true, ...v2 }`。把"必须封存"这件事写进哈希本身，这样**删掉 `completionHash` 也没法把已完成合同降级成"未封存但仍有效"**。

签署人列表排序键 `(order, email, id)`，保证同一个人重排也不改哈希。`canonicalJSON` 递归排序 key、去 undefined，让哈希与对象构造顺序无关。

`signDeadline` 与 `expiresAt` 双字段并存：v1 把 deadline 写进哈希，所以 **v1 的 SENT 合同拒绝延期**（代码里显式 409 并提示"作废重发"）。

### 6.3 邀请链接的三层存储

【代码】`service.js :: sendAgreement / getLinks / rotateLink`：

| 存什么 | 为什么 |
|---|---|
| `sha256(token)` → `accessTokenHash @unique` | 查表用；库泄漏也拿不到 token |
| `AES-256-GCM(token)` → `accessTokenEnc`（`v1.iv.tag.ct`，base64url） | 让运营者**以后还能复制同一条链接**，而不用轮换（轮换会让聊天里那条失效） |
| 明文 `token` | 只在 `send` 响应里出现一次 |

密钥 `AGREEMENT_LINK_KEY`：接受 base64 的 32 字节，或 ≥32 字符的随机串（用 sha256 派生）。**缺失时非生产回退 `JWT_SECRET`，生产必须专用**（`instance.js` + `docs/AGREEMENT.md` §2）。

轮换：`rotateLink` 只换某一个人的 token → 旧链接立刻 404。这与"全部重发"是两回事。

【文档 §未来方案 1】sealToken v2 要做的是：AAD 绑定 `agreementId + signerId`、`kid` 密钥版本、双读窗口。当前 AAD 为空 → 理论上密文可以在两条记录间"换位"（但还要配合 hash 匹配才能生效，风险低但不是零）。

### 6.4 签署写入的并发与竞态

这是整个代码库写得最严谨的地方，值得单独列。

1. **进程内锁**：`withAgreementLock(agreementId)` 把同一合同的 sign/void 串行化（`serialize` 可关，测试用）。
2. **跨进程 CAS**：`commitSignature` 的 filter 是 `{_id, agreementId, email, signedAt: null}`。两个标签页同时点"签署"，只有一个 `modifiedCount=1`，另一个返回 `alreadySigned`。注释明确写了"**永远不要换成先读后写**"。
3. **提交后复核**：写完签名再读 agreement，如果状态已不是 `SENT/COMPLETED`（说明期间被作废），就补一条 `signedAfterVoid` 事件并返回 409，**绝不返回成功**。
4. **完成竞态**：`transition(SENT→COMPLETED)` 用状态守卫；失败则再看一次是不是被作废，是就记 `signedAfterVoid` 并 409。
5. **续签竞态**：`claimRenewalStart` 用 `renewedBy:null, renewalStatus != renewing` 条件更新，失败则检查"孤儿草稿"（claim 了但草稿没写成）并收养，避免漏号/重复号。

测试里有 `void-race.test.mjs`、`void-race-postcheck.test.mjs` 专门压这两条路径。

### 6.5 完成封存：`completionSeal`

【代码】覆盖内容：

```js
{ v:1, agreementId, number, contentHash, completedAt, termEnd,
  signers: [{email,label,signedAt,signatureHash}] }  // 按 (order,email,id) 排序
```

为什么需要它：单个签署人的证据只覆盖"他自己的签名那一刻"，**覆盖不到 `completedAt`、最终 `termEnd`、签署人名单**。没有封存的话，改 `completedAt` 或删一个签署人不会有任何校验失败。完成时写一次，之后每次 verify 重算。

### 6.6 `/verify` 的语义（最容易讲错的字段）

【代码】`verifySignature()` 返回：

| 字段 | 含义 | 何时为 false/null |
|---|---|---|
| `match` | 该签署人的 `signatureHash` 是否等于重算值 | 改 IP/时间/签名图 → false |
| `contentMatch` | 用当前库里的正文重算 `fingerprint` 是否等于 `contentHash` | 改正文/期限/签署人 → false；无 `contentHash` → null |
| `termEndMatch` | 按期限规则重算的到期日是否等于库里的 `termEnd` | 改 `termMonths`/`effectiveAt` → false |
| `completionMatch` | 重算封存是否等于 `completionHash` | v3 已完成但缺封存 → **false**；v1/v2 无封存 → **null**（页面显示"未封存"，不伪装成 true） |
| `requiresSeal` | v3 且有完成信号（status=COMPLETED / completedAt / 全员已签） | 用来把"删封存"识别成失败 |
| `legacy` | `hashV=1` | 页面必须提示"旧版摘要，覆盖有限"（v1 不覆盖期限字段） |

`verified = match && contentMatch !== false && termEndMatch && completionMatch !== false`。

注意 `completionMatch !== false` 而不是 `=== true`：这是为了兼容 v1/v2 的历史记录（null 视为"不适用"，不视为失败）。

**证书编号** `CERT-<signatureHash 前 16 位大写>`：只是给人念/抄的短码，不是独立凭据。`verifyByCert` 在合同内按前缀找签署人，所以短码碰撞在同一合同内才会碰撞。

### 6.7 签名图净化（服务端，纯函数）

【代码】`signatureImage.js`，117 行，写得比大多数 App 都认真：

- 只接受 `data:image/png;base64,...`，≤300 KB；
- 自己解析 PNG：signature → 遍历 chunk 取 IHDR / IDAT / IEND；
- 只支持 8-bit、非隔行、colorType 0/2/4/6；
- `zlib.inflateSync(..., { maxOutputLength: expected })` —— **防解压炸弹**；
- 手动逆扫描线滤波（None/Sub/Up/Average/Paeth）；
- 统计"可见墨迹"像素，阈值 `max(40, 0.1% 像素)` → 空白画布直接拒。

这把"随便传一张全白 PNG"和"传 1 GB 解压炸弹"两条路都堵了。测试 `signature-image.test.mjs` 覆盖。

### 6.8 期限与续签规则

【代码】`terms.js`（纯函数，92 行）+ `service.js`：

- 签署截止：默认 **14 天**，最长 **30 天**（`MAX_SIGN_DAYS`）；
- 链接总寿命：自首次发送起 **30 天**（`MAX_LINK_LIFETIME_DAYS`）—— 因为 v1 token 的双读窗口就是 30 天，反复延期不能把链接续到 30 天以外；
- 合同期限：`termMonths` 或显式 `termEnd`，从 `effectiveAt || completedAt` 起算；
- 日期全部按 **Asia/Shanghai** 固定 +08:00 计算，月末夹到当月最后一天，并取**当天 23:59:59.999**（"有效至 termEnd 当日"）；
- 期限还可以 `termState()` 派生 `ok / soon(≤30天) / expired / renewing / renewal-expired / renewed`，给面板做提醒。

我实测的合同 `termMonths=12`，完成时间 2026-11-23，PDF/详情里 `termEnd` 落在 2027-11-23 23:59:59.999 (+08:00)。

### 6.9 模板编译（防注入）

【代码】`template.js`（50 行）：

- 变量白名单：`{{partyA|partyB}}.{name,nameEn,contactPerson,legalRepresentative,email,phone,address,addressEn}`；
- Markdown 上下文转义：先 `& < >`，再给 `\`*_{}[]()#+-.!|` 加反斜杠 —— 联系人名字叫 `A *B* <C>` 也注入不了强调/HTML；
- 返回 `missing / used / leftover`，`hasUnfilledVariables` 用来**阻止发出**。

【实测坑】我的第一版正文里写了 `{{partyA.legalRepresentative}}` → `send` 直接 400「正文仍有未填写的模板变量」。因为 **`legalRepresentative` 不在白名单里**（`PARTY_FIELDS` / `PARTY_LIMITS` 有它，但模板变量没有它），而且 `resolveParty()` 的快照也不带这个字段。这是**真实的功能缺口**，见 §9.2。

### 6.10 PDF 渲染

【代码】`pdf.js`：

- 拼 URL：`${baseUrl}/print/${id}?k=${hmac("print:"+id, JWT_SECRET)}`；
- 用 headless Chromium（优先 Playwright 的 `chrome-headless-shell`；寻找顺序 `CHROMIUM_BIN` → Playwright 缓存（mac/Linux/Windows），**避免钥匙串/窗口服务**）：
  `--headless=new --disable-gpu --no-sandbox --no-pdf-header-footer --virtual-time-budget=4000 --print-to-pdf=...`；
- 渲染到临时文件再读回，`finally` 删除；
- `@page` 里写页脚：左下合同编号、右下「第 N / M 页」。

【实测】2 页 PDF，165,209 字节，包含正文 + 两个签名块 + 每人的记录编号/IP/时间戳。

重要边界：**PDF 不重算哈希**，只是把库里存的哈希印上去；重算只发生在 `/api/verify/signature`。这是合理的设计（渲染不该依赖业务校验），但要写进文档防止误解。

### 6.11 时间戳（RFC 3161，可选）

【代码】`tsa.js`：

- `openssl ts -query -data <digest 的 hex 文本> -sha256 -no_nonce`；
- POST 到 FreeTSA（`AGREEMENT_TSA_URL` 可换），8 秒超时；
- `openssl ts -reply -text` 解析出 `Time stamp` 与 `Status: Granted`；
- 存 `tsaToken`(base64)/`tsaTime`/`tsaUrl`。

价值：证明"这个摘要在这时刻已存在"，**不依赖本机时钟**。best effort：TSA 挂了签名仍然成立，证书上会如实标注（我这次实测 FreeTSA 通，页面显示 `时间戳 2026/11/23 12:16（UTC+8）`）。

---

## 7. 安全模型

### 7.1 三道防线

1. **`src/proxy.js`（边缘）**：默认拒绝，白名单放行（`publicRoutes.js`）；未登录页面跳 `/admin/login?next=`，未登录 API 返回 401；跨源写直接 403。
2. **路由内 `requireAdmin()`（纵深）**：每个非公开 API 自己再验一次 cookie + CSRF。注释写得很直白："**middleware 可以被跳过**"。
3. **数据层投影**：管理端响应走 `managerProjection.js` 白名单，**永不返回** `signatureImage`、`accessTokenHash`、`accessTokenEnc`、`tsaToken`、内部备注。

### 7.2 CSRF

`isForeignOrigin(origin, host, secFetchSite)`：

- `Origin: null` → 拒绝；
- 无 Origin 且 `Sec-Fetch-Site: cross-site` → 拒绝；
- 有 Origin 但 host 不一致 → 拒绝；
- 其余依赖 `SameSite=Lax`。

proxy 与 requireAdmin **各做一次**（同一个纯函数）。

### 7.3 安全响应头

`/sign/*`：`X-Frame-Options: DENY`（防点击劫持诱导签名）、`frame-ancestors 'none'`、`no-referrer`（链接 token 不能进 Referer）、`nosniff`、`no-store`、`noindex`。
`/print/*`：同上但不需要 noindex。

### 7.4 其它

- 请求体上限按路由声明（`src/lib/httpBody.js`）：合同草稿 256 KB、签名提交 640 KB、当事人 64 KB；Content-Length 与实际字节都检查；上传路由已退役（写 405）；
- 集成接口 Bearer 必须 ≥ 24 字符，长度不等直接 false，等长才 `timingSafeEqual`（不给时序侧信道）；
- 建立签署/核验的限流（`src/lib/rateLimit.js`）：签署 20 次/分（IP+token）、核验 60 次/分（IP），超限 429 + `Retry-After`；
- 管理手势 5 次/15 分钟/IP（**进程内 Map**，多实例无效），错误也延迟 400 ms；
- 生产启动检查 `JWT_SECRET` / `ADMIN_SESSION_SECRET`，缺了直接拒绝启动；
- `ALLOW_LOCAL_IN_PRODUCTION=1` 才会允许生产用本地 JSON，且启动打两条醒目警告。

### 7.5 威胁模型（文档 §已写明的边界）

| 攻击 | 能否防 | 说明 |
|---|---|---|
| 改正文不改哈希 | ✅ | `contentMatch=false`（**我实测过**） |
| 改 IP / 时间 / 签名图 | ✅ | `match=false` |
| 删掉 `completionHash` 降级 | ✅ | v3 哈希里带 `sealRequired`，`requiresSeal` 强制 false |
| 同时改正文 + 重算所有哈希 | ❌ | 无密钥 SHA-256，DB 管理员可以 |
| 转发链接给别人签 | ❌ | 链接即签名权，这是设计取舍 |
| 暴力猜 token | ✅（实际） | 32 字节随机，`sha256` 查表 |
| 暴力猜记录编号 | ⚠️ | 16 hex 作 bearer，且 verify 无限流 |
| 微信内置浏览器签不了 | ⚠️ | 已加提示条，真机未验证 |

---

## 8. 运行时、构建与部署

### 8.1 数据源切换

`resolveDataSource()`（`src/lib/dataSource.js`）：

| `DATA_SOURCE` | 行为 |
|---|---|
| `auto`（默认/空） | 有 `MONGODB_URL` 用 Mongo，否则本地 JSON |
| `local` | 永远本地 JSON（`LOCAL_DATA_DIR` 或 `src/data/collections`） |
| `mongo` | 必须 `MONGODB_URL` |

- 生产 `local` 必须 `ALLOW_LOCAL_IN_PRODUCTION=1`（fail closed）；
- 非生产连远程 Mongo 必须 `ALLOW_REMOTE_DB=1`（防误连）；
- 本地 JSON 实现的是 Mongo driver 的一个**子集**（`find/findOne/insert*/update*/countDocuments/$inc/$max/$setOnInsert/$unset/$in`），超出就抛错而不是静默错——这个取舍很好。

> ⚠️ **本机注意**：这个项目的 `.env` 是 `DATA_SOURCE=auto` 且 `MONGODB_URL` 有值 → 直接 `npm run dev` 会尝试连远程库。我全程用 `DATA_SOURCE=local LOCAL_DATA_DIR=/tmp/agr-demo` 隔离跑，**没有连过任何 Mongo**。

### 8.2 构建

- Windows：`next build --webpack`（Turbopack 在 Windows + Node 26 会 `0xC0000005` 崩溃）；
- Linux：Node 26 默认 Turbopack 实测可用；
- 构建后 `scripts/stamp-build.mjs` 写 `.next/BUILD_INFO.json`（`sourceHash`/`files`/`builtAt`/`node`/`next`）；
- 本机 `node -v` = **v24.18.0**，而 `.nvmrc` 是 26、文档实测 26.12.1 → **版本漂移，需确认生产基线**。

### 8.3 索引（上线阻塞项）

必须的唯一索引（`scripts/lib/indexSpec.mjs`）：

- `Agreement.number`（`number_unique`）
- `AgreementSigner(agreementId,email)`（`agreement_email_unique`）
- `AgreementSigner.accessTokenHash` 部分唯一（`accessTokenHash_partial`）

生产路径：`npm run db:indexes:prod`（默认 dry-run）→ `--apply --confirm=<dbName>`；`prestart` 用 `check-indexes.mjs` 复查，缺 `number_unique` **拒绝启动**。

### 8.4 备份与回滚

- 优先"只向前修复"，回滚基线必须是迁移前快照；
- `check-rollback-safety.mjs` 会把"v2 且未完成"和 `DRAFT` 判为 UNSAFE；
- 回滚窗口里旧代码用 `countThisYear` 发号、不更新 `Counter` → 升级回来前必须 `realign-counter.mjs`（`$max`，只升不降）。

---

## 9. 实测发现的问题 + 本轮修复（2026-11-23）

这一节先是"发现了什么"，再是"改了什么、怎么验证的"。每条都给了可复现的证据形式。

### 9.1 更正：管理入口是「两个手势」，不是三道锁

初版报告根据 `ManagerAuthGate` 推断"两手势 + 一图案"，随后又错误地更正为"`/manager` 不挂载它"。
2026-11-23 的真实浏览器走查证明**初版是对的**：`/manager` 经过 `LayoutContent → LayoutMainContent`，
后者确实用 `ManagerAuthGate` 包住了内容；未设置 `PATTERN_UNLOCK_PASSWORD` 时页面停在
"PATTERN AUTHENTICATION TO UNLOCK"，进不去管理端。见 `docs/UX-Walkthrough-2026-11-23.md`。
**已修**：`LayoutMainContent` 对 `/manager` 不再套旧锁。

实测：

```
POST /api/admin/gate/unlock  {p1:[1,2,3,6],p2:[3,2,1,4]}  → 200 {"ok":true}
GET  /manager  （只带 agreement_admin）                     → 200
```

真正的问题在别处：`/login` 这个单图案旧页面**不可能成功**——它的接口 `/api/auth/pattern`
自己调 `requireAdmin`，没有 `agreement_admin` 就 401。也就是说它是死路由。

**已修**：`/login` 改为服务端 302 到 `/admin/login`；文档里不再把 `PATTERN_UNLOCK_PASSWORD`
描述成管理入口的唯一凭据。

### 9.2 已修：校验失败会烧掉合同编号【实测】

初版：一次 400 的创建消耗了 `AGR-2026-0001`，正式合同成了 0002。原因是先 `nextNumber()` 再校验。

**已修**：模板变量、当事人邮箱、字段长度、签署人数量全部前移到 `createDraft` 开头，且都在
分配编号之前。复测：

```
bad template → 400
good draft   → AGR-2026-0015   （上一条成功的是 0014，中间无缺口）
```

### 9.3 已修：模板不支持 `legalRepresentative`

表单能填法人代表，但 `template.js` 的变量白名单与 `resolveParty()` 的快照都没有它，
写 `{{partyA.legalRepresentative}}` 直接 400。

**已修**：白名单与快照各加一行；`tests/draft-limits.test.mjs` 覆盖"能编译、能落库、
不再报未填变量"。复测 `201 AGR-2026-0013`。

### 9.4 已修：管理 API 静默丢弃 `signers`（第三方签不了）

`POST /api/manager/agreements` 只透传 `partyA/partyB`，调用方传的 `signers` 被丢掉，
系统只会给两位当事人的邮箱发链接——想加"丙方"或换签署邮箱做不到。

**已修**：透传 `signers`（显式列表优先，缺省时才从当事人派生）。复测：3 个签署人 → 3 条链接。

### 9.5 已修：合同正文没有体积上限【实测】

初版实测：3 MB 正文被接受并发出（201）。这既是存储放大，也是内存/渲染压力。

**已修**：`src/lib/httpBody.js` 按路由声明上限——合同 256 KB、签名提交 640 KB、当事人 64 KB，
Content-Length 与实际字节都检查。复测：3 MB → `413 {"error":"请求体过大"}`。

另加业务级上限：标题 300 字符、正文 20 万字符、同意文案 4000 字符、签署人 20 位。

### 9.6 已修：公开端点可以无限刷【实测】

初版：连续 25 次签署提交、25 次核验查询全部 200，没有任何限速。
记录编号只有 16 hex，且核验接口公开。

**已修**：`src/lib/rateLimit.js` 固定窗口计数：
签署 20 次/分（IP+token）、核验 60 次/分（IP）；超限 `429 + Retry-After`；
`RATE_LIMIT_DISABLED=1` 仅供测试。复测：第 21 次签署 → 429；第 61 次核验 → 429。

边界：进程内计数，多实例部署仍需网关层限流（已写进 `docs/未来方案.md`）。

### 9.7 已修：e2e 在本机跑不起来

初版 e2e 把 Chromium 写死成 `C:/Users/Wang Xin/...chrome-headless-shell.exe`，在 macOS/Linux
上直接 ENOENT；失败后还会遗留一个 `next start` 占着 4030 端口，下一次运行会悄悄连到旧服务。

**已修**：
- `scripts/lib/find-browser.mjs`：`E2E_CHROME` → `CHROMIUM_BIN` → Playwright 缓存（mac/Linux/Windows 三平台布局）；
- 启动前探测端口，占用则明确报错；
- 退出/异常/超时（8 分钟）都会杀掉 server 与 Chrome；
- 构建时间戳改源码哈希后，e2e 多了一项"build was produced from the current source tree"。

复测：`PASSED=63/63`，`--mongo` 也 63/63。

### 9.8 已移除：对版本控制的依赖

初版 190 条测试里有 1 条要求从版本库里取一个历史提交；构建戳与 e2e 元数据也记录提交号。
交付目录没有任何版本库元数据，这条链在别人手里必然断。

**已修**：
- `tests/fixtures/pinned-legacy-source.mjs` 保存 v1 两个函数原文，`compat-hash` 校验其摘要
  （与原 commit 的 sha256 完全一致）；
- `scripts/stamp-build.mjs` 写 `.next/BUILD_INFO.json`：`sourceHash`（603 个文件）、`files`、
  `builtAt`、`node`、`next`；
- e2e 记录 `sourceHash / buildSourceHash / buildFresh`；
- 所有文档不再引用提交号或版本库历史。

### 9.9 已修：登录后的开放重定向

`/admin/login?next=//evil.example` 会被 `router.replace("//evil.example")` 当成协议相对地址。
**已修**：只接受以单个 `/` 开头的站内路径。

### 9.10 仍未处理（记录在案）

| 问题 | 影响 | 建议 |
|---|---|---|
| 签署页会把**其他签署人的 IP** 展示给持有人 | 隐私（合作方互相看到来源 IP） | 只显示自己的；或按 `未来方案 §3` 令牌化 |
| 证据无服务端私钥签名 | 有 DB 写权限者可同时改正文与哈希 | Ed25519 + 事件链（`未来方案 §2`） |
| 限流是进程内计数 | 多实例失效 | 网关限流 |
| 导入工具未跑通真实 Prisma 链路 | 不能迁移旧数据 | 快照库先验证 |
| 真实笔迹/打印像素未自动化 | PDF 只校验页数与文本 | 加像素基线 |
| `ManagerAuthGate` 仍挂在 `LayoutMainContent` | 部分生成器页面会多一道图案锁 | 清理生成器壳时一并删 |

### 9.11 第二、三轮：安全加固与管理会话

这一轮不改业务流程，只收紧边界。每条都有对应测试。

| 加固项 | 之前 | 现在 |
|---|---|---|
| 管理手势存储 | 无密钥 SHA-256，库泄漏即可离线爆破（4–9 点） | HMAC-SHA256（`v2:`），密钥在服务端；旧值成功解锁后自动升级；无密钥时 v2 拒绝解锁 |
| 手势暴力破解 | 仅按 `X-Forwarded-For` 限 5 次/15 分（头可伪造） | 追加全局 100 次/15 分，伪造头也绕不过；失败加 300ms 延迟 |
| 打印 key | 静态 HMAC，永不过期 | `<exp>.<hmac(print:id:exp)>`，10 分钟 TTL，未来时间戳也拒绝 |
| 请求体上限 | 先 `req.text()` 全量读入再判断 | 流式逐块读取，超限立即 `cancel()`；`Content-Length` 缺失/造假无效 |
| 生产启动 | 只查 `JWT_SECRET`/`ADMIN_SESSION_SECRET` | 追加：`AGREEMENT_LINK_KEY` 必填；`AGREEMENT_PUBLIC=1` 强制 https 公网基址；禁止 `RATE_LIMIT_DISABLED` |
| 畸形 ID | `new ObjectId('x')` 抛错 → 500，可能带驱动信息 | 统一按"未找到"返回 null/404 |
| 签署页 IP | 展示其他签署人的 IP | 只显示自己的；记录与 PDF 不变 |
| 全局响应头 | 只有 `/sign`、`/print` 有安全头 | 其他页面/API 也带 `nosniff` + `Referrer-Policy` |
| 管理会话 | 7 天持久 cookie（关浏览器仍登录） | 默认**会话级**（关浏览器需重画手势）+ 12 小时上限；勾“记住这台设备”才 7 天；v1 cookie 全部失效 |
| 退出登录 | 清 cookie，但回退可能看到缓存页 | 清 cookie + `/manager` 带 `no-store`，回退看不到旧内容 |
| 初始化脚本 | 备份写到 `D:\ClientsWebsites\...`（Windows 写死） | 写到数据目录下的 `_backups/` |

仍未解决（见 `未来方案`）：重置手势不会注销已签发的会话（会话内仍有效，需轮换
`ADMIN_SESSION_SECRET`）；限流仍是单进程；证据无服务端签名。

### 9.12 第四轮：拒签与证据包（按评审建议）

评审里排前两位的产品缺口已经补上：

| 能力 | 实现 | 实测 |
|---|---|---|
| 拒绝签署 | `POST /api/sign/<token>/decline`，状态 `DECLINED`，理由 ≤500 字存 signer + agreement | 拒绝后合同 `DECLINED`；另一签署人提交 409「合同已被拒绝」；理由在双方页面可见 |
| 证据包 | `GET /api/manager/agreements/<id>/evidence` → ZIP | 7 个条目：README、manifest（逐文件 SHA-256）、PDF、2 张签名图、2 个 TSR；`openssl ts -reply` 显示 `Granted.`；未登录 401 |

设计取舍：

- 拒签是**整份停止**而不是"该签署人标记拒绝、其他人继续"——现实里一方不接受条款，继续签没有意义；
- 拒签后仍可作废（`DECLINED → VOIDED`），但不能再签；
- 证据包不包含数据库导出，只包含"可独立复算"的材料；manifest 里明说这是无密钥 SHA-256。

### 9.13 第五轮：管理入口的 TOTP 第二因素

评审里"手势是弱口令"这一条，落地成了 RFC 6238：

| 项 | 实现 |
|---|---|
| 算法 | TOTP-SHA1 / 6 位 / 30 秒，允许 ±1 步（时间漂移） |
| 密钥 | 20 字节随机 → base32；AES-256-GCM 加密存储（`ADMIN_TOTP_KEY`） |
| 防重放 | 记录 `totpLastStep`，同一步长的码第二次直接拒绝 |
| 注册 | **只能**从命令行 `npm run init:totp`，没有任何 HTTP 路由能设置它 |
| 失败 | 手势错误与验证码错误分开返回（`code:"gesture"` / `code:"totp"`），界面只清错误的那一步 |
| 未启用 | 行为完全不变，`/api/admin/gate` 返回 `totp:false` |

实测（隔离库）：

```
GET  /api/admin/gate                      → {"scheme":"v2","totp":true}
POST unlock  无验证码                      → 401 {"code":"totp"}
POST unlock  错误码                        → 401 {"code":"totp"}
POST unlock  正确码                        → 200 {"ok":true}
POST unlock  同一个码再来一次               → 401 "验证码已被使用，请等待下一个"
GET  /manager（拿到的 cookie）              → 200
```

同时修正了一个**刚引入的隐患**：手势 HMAC 的密钥原来会回退到 `ADMIN_SESSION_SECRET`，
而"轮换会话密钥让所有人下线"是文档推荐操作——那样会把手势一起锁死。现在只认专用
`ADMIN_GATE_SECRET`；没有它则保持旧的无密钥摘要，并在状态里显示 `scheme:v1`。

代价与恢复：

- 忘记带验证器的手机 → `npm run init:totp -- --force`（旧码立即失效，需要服务器权限）；
- 轮换 `ADMIN_TOTP_KEY` / `ADMIN_GATE_SECRET` 后，TOTP 需重新绑定；
- 校验是单进程内的时间步比较，多实例共享数据库也能正确防重放（更新是条件写）。

### 9.14 第六轮：`service.js` 拆分（纯搬移）

1359 行的 `service.js` 是审阅时最明显的维护风险。这轮把它拆成"装配 + 五个模块"：

| 文件 | 行数 | 内容 |
|---|---|---|
| `service.js` | 105 | 只做装配：storage、密钥、token 封装、每合同串行锁 |
| `domain.js` | 191 | 纯函数：`fingerprintInput` / `completionSeal` / `buildEvidence` / `effectiveStatus` |
| `drafts.js` | 345 | 创建/编辑/列表/延期/改期限/详情 |
| `signing.js` | 478 | 发链接/视图/签署/拒签/作废/签署人 cookie |
| `verify.js` | 215 | 证据重算/公开状态/print key/打印数据 |
| `renewal.js` | 87 | 续签认领与双向链接 |
| `parties.js` | 42 | 当事人通讯录 |

方法：按原文件的行区间抽取函数体，用 `ctx = { getStorage, siteUrl, signSecret, withAgreementLock, sealToken, openToken, tsa }`
注入闭包依赖；`renewal` 额外接收 `createDraft`。**没有改任何业务逻辑**。

验证顺序：语法导入 → 287 条单元 → 构建 → 63 项 local e2e → 63 项 Mongo e2e → 293 条含 Mongo。
中途只漏了一个 `hasUnfilledVariables` 的 import，被 `renewal` 与 `party-info` 两条测试当场抓住——这也说明拆分前
测试密度是值得的。

### 9.15 第七轮：把拒签与证据包纳入 e2e

上一轮的两个新能力只有单元测试与手工探针，这轮补进 e2e（仍是 CDP 驱动的同一套脚本）：

| 新增检查 | 断言 |
|---|---|
| step12 建合同并发链接 | 201 + 2 条链接 |
| step12 拒绝 | `declined:true` |
| step12 对方视图 | `status=DECLINED`、`canSign=false`、理由透传 |
| step12 拒签后再签 | 409 |
| step12 公开查询 | `/api/verify` 返回 `DECLINED` |
| step13 证据包 | 200、`application/zip`、PK 头、含 README/manifest/PDF、>1 KB |
| step13 未授权 | 401 |

为此脚本内置一个最小的 100×60 PNG 生成器（签名图必须是真实墨迹，空图会被服务端拒绝）。

注意点：`api()` 记录请求日志时先做 token 掩码，否则"日志里不得出现 token"这条自检会失败——
第一次跑就是被它自己抓住的。

结果：**63/63**，local 与 `--mongo` 各一套。

### 9.16 第八轮：真实用户走查（浏览器 + 真实合同范本）

从 GitHub 下载三份真实合同范本，用鼠标完成"建主体 → 粘模板 → 发送 → 手写签名 → 核验 → 下载证据包"，
逐屏截图（修复前 16 张、修复后 18 张），发现 15 个问题并修复 10 个。详见
`docs/UX-Walkthrough-2026-11-23.md`。最重要的三条：

1. `/manager` 仍被旧图案锁包住（文档与代码都读错了，只有真跑才能发现）→ 已移除该页的旧锁；
2. 管理端正文预览用 `dangerouslySetInnerHTML`，粘贴外部模板可造成存储型 XSS → 改用 ReactMarkdown；
3. 录入框标注"HTML"、只有 8 行、日期被截断、链接无归属——体验层面的硬伤，已逐项修。

未做但已记录：附件与附件哈希、发送前渲染预览、模板占位符检查、移动端标题断行。

### 9.17 第九轮：发送前预览与占位符拦截

走查里最危险的一步是我自己把带 `______` 的模板直接发了出去。这一轮把它堵上：

| 能力 | 实现 |
|---|---|
| 发送前预览 | 正文区"预览 / 继续编辑"，用与签署页相同的 `ReactMarkdown` 渲染 |
| 占位符扫描 | `src/lib/contractChecks.js`：下划线 ≥3、`{{变量}}`、`XX`、空括号，按行报告 |
| 发送拦截 | 命中且未勾选"我已逐项确认，仍要发送" → 不建单，滚动到警告并红框提示 |
| 标题去重 | `stripDuplicateTitle` 支持 `#`–`######`，并识别"标题 +（后缀）" |

实测（浏览器）：粘贴 1.5 千字租赁模板 → 提示"15 处占位符（第 7/9/13 行…）" → 点击发送被拦截并红框 →
勾选后成功创建 `AGR-2026-0003`。截图见 `Agreement-UX-17` ~ `20`。

### 9.18 第十轮：可观测性（请求 ID / 健康检查 / 指标）

评审里"没有日志指标，用户说签不了只能猜"这一条，落地为最小可用的三件套：

| 端点/机制 | 内容 |
|---|---|
| `x-request-id` | proxy 为每个请求生成/透传，响应头返回；5xx 日志带同一个 rid |
| `GET /api/health` | 公开存活探针，不查库（避免探针压垮数据库） |
| `GET /api/health/deep` | 管理员就绪探针：数据源可读、合同数 |
| `GET /api/metrics` | 进程内计数：签署成功/失败、拒签、PDF、TSA、手势、核验、限流 |
| 日志 | 单行 JSON（`ts/level/event/rid/...`），字段按名称脱敏（token/image/body…） |

设计取舍：

- 指标放内存而不是引入 Prometheus 客户端：目的是"现在是不是在坏"，
  不是长期统计；多实例要靠日志聚合。
- TSA 是 best effort，单独计数 `tsa_ok/tsa_fail`，PDF 同理——这两类外部依赖最容易悄悄坏。
- `/api/health` 不查库：K8s/负载均衡每几秒探一次，查库会把数据库拖死。

实测：`/api/health` 200 且带 rid；e2e 新增一条断言（63/63）。

### 9.19 第十一轮：附件（hashV 4）

评审里最后一个"大活"：真实合同离不开附件。设计决定：

- **附件参与内容哈希**，但只对新合同生效：`hashV 4` 的指纹包含 `attachments: [{name,size,sha256}]`；
  v1–v3 记录继续按各自版本验证，兼容性由 `compat-hash` / `verify-content` 看住。
- 附件字节单独存 `AgreementAttachment`（一文件一文档，base64），合同文档只存元数据；
  MongoDB 16 MB 单文档限制因此不构成风险。
- 只有 `DRAFT` 能增删附件；`send` 后冻结——否则等于"签完还能换附件"。
- 限制：最多 5 个、单个 5 MB、总计 15 MB；类型白名单（PDF/PNG/JPG/WEBP/TXT/DOCX/XLSX）。
- 签署页、打印/PDF、证据包都会列出附件；证据包里是**原件 + 各自 SHA-256**。

实测（e2e）：草稿上传附件 201 → 发出后再次上传 409；签署页能看到附件；单元测试验证
"加附件会改变指纹"和"删附件会更新冻结元数据"。

### 9.20 用户走查（第二轮）

按真实用户路径走了一遍：手势 → 建主体 → 填表 → 预览 → 存草稿 → 传附件 → 发送 →
桌面签 → 手机签 → 核验 → PDF/证据包。抓到 5 个问题并修掉：

1. **草稿存了就发不出去**：详情弹窗缺「发送」按钮（只有创建时能发）→ 补上；
2. **扁平签名被拒**：`MIN_HEIGHT=50` 把 609×68 的真实签名判成无效，错误还是「格式不正确」→ 降到 24 并分因提示；
3. 底部操作按钮被压成竖排 → 允许换行、禁止收缩；
4. 文件选择器暴露浏览器原生英文控件 → 换成「选择文件」按钮；
5. 手势页只有九宫格、没有一句说明 → 补提示与「手势一/二」标签。

走查截图 14 张 + 拼图在桌面 `User-Test-*`；详见 `docs/UX-Walkthrough-2026-11-23.md`。

### 9.21 交付状态

- 初版交付目录没有 `node_modules`，离线缓存也缺包；本轮用 npmmirror 装好（`.gitignore` 已忽略）。
- 目录仍不是版本库；但**现在不需要**——构建、测试、e2e 都只依赖目录内容。

### 9.22 第二十二轮：邀请链接密文 v2（AAD + kid + 轮换）

「未来方案 §1」的最后一项硬化，落地为 `packages/agreement/src/core/linkSeal.js`。

- **AAD 绑定**：`v2` 密文用 AES-256-GCM 认证 `agreementId:signerId`。把数据库里两位签署人的 `accessTokenEnc`
  对调，两边都打不开 —— v1 时代这是"给 A 复制出 B 的链接"的社会工程入口。
- **密钥版本**：密文格式 `v2.<kid>.<iv>.<tag>.<ct>`，`kid` = 密钥 SHA-256 前 8 位（不含秘密）。
  新签发用当前 `AGREEMENT_LINK_KEY`；读取接受 `AGREEMENT_LINK_KEYS_PREVIOUS`（逗号分隔）里的旧密钥。
- **双读与自动迁移**：v1 密文仍可解；`getLinks` 读到 v1 时用同一 token 重新封成 v2（token 不变，旧链接照常可用），
  窗口靠"读一次升一级"自然收窄。
- **不静默失败**：解不开的密文进入 `getLinks().failed`，管理端能看到"这条链接无法再复制"；
  生产启动自检会拒绝过短的 `..._PREVIOUS` 项，避免以为轮换窗口生效。
- **关键事实纠正**：已发链接按 `sha256(token)` 查表，**轮换密钥不会让在途链接失效**；它只影响管理端能否再次复制。
  这一条已同步到 `docs/部署与回滚.md`（旧文档写的是"会让已发链接失效"，是错的）。
- 测试 11 条：`tests/link-seal.test.mjs`（9 条纯函数：绑定/篡改/未知 kid/旧格式/轮换/垃圾密钥）
  + `tests/regression.test.mjs` 新增 1 条跨签署人密文对调 + `tests/link-rotation.test.mjs` 2 条服务级
  （换 key 后旧链接仍能签、v1 自动升 v2）。
- 结果：`npm test` **309/309**；`TEST_MONGO=1` **324（323 通过 / 1 skip）**；e2e local 与 `--mongo` 均 **63/63**。

### 9.23 第二十三轮：证据摘要的 Ed25519 服务端签名

「未来方案 §2」的前半段。原来的 `signatureHash` / `completionHash` 是无密钥 SHA-256：有库写权限的人
可以改证据再重算，`/verify` 依然说"一致"。这一轮把摘要变成**可用公钥独立验证**的签名。

- 新 `core/evidenceSign.js`：私钥来自 `AGREEMENT_EVIDENCE_PRIVATE_KEY`（32 字节 seed / PKCS#8 / PEM），
  公钥 JWK 导出，`kid` = 公钥 SHA-256 前 8 位；`AGREEMENT_EVIDENCE_PUBLIC_KEYS` 支持轮换后验旧签名。
- 签署：`signatureSig` / `signatureKeyId` / `signatureSigAlg` 写入签署人行；
  完成时 `completionSig` / `completionKeyId` / `completionSigAlg` 写入合同。
- 验签：`verifySignature()` 返回 `evidenceSignature` / `completionSignature`（valid / invalid / unknown-key / none）
  与 `evidenceKey`；`verified` 在签名 `invalid` 时为 false，旧记录 `none` 不误伤。
- 证据包：多一个 `evidence-key.json`（alg/kid/x/fingerprint），manifest 的 `note` 与 README 按是否配置密钥措辞。
- 启动自检：配置了但解析不了 → 拒绝启动；`AGREEMENT_REQUIRE_EVIDENCE_SIG=1` 时缺失也拒绝。
- 工具：`npm run init:evidence [-- --write]` 生成密钥并（可选）写 `.env`（自动备份）。
- 实测（本地、真实 HTTP）：`/api/verify/signature` 返回 `evidenceSignature.status=valid`、
  `completionSignature.status=valid`、`evidenceKey.kid=e24ee5ea`；页面显示「服务端签名 有效（Ed25519 e24ee5ea）」。
- 截图：`~/Desktop/EVIDENCE-SIG-01-verify.png`；HTTP 样本：`~/Desktop/SmartAgreementsApp-changes/EVIDENCE-SIG-DEMO.json`。
- 结果：`npm test` **317/317**；`TEST_MONGO=1` **332（331 通过 / 1 skip）**；e2e（带证据密钥）local 与 `--mongo` 均 **63/63**。
- 未做：`SigningEvent.prevHash` 链（下一轮）。

### 9.24 第二十四轮：审计事件哈希链（prevHash）

补齐「未来方案 §2」的另一半：Ed25519 能发现**字段被改**，但发现不了**整条事件被删**。

- `SigningEvent` 增 `hash` + `prevHash`：`hash = sha256({v, agreementId, signerId, type, at, ipHash, meta, prevHash})`，
  `meta` 先按存储规则截到 500 字符再参与哈希（否则读回时必然不等）。
- 追加统一走 `ctx.appendEvent`：独立的 per-agreement **事件队列**（不能用签署锁——`signAgreement` 已在锁内，
  同 key 重入会死锁）。存储适配器负责落 `at/prevHash/hash`。
- `verifyEventChain()` **按链走而不是按时间排序**：同一毫秒内的事件时间排序不稳定，按时间会误判断链。
  结果 `{ok, complete, count, hashed, legacy, reason?}`；旧记录（无 hash）报 legacy 前缀，不算篡改。
  `link` = 有一条 prevHash 指向不存在的 hash（删事件）；`fork` = 多条事件抢同一个前驱。
- 暴露：`/api/verify?number=` 与 `/api/verify/signature` 返回 `events` / `eventChain`；管理端详情不暴露内部哈希；
  证据包 manifest 增 `events`，README 说明如何按链复核。
- `/verify` 页面新增一行：`事件链 完整（5 条事件）` / `完整（含 N 条旧记录）` / `断链：…`。
- 实测：新合同 5 条事件全部有 hash 且首条 prevHash=null；改 `sent` 的 meta → `reason=hash, brokenAt=1`；
  删 `sent` → `reason=link`；把旧事件 hash 清空后再追加 → `ok=true, complete=false, legacy=3`。
- 截图：`~/Desktop/EVIDENCE-CHAIN-01-verify.png`；HTTP 样本：`~/Desktop/SmartAgreementsApp-changes/EVIDENCE-CHAIN-DEMO.json`。
- 结果：`npm test` **322/322**；`TEST_MONGO=1` **337（336 通过 / 1 skip）**；e2e（带证据密钥）local / `--mongo` 均 **63/63**。
- 附注：用非法 `AGREEMENT_EVIDENCE_PRIVATE_KEY` 启动时 e2e 全站 500——这是启动自检的 fail-closed 行为，符合预期。

### 9.25 第二十五轮：页脚 + 无边框主题图标（文案来自 Meta）

用户反馈：`/verify` 右上角的「夜间」文字按钮丑（有边框），要求改成夜间图标、去边框、移进页脚；
页脚要进 layout，版权文案可由 Prisma `Meta` 配置。

- 新 `ThemeIconButton`：moon / sun 单色 SVG，32px 圆形热区、**零边框**、hover 才出现浅底，保留 `aria-label` / `aria-pressed`。
- 新 `SiteFooter`：`© 起年–今年 名称 · 权利文案` + 右侧主题图标；窄屏 760 / 常规 1080。
- `layout.jsx` 的 bare 分支（`/verify`、`/manager`）现在包一层 `ThemeProvider` 并渲染页脚；
  `/sign/*`、`/print/*`、`/admin*` 仍然完全不套壳（打印/签署不能被暗色或页脚污染）。
  顺带修好一个既存问题：bare 分支原来没有 `ThemeProvider`，两个页面的「夜间」按钮其实一直无效。
- 文案来源：Prisma `Meta` 的 `app_footer_cn/en`、`app_footer_start_year`、`app_footer_rights_cn/en`，
  空值回退 `FOOTER_DEFAULTS`。
- 让它在**公开页**也生效：
  - `/api/meta` 的 GET 改为公开，但仍只返回 `projectMeta()` 白名单（新增 `app_footer_*`、`app_title_*`）；
    PUT 仍需管理员，实测未登录 PUT → 401，文案未被改。
  - `/api/meta` 加入 `publicRoutes`，否则 proxy 会把未登录请求 302 到登录页，页脚永远只能看默认值。
  - `siteMetaServer` 改用共享 `getDb()`：以前它自己 new `MongoClient(MONGODB_URL)`，本地模式必然走兜底；
    同时把 `.limit(1).next()` 改为 `.toArray()[0]`，因为本地 JSON 游标没有 `next()`。
- 实测：写入 Meta（名称「思维合同 · 合规部」、起始 2024）→ 未登录 `GET /api/meta` 返回该值 →
  `/verify` 页脚显示「© 2024–2026 思维合同 · 合规部 · 保留所有权利」；点击月亮切到暗色，图标变太阳，`html.class=dark`。
- 截图：`~/Desktop/FOOT-01-verify-light.png`、`~/Desktop/FOOT-02-verify-dark.png`。
- 测试数 322→321 是预期的：`route-coverage` 会为每个非公开路由生成“需要鉴权”的子测试，`/api/meta` 转为公开后少一条。
- 结果：`npm test` **321/321**；`TEST_MONGO=1` **336（335 通过 / 1 skip）**；e2e local / `--mongo` 均 **63/63**。

### 9.26 第二十六轮：全站夜间模式走查

用真实浏览器把每个页面都切到 `theme=dark` 截图检查（脚本：暗色 localStorage → 逐页导航），修了 4 个真实的暗色缺陷：

1. **/verify 的印章不可见**：`.ag-stamp` 写死 `#111`，暗底上等于隐形 → 暗色改 `#f5f5f5`。
2. **管理端状态筛选“All”变成白块**：`.aw-chip.is-on` 的白色底在暗色下与文字冲突 → 显式 `background:#fff; color:#0a0a0a`。
3. **详情弹窗透明**：旧的 `.ag-root .ag-modal-card{background:#fff}` 压住了暗色覆盖，页面列表透过弹窗
   → 加 `html.dark .ag-modal-card / .aw-form-panel { background:#0a0a0a !important }` 与更深的遮罩。
4. **签署页仍是那个不工作的旧「夜间」按钮**：`/sign/*` 原本被排除在 `ThemeProvider` 外，按钮一直无效；
   现在签署页也跟随主题、页脚提供图标，旧文字按钮删除。
   同时 `.ag-consent` 的白底在暗色下改成透明 + 白字；签名画布仍保持白底（墨迹识别需要）。

`/print/*`（PDF/打印）与 `/admin*`（手势入口）**保持浅色**是刻意设计：打印不能随主题变暗，入口锁也不需要主题。
实测：verify（空/有结果）、manager（列表/新建弹窗/详情）、sign 全部 `html.class=dark` 且文字可读；
print / admin `class=""`（浅色）。测试 321/321、Mongo 336（335+1）、e2e 双模式 63/63。
截图：`~/Desktop/DARK-01..08*.png` + 拼图 `DARK-contact.png`。

### 9.27 第二十七轮：管理端头部（刷新图标 + 分隔线）

用户要求：刷新用图标、语言开关前加一条竖分隔线、整体收拾一下。

- 刷新：文字按钮 → 34px 圆形图标按钮（SVG 环形箭头），无边框、hover 浅底；
  加载中 `is-busy` 时图标匀速旋转（`@keyframes aw-spin`）。
- 顺序：`[刷新图标] │ [EN / 中文]`，竖线 `.aw-vline` 18px 高、`currentColor` 18% 透明度，随主题变色。
- 语言开关：去掉 `ag-btn` 的按钮感，改为纯文字按钮（12px、字距 .06em、hover 下划线）。
- 标题区与操作区改为 `.aw-manager-head`（`align-items:center`、gap 16、可换行），不再用行内样式。
- 浅色/暗色都截图核对：`~/Desktop/HEADER-01-manager-light.png`、`HEADER-02-manager-dark.png`。
- 测试 321/321、Mongo 336（335+1）、e2e 双模式 63/63。

## 10. 测试与质量评估

### 10.1 我跑出来的数

| 闸门 | 结果 |
|---|---|
| `npm test` | 初测 **190/189/1**（失败=缺版本库）→ 修复后 **321/321** |
| `npm run build` | EXIT=0，`BUILD_ID=gJFzmpE5P1xtqb0oh_qUY`，`sourceHash=d9ae375408b1babb`（271 文件，清理后） |
| 官方 e2e（我重跑） | local **63/63**、`--mongo` **63/63**；包含构建新鲜度、微信 UA、RSC 泄漏、"70KB→413"、"foreign Origin→403" |
| 我手工 e2e | 解锁 → 当事人 → 建草稿/发出 → 两人签 → COMPLETED → PDF 2 页 → verify=true → **篡改后 false** |
| 修复复测 | 3MB→413、21 次签署→429、第 61 次核验→429、3 签署人→3 链接、失败不烧号 |

仓库测试切分（55 个 `*.test.mjs`，其中 4 个 Mongo 用例）覆盖得很实在：`void-race`、`completionSeal`、`compat-hash`、`route-coverage`（46 条路由鉴权）、`public-routes`、`public-security`（RSC 泄漏）、`numbering`、`renewal`、`terms-date`、`signature-image`、`secrets-guard`（扫构建产物），本轮新增 `draft-limits`、`rate-limit`、`http-body`。

### 10.2 质量评分（我的口径，与 `docs/Agreement-设计评估.md` 接近）

| 维度 | 分 | 理由 |
|---|---|---|
| 核心流程 | 8.5/10 | 建/发/签/完成/verify/PDF 全通，竞态处理认真 |
| 数据完整性 | 8/10 | 三层哈希 + 封存 + Ed25519 签名 + 事件链 |
| 安全边界 | 7.5/10 | 纵深鉴权、CSRF、投影、头部、限流、体积上限；限流仅进程内 |
| 可维护性 | 8/10 | 未引用的生成器组件/钩子已删除（367 个文件），业务边界清楚 |
| 可部署性 | 6.5/10 | 构建/索引/跨平台 Chromium 定位齐备；OS/Node 未定、无日志/告警/定时备份 |
| 文档 | 8/10 | 本轮把 12 份文档与代码对齐，并去掉了版本控制依赖 |

### 10.3 「生成器壳」清理（2026-11-23）

从 `src/app`、`instrumentation`、`proxy` 与 `packages/agreement` 的入口做了一次完整 import 图分析：

- 源码文件 571 → 177（`src/`）；删除 367 个**不可达**文件（生成器的图片轮播、订单页、画廊、视频播放器、表单工厂钩子等）。
- 保留：`src/lib/prismaSchema.js`、`src/lib/csv.js`（脚本与测试用），`src/agreement/*` 与 `packages/agreement/*`（库的公开面）。
- 验证：`npm test` 321/321、`npm run build` 成功（271 files vs 638）、e2e local 与 `--mongo` 均 63/63。
- 收益：构建与源码哈希更快，认知负担下降；依赖体积仍在（MUI/antd/Tailwind 仍被少量页面引用），下一轮可按 import 结果继续裁剪 `package.json`。

---

## 11. 上线判断

### 11.1 能做什么 / 不能做什么（明天）

| 目标 | 结论 |
|---|---|
| 受控小范围用户测试（浏览器链接，非微信内） | **可以**，前提是主机 + Mongo 副本集 + HTTPS 今晚到位 |
| 微信内直接签署 | **不建议**：提示条有了，iOS/Android 真机未走通 |
| 公开渠道放量 | **不行**：应用内限流是单进程、无集中日志、无定时备份、证据无服务端签名 |

### 11.2 上线前必须补的（P0）

1. 主机 / 域名 / HTTPS / Mongo 副本集 / 密钥正式值；
2. `npm run db:indexes:prod --apply --confirm=<db>` 并保存输出；
3. Mongo 快照 + 恢复演练一次；
4. 微信 iOS/Android 各走通一次（至少记录截图）；
5. 多实例部署时在网关再加一层限流（应用内已有）；
6. 决定 `ManagerAuthGate` 是否保留（`/manager` 不用，部分生成器页面会用）。

### 11.3 建议的下一步（P1/P2）

- P1：Ed25519 服务端签名 + `SigningEvent.prevHash` 事件链（把"自证"变成"可对外验证"）；sealToken v2（AAD + kid）；signedIp 保留期与隐私说明；导入工具真实 Prisma 链路验证。
- P2：剥生成器壳；Linux CI 默认 Turbopack；请求 ID + 集中日志；verify 端点限流；`legalRepresentative` 进模板。

---

## 12. 附录

### 12.1 本次实测产物

| 文件 | 内容 |
|---|---|
| `~/Desktop/Agreement-sign-page.png` | 待签署页（AGR-2026-0002，0/2 已签，签名板空白） |
| `~/Desktop/Agreement-signed-page.png` | 已完成页（2/2，两个签名块 + IP + 时间戳 + 记录编号） |
| `~/Desktop/Agreement-verify-page.png` | 公众核验页 |
| `~/Desktop/Agreement-admin-gate.png` | 管理入口（全屏两宫格手势） |
| `~/Desktop/Agreement-sample-completed.pdf` | 2 页完成版 PDF（含签名与证明） |

### 12.2 本次实测使用的隔离环境（未触碰任何 Mongo）

```bash
DATA_SOURCE=local LOCAL_DATA_DIR=/tmp/agr-demo \
JWT_SECRET=<dev-only> ADMIN_SESSION_SECRET=<dev-only> \
AGREEMENT_BASE_URL=http://localhost:3100 PORT=3100 npm run dev
```

关键响应（节选）：

```
POST /api/manager/agreements   → 201 {"number":"AGR-2026-0002","links":[...]}
POST /api/sign/<t1>/submit     → {"completed":false,"record":{...}}
POST /api/sign/<t2>/submit     → {"completed":true,"record":{...}}
GET  /api/verify?number=...    → {"status":"COMPLETED","signedCount":2,"total":2}
GET  /api/verify/signature?... → {"verified":true,"hashV":3,"completionMatch":true}
篡改正文 38,000→8,000 后      → {"verified":false,"contentMatch":false,"match":true}

# 修复后的复测（同一套隔离环境）
POST 3MB 正文                 → 413 {"error":"请求体过大"}
POST {{partyA.legalRepresentative}} → 201 AGR-2026-0013
POST signers=[甲,乙,丙]        → 201 links=3
失败创建后成功创建             → AGR-2026-0014 → AGR-2026-0015（无缺口）
第 21 次签名提交               → 429
第 61 次核验查询               → 429
```

### 12.3 术语表

| 词 | 含义 |
|---|---|
| `contentHash` | 发出时冻结的内容指纹（hashV 1/2/3） |
| `signatureHash` | 单个签署人的证据摘要（IP/时间/图/内容哈希） |
| `completionHash` | 完成时刻的封存（completedAt/termEnd/全员签名） |
| `hashV` | 指纹版本；3 = 当前（含 sealRequired） |
| `termEnd` | 合同到期日（Asia/Shanghai，包含当天） |
| `signDeadline` / `expiresAt` | 签署截止（同一值的两个字段，兼容旧代码） |
| `legacy` | hashV=1 的记录，覆盖范围更小 |
| `sealRequired` | v3 哈希内的标记，防止删封存降级 |
| QES | 合格电子签名，需 QTSP/CA，本应用**不提供** |

### 12.4 一句话给不同读者

- **给老板**：能把合同搬到网上签，签完有带指纹的 PDF，事后能在网页上核验；但法律效力≈"有证据的电子签名"，不是 DocuSign 那种 CA 认证。
- **给运营**：建当事人 → 建合同 → 发出 → 复制链接发微信 → 催签 → 下载 PDF。注意失败/作废会烧编号，链接 30 天内有效。
- **给开发**：业务核心在 `packages/agreement/src/core`，三层哈希 + 原子 CAS 是精华；别碰 `commitSignature` 的先读后写；限流与体积上限已加，改动时别绕过 `readJsonLimited`。
- **给评审**：功能完整、实现克制、证据链自洽；短板是部署、限流、可观测性与无密钥签名。
