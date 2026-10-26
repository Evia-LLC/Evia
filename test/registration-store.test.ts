import { describe, expect, it } from 'vitest';
import { createUser } from '../server/db/users.ts';
import { adminSql, database, result } from './helpers/data-api.ts';

describe('atomic registration over the Data API', () => {
  it('stores DOB and versioned server-created Terms evidence together', async () => {
    const id = await createUser('adult@example.test', 'sample-password', 'Sample', { dateOfBirth: '2000-01-01', ip: '127.0.0.1' });
    expect(await result(database().from('users').select('date_of_birth').eq('id', id).single())).toEqual({ date_of_birth: '2000-01-01' });
    const event = await result<Record<string, unknown>>(database().from('consent_events').select('consent_type,actor_id,metadata_json').eq('user_id', id).single());
    expect(event).toMatchObject({ consent_type: 'registration_terms', actor_id: id, metadata_json: {
      choice: 'accepted', demoOnly: true, wordingStatus: 'placeholder', source: 'registration',
      documentVersions: { registration: 'registration-terms-pack-v1-demo-2026-09-24.1' } } });
  });
  it('rolls back account creation if consent recording fails', async () => {
    adminSql(`CREATE FUNCTION evia_private.reject_signup_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'evidence unavailable'; END; $$;
      CREATE TRIGGER reject_signup_evidence BEFORE INSERT ON public.consent_events
      FOR EACH ROW EXECUTE FUNCTION evia_private.reject_signup_evidence();`);
    try {
      await expect(createUser('rollback@example.test', 'sample-password', 'Sample', { dateOfBirth: '2000-01-01' })).rejects.toThrow('evidence unavailable');
      expect(await result(database().from('users').select('id').eq('email', 'rollback@example.test'))).toEqual([]);
    } finally {
      adminSql('DROP TRIGGER reject_signup_evidence ON public.consent_events; DROP FUNCTION evia_private.reject_signup_evidence();');
    }
  });
});
