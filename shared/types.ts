/**
 * The contract between every layer of Elohim.
 *
 * This file is imported by the character engine, the skin-analysis engine, the
 * orchestrator and the database layer alike — it is the only thing they are all
 * allowed to share. Nothing in here may import anything else.
 */

// ---------------------------------------------------------------------------
// Skin appearance
// ---------------------------------------------------------------------------

/**
 * Deliberately named "appearance" and not "diagnosis". These are measurements of
 * how skin *looks* under a normalised capture, not clinical findings.
 */
export const SKIN_METRIC_KEYS = [
  'hydration',
  'oiliness',
  'redness',
  'texture',
  'pores',
  'darkSpots',
  'evenness',
  'underEye',
  'acneIndicators',
] as const;

export type SkinMetricKey = (typeof SKIN_METRIC_KEYS)[number];

export type SkinAppearanceMetrics = Record<SkinMetricKey, number>;

/** Whether a *higher* number is a better outcome for this metric. */
export const METRIC_HIGHER_IS_BETTER: Record<SkinMetricKey, boolean> = {
  hydration: true,
  evenness: true,
  oiliness: false,
  redness: false,
  texture: false,
  pores: false,
  darkSpots: false,
  underEye: false,
  acneIndicators: false,
};

/**
 * Smallest change we are willing to call a change, per metric, in score points.
 * Derived from repeat-capture variance of the same face under varied lighting.
 * Anything below this is reported as "holding steady" — see ARCHITECTURE §4.
 */
export const METRIC_NOISE_FLOOR: Record<SkinMetricKey, number> = {
  hydration: 4,
  oiliness: 5,
  redness: 4,
  texture: 4,
  pores: 5,
  /*
   * Raised from 3 to 8.
   *
   * `test/calibration.test.ts` re-measures a synthetic face through the real
   * normalise-then-measure path after a ±12% exposure change — the difference
   * between a window and a lamp. Every other metric holds inside its floor.
   * Dark-spot area moves about 8 points, because it is a threshold-crossing
   * count and the 8-bit round trip widens the luminance distribution enough to
   * push pixels across the line.
   *
   * A floor of 3 therefore licensed the app to call a 4-point lighting artefact
   * a real change in pigmentation, which is precisely the comfortable lie §4
   * exists to prevent. Raising it only ever makes the product claim *less*, so
   * it is the safe direction to move on synthetic evidence; a real repeat-
   * capture study (scripts/repeatability.mjs) should replace this number with a
   * measured one.
   */
  darkSpots: 8,
  evenness: 4,
  underEye: 5,
  acneIndicators: 4,
};

export const METRIC_LABELS: Record<SkinMetricKey, string> = {
  hydration: 'Hydration',
  oiliness: 'Oiliness',
  redness: 'Redness',
  texture: 'Texture',
  pores: 'Pores',
  darkSpots: 'Dark spots',
  evenness: 'Tone evenness',
  underEye: 'Under-eye',
  acneIndicators: 'Breakout signs',
};

export const FACE_REGIONS = [
  'forehead',
  'glabella',
  'nose',
  'cheekLeft',
  'cheekRight',
  'periorbitalLeft',
  'periorbitalRight',
  'perioral',
  'chin',
] as const;

export type FaceRegionKey = (typeof FACE_REGIONS)[number];

export interface RegionStats {
  /** Pixel count actually sampled after masking. */
  samples: number;
  /** CIELAB means over the region. */
  L: number;
  a: number;
  b: number;
  /** Local standard deviation of L* at fine scale — the texture signal. */
  sigmaL: number;
  /** Fraction of pixels reading as specular highlight. */
  specular: number;
  /** High-frequency energy, normalised by region area. */
  highFreq: number;
  /** Fraction of pixels below the adaptive dark-blob threshold. */
  darkFraction: number;
}

export type CaptureVerdict = 'pass' | 'warn' | 'fail';

export interface CaptureQuality {
  verdict: CaptureVerdict;
  /** 0..1, feeds SkinAnalysis.confidence. */
  score: number;
  brightness: number;
  sharpness: number;
  faceHeightFraction: number;
  centeringError: number;
  /** Human-readable, shown verbatim by Elohim. Empty when the verdict is 'pass'. */
  issues: string[];
}

/** Bumped whenever a metric formula changes; trends never cross versions. */
export const SKIN_MODEL_VERSION = 'elohim-skin-1.0.0';

