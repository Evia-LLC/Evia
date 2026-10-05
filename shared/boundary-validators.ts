/**
 * P1-T06 — server-side boundary validators for structured writes.
 *
 * Pure functions, no I/O: every structured-write route validates its payload
 * here BEFORE any repository call, and the repositories re-validate on the way
 * in so a future caller cannot bypass the route. Independent of client
 * TypeScript types — the client shape is irrelevant; only this file decides
 * what gets stored.
 *
 * Every failure throws ValidationError (status 400). Routes catch it and
 * answer 400 with the message; nothing is written on that path.
 */

export class ValidationError extends Error {
  readonly status = 400;
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

function fail(field: string, reason: string): never {
  throw new ValidationError(`${field}: ${reason}.`);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Far-future tolerance for client clocks: 5 minutes. */
export const TIMESTAMP_FUTURE_SKEW_MS = 5 * 60 * 1000;

/** Idempotency keys are unified with the analysis consent routes: 1..100 chars. */
export const IDEMPOTENCY_KEY_MAX = 100;

// ---------------------------------------------------------------------------
// primitives
// ---------------------------------------------------------------------------

export function validateStringArray(
  value: unknown,
  field: string,
  opts: { maxItems: number; maxEach: number; minEach?: number },
): string[] {
  if (!Array.isArray(value)) fail(field, "must be an array of strings");
  const arr = value as unknown[];
  if (arr.length > opts.maxItems)
    fail(field, `must hold at most ${opts.maxItems} items`);
  const minEach = opts.minEach ?? 1;
  for (const item of arr) {
    if (typeof item !== "string") fail(field, "must hold only strings");
    const trimmed = (item as string).trim();
    if (trimmed.length < minEach) fail(field, "must not hold empty strings");
    if ((item as string).length > opts.maxEach) {
      fail(field, `each entry must be at most ${opts.maxEach} characters`);
    }
  }
  return arr as string[];
}

export function validateEnum<T extends string>(
  value: unknown,
  field: string,
  allowed: readonly T[],
): T {
  if (
    typeof value !== "string" ||
    !(allowed as readonly string[]).includes(value)
  ) {
    fail(field, `must be one of: ${allowed.join(", ")}`);
  }
  return value as T;
}

export function validateBoundedNumber(
  value: unknown,
  field: string,
  min: number,
  max: number,
): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < min ||
    value > max
  ) {
    fail(field, `must be a number between ${min} and ${max}`);
  }
  return value;
}

export function validateBoundedString(
  value: unknown,
  field: string,
  min: number,
  max: number,
): string {
  if (typeof value !== "string") fail(field, "must be a string");
  const s = value as string;
  if (s.trim().length < min) fail(field, "must not be blank");
  if (s.length > max) fail(field, `must be at most ${max} characters`);
  return s;
}

export function validateOptionalBoundedString(
  value: unknown,
  field: string,
  max: number,
): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") fail(field, "must be a string or null");
  if (value.length > max) fail(field, `must be at most ${max} characters`);
  return value;
}

/** Valid ISO-8601 instant that is not more than skew into the future. */
export function validateTimestamp(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim())
    fail(field, "must be an ISO timestamp string");
  const s = value as string;
  const ms = Date.parse(s);
  if (Number.isNaN(ms)) fail(field, "must be a valid date");
  if (ms > Date.now() + TIMESTAMP_FUTURE_SKEW_MS)
    fail(field, "must not be in the future");
  return s;
}

export function validateIdempotencyKey(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    fail("idempotencyKey", "is required");
  }
  const s = value as string;
  if (s.length > IDEMPOTENCY_KEY_MAX) {
    fail("idempotencyKey", `must be at most ${IDEMPOTENCY_KEY_MAX} characters`);
  }
  return s;
}

// ---------------------------------------------------------------------------
// profile + preferences (PATCH /me/profile, PATCH /me/preferences)
// ---------------------------------------------------------------------------

