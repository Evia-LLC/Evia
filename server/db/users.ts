import { REGISTRATION_TERMS_VERSION, REGISTRATION_DOCUMENT_VERSIONS } from '../../shared/age-flow.ts';
import { database, result, affected } from '../lib/data-api.ts';
import { currentConsents } from './consents.ts';
import { findCredentials } from './credentials.ts';
import { newId, newToken, nowIso } from '../lib/ids.ts';
import { hashPassword, verifyPassword } from '../lib/crypto.ts';
import {
  DEFAULT_PREFERENCES,
  type PregnancyStatus,
  type Preferences,
  type SkinProfile,
  type SkinType,
  type UserSummary,
} from '../../shared/types.ts';
import {
  validatePreferencesPatch,
  validateProfilePatch,
} from '../../shared/boundary-validators.ts';

const SESSION_DAYS = 30;

interface UserRow {
  id: string;
  email: string;
  display_name: string;
  created_at: string;
  date_of_birth?: string | null;
}

export async function createUser(
  email: string,
  password: string,
  displayName: string,
  registration?: { dateOfBirth: string; ip?: string },
): Promise<string> {
  const normalised = email.trim().toLowerCase();
  const existing = await result<{ id: string } | null>(database().from('users').select('id').eq('email', normalised).maybeSingle());
  if (existing) throw new Error('An account with that email already exists.');

  const { hash, salt } = await hashPassword(password);
  const id = newId();
  const now = nowIso();

  await result(database().rpc('evia_create_user', {
    p_user: { id, email: normalised, display_name: displayName.trim() || 'friend',
      password_hash: hash, password_salt: salt, created_at: now, date_of_birth: registration?.dateOfBirth ?? null },
    p_profile: { user_id: id, skin_type: 'unknown', fitzpatrick: null, concerns_json: '[]',
      sensitivities_json: '[]', pregnancy_status: 'unknown', updated_at: now },
    p_preferences: { user_id: id, explanation_style: DEFAULT_PREFERENCES.explanationStyle,
      voice_enabled: 0, reduced_motion: 0, quality_tier: DEFAULT_PREFERENCES.qualityTier,
      locale: DEFAULT_PREFERENCES.locale, voice_uri: null, updated_at: now },
    p_consent: registration ? { id: newId(), user_id: id, consent_type: 'registration_terms',
      wording_version_id: REGISTRATION_TERMS_VERSION, state: 'granted', recorded_at: now,
      actor_type: 'account', actor_id: id, idempotency_key: `registration:${id}`,
      metadata_json: { choice: 'accepted', source: 'registration', demoOnly: true, wordingStatus: 'placeholder',
        documentVersions: REGISTRATION_DOCUMENT_VERSIONS, ip: registration.ip ?? null } } : null,
  }));

  return id;
}

// Unknown accounts perform the same KDF work without authenticating a dummy identity.
const DUMMY_SALT = '0'.repeat(32);
const DUMMY_HASH = '0'.repeat(128);

export async function authenticate(email: string, password: string): Promise<string | null> {
  const found = await findCredentials(email.trim().toLowerCase());
  if (!found) {
    await verifyPassword(password, DUMMY_HASH, DUMMY_SALT);
    return null;
  }
  if (!(await verifyPassword(password, found.password_hash, found.password_salt))) return null;
  return found.id;
}

export async function createSession(userId: string): Promise<string> {
  const token = newToken();
  const now = new Date();
  const expires = new Date(now.getTime() + SESSION_DAYS * 86400_000);
  await result(database().from('sessions').insert({ token, user_id: userId, created_at: now.toISOString(), expires_at: expires.toISOString() }));
  return token;
}

export async function userIdForSession(token: string): Promise<string | null> {
  const found = await result<{ user_id: string; expires_at: string } | null>(database().from('sessions').select('user_id,expires_at').eq('token', token).maybeSingle());
  if (!found) return null;
  if (new Date(found.expires_at) < new Date()) {
    await result(database().from('sessions').delete().eq('token', token));
    return null;
  }
  return found.user_id;
}

/** Drops every session past its expiry. Called on boot and periodically. */
export async function sweepExpiredSessions(): Promise<number> {
  return affected(database().from('sessions').delete({ count: 'exact' }).lte('expires_at', new Date().toISOString()));
}

export async function destroySession(token: string): Promise<void> {
  await result(database().from('sessions').delete().eq('token', token));
}

