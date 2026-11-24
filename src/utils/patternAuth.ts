// src/utils/PatternAuth.ts  (or .js if you use plain JS)
import { EXPECTED_PATTERN } from '@/utils/patternPassword'; // << single source of truth

export class PatternAuth {
  private static readonly STORAGE_KEY  = 'pattern_auth';
  private static readonly SESSION_KEY  = 'pattern_session';
  private static readonly SESSION_DURATION = 30 * 60 * 1000; // 30 min

  /* --------------  pattern  -------------- */
  static savePattern(pattern: number[]): void {
    if (typeof window === 'undefined') return;
    localStorage.setItem(this.STORAGE_KEY, JSON.stringify(pattern));
  }

  static getPattern(): number[] | null {
    // The client never stores or derives the pattern; the server verifies it.
    return null;
  }

  static validatePattern(_input: number[]): boolean {
    // No client-side fallback. Only /api/auth/pattern can approve a pattern;
    // a 503 from that endpoint must fail closed, not fall back to a constant.
    return false;
  }

  static clearPattern(): void {
    if (typeof window === 'undefined') return;
    localStorage.removeItem(this.STORAGE_KEY);
    console.log('Pattern cleared from LS');
  }

  static generateSecurePattern(length = 6): number[] {
    const pool = [1, 2, 3, 4, 5, 6, 7, 8, 9];
    const shuffled = pool.sort(() => Math.random() - 0.5);
    return shuffled.slice(0, length);
  }

  /* --------------  session  -------------- */
  static setSession(): void {
    if (typeof window === 'undefined') return;
    const exp = Date.now() + this.SESSION_DURATION;
    localStorage.setItem(this.SESSION_KEY, String(exp));
    console.log('Session set, expires:', new Date(exp).toLocaleString());
  }

  static isSessionValid(): boolean {
    if (typeof window === 'undefined') return false;
    const exp = Number(localStorage.getItem(this.SESSION_KEY) || '0');
    const ok = Date.now() < exp;
    console.log('Session valid:', ok, 'Expiry:', new Date(exp).toLocaleString());
    return ok;
  }

  static clearSession(): void {
    if (typeof window === 'undefined') return;
    localStorage.removeItem(this.SESSION_KEY);
    console.log('Session cleared');
  }

  static getSessionTimeRemaining(): number {
    if (typeof window === 'undefined') return 0;
    const exp = Number(localStorage.getItem(this.SESSION_KEY) || '0');
    return Math.max(0, exp - Date.now());
  }

  static getSessionExpiry(): number | null {
    if (typeof window === 'undefined') return null;
    const exp = Number(localStorage.getItem(this.SESSION_KEY) || '0');
    return exp || null;
  }
}