export const SKIN_TYPES = [
  "dry",
  "oily",
  "combination",
  "normal",
  "sensitive",
  "unknown",
] as const;

export const PREGNANCY_STATUS_VALUES = [
  "unknown",
  "no",
  "pregnant",
  "trying",
  "breastfeeding",
] as const;

export const EXPLANATION_STYLES = [
  "simple",
  "detailed",
  "genz",
  "adaptive",
] as const;

export const QUALITY_TIERS = ["low", "medium", "high", "auto"] as const;

const LOCALE_RE = /^[A-Za-z]{2,8}(-[A-Za-z0-9]{1,8})*$/;

export interface ProfilePatch {
  skinType?: string;
  fitzpatrick?: number | null;
  concerns?: string[];
  sensitivities?: string[];
  pregnancyStatus?: string;
}

export function validateProfilePatch(body: unknown): ProfilePatch {
  if (!isPlainObject(body)) fail("profile", "must be an object");
  const out: ProfilePatch = {};
  const raw = body as Record<string, unknown>;
  if (raw.skinType !== undefined) {
    out.skinType = validateEnum(raw.skinType, "skinType", SKIN_TYPES);
  }
  if (raw.fitzpatrick !== undefined) {
    if (raw.fitzpatrick === null) {
      out.fitzpatrick = null;
    } else if (
      typeof raw.fitzpatrick !== "number" ||
      !Number.isInteger(raw.fitzpatrick) ||
      raw.fitzpatrick < 1 ||
      raw.fitzpatrick > 6
    ) {
      fail("fitzpatrick", "must be an integer between 1 and 6, or null");
    } else {
      out.fitzpatrick = raw.fitzpatrick;
    }
  }
  if (raw.concerns !== undefined) {
    out.concerns = validateStringArray(raw.concerns, "concerns", {
      maxItems: 30,
      maxEach: 80,
    });
  }
  if (raw.sensitivities !== undefined) {
    out.sensitivities = validateStringArray(
      raw.sensitivities,
      "sensitivities",
      {
        maxItems: 30,
        maxEach: 80,
      },
    );
  }
  if (raw.pregnancyStatus !== undefined) {
    out.pregnancyStatus = validateEnum(
      raw.pregnancyStatus,
      "pregnancyStatus",
      PREGNANCY_STATUS_VALUES,
    );
  }
  return out;
}

export interface PreferencesPatch {
  explanationStyle?: string;
  voiceEnabled?: boolean;
  voiceURI?: string | null;
  reducedMotion?: boolean;
  qualityTier?: string;
  locale?: string;
}

export function validatePreferencesPatch(body: unknown): PreferencesPatch {
  if (!isPlainObject(body)) fail("preferences", "must be an object");
  const out: PreferencesPatch = {};
  const raw = body as Record<string, unknown>;
  if (raw.explanationStyle !== undefined) {
    out.explanationStyle = validateEnum(
      raw.explanationStyle,
      "explanationStyle",
      EXPLANATION_STYLES,
    );
  }
  if (raw.voiceEnabled !== undefined) {
    if (typeof raw.voiceEnabled !== "boolean")
      fail("voiceEnabled", "must be a boolean");
    out.voiceEnabled = raw.voiceEnabled;
  }
  if (raw.voiceURI !== undefined) {
    if (raw.voiceURI !== null) {
      if (typeof raw.voiceURI !== "string")
        fail("voiceURI", "must be a string or null");
      if (raw.voiceURI.length > 500)
        fail("voiceURI", "must be at most 500 characters");
    }
    out.voiceURI = raw.voiceURI as string | null;
  }
  if (raw.reducedMotion !== undefined) {
    if (typeof raw.reducedMotion !== "boolean")
      fail("reducedMotion", "must be a boolean");
    out.reducedMotion = raw.reducedMotion;
  }
  if (raw.qualityTier !== undefined) {
    out.qualityTier = validateEnum(
      raw.qualityTier,
      "qualityTier",
      QUALITY_TIERS,
    );
  }
  if (raw.locale !== undefined) {
    if (typeof raw.locale !== "string" || !LOCALE_RE.test(raw.locale)) {
      fail("locale", "must be a BCP-47-style locale tag up to 35 characters");
    }
    if (raw.locale.length > 35) fail("locale", "must be at most 35 characters");
    out.locale = raw.locale;
  }
  return out;
}

