import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import express from 'express';
import { createServer, type Server } from 'node:http';
import { LEGAL_CONTENT } from '../shared/legal-content.ts';

const { currentConsent, recordConsentDecision, analyseWithPerfectCorp } = vi.hoisted(() => ({
  currentConsent: vi.fn(), recordConsentDecision: vi.fn(), analyseWithPerfectCorp: vi.fn(),
}));
vi.mock('../server/db/consents.ts', () => ({ currentConsent, recordConsentDecision }));
vi.mock('../server/routes/auth.ts', () => ({ requireAuth: (req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (req.headers['x-test-account'] !== 'sample') { res.status(401).json({ error: 'Sign in' }); return; }
  req.userId = 'sample-account'; next();
} }));
vi.mock('../server/lib/rate-limit.ts', () => ({ scanLimiter: (_req: express.Request, _res: express.Response, next: express.NextFunction) => next() }));
vi.mock('../server/ai/perfectcorp.ts', async importOriginal => ({ ...await importOriginal<object>(), analyseWithPerfectCorp }));
const { analysisRouter } = await import('../server/routes/analysis.ts');
const version = LEGAL_CONTENT['facial-scan-consent'].wordingVersionId;
let server: Server; let base: string;
beforeAll(async () => {
  const app = express(); app.use(express.json()); app.use(analysisRouter);
  server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('No port');
  base = `http://127.0.0.1:${address.port}`;
});
afterAll(async () => { await new Promise<void>(resolve => server.close(() => resolve())); });
beforeEach(() => {
  vi.stubEnv('EVIA_SAMPLE_DEMO', '1'); vi.stubEnv('PERFECTCORP_API_KEY', 'test'); vi.stubEnv('ANALYSIS_PROVIDER', 'perfectcorp');
  currentConsent.mockReset().mockResolvedValue({ state: 'granted', wordingVersionId: version });
  recordConsentDecision.mockReset().mockImplementation(async (_user, consentType, wordingVersionId, state, metadata) => ({ consentType, wordingVersionId, state, metadata }));
  analyseWithPerfectCorp.mockReset().mockResolvedValue({ hydration: 60 });
});
afterEach(() => vi.unstubAllEnvs());
const post = (path: string, body: unknown, account = true) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(account ? { 'x-test-account': 'sample' } : {}) }, body: JSON.stringify(body) });
const payload = { imageBase64: Buffer.from([255, 216, 255, 217]).toString('base64') };

it('requires an authenticated account before accepting an upload', async () => {
  expect((await post('/face', payload, false)).status).toBe(401); expect(analyseWithPerfectCorp).not.toHaveBeenCalled();
});
it.each([null, { state: 'withdrawn', wordingVersionId: version }, { state: 'granted', wordingVersionId: 'old' }])('blocks absent, declined or stale consent before vendor egress: %s', async consent => {
  currentConsent.mockResolvedValue(consent);
  expect((await post('/face', payload)).status).toBe(403); expect(analyseWithPerfectCorp).not.toHaveBeenCalled();
});
it('does not allow demo decisions to authorize production processing', async () => {
  vi.stubEnv('EVIA_SAMPLE_DEMO', '0');
  expect((await post('/face', payload)).status).toBe(403); expect(analyseWithPerfectCorp).not.toHaveBeenCalled();
  expect((await post('/consent', { choice: 'accepted', wordingVersionId: version, idempotencyKey: 'a' })).status).toBe(403);
});
it.each(['accepted', 'declined'])('records %s with account, actor, wording, choice, source and demo status', async choice => {
  const response = await post('/consent', { choice, wordingVersionId: version, idempotencyKey: 'action-1' });
  expect(response.status).toBe(201); expect((await response.json()).productionApproved).toBe(false);
  expect(recordConsentDecision).toHaveBeenCalledWith('sample-account', 'facial_scan', version,
    choice === 'accepted' ? 'granted' : 'withdrawn', expect.objectContaining({ actorId: 'sample-account', choice, demoOnly: true, source: 'facial-scan-screen', idempotencyKey: 'action-1' }));
});
it('does not accept client supplied guardian approval or obsolete wording', async () => {
  expect((await post('/consent', { choice: 'accepted', wordingVersionId: 'old', idempotencyKey: 'a', guardianApproved: true })).status).toBe(400);
  expect(recordConsentDecision).not.toHaveBeenCalled();
});
it.each(['local', 'missing-key'])('degrades without calling the provider: %s', async reason => {
  if (reason === 'local') vi.stubEnv('ANALYSIS_PROVIDER', 'local'); else vi.stubEnv('PERFECTCORP_API_KEY', '');
  const response = await post('/face', payload); expect((await response.json()).provider).toBe('local');
  expect(analyseWithPerfectCorp).not.toHaveBeenCalled();
});
it('returns provider provenance, no image bytes, and erases the transient buffer', async () => {
  const response = await post('/face', payload); const result = await response.json();
  expect(result.modelVersion).toBe('perfectcorp-v2.1'); expect(result).not.toHaveProperty('imageBase64');
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect([...analyseWithPerfectCorp.mock.calls[0][0]]).toEqual([0, 0, 0, 0]);
});
it('returns a sanitised fallback and erases memory on provider failure', async () => {
  analyseWithPerfectCorp.mockRejectedValue(new Error('secret image URL'));
  const response = await post('/face', payload); expect(await response.json()).toEqual({ provider: 'local', reason: 'provider_error' });
  expect([...analyseWithPerfectCorp.mock.calls[0][0]]).toEqual([0, 0, 0, 0]);
});
it('rejects invalid image bytes before upload', async () => {
  expect((await post('/face', { imageBase64: 'bm90IGEganBlZw==' })).status).toBe(400);
  expect(analyseWithPerfectCorp).not.toHaveBeenCalled();
});

