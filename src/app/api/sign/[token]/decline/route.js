import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { declineAgreement } from "@/agreement/service";
import { rateLimit, clientIp, tooManyResponse } from "@/lib/rateLimit";
import { readJsonLimited } from "@/lib/httpBody";
import { inc, logEvent, requestIdOf } from "@/lib/observability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DECLINE_BYTES = 8 * 1024;

export async function POST(req, { params }) {
  const { token } = await params;
  const bucket = "decline:" + clientIp(req) + ":" + crypto.createHash("sha256").update(String(token)).digest("hex").slice(0, 12);
  const gate = rateLimit({ key: bucket, limit: 10, windowMs: 60 * 1000 });
  if (!gate.ok) return tooManyResponse(gate.retryAfter);

  try {
    const body = await readJsonLimited(req, DECLINE_BYTES);
    const out = await declineAgreement(token, { reason: body.reason }, {
      ip: req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || "",
    });
    inc("decline_ok");
    return NextResponse.json({ ok: true, ...out });
  } catch (e) {
    const status = e.status || 400;
    inc("decline_fail");
    if (status >= 500) logEvent("decline.error", { rid: requestIdOf(req), status, message: e.message }, "error");
    return NextResponse.json({ error: e.message || "拒绝失败" }, { status });
  }
}
