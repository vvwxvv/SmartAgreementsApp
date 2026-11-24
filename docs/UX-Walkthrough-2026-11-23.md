# 真实用户走查报告（2026-11-23）

> 目标：不用 API 脚本"假装用户"，而是从网上下载真实合同范本，通过界面录入、发起、签署、查验，
> 记录体验问题并按严重度修复。所有截图在 `~/Desktop`。
> 环境：本机 `next start`（生产构建），`DATA_SOURCE=local` 隔离目录 `/tmp/agr-ux`，1440×1100 与 390×844 两档视口。

---

## 1. 我做了什么

1. **下载真实范本**（GitHub 公开仓库，原始文件留在 `~/Desktop/contract-templates/`）：
   - `房屋租赁合同.md`（3.2 KB，简体，实际使用）
   - `軟體委外開發簡易合約書範本.md`（5.8 KB，繁体，用于跨字形测试）
   - `網站建置合約範本.txt`（5.2 KB）
2. **通过界面**（不是 API）创建两个主体：星海科技有限公司（公司）、王欣（个人）。
3. 新建协议：把 3.2 KB 的 Markdown 原文粘贴进正文框，签署截止 14 天、合同期限 1 年、立即发送。
4. 打开签署链接，**用鼠标在签名板画线**签署（CDP 鼠标事件 → 真实笔迹），第二位签署人同法完成。
5. `/verify` 输入合同编号 + 16 位记录编号，得到"签名与证据一致"。
6. 下载证据包 ZIP 与完成版 PDF。
7. 同一页面切 390×844 手机视口截图，检查移动端/微信场景。

---

## 2. 发现的问题（按严重度）

| # | 严重度 | 问题 | 证据 | 状态 |
|---|---|---|---|---|
| 1 | **高** | `/manager` 实际还套着旧版单图案锁（`ManagerAuthGate`）。未设置 `PATTERN_UNLOCK_PASSWORD` 时，浏览器停在"PATTERN AUTHENTICATION TO UNLOCK"无法进入；文档却说 `/manager` 只用管理员手势。 | `Agreement-UX-01-manager-empty-BEFORE.png`（第一次跑就被拦住） | **已修**：`LayoutMainContent` 对 `/manager` 不再套旧锁（该页已有两道手势 + 可选 TOTP） |
| 2 | **高** | 管理端"正文"预览用 `dangerouslySetInnerHTML` 渲染原文。粘贴自网络的模板若含 HTML/脚本，会在管理员页面执行（存储型 XSS / 自伤）。 | 代码审查 + 录入模板流程 | **已修**：改用 `ReactMarkdown`（与签署页同一渲染器） |
| 3 | 中 | 正文输入框标签写"正文（HTML）"，但系统实际渲染 Markdown；用户会去粘贴 HTML。 | `Agreement-UX-03-form-with-template-BEFORE.png` | **已修**：改为"正文（Markdown / 纯文本）" |
| 4 | 中 | 输入框只有 8 行，1.5 千字合同只能看到开头几行，无法在发送前通读。 | 同上 | **已修**：14 行 |
| 5 | 中 | 详情弹窗日期被截断（"2026-11-23 15…"、"截止 2026…"），关键时间读不出来。 | `Agreement-UX-05-detail-BEFORE.png` | **已修**：弹窗内改为自适应列 + 允许换行；手机端两列换行 |
| 6 | 中 | 两条签署链接长得一样，运营者无法判断哪条给谁，容易发错人。 | `Agreement-UX-05-detail-BEFORE.png` | **已修**：链接上方显示"甲方 xxx / 乙方 xxx" |
| 7 | 低 | 管理端表格列头 "Email"、事件类型 "sent / draft.created / linksViewed" 在中文界面里是英文。 | 同上 | **已修**：邮箱；事件中文化 |
| 8 | 低 | `/verify` 签名时间显示 ISO UTC（`2026-11-23T07:33:09.839Z`），旁边其它时间是本地时间。 | `Agreement-UX-12-verify-result-BEFORE.png` | **已修**：统一本地格式 |
| 9 | 低 | 未完成的合同在 `/verify` 显示"未封存（本功能上线前完成）"，把"还在签"说成"旧版"。 | 同上 | **已修**：按状态显示"尚在签署中，完成时封存" |
| 10 | 低 | IP 显示 `::ffff:127.0.0.1`，本机地址没被识别。 | 同上 | **已修**：`::1/127.0.0.1/::ffff:127.0.0.1` 统一显示"本机" |
| 11 | 低 | 手机端标题在"王/欣"中间断行，字距过大。 | `Agreement-UX-11-mobile-sign-BEFORE.png` | 未修（需要排版层单独设计） |
| 12 | 低 | 合同标题与正文里模板自带的 H2 重复（"房屋租赁合同"出现两次）。 | `Agreement-UX-06-sign-document-BEFORE.png` | **已修**：`stripDuplicateTitle` 支持 `#`–`######`，并识别"标题+后缀" |
| 13 | 产品缺口 | 没有附件/附件哈希。真实合同常带报价单、图纸，本系统只能把正文粘成一篇。 | 录入时想加附件无处可放 | **已修**：草稿可传附件（≤5 个、单个 5 MB），元数据进入 `hashV 4` 指纹；发出后冻结；签署页/PDF/证据包均列出 |
| 14 | 产品缺口 | 没有发送前"渲染预览"。Markdown 语法错误要发出去才看得到。 | 表单无预览入口 | **已修**：正文区新增"预览/继续编辑"，与签署页同一渲染器 |
| 15 | 产品缺口 | 模板里的下划线空格（"出租方：____"）没有填写机制，用户只能手工改正文；不小心把空白模板发出去也无人提醒。 | `Agreement-UX-06` 里大量 `____` | **已修**：发送前扫描下划线/变量/XX/空括号；有命中时先拦截，需勾选"我已确认"才能发送 |

