# 本地数据导入 MongoDB（Prisma 兼容）

目标：把 `src/data/collections/*.json`（或你手上的 CSV/JSON）导入 MongoDB，字段与类型**符合 `prisma/schema.prisma`**。

## 结论先说

- **JSON 是 Prisma 安全格式**：`_id` 转 `id`，日期保持 ISO-8601，ObjectId 列用 24 位十六进制字符串，Json 列保持对象。
- **CSV 也支持**，但必须先按 schema 类型转换（脚本会做）。**不要**直接 `mongoimport --type=csv`：那样 ObjectId/Date 会变成字符串，Prisma 读出来类型不对。
- 导出阶段会**严格校验**：未知字段、必填缺失、ObjectId 非法都会报错并中止。

## 步骤

```bash
# 0) schema 校验（本地没有 MONGODB_URL 时给个占位值）
$env:MONGODB_URL="mongodb://127.0.0.1:27017/agreement_test"; npx prisma validate

# 1) 导出（默认 export/；会同时生成 JSON 与 CSV）
npm run export:local
#   -> export/Agreement.json, export/Agreement.csv, export/_report.json ...

# 2) 索引（生产只做这一步；db push 只对快照库）
npm run db:indexes

# 3) 导入（默认 dry-run）
npm run import:mongo
npm run import:mongo -- --apply

# 4) 索引兜底
npm run db:indexes
```

## 字段映射

| Prisma | 本地 JSON | 导入时处理 |
|---|---|---|
| `id String @map("_id") @db.ObjectId` | `_id`（24 hex） | 转 `id`，校验 24 hex |
| `DateTime` | ISO 字符串 | 规范化为 ISO-8601 |
| `String @db.ObjectId`（如 `agreementId`） | 24 hex 字符串 | 原样，校验 |
| `Json` | 对象/数组 | 原样 |
| `Int` / `Float` / `Boolean` | 数字/布尔 | 强转 |
| `AdminGate.id` | `"gate"` | 普通字符串，不要求 ObjectId |

## CSV 用法的两个细节

1. CSV 里的 Json 列是**字符串化的 JSON**，导入时会 `JSON.parse`；解析失败按原文保留（会被校验拒绝，提示更明确）。
2. 单文件导入必须同时指定集合：

```bash
npm run import:mongo -- --collection=PartyInfo --csv=export/PartyInfo.csv --apply
```

## 合并已有数据：默认拒绝

目标库已有 Agreement 时，`--apply` **拒绝执行**（退出码 2）。确认过快照与撞号方案后，显式加 `--allow-merge`。

`P2002` 按索引名区分：

- `_id` 已存在且内容完全一致 → 幂等跳过并计数；
- `_id` 相同但内容不同 → **报错并以非 0 退出**，不覆盖；
- `number` 已存在但 `_id` 不同 → **报错并以非 0 退出**，不静默跳过；
- `accessTokenHash` 已被另一签署人占用 → **报错**，不跳过（否则会丢签署人）；
- `(agreementId, email)` 重复 → 跳过并计数。

## 幂等与失败处理

- `--apply` 逐条 `create`；已存在（`P2002`，唯一索引冲突）**跳过**并计数，不做覆盖。
- 任何一条校验失败会打印 `集合 + id + 原因`，并以非 0 退出；不会静默跳过。
- 不打印文档内容，只打印 id 与计数（签名图、token 哈希不会进日志）。

## 已知限制

- 需要目标库已 `prisma db push`（或等价迁移），否则 `create` 会因集合/索引缺失报错。
- `Counter` 也有 Prisma 模型；导入它可保留现有编号进度。
- 本地 JSON 的写入原子性只在单进程成立；导入是一次性离线操作，不受影响。

## 前提：MongoDB 副本集

Prisma 的 MongoDB 连接器在写入（尤其嵌套写/事务）时依赖副本集。Atlas 默认就是副本集；自建单节点 `mongod` **不受支持**——不要依赖简单 `create` 偶然成功，事务与嵌套写在单节点上行为不可靠。导入前必须确认目标库是副本集。

## `prisma db push` 的边界

- **不要直接对生产库跑**。它会按 schema 调整集合与索引，可能和 `npm run db:indexes` 建的 `number_unique` 冲突，破坏性变更还会要求 `--accept-data-loss`。
- 正确做法：先在**快照库**上跑一遍并保存输出，确认无误后，生产只跑 `npm run db:indexes`。
- **本机尚未取得可归档的 `db push` 输出**：npm 12 拦截了 Prisma 引擎的 postinstall，`prisma generate/db push` 在下载引擎阶段被网络阻断（ECONNRESET）。在快照库执行时把 stdout/stderr 原样贴到本节并注明 Prisma 版本；在此之前不要把 `db push` 视为已验证步骤。
- 即使 `db push` 成功，它也不会创建 `accessTokenHash_partial` 部分唯一索引；必须再跑 `npm run db:indexes`。

## 合并已有数据时的三条硬规则

1. **父记录不可用，子记录必须一起跳过**：Agreement 因 `P2002` 被跳过、因编号冲突失败、或校验失败时，它的 Signer/Event 不再导入，计入 `skippedDependents`。
2. **Counter 只升不降**：目标库已有 `Counter` 时取 `max(target, source)`；绝不让导入把生产编号进度调低。
3. **编号冲突不要静默跳过**：`AGR-2026-0001` 这类编号很可能与生产撞号。建议只用于**新库初始化**；要合并进已有库，先重编号或分批人工核对。
4. **互引必须闭合**：`renewalOf` / `renewedFrom` 指向目标库中不存在的 Agreement 时，导入报错并以非 0 退出，不留下断链。

## CSV 的空值与类型

- 空单元格 = **未提供**（所有类型），不是 `null`，也不是 `false`。需要显式 `null` 请用 JSON。
- `Boolean`：只接受 `true/false/1/0/yes/no`；其他值（如拼错的 `fasle`）**直接报错**，不按 false 处理。空表示未提供。
- `Int/Float`：空为未提供；`"0"` 是 0。
- `Json`：字符串化 JSON；解析失败按原文保留（随后会被校验拒绝并打印原因）。

## 导出文件的安全

- `export/*.json|csv` 含 token 哈希与签名图。`export/` 不应提交、上传网盘或发到聊天工具。
- 导入完成后**删除该目录**；不要把导出文件放进网盘或聊天工具。
