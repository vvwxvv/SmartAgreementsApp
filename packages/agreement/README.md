# @yourorg/agreement

Next.js App Router 合同签署模块：纸张风格 UI、bearer 邀请链接、签名证据记录。

## 安装

```bash
npm i @yourorg/agreement
npx agreement init
```

`init` 会在你的 `app/` 或 `src/app/` 下生成 4 个薄适配文件，并在 `lib/agreement.js`
生成配置骨架（已存在则不覆盖）。它不会改 `middleware`、不会写 `.env`。

需要：

1. `next.config` 加 `transpilePackages: ["@yourorg/agreement"]`
2. 根 layout 引入 `@yourorg/agreement/styles.css`
3. 填 `lib/agreement.js` 的 storage / baseUrl / secrets / auth

## 配置

```js
import { defineAgreement } from "@yourorg/agreement/next";
import { createMongoStorage } from "@yourorg/agreement/core/adapters/mongo";

export const agreementConfig = defineAgreement({
  storage: () => createMongoStorage({ url: process.env.MONGODB_URL, db: process.env.MONGODB_DB }),
  baseUrl: process.env.AGREEMENT_BASE_URL,
  secrets: { linkKey: process.env.AGREEMENT_LINK_KEY, signSecret: process.env.JWT_SECRET },
  auth: { getAdmin: async (req) => (await getSession(req))?.user ?? null },
  tenancy: "single",
});
```

- 缺 `storage` / `baseUrl` / 密钥：导入即报错。
- `tenancy: "multi"` 必须提供 `auth.canManage(req, agreement)`。
- 未配置 `auth.getAdmin`：管理接口返回 **503**，不会放行。
- 已配置但未登录：401；多租户无权：404。

存储适配器：

| 适配器 | 子路径 | 说明 |
|---|---|---|
| Mongo | `@yourorg/agreement/core/adapters/mongo` | 动态 `import("mongodb")`，未安装时给出明确错误 |
| JSON 文件 | `@yourorg/agreement/core/adapters/file` | 演示/测试；仅单进程原子 |

依赖情况（实测）：

| 包 | 是否安装 | 说明 |
|---|---|---|
| `mongodb` | 否 | 仅 `core/adapters/mongo` 动态加载 |
| `playwright-core` | **不依赖** | 本包不使用，安装了也不会被导入 |
| Chromium 二进制 | 外部 | `CHROMIUM_BIN` 或 Playwright 缓存中的 headless shell |

PDF 关闭或找不到 Chromium 时，PDF 接口返回 **501**，创建/签署/状态查询不受影响。

## 升级现有宿主

包不接管旧路径。升级时必须保留这些文件，并确保它们仍调用同一份 service 与授权链：

- `/sign/[token]`、`/sign/[token]/print`、`/print/[id]`
- `/verify`、`/api/verify`、`/api/verify/signature`
- 旧 `/api/sign/*`、`/api/agreements/*`

不要只把新 catch-all 接上就删旧文件：旧链接和旧客户端仍在用。

## 生成的入口

| 文件 | 用途 |
|---|---|
| `app/sign/[token]/page.jsx` | 签署页 |
| `app/sign/[token]/print/page.jsx` | 签署人副本 |
| `app/print/[id]/page.jsx` | 打印/PDF 源 |
| `app/api/agreement/[...path]/route.js` | API |

API 前缀 `/api/agreement`：`agreements`、`agreements/:id`、`send`、`links`、`void`、
`signers/:sid/link`、`pdf`、`sign/:token`、`sign/:token/submit`、`sign/:token/pdf`、`verify`。

## 已知限制

- 状态转换与事件写入不在同一事务：并发下 `completed` 事件只写一次，但进程崩溃窗口内
  可能留下「已完成、无事件」。
- `completed` 响应字段是「此刻是否全部签完」的快照，不表示「本次请求完成了合同」。
- 文件适配器只在单进程内保证条件写原子性。
