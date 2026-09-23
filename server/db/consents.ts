import { newId, nowIso } from '../lib/ids.ts';
import { row, rows } from './index.ts';
import type {
  ConsentDecision,
  ConsentState,
  ConsentSummaries,
  ConsentSummary,
  ConsentType,
} from '../../shared/types.ts';

export interface ConsentMetadata extends Record<string, unknown> {
  /** Stable per client action. Reusing it makes a retry return the first event. */
  idempotencyKey?: string;
  actorType?: string;
  actorId?: string;
}

interface ConsentRow {
  id: string; user_id: string; consent_type: string; wording_version_id: string;
  state: ConsentState; recorded_at: string; actor_type: string | null;
  actor_id: string | null; metadata_json: string | Record<string, unknown> | null; idempotency_key: string;
}

function decision(r: ConsentRow): ConsentDecision {
  return {
    id: r.id, userId: r.user_id, consentType: r.consent_type,
    wordingVersionId: r.wording_version_id, state: r.state, recordedAt: r.recorded_at,
    ...(r.actor_type && { actorType: r.actor_type }), ...(r.actor_id && { actorId: r.actor_id }),
    ...(r.metadata_json && {
      metadata: typeof r.metadata_json === 'string' ? JSON.parse(r.metadata_json) as Record<string, unknown> : r.metadata_json,
    }),
    idempotencyKey: r.idempotency_key,
  };
}

function summary(value: ConsentDecision): ConsentSummary {
  return { consentType: value.consentType, state: value.state,
    wordingVersionId: value.wordingVersionId, recordedAt: value.recordedAt, decisionId: value.id };
}

export async function recordConsentDecision(
  userId: string, consentType: ConsentType, wordingVersionId: string,
  state: ConsentState, metadata: ConsentMetadata = {},
): Promise<ConsentDecision> {
  const idempotencyKey = metadata.idempotencyKey ?? newId();
  const { idempotencyKey: _key, actorType, actorId, ...evidence } = metadata;
  const id = newId();
  const recordedAt = nowIso();
  const inserted = await row<ConsentRow>(
    `INSERT INTO consent_events
       (id, user_id, consent_type, wording_version_id, state, recorded_at,
        actor_type, actor_id, metadata_json, idempotency_key)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?::JSONB, ?)
     ON CONFLICT (user_id, idempotency_key) DO NOTHING
     RETURNING *`,
    id, userId, consentType, wordingVersionId, state, recordedAt,
    actorType ?? null, actorId ?? null,
    Object.keys(evidence).length ? JSON.stringify(evidence) : null, idempotencyKey,
  );
  if (inserted) return decision(inserted);
  const existing = await row<ConsentRow>(
    'SELECT * FROM consent_events WHERE user_id = ? AND idempotency_key = ?',
    userId, idempotencyKey,
  );
  if (!existing) throw new Error('Consent decision retry could not be resolved.');
  if (existing.consent_type !== consentType || existing.wording_version_id !== wordingVersionId || existing.state !== state) {
    throw new Error('Idempotency key was already used for a different consent decision.');
  }
  return decision(existing);
}

export async function currentConsent(userId: string, consentType: ConsentType): Promise<ConsentSummary | null> {
  const found = await row<ConsentRow>(
    `SELECT * FROM consent_events WHERE user_id = ? AND consent_type = ?
     ORDER BY recorded_at DESC, event_sequence DESC LIMIT 1`, userId, consentType,
  );
  return found ? summary(decision(found)) : null;
}

export async function currentConsents(userId: string): Promise<ConsentSummaries> {
  const found = await rows<ConsentRow>(
    `SELECT DISTINCT ON (consent_type) * FROM consent_events WHERE user_id = ?
     ORDER BY consent_type, recorded_at DESC, event_sequence DESC`, userId,
  );
  return Object.fromEntries(found.map((item) => [item.consent_type, summary(decision(item))]));
}

export async function consentHistory(userId: string, consentType?: ConsentType): Promise<ConsentDecision[]> {
  const found = consentType
    ? await rows<ConsentRow>(`SELECT * FROM consent_events WHERE user_id = ? AND consent_type = ?
        ORDER BY recorded_at DESC, event_sequence DESC`, userId, consentType)
    : await rows<ConsentRow>(`SELECT * FROM consent_events WHERE user_id = ?
        ORDER BY recorded_at DESC, event_sequence DESC`, userId);
  return found.map(decision);
}
