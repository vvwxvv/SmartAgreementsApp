import { NextResponse } from "next/server";
import { AI_EXPORT_PROMPT, AI_EMPTY_TEMPLATE, AI_SPEC_VERSION } from "@/lib/aiExportSpec";

export const dynamic = "force-static";

/**
 * 给模型直接抓取的纯文本版规范：
 *   /ai-spec/raw            → 导出指令（text/plain）
 *   /ai-spec/raw?template=1 → 空白模板
 */
export async function GET(req) {
  const url = new URL(req.url);
  const template = url.searchParams.get("template");
  const body = template ? AI_EMPTY_TEMPLATE : AI_EXPORT_PROMPT;
  return new NextResponse(`# agreement export spec v${AI_SPEC_VERSION}\n\n${body}\n`, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=300",
    },
  });
}
