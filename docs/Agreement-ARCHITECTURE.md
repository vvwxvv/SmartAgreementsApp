# Agreement — 架构（入口）

> 唯一架构文档：**`design/ARCHITECTURE.md`**（2026-11-23 核对）。
> 本文件只保留入口与现状快照，避免两处漂移。

## 现状快照

| 项 | 事实 |
|---|---|
| Next.js / React | 16.4.6 / 19.3.1 |
| Node | `engines >=24`，`.nvmrc` 26；实测 26.12.1 |
| 构建器 | Windows：`next build --webpack`；Linux Node 26 默认 Turbopack 实测可用 |
| 构建来源 | `.next/BUILD_INFO.json` 的 `sourceHash`（不依赖版本控制） |
| 数据 | MongoDB 运行时原生 driver；Prisma 6.19.3 仅 schema/导入 |
| 内容哈希 | hashV 4（附件元数据入哈希）；完成写 `completionHash` |
| 证据签名 | Ed25519（`signatureSig` / `completionSig`）+ 审计事件 `hash/prevHash` 链 |
| 校验字段 | `contentMatch` / `termEndMatch` / `completionMatch` / `legacy` / `requiresSeal` |
| 测试 | 常规 55 文件 / 321（全部通过）；Mongo 55 文件 / 336（335 通过 / 1 skip） |
| E2E | local 63/63；`--mongo` 63/63（headless Chrome over CDP，自动定位浏览器） |
| 生产流程 | `npm ci` → `npm run build` → `npm prune --omit=dev` → `next start` |

## 去哪看

- 设计包索引：`design/README.md`
- 架构细节：`design/ARCHITECTURE.md`
- 签署语义：`design/AGREEMENT.md`
- 打包方案：`design/PLUGIN-V2.md`
- 数据模型：`prisma/schema.prisma`
- 校验实现：`packages/agreement/src/core/service.js`（`fingerprintInput` / `completionSeal` / `verifySignature`）
- 限流与体积：`src/lib/rateLimit.js` / `src/lib/httpBody.js`
- 安全边界：`src/proxy.js`、`src/lib/requireAdmin.js`、`src/lib/publicRoutes.js`
- 独立实测：`docs/Research-Report-2026-11-23.md`
