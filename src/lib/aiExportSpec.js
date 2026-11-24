/**
 * 「AI 导出规范 v1」：给模型用的导出指令 + 与本应用对版的标记说明。
 *
 * 目的：让 AI 生成的文件一开始就带机器标记（front matter），导入时不需要人工猜标题、
 * 条款层级、当事人，也不会把签署表/目录重复做一遍。
 */
export const AI_SPEC_VERSION = 1;

/** 文件开头必须有这 5 行（可增减可选字段，但 --- 与 agreement-app 行必须在）。 */
export const FRONT_MATTER_SKELETON = `---
agreement-app: 1
title: 网站建设服务协议
lang: zh
partyA: 甲方全称
partyB: 乙方全称
---`;

export const AI_EXPORT_PROMPT = `请按「协议导出规范 v1」生成合同文件：

1. 文件开头写 front matter（用 --- 包围），必须包含 agreement-app: 1 和 title；可选 lang(zh/en)、partyA、partyB、category：

${FRONT_MATTER_SKELETON}

2. 正文用 Markdown：
   - 章节用「## 一、项目内容与费用」这类标题；也可以写「## 第N条 …」
   - 子条款单独成段，行首写 1.1 / 1.2 / 8.7（与本条编号一致）
   - 小标题单独一行，整行加粗，例如 **服务范围与款式说明**

3. 表格必须用标准 Markdown 表格（| 列 | 列 |），不要合并单元格，单元格内不要换行。

4. 不要生成签署表、签字栏、日期栏——本应用会自动生成签署区。

5. 不要生成目录——本应用会自动生成。

6. 输出 .md 最稳妥；.docx / .pdf 也可以，但 front matter 要作为正文第一段原样保留。
   PDF 需是文本型（不是扫描图），否则无法解析。

7. 金额、期限这类关键数字写完整（如 1200 元、12 个月），不要用变量占位符。`;

/** 空白骨架，方便直接粘给模型当起点。 */
export const AI_EMPTY_TEMPLATE = `${FRONT_MATTER_SKELETON}

甲乙双方经友好协商，就以下事项达成协议，共同遵守。

## 一、项目内容与费用

1.1 甲方委托乙方提供以下服务：________。

1.2 服务费用合计人民币 ________ 元，付款方式：________。

## 二、交付与验收

2.1 乙方应于 ________ 前完成交付。

2.2 甲方应在收到成果后 ________ 个工作日内验收。
`;
