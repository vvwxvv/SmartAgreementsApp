# Agreement — 合同签署应用 / Contract Signing App

一个只做「签合同」的 Next.js 应用：**创建草稿 → 发送冻结版本 → 签署人凭链接签名 → 保存可重算的证据 → 导出 A4 PDF → 对外验证**。
签署人没有账号，**链接即签名权**；合同正文与签名记录在同一份文档里；每个签名都是可复算的 SHA-256 证据，可选 RFC 3161 时间戳。

> 状态：Next 16.4.6 / React 19.3.1；源码已清理（367 个未引用文件移除）；常规测试 **321/321**，Mongo **336 条（335 通过、1 skip）**，e2e local 与 `--mongo` 均 **63/63**。
> 生产就绪仍缺：生产索引执行、微信真机验证、备份与网关层限流（应用内已有限流）。
> 本项目不依赖版本控制工具：构建来源由 `.next/BUILD_INFO.json` 的 `sourceHash` 证明。
> 给评审 AI 的入口：[design/README.md](design/README.md)；架构：[design/ARCHITECTURE.md](design/ARCHITECTURE.md)；未来事项：[docs/未来方案.md](docs/未来方案.md)；独立实测报告：[docs/Research-Report-2026-11-23.md](docs/Research-Report-2026-11-23.md)。

---

## 1. 做与不做

| 做 | 不做（故意） |
|---|---|
| 建草稿、冻结、给每个签署人发一条 bearer 链接 | 签署人账号 / 项目 / 角色 |
| 在合同页内用签名板签署（不同意可拒绝并填理由） | 邮件/短信投递（运营者复制链接） |
| 存签名图 + IP + UA 摘要 + 内容哈希 | 实名认证 / 人脸 / 证件 / 银行卡 |
| 重算并校验证据链 | 合格电子签名（QES，需 QTSP） |
| 打印版 A4 PDF（合同 + 签名页 + 证明） | 复杂合同生命周期（仅作废/过期/拒签） |
| 服务器间状态查询 | 宿主应用的权限发放 |

一句话：**它回答「谁、何时、从哪、对哪一版内容、签了什么」，不回答「他能不能进你的后台」。**

---

## 2. 技术栈

| 层 | 选择 |
|---|---|
| 框架 | Next.js 16.4.6 App Router，React 19.3.1，Node ≥24；Windows 构建用 `--webpack`，Linux Node 26 默认 Turbopack 已验证 |
| 样式 | 手写 CSS（`agreement-ui.css` / `agreement-v2.css`）+ 历史外壳（MUI/antd/Radix/Tailwind） |
| 数据 | **可切换**：MongoDB（生产，原生驱动）或本地 JSON（仅开发/E2E）；Prisma 只做 schema 与导入工具 |
| 鉴权 | 两个手势（HMAC 存库）+ HttpOnly `agreement_admin`；默认会话级（关浏览器需重画），可勾选“记住 7 天” |
| PDF | 无头 Chromium 打印 `/print/[id]?k=<hmac>` |
| 时间戳 | RFC 3161（`openssl ts` + FreeTSA），可选 |

---

## 3. 快速开始

```bash
npm ci
# 编辑 .env（Mongo 或 DATA_SOURCE=local）
npm run data:csv:check   # CSV 案例数据必须符合 prisma/schema.prisma
npm run data:csv         # 导入到本地数据目录
npm run dev                 # http://localhost:3000
npm run build && npm start  # 生产
npm test                    # 常规，无需 Mongo
TEST_MONGO=1 npm test       # 含内存副本集
```

最小 `.env`（完整模板见 `.env.example`）：

```ini
DATA_SOURCE=auto            # auto | local | mongo（生产用 mongo）
MONGODB_URL=...             # 留空则自动使用本地 JSON 存储
MONGODB_DB=agreement
JWT_SECRET=<32+ 随机串>
ADMIN_SESSION_SECRET=<32+ 随机串>
ADMIN_GATE_SECRET=<16+ 随机串>
AGREEMENT_LINK_KEY=<32+ 随机串或 base64 32 字节>
AGREEMENT_EVIDENCE_PRIVATE_KEY=<npm run init:evidence 生成>
```

- `auto`：有 `MONGODB_URL` 用 Mongo，否则用本地文件。
- 非生产连远程 Mongo 需 `ALLOW_REMOTE_DB=1`。
- 启动日志会打印解析结果，例如 `data source: auto -> local (local files)`。
- 本仓库已清理 367 个未引用的生成器文件；`npm ci` 后直接 build 即可。

---

## 4. 页面

| 路由 | 权限 | 说明 |
|---|---|---|
| `/` | 公开 | 入口 |
| `/sign/[token]` | 公开（token） | 签署：正文 + 签名板 + 同意条款 |
| `/print/[id]` | 公开（`?k=`） | A4 打印版 |
| `/verify` | 公开 | 证据校验 |
| `/api/manager/agreements/[id]/evidence` | 管理 | 证据包 ZIP（PDF + manifest + 签名图 + TSR） |
| `/api/health` | 公开 | 存活探针（不查库），带 `x-request-id` |
| `/api/health/deep` | 管理 | 就绪探针（数据源可读） |
| `/api/metrics` | 管理 | 签署/PDF/TSA/限流计数（进程内） |
| `/admin/login` | 公开 | 管理入口（图案锁） |
| `/manager` | 管理 | 面板：协议 / 主体通讯录 |

