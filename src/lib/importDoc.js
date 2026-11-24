/**
 * 文档导入（纯本地解析，不调用任何 LLM）。
 *
 *   .docx  → mammoth 取 HTML → 这里换成 Markdown（表格自己拼，避免 turndown 把单元格写乱）
 *   .pdf   → pdfjs 逐行取文本 + 字号，按「字号大于正文 + 符合编号样式」判定标题
 *   .md/.txt → 直接按 Markdown 读
 *
 * 输出统一是 Markdown，再交给 contractSections.parseContract() 拆成条款。
 */
import mammoth from "mammoth";

const HEADING_STYLE = /^(第[一二三四五六七八九十百零〇\d]+[章节部分篇]|[一二三四五六七八九十]+、|[（(][一二三四五六七八九十\d]+[)）]|\d+(?:\.\d+)*[.、]?\s)/;

/** 估算一段文本的显示宽度（中文全角≈1em，西文≈0.5em）。 */
function textWidth(str, size) {
  let w = 0;
  for (const ch of String(str)) w += /[\u2e80-\u9fff\uff00-\uffef]/.test(ch) ? size : size * 0.5;
  return w;
}

/** 只修「康熙部首 / 兼容汉字」，不动全角标点。 */
function fixCompat(s) {
  return String(s).replace(/[\u2e80-\u2fdf\uf900-\ufaff]/g, (ch) => ch.normalize("NFKC"));
}

function decodeEntities(s) {
  return String(s)
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_m, d) => String.fromCodePoint(Number(d)));
}

/** mammoth 的 HTML → Markdown。表格单独处理，避免 turndown-gfm 把单元格写成多行。 */
function tableToMarkdown(tableHtml) {
  const rows = String(tableHtml)
    .replace(/<\/tr>/gi, "\n")
    .replace(/<\/(td|th)>/gi, "\t")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .split("\n")
    .map((r) => decodeEntities(r).replace(/[ \u00a0]+/g, " ").trim())
    .filter((r) => r.replace(/\t/g, "").trim());
  if (!rows.length) return "";
  const cells = rows.map((r) => r.replace(/\t+$/, "").split("\t").map((c) => c.trim()));
  const width = Math.max(...cells.map((r) => r.length));
  const norm = cells.map((r) => [...r, ...Array(width - r.length).fill("")]);
  const head = norm[0];
  const body = norm.slice(1);
  return [
    "| " + head.join(" | ") + " |",
    "| " + Array(width).fill("---").join(" | ") + " |",
    ...body.map((r) => "| " + r.join(" | ") + " |"),
  ].join("\n");
}

export function htmlToMarkdown(html) {
  let s = String(html || "");
  // 表格先整体抽出来单独转，避免 </p> 先换行把单元格拆散
  const tables = [];
  s = s.replace(/<table[\s\S]*?<\/table>/gi, (m) => {
    tables.push(tableToMarkdown(m));
    return "\n\n@@TABLE" + (tables.length - 1) + "@@\n\n";
  });
  s = s.replace(/<br\s*\/?>/gi, "\n");
  s = s.replace(/<\/(td|th)>/gi, "\t");
  s = s.replace(/<\/tr>/gi, "\n");
  s = s.replace(/<li[^>]*>/gi, "\n- ");
  s = s.replace(/<\/(p|div|li|h[1-6]|ul|ol|table|tbody|thead)>/gi, "\n");
  s = s.replace(/<(strong|b)[^>]*>/gi, "**").replace(/<\/(strong|b)>/gi, "**");
  s = s.replace(/<(em|i)[^>]*>/gi, "_").replace(/<\/(em|i)>/gi, "_");
  s = s.replace(/<[^>]+>/g, "");
  s = decodeEntities(s);

  const lines = s.split("\n").map((l) => l.replace(/[ \u00a0]+/g, (m) => (m.includes("\t") ? m : " ")).trim());
  const out = [];
  let table = [];

  const flushTable = () => {
    if (!table.length) return;
    const rows = table.map((r) => r.replace(/\t+$/, "").split("\t").map((c) => c.trim()));
    const width = Math.max(...rows.map((r) => r.length));
    const norm = rows.map((r) => [...r, ...Array(width - r.length).fill("")]);
    const head = norm[0];
    const body = norm.slice(1);
    out.push("| " + head.join(" | ") + " |");
    out.push("| " + Array(width).fill("---").join(" | ") + " |");
    for (const r of body) out.push("| " + r.join(" | ") + " |");
    out.push("");
    table = [];
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) { flushTable(); continue; }
    if (line.includes("\t") || (line.startsWith("|") && line.endsWith("|"))) {
      table.push(line);
      continue;
    }
    flushTable();
    // 整行加粗 → 可能是标题
    const bold = /^\*\*(.+?)\*\*$/.exec(line);
    if (bold) {
      const text = bold[1].trim();
      if (HEADING_STYLE.test(text)) out.push("## " + text);
      else out.push("**" + text + "**");
      continue;
    }
    out.push(line);
  }
  flushTable();
  const markdown = out.join("\n").replace(/\n{3,}/g, "\n\n");
  return markdown.replace(/@@TABLE(\d+)@@/g, (_m, i) => tables[Number(i)] || "").replace(/\n{3,}/g, "\n\n").trim();
}

export async function docxToMarkdown(buffer) {
  const { value } = await mammoth.convertToHtml({ buffer });
  return htmlToMarkdown(value);
}

