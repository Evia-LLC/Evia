import { beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyIntakeDraft } from '../shared/intake.ts';
const state = vi.hoisted(() => ({ request: vi.fn(), session: { user: null as any, guest: false } }));
vi.mock('../src/lib/api.ts', () => ({ request: state.request }));
vi.mock('@/state/session.svelte.ts', () => ({ session: state.session }));
import { persistIntake } from '../src/lib/intake.ts';
beforeEach(() => { state.request.mockReset(); state.session.user = null; state.session.guest = false; });
describe('intake draft transmission', () => {
  it('does not transmit declined answers, even after account creation', async () => {
    const draft = emptyIntakeDraft(); draft.answers.medications = 'Private'; state.session.user = { id: 'account-a' };
    expect(await persistIntake(draft)).toBeNull(); expect(state.request).not.toHaveBeenCalled();
  });
  it('cannot save a consenting draft before authentication or for a guest', async () => {
    const draft = emptyIntakeDraft(); draft.storageConsent = true;
    await expect(persistIntake(draft)).rejects.toThrow('sign in');
    state.session.user = { id: 'guest' }; state.session.guest = true;
    await expect(persistIntake(draft)).rejects.toThrow('sign in'); expect(state.request).not.toHaveBeenCalled();
  });
  it('posts only to the current-account endpoint and refreshes that account summary', async () => {
    const draft = emptyIntakeDraft(); draft.storageConsent = true; state.session.user = { id: 'account-a' };
    state.request.mockResolvedValue({ intake: { answers: draft.answers }, user: { id: 'account-a', displayName: 'Ada' } });
    await persistIntake(draft);
    expect(state.request.mock.calls[0][0]).toBe('/me/intake');
    expect(JSON.parse(state.request.mock.calls[0][1].body)).not.toHaveProperty('userId');
    expect(state.session.user.displayName).toBe('Ada');
  });
  it('does not replace a new session when an old save finishes late', async () => {
    const draft = emptyIntakeDraft(); draft.storageConsent = true; state.session.user = { id: 'account-a' };
    state.request.mockImplementation(async () => { state.session.user = { id: 'account-b' }; return { intake: {}, user: { id: 'account-a' } }; });
    await persistIntake(draft); expect(state.session.user.id).toBe('account-b');
  });
});
