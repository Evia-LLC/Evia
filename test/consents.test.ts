import { beforeEach, describe, expect, it } from 'vitest';
import { createUser } from '../server/db/users.ts';
import { recordConsentDecision, currentConsent, currentConsents, consentHistory } from '../server/db/consents.ts';
import { database, result } from './helpers/data-api.ts';

let user: string;
beforeEach(async () => { user = await createUser(`consent-${crypto.randomUUID()}@test.local`, 'password', 'Tester'); });
describe('versioned consent events over the Data API', () => {
  it('represents no decision with no event', async () => {
    expect(await currentConsent(user, 'new-key')).toBeNull();
    expect(await currentConsents(user)).toEqual({});
  });
  it('retains grant and withdrawal history and resolves current summaries', async () => {
    await recordConsentDecision(user, 'photos', 'v1', 'granted');
    await recordConsentDecision(user, 'photos', 'v1', 'withdrawn');
    expect(await currentConsent(user, 'photos')).toMatchObject({ state: 'withdrawn' });
    expect((await consentHistory(user, 'photos')).map((e) => e.state)).toEqual(['withdrawn', 'granted']);
  });
  it('breaks timestamp ties by event sequence and groups the view by user too', async () => {
    const other = await createUser('other-consent@example.test', 'password', 'Other');
    const at = '2026-01-01T00:00:00.000Z';
    await result(database().from('consent_events').insert([
      { id: 'tie-grant', user_id: user, consent_type: 'photos', wording_version_id: 'v1', state: 'granted', recorded_at: at, idempotency_key: 'a' },
      { id: 'tie-withdraw', user_id: user, consent_type: 'photos', wording_version_id: 'v2', state: 'withdrawn', recorded_at: at, idempotency_key: 'b' },
      { id: 'other-grant', user_id: other, consent_type: 'photos', wording_version_id: 'v3', state: 'granted', recorded_at: at, idempotency_key: 'c' },
    ]));
    expect(await currentConsents(user)).toMatchObject({ photos: { state: 'withdrawn', decisionId: 'tie-withdraw' } });
    expect(await currentConsents(other)).toMatchObject({ photos: { state: 'granted' } });
  });
  it('replays the first event, rejects mismatched retries, and never updates immutable events', async () => {
    const first = await recordConsentDecision(user, 'photos', 'v1', 'granted', { idempotencyKey: 'retry' });
    expect(await recordConsentDecision(user, 'photos', 'v1', 'granted', { idempotencyKey: 'retry' })).toEqual(first);
    await expect(recordConsentDecision(user, 'photos', 'v2', 'granted', { idempotencyKey: 'retry' })).rejects.toThrow(/different consent/);
    await expect(result(database().from('consent_events').update({ state: 'withdrawn' }).eq('id', first.id))).rejects.toThrow(/immutable/);
    expect(await consentHistory(user)).toHaveLength(1);
  });
  it('preserves server-derived evidence and multiple wording versions', async () => {
    await recordConsentDecision(user, 'photos', 'v1', 'granted', { actorId: 'forged', source: 'forged', custom: true },
      { actorType: 'account', actorId: user, source: 'settings', ip: '127.0.0.1' });
    await recordConsentDecision(user, 'photos', 'v2', 'granted');
    const history = await consentHistory(user);
    expect(new Set(history.map((e) => e.wordingVersionId))).toEqual(new Set(['v1', 'v2']));
    expect(history.find((e) => e.wordingVersionId === 'v1')).toMatchObject({ actorId: user,
      metadata: { custom: true, source: 'settings', ip: '127.0.0.1' } });
  });
});
