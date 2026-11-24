/** Deployment sanity helpers. */

export function baseUrlConfigured() {
  return process.env.AGREEMENT_BASE_URL || "";
}

/** True when the app is meant to be reachable by other people. */
export function isPublicDeployment() {
  if (process.env.AGREEMENT_PUBLIC === "1") return true;
  const u = baseUrlConfigured();
  if (!u) return false;
  return !/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?/i.test(u);
}
