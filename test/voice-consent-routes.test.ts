import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IncomingMessage, ServerResponse } from 'node:http';
import { Socket } from 'node:net';

const state = vi.hoisted(() => ({
  consent: false, guestAllowed: true, speak: vi.fn(), setConsent: vi.fn(), logError: vi.fn(),
}));
// This integration test must neither load a real key nor use a real database.
vi.mock('../server/lib/env.ts', () => ({}));
vi.mock('../server/db/index.ts', () => ({ migrate: vi.fn(), row: vi.fn(), rows: vi.fn(), run: vi.fn() }));
vi.mock('../server/db/users.ts', () => ({
  getConsents: vi.fn(async () => ({ cloud_reasoning: state.consent, image_storage: false })),
  setConsent: state.setConsent,
  userIdForSession: vi.fn(async (token: string) => token === 'test-session' ? 'test-user' : null),
  sweepExpiredSessions: vi.fn(),
}));
vi.mock('../server/voice/tts.ts', () => ({
  speakLine: state.speak, clonedVoiceAvailable: () => true, guestVoiceAllowed: () => state.guestAllowed,
  VoiceUnavailable: class VoiceUnavailable extends Error {},
}));
vi.mock('../server/ai/claude.ts', () => ({
  modelAvailable: () => false, MODEL: 'test-model', describeSkinImage: vi.fn(), readProductLabel: vi.fn(),
  describeApiError: () => 'Provider unavailable',
}));
vi.mock('../server/ai/orchestrator.ts', () => ({ handleTurn: vi.fn(), handleEvent: vi.fn() }));
vi.mock('../server/ai/budget.ts', () => ({ todaySummary: vi.fn() }));
vi.mock('../server/demo/seed.ts', () => ({ seedDemoUser: vi.fn() }));
vi.mock('../server/lib/log.ts', () => ({ log: { error: state.logError, warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }));
vi.mock('../server/lib/rate-limit.ts', () => {
  const pass = (_req: unknown, _res: unknown, next: () => void) => next();
  return { rateLimit: () => pass, guestVoiceLimiter: pass, voiceLimiter: pass, loginLimiter: pass, registerLimiter: pass,
    chatLimiter: pass, scanLimiter: pass, visionLimiter: pass };
});

const { app } = await import('../server/app.ts');
beforeEach(() => {
  state.consent = false; state.guestAllowed = true; state.speak.mockReset(); state.setConsent.mockClear(); state.logError.mockClear();
  state.speak.mockResolvedValue({ audio: Buffer.from('audio'), contentType: 'audio/wav', words: [], duration: 1, cached: false, chunks: [] });
});
async function post(path: string, body: unknown, authenticated = true, method = 'POST') {
  // Dispatch actual Express middleware with Node request/response objects,
  // without binding a socket or making any network request.
  return new Promise<{ status: number; body: any }>((resolve, reject) => {
    const req = new IncomingMessage(new Socket());
    const payload = JSON.stringify(body);
    req.method = method; req.url = path;
    req.headers = { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(payload)),
      ...(authenticated ? { authorization: 'Bearer test-session' } : {}) };
    const res = new ServerResponse(req);
    res.end = ((chunk: string | Buffer) => {
      resolve({ status: res.statusCode, body: JSON.parse(String(chunk)) });
      return res;
    }) as typeof res.end;
    app(req, res);
    req.on('error', reject); req.push(payload); req.push(null);
  });
}

describe('voice HTTP consent and errors', () => {
  it('requires authentication for account speech', async () => {
    const result = await post('/api/voice/speak', { text: 'Hello' }, false);
    expect(result.status).toBe(401); expect(state.speak).not.toHaveBeenCalled();
  });
  it('requires stored cloud consent before account text reaches speech', async () => {
    const result = await post('/api/voice/speak', { text: 'Private reply', cloud_reasoning: true });
    expect(result.status).toBe(403); expect(state.speak).not.toHaveBeenCalled();
    expect(result.body.error).toContain('OpenAI'); expect(result.body.error).not.toMatch(/cloned|browser/i);
  });
  it('rechecks account consent on every request', async () => {
    state.consent = true;
    expect((await post('/api/voice/speak', { text: 'Allowed reply' })).status).toBe(200);
    state.consent = false;
    expect((await post('/api/voice/speak', { text: 'After withdrawal' })).status).toBe(403);
    expect(state.speak).toHaveBeenCalledTimes(1);
  });
  it('redacts arbitrary provider errors on the account route and in its log', async () => {
    state.consent = true; state.speak.mockRejectedValueOnce(new Error('private upstream body with test-secret'));
    const result = await post('/api/voice/speak', { text: 'Personal reply' });
    expect(result.status).toBe(502); expect(result.body.error).toContain('available as text');
    expect(JSON.stringify([result, state.logError.mock.calls])).not.toMatch(/private upstream|test-secret/);
  });
  it('redacts arbitrary provider errors on the guest route and in its log', async () => {
    state.speak.mockRejectedValueOnce(new Error('private upstream body with test-secret'));
    const result = await post('/api/public/voice/speak', { text: 'Guest reply' }, false);
    expect(result.status).toBe(502);
    expect(JSON.stringify([result, state.logError.mock.calls])).not.toMatch(/private upstream|test-secret/);
  });
  it('respects the operator guest-voice switch', async () => {
    state.guestAllowed = false;
    const result = await post('/api/public/voice/speak', { text: 'Hello' }, false);
    expect(result.status).toBe(503); expect(state.speak).not.toHaveBeenCalled();
    expect(result.body.error).toContain('OpenAI');
  });
  it.each(['false', 'true', 1, null, {}])('rejects a non-boolean consent value %j', async (granted) => {
    const result = await post('/api/me/consent', { kind: 'cloud_reasoning', granted }, true, 'PUT');
    expect(result.status).toBe(400); expect(state.setConsent).not.toHaveBeenCalled();
  });
  it('accepts explicit boolean consent without changing its value', async () => {
    expect((await post('/api/me/consent', { kind: 'cloud_reasoning', granted: false }, true, 'PUT')).status).toBe(200);
    expect(state.setConsent).toHaveBeenCalledWith('test-user', 'cloud_reasoning', false);
  });
});
