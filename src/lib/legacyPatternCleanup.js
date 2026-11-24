/** Remove pattern material older builds may have left in localStorage.
 *  The client never holds or verifies the pattern any more; this only clears
 *  what an earlier version stored. Safe to call repeatedly. */
const LEGACY_KEYS = ["pattern_auth", "pattern_session"];

export function clearLegacyPatternStorage() {
  if (typeof window === "undefined") return false;
  let removed = false;
  for (const key of LEGACY_KEYS) {
    try {
      if (window.localStorage.getItem(key) !== null) {
        window.localStorage.removeItem(key);
        removed = true;
      }
    } catch { /* storage blocked (private mode) */ }
  }
  return removed;
}