export interface SkinAnalysis {
  id?: string;
  capturedAt: string;
  metrics: SkinAppearanceMetrics;
  regions: Partial<Record<FaceRegionKey, RegionStats>>;
  quality: CaptureQuality;
  /** 0..1 — quality score times ROI confidence. */
  confidence: number;
  modelVersion: string;
  /**
   * Whether a photo was kept for this scan.
   *
   * Storage is off by default and additionally requires a server blob key, so
   * most scans have no image. The client needs to know which do *before* it
   * offers to show one — asking and getting a 404 would mean advertising a
   * feature and then failing at it.
   */
  hasImage?: boolean;
  /** Optional qualitative layer from cloud reasoning; never replaces metrics. */
  observations?: string[];
  notes?: string;
}

// ---------------------------------------------------------------------------
// Longitudinal model
// ---------------------------------------------------------------------------

export type TrendDirection = 'improving' | 'declining' | 'steady';

export interface MetricTrend {
  key: SkinMetricKey;
  current: number;
  previous: number | null;
  first: number | null;
  deltaFromPrevious: number | null;
  deltaFromFirst: number | null;
  /** Least-squares slope in points per week across the window. */
  slopePerWeek: number | null;
  /** False when |delta| is under this metric's noise floor. */
  significant: boolean;
  direction: TrendDirection;
}

export interface ProductCorrelation {
  productId: string;
  productName: string;
  overlapDays: number;
  scansDuringUse: number;
  /** Correlation only. Never phrased as causation — ARCHITECTURE §4. */
  metricDeltasDuringUse: Partial<Record<SkinMetricKey, number>>;
}

export interface LongitudinalSummary {
  scanCount: number;
  windowDays: number;
  trends: MetricTrend[];
  correlations: ProductCorrelation[];
  /** True when the history spans more than one model version. */
  mixedModelVersions: boolean;
  headline: string | null;
}

// ---------------------------------------------------------------------------
// Character direction
// ---------------------------------------------------------------------------

export const CHARACTER_STATES = [
  'IDLE',
  'LISTENING',
  'THINKING',
  'SPEAKING',
  'HAPPY',
  'CONCERNED',
  'EXCITED',
  'CONFUSED',
  'CLINICAL_ANALYSIS',
  'ANALYSIS_COMPLETE',
  'EXPLAINING',
  'GOODBYE',
] as const;

export type CharacterState = (typeof CHARACTER_STATES)[number];

export const EXPRESSIONS = [
  'neutral',
  'warm',
  'smile',
  'grin',
  'concerned',
  'curious',
  'reassuring',
  'focused',
  'surprised',
] as const;

export type Expression = (typeof EXPRESSIONS)[number];

export const GESTURES = [
  'none',
  'nod',
  'slow_nod',
  'head_tilt',
  'small_wave',
  'open_palms',
  'point_to_hologram',
  'hand_to_chin',
  'lean_in',
] as const;

export type Gesture = (typeof GESTURES)[number];

export const VISEMES = ['sil', 'AA', 'EE', 'IH', 'OH', 'OU', 'MBP', 'FV', 'L', 'S'] as const;
export type Viseme = (typeof VISEMES)[number];

/**
 * The *only* channel through which the AI may influence the character.
 * Every field is a closed vocabulary; anything unrecognised is rejected by
 * `sanitiseDirective` rather than passed to the rig — ARCHITECTURE §5.2.
 */
export interface CharacterDirective {
  state: CharacterState;
  expression: Expression;
  gesture: Gesture;
  /** 0..1 — how strongly to play the expression. */
  intensity: number;
}

export const DEFAULT_DIRECTIVE: CharacterDirective = {
  state: 'IDLE',
  expression: 'warm',
  gesture: 'none',
  intensity: 0.5,
};

// ---------------------------------------------------------------------------
// Conversation
// ---------------------------------------------------------------------------

export const EMOTIONS = [
  'happy',
  'excited',
  'frustrated',
  'worried',
  'sad',
  'confused',
  'curious',
  'embarrassed',
  'neutral',
  'playful',
] as const;

export type Emotion = (typeof EMOTIONS)[number];

export const INTENTS = [
  'greeting',
  'small_talk',
  'venting',
  'describe_concern',
  'ask_question',
  'request_scan',
  'request_results',
  'request_progress',
  'ask_product',
  'update_routine',
  'set_preference',
  'goodbye',
  'other',
] as const;

export type Intent = (typeof INTENTS)[number];

