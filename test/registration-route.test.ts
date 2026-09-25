import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import express from 'express';
import { createServer, type Server } from 'node:http';
import { AGE_FLOW_COPY, REGISTRATION_TERMS_VERSION } from '../shared/age-flow.ts';
const mocks = vi.hoisted(() => ({ createUser: vi.fn(), createSession: vi.fn(), getUserSummary: vi.fn(), log: vi.fn() }));
vi.mock('../server/db/users.ts', () => mocks);
vi.mock('../server/lib/log.ts', () => ({ log: { info: mocks.log } }));
vi.mock('../server/lib/rate-limit.ts', () => ({ loginLimiter: (_req: unknown, _res: unknown, next: () => void) => next(), registerLimiter: (_req: unknown, _res: unknown, next: () => void) => next() }));
const { authRouter } = await import('../server/routes/auth.ts');
let server: Server; let base: string;
beforeAll(async () => {
  const app = express(); app.use(express.json()); app.use(authRouter); server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('no listener');
  base = `http://127.0.0.1:${address.port}`;
});
afterAll(async () => { await new Promise<void>(resolve => server.close(() => resolve())); });
beforeEach(() => {
  vi.stubEnv('EVIA_SAMPLE_DEMO', '1'); vi.clearAllMocks(); mocks.createUser.mockResolvedValue('sample-id');
  mocks.createSession.mockResolvedValue('sample-token'); mocks.getUserSummary.mockResolvedValue({ id: 'sample-id' });
});
afterEach(() => vi.unstubAllEnvs());
const post = (body: unknown) => fetch(base + '/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
function dobAtAge(age: number) { const date = new Date(); date.setUTCFullYear(date.getUTCFullYear() - age); return date.toISOString().slice(0, 10); }
const adult = () => ({ email: 'adult@example.test', password: 'sample-password', displayName: 'Sample', dateOfBirth: dobAtAge(25), termsAccepted: true, termsVersion: REGISTRATION_TERMS_VERSION });
it('blocks under-16 attempts without creating accounts, sessions or logging their data', async () => {
  const response = await post({ ...adult(), dateOfBirth: dobAtAge(15) });
  expect(response.status).toBe(403); expect((await response.json()).error).toBe(AGE_FLOW_COPY.under16);
  expect(mocks.createUser).not.toHaveBeenCalled(); expect(mocks.createSession).not.toHaveBeenCalled(); expect(mocks.log).not.toHaveBeenCalled();
});
it.each([16, 17])('does not create an ordinary account for a %s-year-old', async age => {
  const response = await post({ ...adult(), dateOfBirth: dobAtAge(age) });
  expect(response.status).toBe(403); expect((await response.json()).guardianRequired).toBe(true); expect(mocks.createUser).not.toHaveBeenCalled();
});
it.each([{ dateOfBirth: 'bad' }, { termsAccepted: false }, { termsVersion: 'old' }])('rejects missing or stale registration evidence: %s', async override => {
  expect((await post({ ...adult(), ...override })).status).toBe(400); expect(mocks.createUser).not.toHaveBeenCalled();
});
it('does not treat draft Terms as production approval', async () => {
  vi.stubEnv('EVIA_SAMPLE_DEMO', '0'); expect((await post(adult())).status).toBe(403); expect(mocks.createUser).not.toHaveBeenCalled();
});
it('passes self-declared DOB into atomic sample registration after a separate Terms choice', async () => {
  const request = adult(); const response = await post(request); expect(response.status).toBe(200);
  expect(response.headers.get('set-cookie')).toContain('HttpOnly; SameSite=Strict');
  expect(response.headers.get('set-cookie')).not.toMatch(/max-age|expires/i);
  expect(mocks.createUser).toHaveBeenCalledWith(request.email, request.password, request.displayName, expect.objectContaining({ dateOfBirth: request.dateOfBirth }));
});
