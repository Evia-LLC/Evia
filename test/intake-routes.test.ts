import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import { IncomingMessage, ServerResponse } from 'node:http';
import { Socket } from 'node:net';
import { emptyIntakeDraft } from '../shared/intake.ts';

const state = vi.hoisted(() => ({ get: vi.fn(), save: vi.fn(), summary: vi.fn() }));
vi.mock('../server/db/intake.ts', () => ({ getIntake: state.get, saveIntake: state.save }));
vi.mock('../server/db/users.ts', () => ({
  userIdForSession: async (token: string) => token === 'session-a' ? 'account-a' : null,
  getUserSummary: state.summary,
}));
const { intakeRouter } = await import('../server/routes/intake.ts');
const app = express(); app.use(express.json({ limit: '64kb' })); app.use('/api/me/intake', intakeRouter);
beforeEach(() => {
  state.get.mockReset(); state.get.mockResolvedValue({ answers: { preferredName: 'Ada' } });
  state.save.mockReset(); state.save.mockResolvedValue({ answers: { preferredName: 'Ada' } });
  state.summary.mockReset(); state.summary.mockResolvedValue({ id: 'account-a', displayName: 'Ada' });
});
function request(path: string, method = 'GET', body?: unknown, auth = true) {
  return new Promise<{ status: number; body: any; headers: ReturnType<ServerResponse['getHeaders']> }>((resolve, reject) => {
    const req = new IncomingMessage(new Socket()); const payload = body ? JSON.stringify(body) : '';
    req.method = method; req.url = path; req.headers = {
      ...(auth ? { authorization: 'Bearer session-a' } : {}),
      ...(payload ? { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(payload)) } : {}),
    };
    const res = new ServerResponse(req);
    res.end = ((chunk: string | Buffer) => { resolve({ status: res.statusCode, body: JSON.parse(String(chunk)), headers: res.getHeaders() }); return res; }) as typeof res.end;
    app(req, res); req.on('error', reject); if (payload) req.push(payload); req.push(null);
  });
}
describe('authenticated intake HTTP boundary', () => {
  it.each([['GET', '/api/me/intake'], ['GET', '/api/me/intake/export'], ['PUT', '/api/me/intake']])('requires authentication for %s %s', async (method, path) => {
    expect((await request(path, method, emptyIntakeDraft(), false)).status).toBe(401);
    expect(state.get).not.toHaveBeenCalled(); expect(state.save).not.toHaveBeenCalled();
  });
  it('uses the session owner even if the query names a different account', async () => {
    const result = await request('/api/me/intake?userId=account-b');
    expect(result.status).toBe(200); expect(state.get).toHaveBeenCalledWith('account-a');
    expect(result.headers['cache-control']).toBe('no-store');
  });
  it('exports only the session account as a non-cacheable download', async () => {
    const result = await request('/api/me/intake/export?userId=account-b');
    expect(state.get).toHaveBeenCalledWith('account-a');
    expect(result.headers['content-disposition']).toContain('attachment'); expect(result.headers['cache-control']).toBe('no-store');
  });
  it('refuses declined storage rather than saving a false-consent row', async () => {
    expect((await request('/api/me/intake', 'PUT', emptyIntakeDraft())).status).toBe(400);
    expect(state.save).not.toHaveBeenCalled();
  });
  it('rejects caller-supplied ownership and oversized sensitive answers', async () => {
    const draft = emptyIntakeDraft(); draft.storageConsent = true;
    expect((await request('/api/me/intake', 'PUT', { ...draft, userId: 'account-b' })).status).toBe(400);
    draft.answers.medications = 'private-note'.repeat(100);
    const result = await request('/api/me/intake', 'PUT', draft);
    expect(result.status).toBe(400); expect(JSON.stringify(result.body)).not.toContain('private-note'); expect(state.save).not.toHaveBeenCalled();
  });
  it('returns the saved intake and refreshed summary of the same owner', async () => {
    const draft = emptyIntakeDraft(); draft.storageConsent = true; draft.answers.preferredName = 'Ada';
    const result = await request('/api/me/intake', 'PUT', draft);
    expect(result.status).toBe(200); expect(state.save).toHaveBeenCalledWith('account-a', draft);
    expect(state.summary).toHaveBeenCalledWith('account-a'); expect(result.body.user.id).toBe('account-a');
  });
});
