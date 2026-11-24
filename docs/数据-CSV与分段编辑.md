# 数据：Prisma schema 契约 + CSV 本地数据 + 分段合同编辑

> 2026-11-23。两条要求：**案例数据必须严格符合 `prisma/schema.prisma`，并可从 CSV 读取**；
> **合同不再整段 Markdown 输入，改成分段（前言 + 条款）**。

## 1. 唯一契约：`prisma/schema.prisma`

`src/lib/prismaSchema.js` 直接解析 schema，导出：

- `parsePrismaSchema(text)` → `{ Model: { fields: { name: { type, optional, objectId, mappedTo, … } } } }`
- `validateRow(model, row)` → 字符串数组（空 = 通过）
- `rowToDoc(model, row)` → 存储文档（`id` → `_id`，Int/Boolean/DateTime/Json 按类型转换）

校验规则：

| 检查 | 处理 |
|---|---|
| 未知列 | 报错（model 没有这个字段） |
| 必填为空 | 报错（`String` 无 `?`、无 `@default`、非 `@updatedAt`） |
| `Int` / `Boolean` | 正则 / true·false·1·0 |
| `DateTime` | 必须是 ISO 8601，且 `Date.parse` 有效 |
| `Json` | `JSON.parse` 必须成功 |
| `@db.ObjectId` | 24 位十六进制 |
| 跨表引用 | Signer/Event 的 `agreementId`、Event 的 `signerId`、`parties[].contactId` 必须存在 |

## 2. CSV 数据目录：`data/csv/`

文件名 = model 名（`Agreement.csv`、`AgreementSigner.csv`、`PartyInfo.csv`、`SigningEvent.csv`、`Meta.csv`、`Counter.csv`）。
表头 = schema 字段名（不是 `_id`，用 `id`）。正文可以带换行与逗号，按 RFC 4180 用双引号包裹。

```bash
npm run data:csv:check                 # 只校验：schema、类型、跨表引用
npm run data:csv                       # 导入到 src/data/collections（默认）
node scripts/csv-import.mjs --data-dir /tmp/demo --force
```

- 导入默认拒绝覆盖非空集合（`--force` 才覆盖），避免把线上本地数据洗掉；
- 缺少的 model 文件直接跳过（例如 `AdminGate.csv` 通常不提供，手势仍用 `init:admin` 设置）；
- `Counter.csv` 的 id 是 `AGR-<年>`，`seq` 与已有编号连续，避免导入后从 0001 重开。

当前案例数据：2 份合同（SENT / DRAFT）、3 个主体、2 个签署人、2 条事件、Meta 与 Counter。

## 3. 分段合同编辑

`src/lib/contractSections.js`：

- `parseContract(markdown)`：按 `## ` 切成 `{ intro, sections[] }`，正文原样保留（列表、表格不丢）；
- `composeContract({ intro, sections })`：拼回 Markdown，标题自动编号「第一条 …」（已带编号不重复）；
- `numberHeadings(markdown)`：渲染兜底，历史数据（整段 Markdown）也会被自动编号；
- `CONTRACT_TEMPLATES`：服务合同 / 采购合同 / 保密协议三套条款模板。

管理端「新建协议」正文区改为：

```
前言 textarea
[第 N 条 标题]  [上移 下移 删除]
标题 input
条款正文 textarea
＋ 添加条款    套用条款模板…
```

`form.body` 仍是拼好的 Markdown——内容指纹、PDF、签署页、证据包、附件哈希全部不变。

## 4. 合同排版

`.ag-contract`：宋体、16px、行高 2.05、首行缩进 2 字、两端对齐；条款标题用无衬线、不缩进；
列表/表格/引用单独处理。签署页、管理端预览、PDF 共用同一套规则。

打印时：标题居中 21pt、字距 0.08em，正文 11pt / 1.85，条款标题 `break-after: avoid`，签署区不可分页。

## 5. 管理端交互（产品级）

- 协议列表：搜索 + 状态筛选 + 每页 10 条；
- 主体列表：搜索 + 同款模态新建；
- 空态区分「筛选无结果」与「还没有任何数据」；
- 手机端两张表都改为卡片式，语言选择持久化；
- 签署页桌面端为「文档 + 摘要栏」两栏，摘要在 1080px 以下自动落到底部。

## 6. 验证

```bash
npm run data:csv:check
npm test                     # 321/321（含 csv.test.mjs 8 条）
node scripts/e2e-manager.mjs # 63/63
```
