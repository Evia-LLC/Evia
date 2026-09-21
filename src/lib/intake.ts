import { request } from './api.ts';
import { session } from '@/state/session.svelte.ts';
import { validateIntakeDraft, type IntakeDraft, type IntakeRecord } from '@shared/intake.ts';
import type { UserSummary } from '@shared/types.ts';

/** Call only after registration. A declined save never transmits the draft. */
export async function persistIntake(input: IntakeDraft): Promise<IntakeRecord | null> {
  const draft = validateIntakeDraft(input);
  if (!draft.storageConsent) return null;
  if (!session.user || session.guest) throw new Error('Create or sign in to your account before saving the intake.');
  const identity = session.user.id;
  const result = await request<{ intake: IntakeRecord; user: UserSummary }>('/me/intake', {
    method: 'PUT', body: JSON.stringify(draft),
  });
  if (session.user?.id === identity && !session.guest) session.user = result.user;
  return result.intake;
}
export const loadIntake = () => request<{ intake: IntakeRecord | null }>('/me/intake');
export const exportIntake = () => request<{ intake: IntakeRecord | null }>('/me/intake/export');