export async function getProfile(userId: string): Promise<SkinProfile> {
  const found = await result<{
    skin_type: string;
    fitzpatrick: number | null;
    concerns_json: string;
    sensitivities_json: string;
    pregnancy_status: string | null;
    updated_at: string;
  } | null>(database().from('skin_profiles').select('skin_type,fitzpatrick,concerns_json,sensitivities_json,pregnancy_status,updated_at').eq('user_id', userId).maybeSingle());
  if (!found) {
    return {
      skinType: 'unknown',
      fitzpatrick: null,
      concerns: [],
      sensitivities: [],
      pregnancyStatus: 'unknown',
      updatedAt: nowIso(),
    };
  }
  return {
    skinType: found.skin_type as SkinType,
    fitzpatrick: found.fitzpatrick,
    concerns: JSON.parse(found.concerns_json),
    sensitivities: JSON.parse(found.sensitivities_json),
    // Coalesced rather than cast: a row written before the column existed reads
    // as null, and null must mean "unanswered", not "no".
    pregnancyStatus: (found.pregnancy_status as PregnancyStatus | null) ?? 'unknown',
    updatedAt: found.updated_at,
  };
}

export async function updateProfile(
  userId: string,
  patch: Partial<SkinProfile>,
): Promise<SkinProfile> {
  // P1-T06: allowlisted at the repository boundary too, so a future caller
  // cannot bypass the route. Invalid values throw ValidationError (400)
  // before any write; unknown keys are ignored, never stored.
  const clean = validateProfilePatch(patch) as Partial<SkinProfile>;
  const current = await getProfile(userId);
  const next: SkinProfile = { ...current, ...clean, updatedAt: nowIso() };
  await result(database().from('skin_profiles').update({
    skin_type: next.skinType, fitzpatrick: next.fitzpatrick, concerns_json: JSON.stringify(next.concerns),
    sensitivities_json: JSON.stringify(next.sensitivities), pregnancy_status: next.pregnancyStatus,
    updated_at: next.updatedAt,
  }).eq('user_id', userId));
  return next;
}

export async function getPreferences(userId: string): Promise<Preferences> {
  const found = await result<{
    explanation_style: string;
    voice_enabled: number;
    reduced_motion: number;
    quality_tier: string;
    locale: string;
    voice_uri: string | null;
  } | null>(database().from('preferences').select('explanation_style,voice_enabled,reduced_motion,quality_tier,locale,voice_uri').eq('user_id', userId).maybeSingle());
  if (!found) return { ...DEFAULT_PREFERENCES };
  return {
    explanationStyle: found.explanation_style as Preferences['explanationStyle'],
    // Number(), because these are 0/1 integer columns and a driver is entitled
    // to hand an integer back as a string.
    voiceEnabled: Number(found.voice_enabled) === 1,
    voiceURI: found.voice_uri ?? null,
    reducedMotion: Number(found.reduced_motion) === 1,
    qualityTier: found.quality_tier as Preferences['qualityTier'],
    locale: found.locale,
  };
}

export async function updatePreferences(
  userId: string,
  patch: Partial<Preferences>,
): Promise<Preferences> {
  // P1-T06: same repository-boundary allowlist as updateProfile.
  const clean = validatePreferencesPatch(patch) as Partial<Preferences>;
  const next = { ...(await getPreferences(userId)), ...clean };
  await result(database().from('preferences').update({
    explanation_style: next.explanationStyle, voice_enabled: next.voiceEnabled ? 1 : 0,
    voice_uri: next.voiceURI ?? null, reduced_motion: next.reducedMotion ? 1 : 0,
    quality_tier: next.qualityTier, locale: next.locale, updated_at: nowIso(),
  }).eq('user_id', userId));
  return next;
}

export async function getUserSummary(userId: string): Promise<UserSummary | null> {
  const found = await result<UserRow | null>(database().from('users').select('id,email,display_name,created_at,date_of_birth').eq('id', userId).maybeSingle());
  if (!found) return null;
  const scanCount = await affected(database().from('skin_scans').select('id', { count: 'exact', head: true }).eq('user_id', userId));
  const [profile, preferences, consents] = await Promise.all([
    getProfile(userId),
    getPreferences(userId),
    currentConsents(userId),
  ]);
  return {
    id: found.id,
    email: found.email,
    displayName: found.display_name,
    createdAt: found.created_at,
    dateOfBirth: found.date_of_birth ?? null,
    profile,
    preferences,
    consents,
    scanCount,
  };
}

/**
 * Hard delete. Rows cascade from users(id); blobs are shredded by the caller,
 * which owns the list of refs (see routes/me.ts).
 */
export async function deleteUser(userId: string): Promise<void> {
  await result(database().from('users').delete().eq('id', userId));
}