// ---------------------------------------------------------------------------
// scans (POST /scans, POST /body-scans)
// ---------------------------------------------------------------------------

export const SKIN_METRIC_KEYS = [
  "hydration",
  "oiliness",
  "redness",
  "texture",
  "pores",
  "darkSpots",
  "evenness",
  "underEye",
  "acneIndicators",
] as const;

export const BODY_METRIC_KEYS = [
  "shoulderHipRatio",
  "waistRatio",
  "shoulderTilt",
  "hipTilt",
  "headForward",
  "postureAlignment",
] as const;

export const FACE_REGIONS = [
  "forehead",
  "glabella",
  "nose",
  "cheekLeft",
  "cheekRight",
  "periorbitalLeft",
  "periorbitalRight",
  "perioral",
  "chin",
] as const;

export const CAPTURE_VERDICTS = ["pass", "warn", "fail"] as const;

function validateRegionStats(
  value: unknown,
  field: string,
): Record<string, number> {
  if (!isPlainObject(value)) fail(field, "must be an object");
  const raw = value as Record<string, unknown>;
  const out: Record<string, number> = {};
  for (const key of [
    "samples",
    "L",
    "a",
    "b",
    "sigmaL",
    "specular",
    "highFreq",
    "darkFraction",
  ]) {
    const v = raw[key];
    if (typeof v !== "number" || !Number.isFinite(v))
      fail(`${field}.${key}`, "must be a finite number");
    out[key] = v;
  }
  if (
    !Number.isInteger(out.samples) ||
    out.samples < 0 ||
    out.samples > 100_000_000
  ) {
    fail(`${field}.samples`, "must be an integer between 0 and 100000000");
  }
  if (out.L < 0 || out.L > 100) fail(`${field}.L`, "must be between 0 and 100");
  for (const k of ["a", "b"] as const) {
    if (out[k] < -128 || out[k] > 127)
      fail(`${field}.${k}`, "must be between -128 and 127");
  }
  if (out.sigmaL < 0 || out.sigmaL > 100)
    fail(`${field}.sigmaL`, "must be between 0 and 100");
  for (const k of ["specular", "highFreq", "darkFraction"] as const) {
    if (out[k] < 0 || out[k] > 1)
      fail(`${field}.${k}`, "must be between 0 and 1");
  }
  return out;
}

function validateQuality(value: unknown): Record<string, unknown> {
  if (!isPlainObject(value)) fail("quality", "must be an object");
  const raw = value as Record<string, unknown>;
  validateEnum(raw.verdict, "quality.verdict", CAPTURE_VERDICTS);
  for (const k of [
    "score",
    "brightness",
    "sharpness",
    "faceHeightFraction",
    "centeringError",
  ]) {
    validateBoundedNumber(raw[k], `quality.${k}`, 0, 1);
  }
  const issues =
    raw.issues === undefined
      ? []
      : validateStringArray(raw.issues, "quality.issues", {
          maxItems: 20,
          maxEach: 300,
        });
  return { ...raw, issues };
}

export interface ValidatedScan {
  capturedAt: string;
  metrics: Record<string, number>;
  regions: Record<string, Record<string, number>>;
  quality: Record<string, unknown>;
  confidence: number;
  modelVersion: string;
  observations: string[];
  notes?: string;
}