---

## 3. 修复后的样子（同流程重跑）

- `Agreement-UX-15-detail-after.png`：日期完整、邮箱中文化、链接带"乙方 王欣"、事件中文化、出现"证据包"按钮。
- `Agreement-UX-16-verify-after.png`：签署时间本地化、IP 显示"本机"、"尚在签署中，完成时封存"。
- `Agreement-UX-03-form-with-template.png`：标签改为 Markdown、输入框 14 行。
- `Agreement-UX-11-mobile-sign.png`：日期换行后完整可见。

---

## 4. 截图清单（`~/Desktop`）

**修复前（拦截问题）**

```
Agreement-UX-01-manager-empty-BEFORE.png      旧图案锁拦住 /manager
Agreement-UX-02-party-form-BEFORE.png         主体表单
Agreement-UX-03-form-with-template-BEFORE.png 正文（HTML）标签 + 8 行输入框
Agreement-UX-04-list-after-create-BEFORE.png  创建后列表/弹窗
Agreement-UX-05-detail-BEFORE.png             日期截断 + 链接无归属
Agreement-UX-06-sign-document-BEFORE.png      长合同签署页
Agreement-UX-07-sign-canvas-BEFORE.png        签名区
Agreement-UX-08-drawn-signature-BEFORE.png    鼠标画出的签名
Agreement-UX-09-after-sign-BEFORE.png         签署后
Agreement-UX-10-completed-BEFORE.png          1/2 未完成
Agreement-UX-11-mobile-sign-BEFORE.png        手机端日期截断
Agreement-UX-12-verify-status-BEFORE.png      核验状态
Agreement-UX-12-verify-result-BEFORE.png      UTC 时间/未封存文案/IP
```

**修复后**

