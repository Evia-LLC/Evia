import { readFileSync } from 'node:fs';
import { afterEach, expect, it, vi } from 'vitest';
import { HEALTH_COPY, SAFETY_COPY, PHOTO_COPY, AI_COPY, COOKIE_COPY, ACCOUNT_COPY } from '../shared/legal-screen-copy.ts';
import { LEGAL_CONTENT, approvedConsent } from '../shared/legal-content.ts';
import { healthConsentApplies, REVIEW_VERSIONS } from '../shared/legal-review.ts';
import { COOKIE_LIFETIME, DEFAULT_COOKIES, normalizeCookies, parseCookieRecord, saveCookies, functionalStorageAllowed } from '../src/lib/cookie-preferences.ts';
import { recordLegalReview, guestLegalReviews } from '../src/lib/legal-review.ts';

afterEach(() => vi.unstubAllGlobals());
it.each([[2, HEALTH_COPY], [3, SAFETY_COPY], [4, PHOTO_COPY], [8, AI_COPY], [9, COOKIE_COPY], [10, ACCOUNT_COPY]])('preserves every guide §%s quote verbatim', (number, copy) => {
  const guide = readFileSync('docs/LEGAL_IMPLEMENTATION_GUIDE.md', 'utf8').split('## 3. Verbatim in-app screens')[1];
  const section = guide.split(`### ${number}.`)[1].split('### ')[0].split('\n---')[0];
  expect(Object.values(copy)).toEqual([...section.matchAll(/`([^`]+)`/g)].map(match => match[1]));
});
it('requires the health choice in WA/NV/CT and for unknown location, independently of optional choices', () => {
  for (const region of ['WA', 'NV', 'CT', 'Unknown']) expect(healthConsentApplies(region)).toBe(true);
  expect(healthConsentApplies('Other')).toBe(false);
  expect(LEGAL_CONTENT['safety-lifestyle-consent'].applicability.requirement).toBe('optional');
  expect(LEGAL_CONTENT['progress-photo-consent'].applicability.requirement).toBe('optional');
});
it('never turns a demo review into an approved processing or photo storage grant', () => {
  for (const [surface, wordingVersionId] of Object.entries(REVIEW_VERSIONS)) {
    expect(approvedConsent({ consentType: `demo_review:${surface}`, wordingVersionId, state: 'granted', recordedAt: '', decisionId: '' })).toBe(false);
  }
});
it('defaults optional categories off and honours GPC and the demo marketing prohibition', () => {
  expect(normalizeCookies({})).toEqual(DEFAULT_COOKIES);
  expect(normalizeCookies({ functional: true, analytics: true }, true)).toEqual({ necessary: true, functional: true, analytics: false, marketing: false });
});
it('rejects malformed, stale and expired preference records', () => {
  const now = Date.now();
  const record = { wordingVersionId: REVIEW_VERSIONS['cookie-preferences'], recordedAt: new Date(now).toISOString(), expiresAt: new Date(now + COOKIE_LIFETIME).toISOString(), preferences: DEFAULT_COOKIES };
  expect(parseCookieRecord(JSON.stringify(record), now)).not.toBeNull();
  expect(parseCookieRecord(JSON.stringify(record), now + COOKIE_LIFETIME)).toBeNull();
  expect(parseCookieRecord(JSON.stringify({ ...record, wordingVersionId: 'old' }), now)).toBeNull();
  expect(parseCookieRecord('{broken', now)).toBeNull();
});
it('removes functional storage on rejection and gates persistence before consent', () => {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) });
  expect(functionalStorageAllowed()).toBe(false);
  saveCookies({ functional: true });
  expect(functionalStorageAllowed()).toBe(true);
  values.set('elohim.sound', '1'); values.set('elohim.intro.seen', '1');
  saveCookies(DEFAULT_COOKIES);
  expect(functionalStorageAllowed()).toBe(false);
  expect(values.has('elohim.sound')).toBe(false);
  expect(values.has('elohim.intro.seen')).toBe(false);
});
it('keeps guest refusals and skips as temporary evidence without account or provider calls', async () => {
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  await recordLegalReview('safety-lifestyle-consent', 'skipped');
  await recordLegalReview('progress-photo-consent', 'declined');
  expect(fetch).not.toHaveBeenCalled();
  expect(guestLegalReviews.at(-1)).toMatchObject({ accountId: null, choice: 'declined', approved: false, demoOnly: true });
  expect(guestLegalReviews.at(-2)).toMatchObject({ choice: 'skipped' });
});

it('keeps a choice effective in this tab when reads succeed but persistence is blocked', () => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => { throw new Error('Quota exceeded'); }, removeItem: () => {} });
  const result = saveCookies({ functional: true });
  expect(result.persisted).toBe(false);
  expect(functionalStorageAllowed()).toBe(true);
  saveCookies(DEFAULT_COOKIES);
  expect(functionalStorageAllowed()).toBe(false);
});
