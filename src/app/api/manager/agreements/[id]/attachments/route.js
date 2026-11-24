import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/requireAdmin";
import { addAttachment, listAttachments } from "@/agreement/service";
import { readJsonLimited } from "@/lib/httpBody";
import { inc, logEvent, requestIdOf } from "@/lib/observability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// 5 MB file ≈ 6.7 MB as base64 + JSON envelope.
const MAX_BODY = 8 * 1024 * 1024;
const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(req, { params }) {
  const adminDenied = await requireAdmin(req); if (adminDenied) return adminDenied;
  const { id } = await params;
  try {
    return NextResponse.json({ attachments: await listAttachments(id) }, { headers: NO_STORE });
  } catch (e) {
    return NextResponse.json({ error: e.message || "读取失败" }, { status: e.status || 500, headers: NO_STORE });
  }
}

export async function POST(req, { params }) {
  const adminDenied = await requireAdmin(req); if (adminDenied) return adminDenied;
  const { id } = await params;
  try {
    const body = await readJsonLimited(req, MAX_BODY);
    const out = await addAttachment(id, { name: body.name, mime: body.mime, data: body.data });
    inc("attachment_ok");
    return NextResponse.json({ ok: true, attachment: out, attachments: await listAttachments(id) }, { status: 201, headers: NO_STORE });
  } catch (e) {
    // A file just over the limit trips the HTTP body cap first (the base64
    // envelope is ~1.37× the file). Say the per-file rule instead.
    const status = e.status || 400;
    const message = status === 413 ? "单个附件不能超过 5 MB" : (e.message || "上传失败");
    inc("attachment_fail");
    if (status >= 500) logEvent("attachment.error", { rid: requestIdOf(req), status, message: e.message }, "error");
    return NextResponse.json({ error: message }, { status, headers: NO_STORE });
  }
}
