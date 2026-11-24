/**
 * Production boot requirements as a pure function, so they can be tested and
 * reused outside Next's instrumentation hook.
 *
 * Demo/E2E runs (ALLOW_LOCAL_IN_PRODUCTION=1) are intentionally exempt from the
 * HTTPS/link-key rules: they are documented as non-production. Everything else
 * must fail closed — a server that can accept contracts but cannot issue
 * encrypted links is worse than one that refuses to start.
 */
import { createEvidenceSigner } from "../../packages/agreement/src/core/evidenceSign.js";

export const MIN_LINK_KEY_LENGTH = 32;

export function productionProblems(env = process.env) {
  const demo = String(env.ALLOW_LOCAL_IN_PRODUCTION || "").trim() === "1";
  const problems = [];

  if (!env.JWT_SECRET) problems.push("JWT_SECRET 未设置");
  if (!env.ADMIN_SESSION_SECRET) problems.push("ADMIN_SESSION_SECRET 未设置");

  const linkKey = String(env.AGREEMENT_LINK_KEY || "");
  if (linkKey.length < MIN_LINK_KEY_LENGTH) {
    problems.push("AGREEMENT_LINK_KEY 未设置或少于 " + MIN_LINK_KEY_LENGTH + " 字符");
  }

  // A malformed previous key is skipped at read time, which would silently
  // shrink the rotation window. Refuse to start instead of pretending it works.
  const previous = String(env.AGREEMENT_LINK_KEYS_PREVIOUS || "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
  for (const key of previous) {
    if (key.length < MIN_LINK_KEY_LENGTH) {
      problems.push("AGREEMENT_LINK_KEYS_PREVIOUS 含过短密钥（每项至少 " + MIN_LINK_KEY_LENGTH + " 字符）");
      break;
    }
  }

  // The public-URL rules only apply once the operator declares the deployment
  // public. An internal/staging host may legitimately use http on a private
  // address; sending real links from it is their call, not a silent default.
  // Demo mode relaxes only the public-URL rule (e2e serves on localhost); the
  // link key is still mandatory — without it no contract can be sent at all.
  if (!demo && String(env.AGREEMENT_PUBLIC || "").trim() === "1") {
    const base = String(env.AGREEMENT_BASE_URL || "");
    if (!base) problems.push("AGREEMENT_PUBLIC=1 但 AGREEMENT_BASE_URL 未设置");
    else if (!/^https:\/\//i.test(base)) problems.push("AGREEMENT_PUBLIC=1 要求 AGREEMENT_BASE_URL 使用 https");
    else if (/localhost|127\.0\.0\.1|\[::1\]/i.test(base)) problems.push("AGREEMENT_PUBLIC=1 但 AGREEMENT_BASE_URL 仍指向 localhost");
  }

  // Evidence signing is optional, but a *configured* key that does not parse is
  // a silent downgrade to unsigned evidence — refuse to start instead.
  const evidenceKey = String(env.AGREEMENT_EVIDENCE_PRIVATE_KEY || "").trim();
  if (evidenceKey) {
    const signer = createEvidenceSigner({ privateKey: evidenceKey });
    if (!signer.enabled) problems.push("AGREEMENT_EVIDENCE_PRIVATE_KEY 无法解析（需要 PKCS#8/PEM 或 32 字节 seed）");
  } else if (String(env.AGREEMENT_REQUIRE_EVIDENCE_SIG || "").trim() === "1") {
    problems.push("AGREEMENT_REQUIRE_EVIDENCE_SIG=1 但 AGREEMENT_EVIDENCE_PRIVATE_KEY 未设置");
  }

  if (String(env.RATE_LIMIT_DISABLED || "").trim() === "1") {
    problems.push("RATE_LIMIT_DISABLED 不允许在生产启用");
  }

  return problems;
}
