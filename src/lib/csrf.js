/** Same-origin check for state-changing requests (pure). */
export function isForeignOrigin(origin, host, secFetchSite) {
  if (origin === "null") return true;
  if (!origin) return String(secFetchSite || "").toLowerCase() === "cross-site";
  try {
    return new URL(origin).host !== host;
  } catch {
    return true;
  }
}