export type ExplanationStyle = 'simple' | 'detailed' | 'genz' | 'adaptive';

export interface TurnClassification {
  emotion: Emotion;
  intent: Intent;
  /** 0..1 confidence in the classification. */
  confidence: number;
  /** True when the user is describing something that needs a human clinician. */
  escalate: boolean;
  /**
   * True when that clinician is needed today rather than at an appointment —
   * airway or allergic symptoms, or a reaction that is spreading.
   */
  urgent: boolean;
}

export type MemoryKind = 'skin' | 'routine' | 'preference' | 'product' | 'context';

export interface MemoryWrite {
  kind: MemoryKind;
  /** Stable key so a later contradiction updates rather than duplicates. */
  key: string;
  value: string;
  confidence: number;
}

export interface MemoryRecord extends MemoryWrite {
  id: string;
  updatedAt: string;
}

/** What the conversation engine returns for one user turn. */
export interface ElohimTurn {
  text: string;
  directive: CharacterDirective;
  classification: TurnClassification;
  memoryWrites: MemoryWrite[];
  /** Client-side actions Elohim is asking the UI to take. Closed vocabulary. */
  actions: ElohimAction[];
  /** True when produced by the local fallback rather than the model. */
  demo: boolean;
}

export type ElohimAction =
  | { type: 'offer_scan'; reason: string }
  | { type: 'enter_clinical' }
  | { type: 'show_progress'; metric?: SkinMetricKey }
  | { type: 'show_history' }
  | { type: 'ask_explanation_style' };

export interface ChatMessage {
  id: string;
  role: 'user' | 'elohim';
  content: string;
  createdAt: string;
  emotion?: Emotion;
  intent?: Intent;
  directive?: CharacterDirective;
  demo?: boolean;
}

// ---------------------------------------------------------------------------
// User
// ---------------------------------------------------------------------------

export type SkinType = 'dry' | 'oily' | 'combination' | 'normal' | 'sensitive' | 'unknown';

/**
 * Pregnancy status, because it changes which actives are appropriate.
 *
 * `unknown` is the default and is deliberately distinct from `no`. Someone who
 * has not been asked, and someone who chose not to answer, are both unknown —
 * and neither may be treated as a "no". Recommendations that depend on this
 * are handled conservatively when it is unknown rather than assuming the
 * convenient answer.
 */
export type PregnancyStatus = 'unknown' | 'no' | 'pregnant' | 'trying' | 'breastfeeding';

/** Every valid value, for validating input against the union at runtime. */
export const PREGNANCY_STATUSES: readonly PregnancyStatus[] = [
  'unknown',
  'no',
  'pregnant',
  'trying',
  'breastfeeding',
];

export const PREGNANCY_STATUS_LABELS: Record<PregnancyStatus, string> = {
  unknown: 'Prefer not to say',
  no: 'No',
  pregnant: 'Pregnant',
  trying: 'Trying to conceive',
  breastfeeding: 'Breastfeeding',
};

/** The statuses under which a pregnancy-vetoed active is withheld outright. */
export const PREGNANCY_RESTRICTED: readonly PregnancyStatus[] = [
  'pregnant',
  'trying',
  'breastfeeding',
];

export interface SkinProfile {
  skinType: SkinType;
  fitzpatrick: number | null;
  concerns: string[];
  sensitivities: string[];
  /** See PregnancyStatus — `unknown` means unanswered, never "no". */
  pregnancyStatus: PregnancyStatus;
  updatedAt: string;
}

export interface Preferences {
  explanationStyle: ExplanationStyle;
  voiceEnabled: boolean;
  /** Chosen speech-synthesis voice; null means Elohim picks the best available. */
  voiceURI: string | null;
  reducedMotion: boolean;
  qualityTier: 'low' | 'medium' | 'high' | 'auto';
  locale: string;
}

export const DEFAULT_PREFERENCES: Preferences = {
  explanationStyle: 'adaptive',
  voiceEnabled: true,
  voiceURI: null,
  reducedMotion: false,
  qualityTier: 'auto',
  locale: 'en',
};

export type ConsentType = string;
export type ConsentState = 'granted' | 'withdrawn';

export interface ConsentDecision {
  id: string;
  userId: string;
  consentType: ConsentType;
  wordingVersionId: string;
  state: ConsentState;
  recordedAt: string;
  actorType?: string;
  actorId?: string;
  metadata?: Record<string, unknown>;
  idempotencyKey: string;
}

