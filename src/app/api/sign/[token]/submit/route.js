import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { signAgreement } from "@/agreement/service";
import { rateLimit, clientIp, tooManyResponse } from "@/lib/rateLimit";
import { readJsonLimited, LIMITS } from "@/lib/httpBody";
import { inc, logEvent, requestIdOf } from "@/lib/observability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Holding the link is the authorization to sign, so the token is the natural
// bucket: one IP hammering one link is either a stuck tab or a script.
const WINDOW_MS = 60 * 1000;
const MAX_PER_WINDOW = 20;

export async function POST(req, { params }) {
  const { token } = await params;
  const bucket = "sign:" + clientIp(req) + ":" + crypto.createHash("sha256").update(String(token)).digest("hex").slice(0, 12);
  const gate = rateLimit({ key: bucket, limit: MAX_PER_WINDOW, windowMs: WINDOW_MS });
  if (!gate.ok) return tooManyResponse(gate.retryAfter);

  try {
    const body = await readJsonLimited(req, LIMITS.signBytes);
    const out = await signAgreement(
      token,
      { image: body.image, contentHash: body.contentHash },
      {
        ip: req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || "",
        ua: req.headers.get("user-agent") || "",
      }
    );
    inc("sign_ok");
    return NextResponse.json({ ok: true, ...out });
  } catch (e) {
    const status = e.status || 400;
    inc("sign_fail");
    if (status >= 500) logEvent("sign.error", { rid: requestIdOf(req), status, message: e.message }, "error");
    return NextResponse.json({ error: e.message || "签署失败" }, { status });
  }
}
