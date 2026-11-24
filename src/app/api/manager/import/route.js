import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/requireAdmin";
import { documentToMarkdown, splitFrontMatter, stripRules, preserveBreaks } from "@/lib/importDoc";
import { parseContract, stripSignatureTables, importChecks } from "@/lib/contractSections";
import { contentChecks } from "@/lib/contentChecks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// 10 MB base64 envelope ≈ 7.5 MB file
const MAX_BODY = 10 * 1024 * 1024;

/**
 * 上传 docx/pdf/txt → 本地解析成条款（不调用任何 LLM）。
 * 返回给前端：标题、前言、条款数组、Markdown 原文、提示。
 */
export async function POST(req) {
  const denied = await requireAdmin(req);
  if (denied) return denied;

  try {
    const raw = await req.text();
    if (raw.length > MAX_BODY) return NextResponse.json({ error: "文件太大（上限 7 MB 左右）" }, { status: 413 });
    const body = JSON.parse(raw);
    const name = String(body.name || "");
    const data = String(body.data || "");
    if (!name || !data) return NextResponse.json({ error: "缺少文件名或内容" }, { status: 400 });

    const buffer = Buffer.from(data, "base64");
    const { markdown: withMeta, warnings } = await documentToMarkdown({ name, buffer });
    // AI 导出规范 v1：文件头的 front matter 就是「对版标记」
    const { meta, body: rawMd } = splitFrontMatter(withMeta);
    const marked = Number(meta["agreement-app"]) === 1;
    if (Object.keys(meta).length && !marked) warnings.push("检测到 front matter，但没有 agreement-app: 1 标记，按普通文档处理。");

    // 首行若是整行加粗/一级标题，当作协议标题
    let markdown = preserveBreaks(stripRules(rawMd)).trim();
    let title = "";
    const firstLine = markdown.split("\n")[0] || "";
    // 首行是整行加粗或 #/## 标题，且不像章节编号 → 当协议标题
    const asTitle = /^(?:\*\*(.+?)\*\*|#{1,2}\s+(.+))$/.exec(firstLine.trim());
    const looksNumbered = /^(第[一二三四五六七八九十百零〇\d]+[章条]|[一二三四五六七八九十]+、|\d+[.、])/.test((asTitle && (asTitle[1] || asTitle[2])) || "");
    if (asTitle) {
      const candidate = (asTitle[1] || asTitle[2] || "").trim();
      if (candidate.length <= 60 && !looksNumbered && !meta.title) {
        title = candidate;
        markdown = markdown.split("\n").slice(1).join("\n").trim();
      }
    }

    // Word 常把自动编号写成加粗（**1.1**），渲染层会自己处理条款号 → 去掉这层加粗
    markdown = markdown.replace(/\*\*(\d{1,2}(?:\.\d{1,2}){1,2})\*\*/g, "$1");

    const parsed = parseContract(markdown);
    const sections = parsed.sections.map((s) => ({ heading: s.heading, body: stripSignatureTables(s.body) }));
    const droppedSigTables = parsed.sections.some((s) => stripSignatureTables(s.body) !== s.body);
    if (droppedSigTables) warnings.push("已自动移除文末的签署表（电子协议会生成签署栏）。");
    if (!sections.length) warnings.push("没有拆出条款：正文会作为一整段放在「前言」里。");

    return NextResponse.json({
      title: meta.title || title,
      meta,
      marked,
      intro: parsed.intro,
      sections,
      markdown,
      warnings,
      checks: importChecks(sections),
      content: contentChecks(sections.map((x) => x.body).join("\n"), { category: meta.category || "", title: meta.title || title }),
      stats: { chars: markdown.length, sections: sections.length },
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    console.error("[import] failed:", e?.message);
    return NextResponse.json({ error: e?.message || "解析失败" }, { status: 400 });
  }
}
