/** Expiry helpers (pure). */
export const EXPIRY_SOON_DAYS = 30;

/** @returns {{ state: "none"|"ok"|"soon"|"expired", days: number|null }} */
export function expiryState(expiresAt, now = new Date()) {
  if (!expiresAt) return { state: "none", days: null };
  const end = new Date(expiresAt).getTime();
  if (!Number.isFinite(end)) return { state: "none", days: null };
  const days = Math.ceil((end - now.getTime()) / 86400000);
  if (days < 0) return { state: "expired", days };
  if (days <= EXPIRY_SOON_DAYS) return { state: "soon", days };
  return { state: "ok", days };
}