export interface ConsentSummary {
  consentType: ConsentType;
  state: ConsentState;
  wordingVersionId: string;
  recordedAt: string;
  decisionId: string;
}

export type ConsentSummaries = Record<ConsentType, ConsentSummary | undefined>;

export function hasConsent(
  consents: ConsentSummaries | undefined,
  consentType: ConsentType,
): boolean {
  return consents?.[consentType]?.state === 'granted';
}

/** Metadata only. Image bytes are fetched through the authenticated image route. */
export interface ProgressPhoto {
  id: string;
  skinScanId: string | null;
  createdAt: string;
  capturedAt: string;
  consentEventId: string;
  /** Non-biometric display hints only; never landmarks or face geometry. */
  presentation?: Record<string, string>;
}

export interface UserSummary {
  id: string;
  email: string;
  displayName: string;
  createdAt: string;
  profile: SkinProfile;
  preferences: Preferences;
  /** Missing key means no decision has ever been recorded. */
  consents: ConsentSummaries;
  scanCount: number;
}

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------

export interface Product {
  id: string;
  name: string;
  brand: string | null;
  category: string | null;
  ingredients: string[];
  source: 'user' | 'catalogue';
}

/** A product on the operator's shelf: something she can point to and link. */
export interface CatalogueProduct {
  id: string;
  source: 'shopify' | 'woocommerce' | 'import' | 'manual';
  sku: string | null;
  name: string;
  brand: string | null;
  category: string | null;
  description: string;
  ingredients: string[];
  tags: string[];
  priceCents: number | null;
  currency: string;
  url: string;
  imageUrl: string | null;
  inStock: boolean;
  updatedAt: string;
}

/**
 * Somewhere else a product can be bought.
 *
 * `compared` is the honesty bit: true only when the price was actually
 * fetched from the merchant, so a search link never counts as a comparison.
 */
export interface Offer {
  merchant: string;
  title: string;
  priceCents: number | null;
  currency: string | null;
  url: string;
  imageUrl: string | null;
  compared: boolean;
}

/** One suggestion turned into something to buy, with the reasoning attached. */
export interface ProductPick {
  suggestion: {
    step: RoutineStep;
    title: string;
    actives: string[];
    because: { key: SkinMetricKey; value: number; label: string } | null;
    why: string;
    cautions: string[];
  };
  /** The shelf product, or null when the shelf has nothing for this step. */
  product: CatalogueProduct | null;
  /** Actives found in or on the product. */
  matched: string[];
  /** The shop name when the pick is from the shelf. */
  from: string | null;
  offers: Offer[];
  /** The price sentence, written from what was actually fetched. */
  priceNote: string;
  /** How many priced sources were compared. 0 or 1 is not a comparison. */
  compared: number;
  /** Where to send the tap: the best price, or the shelf, or the first link. */
  bestUrl: string | null;
  reason: string;
}

export interface CatalogueStatus {
  storeName: string;
  storeUrl: string | null;
  products: number;
  lastSync: string | null;
  lastSource: 'shopify' | 'woocommerce' | 'import' | 'manual' | null;
  lastError: string | null;
  /** Whether a marketplace is configured for real price comparison. */
  comparison: boolean;
}

export interface ProductUsage {
  id: string;
  product: Product;
  startedAt: string;
  endedAt: string | null;
  frequency: string | null;
  notes: string | null;
}

export interface IngredientFinding {
  ingredient: string;
  severity: 'info' | 'caution' | 'avoid';
  reason: string;
}

export type RoutineStep = 'cleanse' | 'treat' | 'hydrate' | 'protect';

/**
 * One recommendation. Carries the metric that triggered it so the UI — and
 * Elohim — can always answer "why are you telling me this?".
 */
export interface Suggestion {
  step: RoutineStep;
  title: string;
  actives: string[];
  family: string;
  because: { key: SkinMetricKey; value: number; label: string } | null;
  why: string;
  cautions: string[];
  alreadyCovered: boolean;
  coveredBy: string[];
  priority: number;
}

export interface RoutinePlan {
  suggestions: Suggestion[];
  gaps: RoutineStep[];
  caveat: string;
}

/** Whole-routine review: what is doubled up, conflicting or missing. */
export type OutcomeVerdict =
  | 'working'
  | 'no_evidence'
  | 'wrong_way'
  | 'too_early'
  | 'not_scored'
  | 'unrecognised';

