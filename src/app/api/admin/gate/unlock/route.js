import { NextResponse } from "next/server";
import { COOKIE, adminCookieOptions, createAdminToken, rememberTtlSeconds } from "@/lib/adminAuth";
import { checkGate } from "@/agreement/adminGate";
import { totpStatus, verifyGateTotp } from "@/agreement/adminTotp";
import { rateLimit, clientIp, tooManyResponse } from "@/lib/rateLimit";
import { inc } from "@/lib/observability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Two layers: 5 attempts / 15 min per source, and a global ceiling. The source
// address comes from a header, so a spoofing client could dodge the per-IP
// bucket — the global cap makes brute force impractical regardless.
const WINDOW_MS = 15 * 60 * 1000;
const PER_SOURCE = 5;
const GLOBAL = 100;

export async function POST(req) {
  const ip = clientIp(req);
  const perSource = rateLimit({ key: "gate:" + ip, limit: PER_SOURCE, windowMs: WINDOW_MS });
  if (!perSource.ok) return tooManyResponse(perSource.retryAfter);
  const global = rateLimit({ key: "gate:global", limit: GLOBAL, windowMs: WINDOW_MS });
  if (!global.ok) return tooManyResponse(global.retryAfter);

  try {
    const body = await req.json().catch(() => ({}));
    const ok = await checkGate(body.p1, body.p2);
    if (!ok) {
      inc("gate_fail");
      // Small fixed delay: keeps interactive retries snappy, scripted guessing slow.
      await new Promise((r) => setTimeout(r, 300));
      return NextResponse.json({ error: "手势不匹配", code: "gesture" }, { status: 401 });
    }

    // Second factor: only when the operator enrolled an authenticator.
    const totp = await totpStatus();
    if (totp.configured) {
      const check = await verifyGateTotp(body.totp);
      if (!check.ok) {
        inc("gate_fail");
        await new Promise((r) => setTimeout(r, 300));
        return NextResponse.json(
          {
            error: check.error || (check.replay ? "验证码已被使用，请等待下一个" : "动态验证码不正确"),
            code: "totp",
          },
          { status: 401 }
        );
      }
    }

    // Remembering the device is opt-in. Without it the cookie has no Max-Age,
    // so the browser drops it on exit and the next visit asks for both gestures.
    const remember = Boolean(body && body.remember === true);
    inc("gate_ok");
    const res = NextResponse.json({ ok: true, remembered: remember });
    const isHttps = (req.headers.get("x-forwarded-proto") || req.nextUrl.protocol.replace(":", "")) === "https";
    const options = adminCookieOptions(isHttps);
    if (remember) options.maxAge = rememberTtlSeconds();
    res.cookies.set(COOKIE, await createAdminToken({ remember }), options);
    return res;
  } catch (e) {
    return NextResponse.json({ error: e.message || "解锁失败" }, { status: 400 });
  }
}
