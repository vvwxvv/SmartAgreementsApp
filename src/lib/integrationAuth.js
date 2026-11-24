/** Integration bearer check (pure, testable).
 *  Timing-safe: compares equal-length buffers, never short-circuits on content.
 *  A short or missing secret disables the endpoint instead of accepting it. */
import crypto from "node:crypto";

export const MIN_INTEGRATION_SECRET_LENGTH = 24;

export function isIntegrationAuthorized(header, secret) {
  if (!secret || secret.length < MIN_INTEGRATION_SECRET_LENGTH) return false;
  const expected = "Bearer " + secret;
  const got = String(header || "");
  const a = Buffer.from(got, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
