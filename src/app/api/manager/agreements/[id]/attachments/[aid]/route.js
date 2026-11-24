import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/requireAdmin";
import { getAttachmentBlob, removeAttachment } from "@/agreement/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

function download(doc) {
  const buf = Buffer.from(doc.data || "", "base64");
  return new NextResponse(buf, {
    headers: {
      "Content-Type": doc.mime || "application/octet-stream",
      "Content-Disposition": `attachment; filename="attachment"; filename*=UTF-8''${encodeURIComponent(doc.name || "attachment")}`,
      "Content-Length": String(buf.length),
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-store",
    },
  });
}

export async function GET(req, { params }) {
  const adminDenied = await requireAdmin(req); if (adminDenied) return adminDenied;
  const { id, aid } = await params;
  try {
    return download(await getAttachmentBlob(id, aid));
  } catch (e) {
    return NextResponse.json({ error: e.message || "附件不存在" }, { status: e.status || 404, headers: NO_STORE });
  }
}

export async function DELETE(req, { params }) {
  const adminDenied = await requireAdmin(req); if (adminDenied) return adminDenied;
  const { id, aid } = await params;
  try {
    await removeAttachment(id, aid);
    return NextResponse.json({ ok: true }, { headers: NO_STORE });
  } catch (e) {
    return NextResponse.json({ error: e.message || "删除失败" }, { status: e.status || 400, headers: NO_STORE });
  }
}
