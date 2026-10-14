import { database, result, affected } from '../lib/data-api.ts';
import { currentConsents } from './consents.ts';
import { nowIso } from '../lib/ids.ts';
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


interface UserRow {
  id: string;
  email: string;
  display_name: string;
  created_at: string;
  date_of_birth?: string | null;
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