it('records guardian review evidence with server identity/IP and rejects fabricated approval fields', async () => {
  const { AGE_FLOW_VERSION } = await import('../shared/age-flow.ts');
  const response = await post('/onboarding-choice', { action: 'guardian_approve', choice: 'attempted',
    wordingVersionId: AGE_FLOW_VERSION, idempotencyKey: 'guardian-attempt',
    guardian: { name: 'Sample Guardian', email: 'guardian@example.test', relationship: true, cardType: 'credit', illinois: true,
      approved: true, verificationResult: 'verified', last4: '1234', fingerprintToken: 'fake' } });
  expect(response.status).toBe(201);
  expect(await response.json()).toMatchObject({ approved: false, record: { approved: false, cameraUnlocked: false,
    accountId: 'sample-account', verificationResult: 'not_verified', illinoisIdResult: 'not_verified', last4: null, fingerprintToken: null } });
  expect(recordConsentDecision.mock.calls[0][4].record.ipAddress).toBeTruthy();
});

it('records versioned legal review evidence without allowing forged processing approval', async () => {
  const { REVIEW_VERSIONS } = await import('../shared/legal-review.ts');
  const response = await post('/legal-review', { surface: 'health-consent', choice: 'declined',
    wordingVersionId: REVIEW_VERSIONS['health-consent'], jurisdiction: 'WA', idempotencyKey: 'health-review',
    approved: true, actorId: 'another-account', demoOnly: false });
  expect(response.status).toBe(201);
  expect(await response.json()).toMatchObject({ approved: false });
  expect(recordConsentDecision).toHaveBeenCalledWith('sample-account', 'demo_review:health-consent', REVIEW_VERSIONS['health-consent'], 'withdrawn',
    expect.objectContaining({ actorId: 'sample-account', choice: 'declined', jurisdiction: 'WA', demoOnly: true, approved: false }));
});
it('rejects unauthenticated, stale and production legal reviews without writing evidence', async () => {
  const { REVIEW_VERSIONS } = await import('../shared/legal-review.ts');
  const body = { surface: 'progress-photo-consent', choice: 'accepted', wordingVersionId: REVIEW_VERSIONS['progress-photo-consent'], idempotencyKey: 'photo-review' };
  expect((await post('/legal-review', body, false)).status).toBe(401);
  expect((await post('/legal-review', { ...body, wordingVersionId: 'obsolete' })).status).toBe(400);
  vi.stubEnv('EVIA_SAMPLE_DEMO', '0');
  expect((await post('/legal-review', body)).status).toBe(403);
  expect(recordConsentDecision).not.toHaveBeenCalled();
});
it('never records marketing as enabled from forged cookie preferences', async () => {
  const { REVIEW_VERSIONS } = await import('../shared/legal-review.ts');
  const response = await post('/legal-review', { surface: 'cookie-preferences', choice: 'saved', wordingVersionId: REVIEW_VERSIONS['cookie-preferences'],
    idempotencyKey: 'cookies', preferences: { functional: true, analytics: false, marketing: true, faceImage: 'forged' } });
  expect(response.status).toBe(201);
  expect(recordConsentDecision.mock.calls[0][4].preferences).toEqual({ necessary: true, functional: true, analytics: false, marketing: false });
});
