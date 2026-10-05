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
/**
 * Clears the Functional category's browser storage: main's intro and room-sound
 * keys, and (merge with evia-visual-rebuild) the sample-data choice, the
 * character-prototype switch and the Saved product lists, which are gated the
 * same way (src/sample/mode.svelte.ts, src/character3d/switch.svelte.ts,
 * src/products/saved.svelte.ts). Throws only if storage does.
 */
export const FUNCTIONAL_KEYS = ['elohim.intro.seen', 'elohim.sound', 'evia.sample', 'evia.character.proto'] as const;
export const FUNCTIONAL_PREFIXES = ['evia.products.saved'] as const;
function clearFunctionalStorage(): void {
  for (const key of FUNCTIONAL_KEYS) localStorage.removeItem(key);
  const count = typeof localStorage.length === 'number' ? localStorage.length : 0;
  for (let i = count - 1; i >= 0; i--) {
    const key = localStorage.key(i);
    if (key && FUNCTIONAL_PREFIXES.some((prefix) => key === prefix || key.startsWith(`${prefix}.`))) localStorage.removeItem(key);
  }
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
      clearFunctionalStorage();
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
      clearFunctionalStorage();
    }
  } catch { /* The choice remains available in memory if browser storage is blocked. */ }
  return { record, persisted };
}
export function openCookieSettings() { window.dispatchEvent(new Event('evia-cookie-settings')); }
