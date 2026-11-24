import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { getSignerView, getSignerAttachment } from "@/agreement/service";
import { rateLimit, clientIp, tooManyResponse } from "@/lib/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req, { params }) {
  const { token, aid } = await params;
  const bucket = "att:" + clientIp(req) + ":" + crypto.createHash("sha256").update(String(token)).digest("hex").slice(0, 12);
  const gate = rateLimit({ key: bucket, limit: 60, windowMs: 60_000 });
  if (!gate.ok) return tooManyResponse(gate.retryAfter);

  // Resolve the token first: the link is the authorization to read.
  const view = await getSignerView(token);
  if (!view) return NextResponse.json({ error: "链接无效或已失效" }, { status: 404 });

  try {
    const doc = await getSignerAttachment(view.agreement.id, aid);
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
  } catch (e) {
    return NextResponse.json({ error: e.message || "附件不存在" }, { status: e.status || 404 });
  }
}