```
Agreement-UX-01-manager-empty.png
Agreement-UX-02-party-form.png
Agreement-UX-02b-party-filled.png
Agreement-UX-03-form-with-template.png
Agreement-UX-04-list-after-create.png
Agreement-UX-05-detail.png
Agreement-UX-06-sign-document.png
Agreement-UX-07-sign-canvas.png
Agreement-UX-08-drawn-signature.png
Agreement-UX-09-after-sign.png
Agreement-UX-10-completed.png
Agreement-UX-11-mobile-sign.png
Agreement-UX-12-verify-status.png
Agreement-UX-12-verify-result.png
Agreement-UX-13-completed.png
Agreement-UX-14-verify-completed.png
Agreement-UX-15-detail-after.png
Agreement-UX-16-verify-after.png
Agreement-UX-17-placeholder-warning.png   占位符警告 + 确认勾选
Agreement-UX-18-preview.png               发送前预览（Markdown 渲染）
Agreement-UX-19-send-blocked.png          未勾选确认时发送被拦截
Agreement-UX-20-sent-after-ack.png        勾选后发送成功
Agreement-UX-21-attachments-manager.png   管理端附件（名称/大小/SHA-256/下载）
Agreement-UX-22-sign-attachments.png      签署页附件清单
```

**交付物**

```
Agreement-UX-evidence.zip   证据包（README + manifest + PDF + 签名图 + TSR）
Agreement-UX-completed.pdf  完成版 PDF
contract-templates/         三份下载的原始范本
```

---

## 5. 这次走查暴露的"结构性问题"

1. **同一功能有两份 UI**：`AgreementDetailModal.jsx` 与 `src/app/manager/page.jsx` 各写了一套详情弹窗。
   我上一轮把"证据包"按钮加到了前者的，结果 `/manager` 用的是后者——用户看不到。这次才补对。
   建议：删掉未使用的那份，或让两者共用。
2. **文档与实际布局不一致**：文档说 `/manager` 只要管理员手势，实际还套了旧图案锁。
   原因是我之前只查了 import，没查 layout 树。**真实走查比读代码可靠**。
3. **默认语言是英文**：目标用户是中文，但 `/manager` 首屏是 "MANAGEMENT / NEW AGREEMENT"，
   要点一下"中文"。建议默认 zh（已有站点 Meta 可配）。

---

## 6. 验证

```
npm test        286/286
e2e local       63/63
e2e --mongo     63/63
build           EXIT=0（source 57decdd17a313476）
```

> 走查用的三份范本来自公开 GitHub 仓库（`abestsolution/LegalContract`、`ofafa/contract_sample`、
> `NETivism/drupal-site-contract`），仅作测试素材。


---

## 第二轮：以真实用户身份完整走查（2026-11-23 17:10–17:40）

这一轮不调 API 造假数据：手势进后台 → 建主体 → 表单填写 → 预览 → 存草稿 → 上传附件 →
发送 → 甲方桌面签 → 乙方手机签 → 核验 → 导出 PDF/证据包 → 回管理端看详情。
每一步都用无头 Chromium 真实点击/拖拽，截图落在桌面 `User-Test-*.png`。

### 走查中发现并修掉的问题

| # | 现象 | 原因 | 修复 |
|---|---|---|---|
| U1 | 存了草稿之后**没有任何入口能发出**，只能重新建一份 | 详情弹窗只有「续签 / 打开 PDF / 关闭」，发送只存在于创建表单 | 详情底部新增「发送」（`POST /api/agreements/:id/send`），成功后刷新链接 |
| U2 | 桌面用触控板画的签名被拒：「签名图片格式不正确」 | 服务端最小高度 50px，真实的扁平签名（609×68）被当成无效 | 下限改为 60×24，并按原因给中文提示（太小/空/格式） |
| U3 | 签名后页面仍显示 0/2 | 截图时机早于 `load({quiet:true})` 返回（非产品缺陷，属走查脚本） | 走查改为轮询服务端状态后再截图 |
| U4 | 详情底部按钮挤成竖排（「发送」「关闭」两字一行） | `.ag-modal-actions` 不换行、按钮可收缩 | 允许换行 + 按钮 `flex:0 0 auto; white-space:nowrap` |
| U5 | 附件选择器显示浏览器原生「Choose Files / No file chosen」 | 直接暴露 `<input type=file>` | 隐藏原生控件，用「选择文件」文字按钮触发 |

### 截图清单（桌面根目录）