/** PDF：按行聚合文本，字号明显大于正文的行视为标题。 */
export async function pdfToMarkdown(buffer) {
  // unpdf 自带预打包的 pdfjs，避免 Next 服务端找不到 pdf.worker 的问题
  const { extractTextItems, getDocumentProxy } = await import("unpdf");
  const doc = await getDocumentProxy(new Uint8Array(buffer));
  const { items: pages } = await extractTextItems(doc, { mergePages: false });

  const sizes = [];
  const pageLines = pages.map((items) => {
    const rows = [];
    for (const it of items) {
      if (!it.str || !it.str.trim()) continue;
      const size = it.fontSize || it.height || 0;
      sizes.push(size);
      let row = rows.find((r) => Math.abs(r.y - it.y) <= Math.max(2.5, size * 0.25));
      if (!row) { row = { y: it.y, size, parts: [] }; rows.push(row); }
      row.parts.push({ x: it.x, str: it.str });
      row.size = Math.max(row.size, size);
    }
    return rows
      .sort((a, b) => b.y - a.y)
      .map((r) => {
        const parts = r.parts.sort((a, b) => a.x - b.x);
        let text = "";
        for (let i = 0; i < parts.length; i += 1) {
          if (i > 0) {
            const gap = parts[i].x - (parts[i - 1].x + textWidth(parts[i - 1].str, r.size));
            if (gap > r.size * 0.45) text += " ";
          }
          text += parts[i].str;
        }
        return { size: r.size, text: fixCompat(text).replace(/\s+/g, " ").trim() };
      })
      .filter((l) => l.text);
  });

  const median = sizes.sort((a, b) => a - b)[Math.floor(sizes.length / 2)] || 12;
  const out = [];
  for (const lines of pageLines) {
    for (const l of lines) {
      const isBig = l.size > median * 1.12;
      // PDF 里「1.1 条」是正文；只有章级编号或明显大字号才算标题
      const isChapter = /^(第[一二三四五六七八九十百零〇\d]+[章部分篇]|[一二三四五六七八九十]+、)/.test(l.text);
      if ((isBig || isChapter) && l.text.length <= 60) out.push("## " + l.text);
      else out.push(l.text);
    }
    out.push("");
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** 统一入口：返回 Markdown + 一些提示。 */
export async function documentToMarkdown({ name, buffer }) {
  const lower = String(name || "").toLowerCase();
  const warnings = [];
  let markdown = "";
  if (lower.endsWith(".docx")) markdown = await docxToMarkdown(buffer);
  else if (lower.endsWith(".pdf")) {
    markdown = await pdfToMarkdown(buffer);
    warnings.push("PDF 只能按文本位置推断结构：表格与缩进可能丢失，请核对后再提交。");
  } else if (lower.endsWith(".md") || lower.endsWith(".txt")) markdown = buffer.toString("utf8");
  else throw new Error("只支持 .docx / .pdf / .md / .txt");

  const headings = markdown.split("\n").filter((l) => /^## /.test(l)).length;
  if (!headings) warnings.push("没有识别到章节标题（一、二、… 或 第N条），已按整篇作为一段。");
  return { markdown, warnings };
}

/**
 * 读 front matter（AI 导出规范 v1 的「对版标记」）。
 *   ---
 *   agreement-app: 1
 *   title: …
 *   ---
 * 文件里没有这段就原样返回。
 */
/**
 * 保留原始换行。
 *
 * Word / 模型导出的合同里，「甲方：…」「乙方：…」这种块是靠换行成行的；
 * Markdown 把单换行渲染成空格，导入后就挤成一行。给人看的合同不能这样。
 * 做法：普通行后补两个空格（Markdown 硬换行），表格行/标题/列表不动。
 */
export function preserveBreaks(markdown) {
  const lines = String(markdown || "").split("\n");
  const plain = (l) => {
    const t = String(l || "").trim();
    if (!t) return false;
    if (/^#{1,6}\s/.test(t)) return false;   // 标题
    if (/^\|/.test(t)) return false;          // 表格
    if (/^(?:[-*+]\s|\d+[.)]\s)/.test(t)) return false; // 列表
    if (/^>/.test(t)) return false;            // 引用
    if (/^```/.test(t)) return false;          // 代码围栏
    return true;
  };
  const out = [];
  for (let i = 0; i < lines.length; i += 1) {
    const cur = lines[i];
    const next = lines[i + 1];
    if (plain(cur) && plain(next)) out.push(cur.replace(/\s+$/, "") + "  ");
    else out.push(cur);
  }
  return out.join("\n");
}

/** 把正文里的分隔线（AI 常用来分段）清掉，避免被当成标题下划线。 */
export function stripRules(markdown) {
  return String(markdown || "")
    .replace(/^[ \t]*(?:-{3,}|\*{3,}|_{3,})[ \t]*$/gm, "")
    .replace(/\n{3,}/g, "\n\n");
}

export function splitFrontMatter(markdown) {
  const text = String(markdown || "").replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  const m = /^---[ \t]*\n([\s\S]*?)\n---[ \t]*\n?/.exec(text);
  if (!m) return { meta: {}, body: text };
  const meta = {};
  for (const line of m[1].split("\n")) {
    // 模型常写全角冒号、把值包在引号里；都当合法写法
    const mm = /^([A-Za-z][\w-]*)\s*[:：]\s*(.*)$/.exec(line.trim());
    if (!mm) continue;
    let value = mm[2].trim().replace(/^["'“”‘’\s]+|["'“”‘’\s]+$/g, "");
    // 行尾注释（title: 借展协议  # 备注）
    value = value.replace(/\s+#.*$/, "").trim();
    meta[mm[1].toLowerCase()] = value;
  }
  if (!Object.keys(meta).length) return { meta: {}, body: text };
  return { meta, body: text.slice(m[0].length) };
}