---

## 5. 常用命令

```bash
npm test                                   # 单元 + 路由覆盖 + CSRF + 投影 + 索引
npm run build                              # prisma generate + next build
node scripts/init-indexes.mjs              # 建索引（有重复数据则拒绝）
node scripts/init-indexes.mjs --migrate    # 显式替换旧唯一索引
node scripts/layout-gallery.mjs            # 打印版式预览
node scripts/pdf-baseline.mjs              # PDF 基线比对
```

---

## 6. 安全要点

- 每条非公开路由**在函数体内**调用 `requireAdmin`（不信任中间件）；覆盖测试 46/46。
- 写请求在路由内做 CSRF 判定（`Origin` / `Sec-Fetch-Site`），Cookie `SameSite=Lax`。
- 管理端响应走白名单投影：**永不返回**签名图、token 哈希、验证码哈希、TSA token、内部备注。
- 请求体上限按路由声明：合同 256 KB、签名 640 KB、当事人 64 KB（按实际字节）；上传接口已移除。
- 公开端点限流：签署 20 次/分（IP+token）、核验 60 次/分（IP）；手势解锁有全局上限；`RATE_LIMIT_DISABLED=1` 仅测试用，生产拒绝。
- 管理手势以 HMAC 摘要存储（v2），旧摘要解锁后自动升级；打印 key 10 分钟过期。
- 可启用 TOTP 第二因素（`npm run init:totp`）：手势 + 6 位动态码，密钥 AES-GCM 加密存储、同码不可重放。
- 管理会话默认**不持久**：关闭浏览器后再次进入需要重新画手势；只有勾选“记住这台设备”才保留 7 天。
- 生产启动强制 `AGREEMENT_LINK_KEY`；`AGREEMENT_PUBLIC=1` 时强制 https 公网基址。
- 邀请链接密文 v2：AES-GCM + AAD（`agreementId:signerId`），带 `kid`；轮换用 `AGREEMENT_LINK_KEYS_PREVIOUS` 双读。
- 证据摘要带 Ed25519 服务端签名（`npm run init:evidence` 生成密钥），`/verify` 可独立验签。
- 审计事件带 `prevHash` 链；`/verify` 与证据包显示事件链是否完整。
- Schema 与表单都不收身份证、护照、银行账号。

---

## 7. 已知边界

1. 本地 JSON 存储单进程、无事务 —— 生产必须用 Mongo。
2. 无发送通道；应用内限流是**进程内计数**，多实例部署仍需在网关补一层。
3. 单一管理员身份 —— 操作统一记为 `operator`。
4. PDF/TSA 依赖外部二进制（openssl、Chromium）。
5. 不提供合格电子签名（QES），只提供可验证的签署证据。
6. **生产索引需执行**：`npm run db:indexes:prod` 默认 dry-run；`--apply --confirm=<db>` 执行（见 `docs/部署与回滚.md`），并保存输出。
7. 微信提示已加，真机仍未验证；限流为进程内实现。
8. 重置管理手势不会注销当前已登录的管理会话（关浏览器或退出即失效），需要立刻全员下线请轮换 `ADMIN_SESSION_SECRET`。

---

## 8. 文档

- [design/README.md](design/README.md) — 评审入口：现状、命令、已知缺口
- [design/ARCHITECTURE.md](design/ARCHITECTURE.md) — 架构、数据模型、校验、安全
- [design/AGREEMENT.md](design/AGREEMENT.md) — 签署语义与运维
- [design/PLUGIN-V2.md](design/PLUGIN-V2.md) — 打包/CLI 方案
- [docs/HANDOVER.md](docs/HANDOVER.md) — 交接：现状、命令、待决策
- [docs/未来方案.md](docs/未来方案.md) — 未完成事项与优先级
- [docs/部署与回滚.md](docs/部署与回滚.md) — 部署、索引、备份、回滚
- [docs/上线检查表.md](docs/上线检查表.md) — 可勾选的上线/冒烟/回滚清单
- [docs/导入MongoDB.md](docs/导入MongoDB.md) — 本地数据导入
- [docs/Agreement-设计评估.md](docs/Agreement-设计评估.md) — 当前评估
- [docs/Research-Report-2026-11-23.md](docs/Research-Report-2026-11-23.md) — 独立技术研究 + 实测记录
- [docs/UX-Walkthrough-2026-11-23.md](docs/UX-Walkthrough-2026-11-23.md) — 真实用户走查（范本录入/签署/核验）+ 截图
- [docs/e2e/](docs/e2e/) — e2e 产物；[docs/screenshots/](docs/screenshots/)；[docs/samples/](docs/samples/)
