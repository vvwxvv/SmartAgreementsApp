import { NextResponse } from "next/server";
import { verifyByCert } from "@/agreement/service";
import { rateLimit, clientIp, tooManyResponse } from "@/lib/rateLimit";
import { inc } from "@/lib/observability";

function maskEmail(value) {
  const s = String(value || "");
  const at = s.indexOf("@");
  if (at < 1) return s ? s[0] + "***" : null;
  return s[0] + "***" + s.slice(at);
}

function publicEvidence(e) {
  if (!e || !e.signer) return e;
  return { ...e, signer: { ...e.signer, email: maskEmail(e.signer.email) } };
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Recompute a signature's evidence record and compare it with the stored hash.
 *   GET /api/verify/signature?number=AGR-2026-0018&cert=CERT-9DA17A541776ABCD
 * The cert code acts as the bearer token for that one record, so details are
 * only returned when it matches.
 */
export async function GET(req) {
  const gate = rateLimit({ key: "verify-sig:" + clientIp(req), limit: 60, windowMs: 60_000 });
  if (!gate.ok) return tooManyResponse(gate.retryAfter);

  const url = new URL(req.url);
  const number = url.searchParams.get("number") || "";
  const cert = url.searchParams.get("cert") || "";
  const out = await verifyByCert(number, cert).catch(() => ({ found: false }));

  if (!out.found) {
    inc("verify_fail");
    return NextResponse.json({ found: false, error: "没有找到匹配的签署记录" }, { status: 404 });
  }
  if (!out.certOk) {
    // Still return the record so the mismatch is inspectable, not mysterious.
    return NextResponse.json(
      {
        found: true,
        verified: false,
        error: "证书编号与重算摘要不匹配：记录可能被改动过",
        agreementNumber: out.agreementNumber,
        agreementStatus: out.agreementStatus,
        title: out.title,
        evidence: publicEvidence(out.evidence),
        computed: out.computed,
        stored: out.stored,
        tsa: out.tsa || null,
        legacy: out.legacy,
        hashV: out.hashV,
        completionMatch: out.completionMatch,
        completionSealed: out.completionSealed,
        evidenceSignature: out.evidenceSignature || null,
        completionSignature: out.completionSignature || null,
        evidenceKey: out.evidenceKey || null,
        eventChain: out.eventChain || null,
      },
      { status: 200, headers: { "Cache-Control": "no-store" } }
    );
  }

  inc("verify_ok");
  return NextResponse.json(
    {
      found: true,
      // `out.match` only covers the signature digest. The verdict must also
      // include the content fingerprint, or a tampered body reads as "valid".
      verified: out.verified,
      match: out.match,
      contentMatch: out.contentMatch,
      termEndMatch: out.termEndMatch,
      agreementNumber: out.agreementNumber,
      agreementStatus: out.agreementStatus,
      title: out.title,
      evidence: publicEvidence(out.evidence),
      computed: out.computed,
      stored: out.stored,
      tsa: out.tsa || null,
      legacy: out.legacy,
      hashV: out.hashV,
      completionMatch: out.completionMatch,
      completionSealed: out.completionSealed,
      evidenceSignature: out.evidenceSignature || null,
      completionSignature: out.completionSignature || null,
      evidenceKey: out.evidenceKey || null,
      eventChain: out.eventChain || null,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