```
User-Test-01-gate.png                两个手势（极简：只有点阵 + 重画图标）
User-Test-02-manager-empty.png       管理端空态
User-Test-03-form-filled.png         表单：标题/双方/正文/期限
User-Test-04-preview.png             正文 Markdown 预览
User-Test-05-detail-draft.png        草稿详情
User-Test-06-attachment-uploaded.png 附件：名称/大小/SHA-256/删除
User-Test-07-sent-links.png          发送后的两条签署链接
User-Test-08-sign-page.png           签署页（含附件区）
User-Test-09-signature-drawn.png     手写签名
User-Test-10-signed-a.png            甲方签完：你已签署 1/2
User-Test-11-mobile-sign.png         乙方手机（390×844）签署页
User-Test-12-mobile-completed.png    双方签完：2/2 · COMPLETED
User-Test-13-verify.png              核验：签名与证据一致 · 摘要版本 v4
User-Test-14-manager-completed.png   管理端完成态（事件链、证据包入口）
User-Test-01b-gate-info.png          点右上角 i：说明 / 记住设备 / 忘记手势提示
User-Test-01c-gate-mobile.png        手势页手机 390×844
User-Test-contact.png                14 张拼图
```

### 仍然存在的体验问题（未改，记录在案）

- 管理端详情是 560px 老弹窗，附件/链接/事件挤在一列，长合同要滚很久；新版 `ag-modal-panel` 只用在别处。
- 表单「同意条款」默认空，签署页回退到内置文案；建议表单预填默认值让运营者可见可改。
- 手势页没有任何品牌/标题，只有两个九宫格；对第一次用的人仍偏抽象。


### 手势页改版（按用户要求，2026-11-23 17:50）

用户要求「这一页就这么简洁，其他信息加一个 i icon 点击显示 tooltip」。

- 页面上只留：两个九宫格 + 各自的「↻ 重画」；
- 右上角 26px 圆形 `i`，点开 340px 白底黑边小面板，里面才是：
  手势说明（每个 ≥4 点、两个都对自动进入）、「记住这台设备 7 天」勾选、服务端只存 hash 与重置命令；
- Esc / 点面板外关闭；`aria-expanded`、`aria-label` 齐备；
- 手机（≤760px）两格改为上下排列、间距 34px，原来 140px 横向 gap 在 390 宽会溢出。


### 分段编辑 + 合同排版（2026-11-23 18:05）

- 管理端正文改为「前言 + 条款卡片」：标题自动编号「第一条」，可上移/下移/删除、套用三套模板；
- 签署页与 PDF 改用 `.ag-contract`：宋体、首行缩进两字、条款标题不缩进；
- PDF 标题居中、编号与时间居中，页脚保留编号与「第 x / y 页」。

截图：`CSV-Seed-04-sections-editor.png`、`CSV-Seed-05-preview.png`、
`CSV-Seed-06-sign-typography.png`、`CSV-Seed-07-pdf-page.png`；
成品 PDF：`CSV-Seed-合同排版.pdf`。


### 管理端改版（2026-11-23 18:30，专业版式）

原问题：页头重复（站点栏 + 页面标题）、表单/列表挤在一页、宽度不一致、标签全是等宽大写。

- `/manager` 不再套站点外壳（`layout.jsx` bare 列表加入 `/manager`），只保留一处页头；
- 「新建协议」改成 1080px 宽的模态：标题区 + 可滚动正文 + 底部固定操作，列表页只剩列表；
- 条款卡片：`第N条` + 可编辑标题同一行，正文自动增高（`field-sizing: content`），不再裁切；
- 标签从 `ag-mono` 换成 12px 常规字重（`.aw-label`），输入统一 14px；
- 详情弹窗 560 → 720；手机端列表改卡片式（编号+状态 / 标题 / 打开），隐藏创建与到期列；
- 语言选择写入 `localStorage`，刷新后不再跳回英文；
- 核验页输入进 760px 边框卡，标签 + 行内按钮，手机改竖排。

截图：`UI15-01-manager.png`、`UI15-02-create-modal.png`、`UI15-03-create-sections.png`、
`UI15-04-detail.png`、`UI15-05-verify.png`、`UI15-06-mobile-list.png`、`UI15-07-mobile-form.png`。


### 产品级打磨（2026-11-23 19:00）

