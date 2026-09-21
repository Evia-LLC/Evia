import { row, transaction } from './index.ts';
import { intakeProfileFields, validateIntakeDraft, type IntakeDraft, type IntakeRecord } from '../../shared/intake.ts';

interface IntakeRow { schema_version: number; answers_json: string; consented_at: string; updated_at: string }
export async function getIntake(userId: string): Promise<IntakeRecord | null> {
  const stored = await row<IntakeRow>('SELECT schema_version, answers_json, consented_at, updated_at FROM consultation_intakes WHERE user_id = ?', userId);
  if (!stored) return null;
  const draft = validateIntakeDraft({ schemaVersion: stored.schema_version, storageConsent: true, answers: JSON.parse(stored.answers_json) });
  return { ...draft, storageConsent: true, consentedAt: stored.consented_at, updatedAt: stored.updated_at };
}
export async function saveIntake(userId: string, input: IntakeDraft): Promise<IntakeRecord> {
  const draft = validateIntakeDraft(input);
  if (!draft.storageConsent) throw new Error('Intake storage permission is required.');
  const timestamp = new Date().toISOString();
  return transaction(async (tx) => {
    // Serialize saves to one account and make profile/intake updates atomic.
    const owner = await tx.row<{ id: string }>('SELECT id FROM users WHERE id = ? FOR UPDATE', userId);
    if (!owner) throw new Error('Account is unavailable.');
    await tx.run(`INSERT INTO consultation_intakes (user_id, schema_version, answers_json, consented_at, updated_at)
      VALUES (?, ?, ?, ?, ?) ON CONFLICT (user_id) DO UPDATE SET schema_version = EXCLUDED.schema_version,
      answers_json = EXCLUDED.answers_json, consented_at = EXCLUDED.consented_at, updated_at = EXCLUDED.updated_at`,
    userId, draft.schemaVersion, JSON.stringify(draft.answers), timestamp, timestamp);
    if (draft.answers.preferredName) await tx.run('UPDATE users SET display_name = ? WHERE id = ?', draft.answers.preferredName, userId);
    const profile = intakeProfileFields(draft.answers);
    await tx.run('UPDATE skin_profiles SET pregnancy_status = ?, updated_at = ? WHERE user_id = ?', profile.pregnancyStatus, timestamp, userId);
    if (profile.skinType !== undefined) await tx.run('UPDATE skin_profiles SET skin_type = ? WHERE user_id = ?', profile.skinType, userId);
    if (profile.concerns !== undefined) await tx.run('UPDATE skin_profiles SET concerns_json = ? WHERE user_id = ?', JSON.stringify(profile.concerns), userId);
    return { ...draft, storageConsent: true, consentedAt: timestamp, updatedAt: timestamp };
  });
}
