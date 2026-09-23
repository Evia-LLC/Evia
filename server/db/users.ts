import { row, run, transaction } from './index.ts';
import { currentConsents } from './consents.ts';
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

const SESSION_DAYS = 30;

interface UserRow {
  id: string;
  email: string;
  display_name: string;
  password_hash: string;
  password_salt: string;
  created_at: string;
}

export async function createUser(
  email: string,
  password: string,
  displayName: string,
): Promise<string> {
  const normalised = email.trim().toLowerCase();
  const existing = await row('SELECT id FROM users WHERE email = ?', normalised);
  if (existing) throw new Error('An account with that email already exists.');

  const { hash, salt } = hashPassword(password);
  const id = newId();
  const now = nowIso();

  // Every statement goes through `tx`, not the pool. An account is a user plus
  // a profile plus preferences, and a half-made one
  // is worse than none — it would sign in and then behave as though the user
  // had agreed to nothing and preferred nothing.
  await transaction(async (tx) => {
    await tx.run(
      `INSERT INTO users (id, email, display_name, password_hash, password_salt, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      id,
      normalised,
      displayName.trim() || 'friend',
      hash,
      salt,
      now,
    );

    await tx.run(
      `INSERT INTO skin_profiles (user_id, skin_type, updated_at) VALUES (?, 'unknown', ?)`,
      id,
      now,
    );

    await tx.run(
      `INSERT INTO preferences (user_id, explanation_style, voice_enabled, reduced_motion,
                                quality_tier, locale, updated_at)
       VALUES (?, ?, 0, 0, ?, ?, ?)`,
      id,
      DEFAULT_PREFERENCES.explanationStyle,
      DEFAULT_PREFERENCES.qualityTier,
      DEFAULT_PREFERENCES.locale,
      now,
    );
  });

  return id;
}

export async function authenticate(email: string, password: string): Promise<string | null> {
  const found = await row<UserRow>(
    'SELECT * FROM users WHERE email = ?',
    email.trim().toLowerCase(),
  );
  if (!found) return null;
  if (!verifyPassword(password, found.password_hash, found.password_salt)) return null;
  return found.id;
}

export async function createSession(userId: string): Promise<string> {
  const token = newToken();
  const now = new Date();
  const expires = new Date(now.getTime() + SESSION_DAYS * 86400_000);
  await run(
    'INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)',
    token,
    userId,
    now.toISOString(),
    expires.toISOString(),
  );
  return token;
}

export async function userIdForSession(token: string): Promise<string | null> {
  const found = await row<{ user_id: string; expires_at: string }>(
    'SELECT user_id, expires_at FROM sessions WHERE token = ?',
    token,
  );
  if (!found) return null;
  if (new Date(found.expires_at) < new Date()) {
    await run('DELETE FROM sessions WHERE token = ?', token);
    return null;
  }
  return found.user_id;
}

/** Drops every session past its expiry. Called on boot and periodically. */
export async function sweepExpiredSessions(): Promise<number> {
  return run('DELETE FROM sessions WHERE expires_at <= ?', new Date().toISOString());
}

export async function destroySession(token: string): Promise<void> {
  await run('DELETE FROM sessions WHERE token = ?', token);
}

export async function getProfile(userId: string): Promise<SkinProfile> {
  const found = await row<{
    skin_type: string;
    fitzpatrick: number | null;
    concerns_json: string;
    sensitivities_json: string;
    pregnancy_status: string | null;
    updated_at: string;
  }>('SELECT * FROM skin_profiles WHERE user_id = ?', userId);
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
  const current = await getProfile(userId);
  const next: SkinProfile = { ...current, ...patch, updatedAt: nowIso() };
  await run(
    `UPDATE skin_profiles
        SET skin_type = ?, fitzpatrick = ?, concerns_json = ?, sensitivities_json = ?,
            pregnancy_status = ?, updated_at = ?
      WHERE user_id = ?`,
    next.skinType,
    next.fitzpatrick,
    JSON.stringify(next.concerns),
    JSON.stringify(next.sensitivities),
    next.pregnancyStatus,
    next.updatedAt,
    userId,
  );
  return next;
}

export async function getPreferences(userId: string): Promise<Preferences> {
  const found = await row<{
    explanation_style: string;
    voice_enabled: number;
    reduced_motion: number;
    quality_tier: string;
    locale: string;
    voice_uri: string | null;
  }>('SELECT * FROM preferences WHERE user_id = ?', userId);
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
  const next = { ...(await getPreferences(userId)), ...patch };
  await run(
    `UPDATE preferences
        SET explanation_style = ?, voice_enabled = ?, voice_uri = ?, reduced_motion = ?,
            quality_tier = ?, locale = ?, updated_at = ?
      WHERE user_id = ?`,
    next.explanationStyle,
    next.voiceEnabled ? 1 : 0,
    next.voiceURI,
    next.reducedMotion ? 1 : 0,
    next.qualityTier,
    next.locale,
    nowIso(),
    userId,
  );
  return next;
}

export async function getUserSummary(userId: string): Promise<UserSummary | null> {
  const found = await row<UserRow>('SELECT * FROM users WHERE id = ?', userId);
  if (!found) return null;
  /*
   * Number(), because COUNT(*) is a bigint.
   *
   * Postgres bigints arrive as strings — they do not fit a JS number in the
   * general case, so the driver refuses to guess on your behalf. Left alone,
   * scanCount becomes "6", and every comparison against it downstream is a
   * string comparison that looks right until somebody reaches ten scans.
   */
  const counted = await row<{ n: string | number }>(
    'SELECT COUNT(*) AS n FROM skin_scans WHERE user_id = ?',
    userId,
  );
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
    profile,
    preferences,
    consents,
    scanCount: Number(counted?.n ?? 0),
  };
}

/**
 * Hard delete. Rows cascade from users(id); blobs are shredded by the caller,
 * which owns the list of refs (see routes/me.ts).
 */
export async function deleteUser(userId: string): Promise<void> {
  await run('DELETE FROM users WHERE id = ?', userId);
}
