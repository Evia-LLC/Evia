import { REVIEW_VERSIONS } from '../../shared/legal-review.ts';
export const COOKIE_STORAGE_KEY = 'evia.cookie-preferences';
export const COOKIE_LIFETIME = 365 * 24 * 60 * 60 * 1000;
export interface CookiePreferences { necessary: true; functional: boolean; analytics: boolean; marketing: false; }
export interface CookieRecord { wordingVersionId: string; recordedAt: string; expiresAt: string; preferences: CookiePreferences; }
export const DEFAULT_COOKIES: CookiePreferences = { necessary: true, functional: false, analytics: false, marketing: false };
export function normalizeCookies(input: Partial<CookiePreferences>, gpc = false): CookiePreferences {
  // No marketing is enabled in this demo, including for unverified or minor accounts.
  return { necessary: true, functional: input.functional === true, analytics: !gpc && input.analytics === true, marketing: false };
}
export function parseCookieRecord(raw: string | null, now = Date.now()): CookieRecord | null {
  try {
    const value = JSON.parse(raw ?? 'null');
    if (!value || value.wordingVersionId !== REVIEW_VERSIONS['cookie-preferences'] ||
      !Number.isFinite(Date.parse(value.recordedAt)) || Date.parse(value.recordedAt) > now ||
      !Number.isFinite(Date.parse(value.expiresAt)) || Date.parse(value.expiresAt) <= now ||
      Date.parse(value.expiresAt) - Date.parse(value.recordedAt) > COOKIE_LIFETIME ||
      typeof value.preferences?.functional !== 'boolean' || typeof value.preferences?.analytics !== 'boolean') return null;
    return { ...value, preferences: normalizeCookies(value.preferences) };
  } catch { return null; }
}
let memory: CookieRecord | null = null;
let memoryOnly = false;
export function globalPrivacyControl(): boolean {
  return typeof navigator !== 'undefined' && (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl === true;
}
export function readCookies(): CookieRecord | null {
  if (memoryOnly) return memory && parseCookieRecord(JSON.stringify(memory));
  try {
    const record = parseCookieRecord(localStorage.getItem(COOKIE_STORAGE_KEY));
    if (!record) localStorage.removeItem(COOKIE_STORAGE_KEY);
    if (!record?.preferences.functional) {
      localStorage.removeItem('elohim.intro.seen'); localStorage.removeItem('elohim.sound');
    }
    return record;
  }
  catch { return memory && parseCookieRecord(JSON.stringify(memory)); }
}
export function functionalStorageAllowed(): boolean { return readCookies()?.preferences.functional === true; }
export function saveCookies(input: Partial<CookiePreferences>): { record: CookieRecord; persisted: boolean } {
  const now = Date.now();
  const record: CookieRecord = { wordingVersionId: REVIEW_VERSIONS['cookie-preferences'], recordedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + COOKIE_LIFETIME).toISOString(), preferences: normalizeCookies(input, globalPrivacyControl()) };
  memory = record;
  memoryOnly = true;
  let persisted = false;
  try {
    localStorage.setItem(COOKIE_STORAGE_KEY, JSON.stringify(record));
    persisted = true;
    memoryOnly = false;
    if (!record.preferences.functional) {
      localStorage.removeItem('elohim.intro.seen'); localStorage.removeItem('elohim.sound');
    }
  } catch { /* The choice remains available in memory if browser storage is blocked. */ }
  return { record, persisted };
}
export function openCookieSettings() { window.dispatchEvent(new Event('evia-cookie-settings')); }
