/** Signing deadline vs contract term (pure). */
export const DEFAULT_SIGN_DAYS = 14;
export const MAX_SIGN_DAYS = 30;
export const TERM_SOON_DAYS = 30;
// Keep a hard cap on total link lifetime (measured from the first send), so a
// leaked invite cannot be kept alive forever by repeatedly extending it.
export const MAX_LINK_LIFETIME_DAYS = 30;

/** Normalise the signing deadline: default 14d, never beyond 30d from now. */
export function normalizeSignDeadline(input, now = new Date()) {
  if (!input) return new Date(now.getTime() + DEFAULT_SIGN_DAYS * 86400000);
  const d = new Date(input);
  if (!Number.isFinite(d.getTime())) return { error: "签署截止时间无效" };
  if (d.getTime() <= now.getTime()) return { error: "签署截止时间必须晚于现在" };
  const max = now.getTime() + MAX_SIGN_DAYS * 86400000;
  if (d.getTime() > max) return { error: "签署截止最多 " + MAX_SIGN_DAYS + " 天" };
  return d;
}

/** Extension: 30 days from now AND never beyond the total link lifetime
 *  (measured from the first send), so repeated extensions cannot keep a v1
 *  link alive past the v2 dual-read window. */
export function normalizeExtension(input, { sentAt, now = new Date() } = {}) {
  const base = normalizeSignDeadline(input, now);
  if (base && base.error) return base;
  if (sentAt) {
    const hard = new Date(sentAt).getTime() + MAX_LINK_LIFETIME_DAYS * 86400000;
    if (base.getTime() > hard) {
      return { error: "链接总有效期最多 " + MAX_LINK_LIFETIME_DAYS + " 天（自首次发送起）" };
    }
  }
  return base;
}

const SHANGHAI_OFFSET_MS = 8 * 3600 * 1000;

/** Calendar parts in Asia/Shanghai (no DST, fixed +08:00). */
export function shanghaiParts(date) {
  const d = new Date(date);
  const shifted = new Date(d.getTime() + SHANGHAI_OFFSET_MS);
  return { y: shifted.getUTCFullYear(), m: shifted.getUTCMonth() + 1, d: shifted.getUTCDate() };
}

/** Midnight (00:00) Shanghai on the given calendar day, as an instant. */
export function shanghaiMidnight(y, m, d) {
  return new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0) - SHANGHAI_OFFSET_MS);
}

/** Add months in Shanghai, clamping to the last day of the target month, and
 *  return the END of that day (inclusive) so "valid through termEnd" holds. */
export function addMonthsEndOfDayShanghai(base, months) {
  const { y, m, d } = shanghaiParts(base);
  const total = m - 1 + Number(months);
  const ny = y + Math.floor(total / 12);
  const nm = ((total % 12) + 12) % 12 + 1;
  const lastDay = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  const nd = Math.min(d, lastDay);
  return new Date(shanghaiMidnight(ny, nm, nd).getTime() + 86400000 - 1);
}

/** Contract term end: explicit date wins, otherwise termMonths from the
 *  effective date (defaults to the completion date). Null when no term. */
export function computeTermEnd({ termMonths, termEnd, effectiveAt, completedAt } = {}) {
  if (termEnd) {
    const d = new Date(termEnd);
    return Number.isFinite(d.getTime()) ? d : null;
  }
  const months = Number(termMonths);
  if (!Number.isFinite(months) || months <= 0) return null;
  const base = new Date(effectiveAt || completedAt || Date.now());
  if (!Number.isFinite(base.getTime())) return null;
  return addMonthsEndOfDayShanghai(base, months);
}

/** Only completed contracts have a meaningful term state. */
export function termState({ status, termEnd, renewalStatus, renewalDeadline, now = new Date() } = {}) {
  if (status !== "COMPLETED") return { state: "n/a", days: null };
  if (!termEnd) return { state: renewalStatus === "renewed" ? "renewed" : "none", days: null };
  const end = new Date(termEnd).getTime();
  if (!Number.isFinite(end)) return { state: "none", days: null };
  const days = Math.ceil((end - now.getTime()) / 86400000);
  if (renewalStatus === "renewed") return { state: "renewed", days };
  const base = days < 0 ? "expired" : days <= TERM_SOON_DAYS ? "soon" : "ok";
  // A renewal that is still in progress keeps its reminder; if its own signing
  // deadline has passed, surface that so the operator can renew again.
  if (renewalStatus === "renewing") {
    const rd = renewalDeadline ? new Date(renewalDeadline).getTime() : null;
    if (rd && rd < now.getTime()) return { state: "renewal-expired", days };
    return { state: "renewing", days };
  }
  return { state: base, days };
}
