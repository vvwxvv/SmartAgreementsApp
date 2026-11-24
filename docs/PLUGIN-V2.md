# Agreement 作为可安装模块（Plugin v2）

目标：别的 Next.js App Router 项目 `npm install` + 一条 CLI，就能得到完整签署能力；需要时又能退回到「只用 API / 只用组件」的粒度。

> 当前状态（2026-11-23）：包已存在 `packages/agreement`（core / next / react / cli）。本仓库只消费 `core`（相对路径导入），
> `next` / `react` / `cli` 仍是 P1 预览，未在本宿主启用；**尚未发布 npm 包**。
> sealToken v2、Ed25519 证据签名、事件哈希链已完成（core 内可直接复用）。

## 0. 硬约束：App Router 是文件系统路由

npm 包不能把页面写进用户的 `app/`，也不应在构建期注入虚拟路由（升级即碎）。可行做法只有：

| 做法 | 机制 | 评价 |
|---|---|---|
| 薄再导出文件 | 用户项目里 4 个 2 行文件，`export { default } from "pkg/next/..."` | 可读、可改、可提交 |
| 全自动 CLI | `npx agreement init` 生成这 4 个文件 | 体验最好，仍留下可检查的代码 |

结论：**CLI 生成薄文件**，不做 next.config 注入。

### 必须真实存在的公开 URL

```
app/sign/[token]/page.jsx            → 签署页
app/sign/[token]/print/page.jsx      → 签署人副本
app/print/[id]/page.jsx              → 打印/PDF 渲染源
app/api/agreement/[...path]/route.js → 内部 API catch-all
```

已经发出的邀请链接与印在 PDF 上的地址不能死；内部 API 可以收敛到 catch-all，但 `/api/verify` 等旧路径要留只读别名。

## 1. 包分层

单包 + 子路径导出；重依赖用 optional peer，避免宿主被迫安装。

```
@yourorg/agreement
├─ core/            # 无框架：service / hash / terms / tsa / storage 契约 / adapters
│  ├─ adapters/mongo.js   # 动态 import("mongodb")
│  └─ adapters/file.js    # 本地 JSON
├─ next/            # 只依赖 next/server：handlers、sign-page、print-page
├─ react/           # 签名板、合同纸、打印稿
├─ cli/             # init / doctor / templates
└─ styles.css
```

可选 peer：`mongodb`（Mongo 适配器）、Chromium/Playwright（PDF）。未安装时给出明确错误或 501，不影响创建/签署/状态。

## 2. 宿主接线

```js
// lib/agreement.js
import { defineAgreement } from "@yourorg/agreement/next";
import { createMongoStorage } from "@yourorg/agreement/core/adapters/mongo";

export const agreementConfig = defineAgreement({
  storage: () => createMongoStorage({ url: process.env.MONGODB_URL, db: process.env.MONGODB_DB }),
  baseUrl: process.env.AGREEMENT_BASE_URL,
  secrets: { linkKey: process.env.AGREEMENT_LINK_KEY, signSecret: process.env.JWT_SECRET },
  auth: {
    getAdmin: async (req) => {
      const s = await getSession(req);
      return s ? { id: s.userId } : null;
    },
    // 多租户必填：
    canManage: async (req, agreement) => agreement.ownerId === (await getSession(req))?.userId,
  },
  tenancy: "single", // "single" | "multi"
});
```

调用点：

```js
import { createDraft, sendAgreement, getStatus } from "@/agreement";

const id = await createDraft({ title, body, consentText, expiresAt, signers: [{ email, label }] }, userId);
const { links } = await sendAgreement(id, req); // 由宿主自己发出去
const s = await getStatus(id);                  // COMPLETED 后宿主自行决定放行
```

## 3. CLI 行为

- 识别 `app/` 与 `src/app/`；生成 4 个薄文件。
- 冲突退出 2 且零写入（先写临时文件再 rename）；可重复执行。
- 不修改 `middleware/proxy` 与 `.env`，只打印可粘贴的示例。
- `doctor` 从宿主 cwd 解析可选依赖。
- 生成的 import 用相对路径或包导出，不依赖宿主的 `@/` 别名。

## 4. 环境变量

```dotenv
MONGODB_URL=…
MONGODB_DB=…
JWT_SECRET=…
AGREEMENT_BASE_URL=https://sign.example.com
AGREEMENT_INTEGRATION_SECRET=…
AGREEMENT_LINK_KEY=<32+ 位随机串>
AGREEMENT_EVIDENCE_PRIVATE_KEY=<32 字节 seed / PKCS#8 / PEM>   # 证据签名
AGREEMENT_REQUIRE_EVIDENCE_SIG=1                              # 可选：缺密钥拒绝启动
AGREEMENT_LINK_KEYS_PREVIOUS=                                 # 轮换窗口
CHROMIUM_BIN=…                 # 可选
DATA_SOURCE=auto|local|mongo   # 可选
```

## 5. 兼容与迁移

- 本仓库保留旧路径 `/api/sign/*`、`/api/agreements/*`、`/api/verify/*` 作为别名，内部调用同一 service 与授权链。
- 宿主升级时不得删除这些文件；否则兼容入口会变成绕过授权的旁路。
- 已发链接 `/sign/<token>` 与 `/verify` 的落点固定。

## 6. 剩余工作

1. 发布包与版本策略（当前只在 monorepo 内使用；`next`/`react`/`cli` 仍是 preview stub）。
2. ~~sealToken v2~~ 已完成（2026-11-23）：GCM + AAD 绑定 `agreementId:signerId`、kid、双读窗口。
3. ~~Ed25519 服务端证据签名 + 事件哈希链~~ 已完成（2026-11-23）。
4. 多租户 `canManage` 的完整测试与文档。
5. CLI 在空宿主上的端到端测试纳入常规 CI（历史验收已做过一次）。
6. 补齐 `package.json#exports`（`core/zip`、`core/attachments` 等新模块目前靠相对路径）。
7. 决定是否把 `next`/`react` 页面层升级为正式实现，还是只保留 `core`。