- **列表工具栏**：搜索（编号/标题）+ 状态筛选（全部/草稿/已发送/已完成/已拒绝/已作废），每页 10 条分页；
  筛选为空与「一条都没有」是两种空态，后者给「新建协议」入口。
- **主体页**：新建成同款 680px 模态；搜索名称 / 英文名 / 邮箱 / 联系人；手机改卡片列表。
- **语言**：写 `localStorage`，刷新不再回到英文。
- 截图：`UI15-08-filtered.png`、`UI15-09-parties.png`、`UI15-10-party-modal.png`。


### 无障碍与移动签署（2026-11-23 19:15）

产品级验收项，不是装饰：

- **模态可键盘操作**：`useModalA11y` 统一处理 Esc 关闭、Tab/Shift+Tab 焦点循环、打开锁 body 滚动、关闭归还焦点；
  三个模态（新建协议 / 新建主体 / 协议详情）都加了 `role="dialog" aria-modal="true"`。
  自动化验证：`ESC_CLOSED=true`、`FOCUS_IN_PANEL=true`、连按 40 次 Tab 仍在框内（`TRAP_OK=true`）。
- **焦点可见**：`:focus-visible` 2px 描边，键盘用户能看到当前位置。
- **移动端签署吸底条**：`0 / 2 已签` + 「去签名」（滚动到签名区），已签后变「下载当前副本」；
  底部 `env(safe-area-inset-bottom)` 适配 iPhone。
- **详情层级**：事件折叠成「事件 · 2」，正文保持折叠，操作栏固定在卡片底部。

截图：`UI16-01-detail.png`、`UI16-02-form-focus.png`、`UI16-03-sign-sticky.png`。


### 签署页桌面布局（2026-11-23 19:25）

- ≥1080px：左文档（760）+ 右摘要栏（320，sticky）；
  摘要栏放「状态 / 签署进度 / 签署人列表 / 附件 / 操作（下载、核验）」；
- 文档区只留正文、签署区、拒签入口；附件不再插在正文与签名之间；
- ≤1080px：单栏，摘要栏落到文档之后；移动端吸底条仍保留。

截图：`UI17-01-sign-desktop.png`、`UI17-02-sign-mobile.png`。


### 打印 / PDF 版式（2026-11-23 19:35）

- 标题居中、编号与时间居中；条款「第N条」、正文宋体 11pt / 1.85、首行缩进 2 字；
- 附件清单改为「名称 ⇠→ 大小 · SHA-256 前缀」，字号 10.5pt、点线分隔、不跨页；
- 签名区前加「（以下无正文）」（正式合同惯例），签名图高度 64px、签名格不跨页；
- 页脚保留「编号 + 第 x / y 页」（`@page` margin box）。

成品：`/Users/vvwxvv/Desktop/PRINT-合同.pdf`、`PRINT-合同-p1.png`。


### 示例数据提示（2026-11-23 19:40）

- `npm run data:csv` 导入时写 `.csv-seed.json`（记录本次导入了哪些 `_id`）；
- 管理端顶部横幅：「示例数据已载入 · N 份协议、M 个主体来自 data/csv」，提供
  **清空示例数据** 与 **知道了**（按 seededAt 记 localStorage，不再打扰）；
- 清空只删除清单里的文档，运营自己创建的合同/主体不受影响；清单删除后横幅自动消失。
- 实测：3 份协议中清掉 2 份示例，保留自建的 `AGR-2026-1003`。

截图：`UI18-01-seed-banner.png`、`UI18-02-after-clear.png`。


### 签署人徽章 / 清空后空态 / 导入保护（2026-11-23 19:45）

- 摘要栏签署人：`（你）` 文本后缀改为描边小徽章 `你`，与右侧「已签 / 待签」分离；
- 清空示例数据后，空态标题变为「示例数据已清空」，并提示从新建正式合同开始；
- `scripts/csv-import.mjs`：`NODE_ENV=production` 时即使集合为空也必须 `--force` 才写入；
  `--check` 不受影响（只读校验仍可直接跑）。

截图：`UI19-02-empty-after-clear.png`；签署人徽章见 `UI17-01-sign-desktop.png`。