export function validateScanAnalysis(body: unknown): ValidatedScan {
  if (!isPlainObject(body)) fail("analysis", "must be an object");
  const raw = body as Record<string, unknown>;
  // Facial geometry is ephemeral client state, never a stored scan field.
  if (Object.prototype.hasOwnProperty.call(raw, "landmarks")) {
    fail("analysis", "facial landmarks are not accepted");
  }
  if (!isPlainObject(raw.metrics)) fail("metrics", "metrics are required");
  const metrics: Record<string, number> = {};
  for (const key of SKIN_METRIC_KEYS) {
    metrics[key] = validateBoundedNumber(
      (raw.metrics as Record<string, unknown>)[key],
      `metrics.${key}`,
      0,
      100,
    );
  }
  const regions: Record<string, Record<string, number>> = {};
  if (raw.regions !== undefined) {
    if (!isPlainObject(raw.regions)) fail("regions", "must be an object");
    const entries = Object.entries(raw.regions as Record<string, unknown>);
    if (entries.length > FACE_REGIONS.length)
      fail("regions", "holds too many regions");
    for (const [key, stats] of entries) {
      if (!(FACE_REGIONS as readonly string[]).includes(key))
        fail("regions", `unknown region "${key}"`);
      regions[key] = validateRegionStats(stats, `regions.${key}`);
    }
  }
  const quality =
    raw.quality === undefined ? undefined : validateQuality(raw.quality);
  if (quality === undefined) fail("quality", "must be an object");
  const confidence = validateBoundedNumber(raw.confidence, "confidence", 0, 1);
  const capturedAt =
    raw.capturedAt === undefined
      ? new Date().toISOString()
      : validateTimestamp(raw.capturedAt, "capturedAt");
  const modelVersion =
    raw.modelVersion === undefined
      ? "elohim-skin-1.0.0"
      : validateBoundedString(raw.modelVersion, "modelVersion", 1, 120);
  const observations =
    raw.observations === undefined
      ? []
      : validateStringArray(raw.observations, "observations", {
          maxItems: 30,
          maxEach: 500,
        });
  let notes: string | undefined;
  if (raw.notes !== undefined) {
    if (typeof raw.notes !== "string") fail("notes", "must be a string");
    if (raw.notes.length > 2000)
      fail("notes", "must be at most 2000 characters");
    notes = raw.notes;
  }
  return {
    capturedAt,
    metrics,
    regions,
    quality: quality as Record<string, unknown>,
    confidence,
    modelVersion,
    observations,
    ...(notes !== undefined && { notes }),
  };
}

export interface ValidatedBodyAnalysis {
  capturedAt: string;
  metrics: Record<string, number>;
  waistSource: "silhouette" | "joints";
  profile: Record<string, number> | null;
  profileDetail: Record<string, number> | null;
  landmarks: Array<Record<string, number>>;
  confidence: number;
  modelVersion: string;
  profileModelVersion: string | null;
}

function validateStoredLandmark(
  value: unknown,
  index: number,
): Record<string, number> {
  if (!isPlainObject(value)) fail(`landmarks[${index}]`, "must be an object");
  const raw = value as Record<string, unknown>;
  const out: Record<string, number> = {};
  for (const key of ["x", "y", "z", "visibility"]) {
    const v = raw[key];
    if (
      typeof v !== "number" ||
      !Number.isFinite(v) ||
      v < -10_000 ||
      v > 10_000
    ) {
      fail(`landmarks[${index}].${key}`, "must be a finite number");
    }
    out[key] = v;
  }
  return out;
}