/** Whether a product in the routine achieved the thing it was suggested for. */
export interface RoutineOutcome {
  productId: string;
  productName: string;
  metric: SkinMetricKey | null;
  metricLabel: string | null;
  startedAt: string;
  daysInUse: number;
  scansDuringUse: number;
  valueAtStart: number | null;
  valueNow: number | null;
  delta: number | null;
  noiseFloor: number | null;
  verdict: OutcomeVerdict;
  /** Plain language, shown verbatim. Always states the association caveat. */
  statement: string;
}

export interface RoutineReview {
  stacked: Array<{ family: string; label: string; products: string[] }>;
  conflicts: string[];
  missing: string[];
  unrecognisedCount: number;
}

export interface ProductAssessment {
  product: Product;
  verdict: 'good_fit' | 'probably_fine' | 'be_cautious' | 'not_now';
  findings: IngredientFinding[];
  /** Overlapping actives already in the routine. */
  overlaps: string[];
  rationale: string;
}

/**
 * A body reading, passed to Elohim with the event rather than stored.
 *
 * Body scans have no server table, so this travels with the message that needs
 * it and is gone afterwards. That is a deliberate consequence of the split:
 * body and skin readings are measured by different pipelines against different
 * model versions and nothing may ever compare one to the other, so putting
 * these in the skin table to make them convenient would create exactly the bug
 * the two lists exist to prevent.
 */
export interface BodyFindingSummary {
  /**
   * The metric key, not its label.
   *
   * This payload is built by the browser and ends up inside a model prompt, so
   * it is the one place in the app where client-supplied text could become
   * instructions. Keys are checked against BODY_READING_LABELS server-side and
   * anything unrecognised is dropped, which means no string the client invents
   * can reach the prompt at all.
   */
  key: string;
  /** 0-100 on the metric's own scale. */
  value: number;
  kind: 'concern' | 'movement' | 'tracked';
  /** Change since the previous scan, or null on a first reading. */
  delta: number | null;
}

/**
 * Every body reading that may cross the wire, and what to call it.
 *
 * The server's allow-list and the client's display labels have to agree; a test
 * asserts they do, because a key that exists on one side and not the other
 * would silently drop a finding rather than fail.
 */
export const BODY_METRIC_KEYS = [
  'shoulderHipRatio',
  'waistRatio',
  'shoulderTilt',
  'hipTilt',
  'headForward',
  'postureAlignment',
] as const;

export type BodyMetricKey = (typeof BODY_METRIC_KEYS)[number];

export const PROFILE_METRIC_KEYS = ['abdominalProfile'] as const;

export type ProfileMetricKey = (typeof PROFILE_METRIC_KEYS)[number];

export const BODY_READING_LABELS: Record<string, string> = {
  shoulderHipRatio: 'Shoulder-to-hip',
  waistRatio: 'Waist width',
  shoulderTilt: 'Shoulder level',
  hipTilt: 'Hip level',
  headForward: 'Head position',
  postureAlignment: 'Vertical alignment',
  abdominalProfile: 'Abdomen',
};

export interface BodySnapshot {
  findings: BodyFindingSummary[];
  /** 0..1 — the weakest joint the measurements depend on. */
  confidence: number;
  /** Whether a side view was taken. Without one there is no abdominal reading. */
  hasProfile: boolean;
}

/**
 * A body reading as it is stored and returned by the server.
 *
 * Mirrors the client's `BodyAnalysis` with the two image flags the client
 * cannot know for itself. Kept in shared/ rather than derived from the client
 * type because the server owns the stored shape, and the pipeline type carries
 * things — raw frames — that are deliberately never persisted.
 */
export interface StoredLandmark {
  x: number;
  y: number;
  z: number;
  visibility: number;
}

export interface BodyProfileDetail {
  depthRatio: number;
  chestDepth: number;
  bellyDepth: number;
}

export interface BodyAnalysisRecord {
  id?: string;
  capturedAt: string;
  metrics: Record<BodyMetricKey, number>;
  waistSource: 'silhouette' | 'joints';
  /** Null on a front-only scan: no side view, so no abdominal reading exists. */
  profile: Record<ProfileMetricKey, number> | null;
  profileDetail: BodyProfileDetail | null;
  landmarks: StoredLandmark[];
  confidence: number;
  modelVersion: string;
  profileModelVersion: string | null;
  hasImage?: boolean;
  hasProfileImage?: boolean;
}