export function validateBodyAnalysis(body: unknown): ValidatedBodyAnalysis {
  if (!isPlainObject(body)) fail("analysis", "must be an object");
  const raw = body as Record<string, unknown>;
  if (!isPlainObject(raw.metrics)) fail("metrics", "metrics are required");
  const metrics: Record<string, number> = {};
  for (const key of BODY_METRIC_KEYS) {
    metrics[key] = validateBoundedNumber(
      (raw.metrics as Record<string, unknown>)[key],
      `metrics.${key}`,
      0,
      100,
    );
  }
  const waistSource = validateEnum(raw.waistSource, "waistSource", [
    "silhouette",
    "joints",
  ] as const);
  let profile: Record<string, number> | null = null;
  if (raw.profile !== undefined && raw.profile !== null) {
    if (!isPlainObject(raw.profile))
      fail("profile", "must be an object or null");
    const v = (raw.profile as Record<string, unknown>).abdominalProfile;
    profile = {
      abdominalProfile: validateBoundedNumber(
        v,
        "profile.abdominalProfile",
        0,
        100,
      ),
    };
  }
  let profileDetail: Record<string, number> | null = null;
  if (raw.profileDetail !== undefined && raw.profileDetail !== null) {
    if (!isPlainObject(raw.profileDetail))
      fail("profileDetail", "must be an object or null");
    const detail = raw.profileDetail as Record<string, unknown>;
    profileDetail = {
      depthRatio: validateBoundedNumber(
        detail.depthRatio,
        "profileDetail.depthRatio",
        0,
        100,
      ),
      chestDepth: validateBoundedNumber(
        detail.chestDepth,
        "profileDetail.chestDepth",
        0,
        100,
      ),
      bellyDepth: validateBoundedNumber(
        detail.bellyDepth,
        "profileDetail.bellyDepth",
        0,
        100,
      ),
    };
  }
  let landmarks: Array<Record<string, number>> = [];
  if (raw.landmarks !== undefined) {
    if (!Array.isArray(raw.landmarks)) fail("landmarks", "must be an array");
    if (raw.landmarks.length > 1000)
      fail("landmarks", "must hold at most 1000 entries");
    landmarks = (raw.landmarks as unknown[]).map((entry, i) =>
      validateStoredLandmark(entry, i),
    );
  }
  const confidence =
    raw.confidence === undefined
      ? 0
      : validateBoundedNumber(raw.confidence, "confidence", 0, 1);
  const capturedAt =
    raw.capturedAt === undefined
      ? new Date().toISOString()
      : validateTimestamp(raw.capturedAt, "capturedAt");
  const modelVersion =
    raw.modelVersion === undefined
      ? "elohim-body-1.0.0"
      : validateBoundedString(raw.modelVersion, "modelVersion", 1, 120);
  const profileModelVersion =
    raw.profileModelVersion === undefined || raw.profileModelVersion === null
      ? null
      : validateBoundedString(
          raw.profileModelVersion,
          "profileModelVersion",
          1,
          120,
        );
  return {
    capturedAt,
    metrics,
    waistSource,
    profile,
    profileDetail,
    landmarks,
    confidence,
    modelVersion,
    profileModelVersion,
  };
}

// ---------------------------------------------------------------------------
// products + routine (POST /products, POST /routine)
// ---------------------------------------------------------------------------

export interface ValidatedProductInput {
  name: string;
  brand: string | null;
  category: string | null;
  ingredients: string[];
}

export function validateProductInput(body: unknown): ValidatedProductInput {
  if (!isPlainObject(body)) fail("product", "must be an object");
  const raw = body as Record<string, unknown>;
  const name = validateBoundedString(raw.name, "name", 1, 200).trim();
  if (!name) fail("name", "must not be blank");
  const brand = validateOptionalBoundedString(raw.brand, "brand", 200);
  const category = validateOptionalBoundedString(raw.category, "category", 100);
  let ingredients: string[] = [];
  if (raw.ingredients !== undefined) {
    ingredients = validateStringArray(raw.ingredients, "ingredients", {
      maxItems: 50,
      maxEach: 200,
    })
      .map((s) => s.trim())
      .filter(Boolean);
    if (ingredients.length > 50)
      fail("ingredients", "must hold at most 50 items");
  }
  return { name, brand, category, ingredients };
}

export interface ValidatedRoutineInput {
  productId: string;
  frequency: string | null;
  startedAt: string | null;
  notes: string | null;
}

export function validateRoutineInput(body: unknown): ValidatedRoutineInput {
  if (!isPlainObject(body)) fail("routine", "must be an object");
  const raw = body as Record<string, unknown>;
  if (typeof raw.productId !== "string" || !raw.productId.trim()) {
    fail("productId", "a known productId is required");
  }
  let frequency: string | null = null;
  if (raw.frequency !== undefined && raw.frequency !== null) {
    if (typeof raw.frequency !== "string")
      fail("frequency", "must be a string or null");
    if (raw.frequency.length > 100)
      fail("frequency", "must be at most 100 characters");
    frequency = raw.frequency;
  }
  let startedAt: string | null = null;
  if (raw.startedAt !== undefined && raw.startedAt !== null) {
    startedAt = validateTimestamp(raw.startedAt, "startedAt");
  }
  let notes: string | null = null;
  if (raw.notes !== undefined && raw.notes !== null) {
    if (typeof raw.notes !== "string")
      fail("notes", "must be a string or null");
    if (raw.notes.length > 2000)
      fail("notes", "must be at most 2000 characters");
    notes = raw.notes;
  }
  return { productId: raw.productId as string, frequency, startedAt, notes };
}

// ---------------------------------------------------------------------------
// consent evidence (POST /me/consents/:type/decisions)
// ---------------------------------------------------------------------------

/**
 * Client-supplied consent metadata allowlist. Actor identity (actorType,
 * actorId), provenance (source, ip) and the idempotency key are
 * server-reserved and never accepted from the client — anything else not
 * listed here is stripped, never stored.
 */
export const CONSENT_CLIENT_METADATA_ALLOWLIST = [
  "choice",
  "demoOnly",
  "wordingStatus",
  "documentVersions",
  "locale",
] as const;

const CONSENT_SERVER_RESERVED = [
  "actorType",
  "actorId",
  "source",
  "ip",
  "idempotencyKey",
] as const;

export function sanitizeConsentClientMetadata(
  raw: unknown,
): Record<string, unknown> {
  if (raw === undefined || raw === null) return {};
  if (!isPlainObject(raw)) fail("metadata", "must be an object");
  const out: Record<string, unknown> = {};
  for (const key of CONSENT_CLIENT_METADATA_ALLOWLIST) {
    const value = (raw as Record<string, unknown>)[key];
    if (value !== undefined) out[key] = value;
  }
  // Validate the admitted fields narrowly: choice is a short token, statuses
  // are short tokens, documentVersions is a small string map.
  if (
    out.choice !== undefined &&
    (typeof out.choice !== "string" || out.choice.length > 40)
  ) {
    fail("metadata.choice", "must be a string of at most 40 characters");
  }
  if (
    out.wordingStatus !== undefined &&
    (typeof out.wordingStatus !== "string" || out.wordingStatus.length > 40)
  ) {
    fail("metadata.wordingStatus", "must be a string of at most 40 characters");
  }
  if (
    out.locale !== undefined &&
    (typeof out.locale !== "string" || out.locale.length > 35)
  ) {
    fail("metadata.locale", "must be a string of at most 35 characters");
  }
  if (out.demoOnly !== undefined && typeof out.demoOnly !== "boolean") {
    fail("metadata.demoOnly", "must be a boolean");
  }
  if (out.documentVersions !== undefined) {
    if (!isPlainObject(out.documentVersions))
      fail("metadata.documentVersions", "must be an object");
    const entries = Object.entries(
      out.documentVersions as Record<string, unknown>,
    );
    if (entries.length > 20)
      fail("metadata.documentVersions", "must hold at most 20 entries");
    for (const [k, v] of entries) {
      if (k.length > 100 || typeof v !== "string" || v.length > 100) {
        fail(
          "metadata.documentVersions",
          "keys and values must be strings of at most 100 characters",
        );
      }
    }
  }
  void CONSENT_SERVER_RESERVED;
  return out;
}
