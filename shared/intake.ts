import type { CharacterDirective, PregnancyStatus, SkinType } from './types.ts';

export const INTAKE_VERSION = 1 as const;
export const AGE_BANDS = ['under-18', '18-24', '25-34', '35-44', '45-54', '55-64', '65-plus', 'prefer-not-to-say'] as const;
export const INTAKE_GOALS = ['comfort', 'breakouts', 'even-tone', 'texture', 'dryness', 'simple-routine', 'sun-care', 'unsure'] as const;
export const SKIN_FEELS = ['tight-dry', 'shiny-oily', 'mixed', 'comfortable', 'varies', 'unsure'] as const;
export const REACTIVITY = ['often', 'sometimes', 'rarely', 'unsure'] as const;
export const SUN_EXPOSURE = ['mostly-indoors', 'some-outdoor-time', 'often-outdoors', 'varies'] as const;
export const SPF_HABITS = ['most-days', 'some-days', 'rarely', 'unsure'] as const;
export const PREGNANCY_CHOICES = ['include', 'skip'] as const;
export const INTAKE_PREGNANCY = ['pregnant', 'trying', 'breastfeeding', 'no', 'prefer-not-to-say'] as const;

/** Self-reported, optional context. No image-derived or diagnostic fields. */
export interface IntakeAnswers {
  preferredName: string | null;
  ageBand: (typeof AGE_BANDS)[number] | null;
  goals: Array<(typeof INTAKE_GOALS)[number]>;
  goalNote: string | null;
  skinFeel: (typeof SKIN_FEELS)[number] | null;
  reactivity: (typeof REACTIVITY)[number] | null;
  currentRoutine: string | null;
  allergies: string | null;
  medications: string | null;
  pregnancyChoice: (typeof PREGNANCY_CHOICES)[number] | null;
  pregnancyStatus: (typeof INTAKE_PREGNANCY)[number] | null;
  sunExposure: (typeof SUN_EXPOSURE)[number] | null;
  spfHabit: (typeof SPF_HABITS)[number] | null;
  triggers: string | null;
  recentProcedures: string | null;
}
export interface IntakeDraft { schemaVersion: typeof INTAKE_VERSION; answers: IntakeAnswers; storageConsent: boolean }
export interface IntakeRecord { schemaVersion: typeof INTAKE_VERSION; answers: IntakeAnswers; storageConsent: true; consentedAt: string; updatedAt: string }
export interface IntakePresentation { phase: 'welcome' | 'question' | 'complete'; line: string; directive: CharacterDirective }

export function emptyIntakeDraft(): IntakeDraft {
  return { schemaVersion: INTAKE_VERSION, storageConsent: false, answers: {
    preferredName: null, ageBand: null, goals: [], goalNote: null, skinFeel: null, reactivity: null,
    currentRoutine: null, allergies: null, medications: null, pregnancyChoice: null, pregnancyStatus: null,
    sunExposure: null, spfHabit: null, triggers: null, recentProcedures: null,
  } };
}

export class IntakeValidationError extends Error {
  constructor(message = 'The intake contains an invalid answer.') { super(message); this.name = 'IntakeValidationError'; }
}
const object = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
function onlyKeys(value: Record<string, unknown>, allowed: string[]): void {
  if (Object.keys(value).some((key) => !allowed.includes(key))) throw new IntakeValidationError('The intake contains an unsupported field.');
}
function choice<T extends string>(value: unknown, allowed: readonly T[], key: string): T | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string' || !allowed.includes(value as T)) throw new IntakeValidationError(`Choose a valid answer for ${key}.`);
  return value as T;
}
function text(value: unknown, limit: number, key: string): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string' || value.length > limit || /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(value)) {
    throw new IntakeValidationError(`Use at most ${limit} plain-text characters for ${key}.`);
  }
  return value.trim() || null;
}
/** Shared normalization, repeated at the authenticated persistence boundary. */
export function validateIntakeDraft(value: unknown): IntakeDraft {
  if (!object(value)) throw new IntakeValidationError();
  onlyKeys(value, ['schemaVersion', 'storageConsent', 'answers']);
  if (value.schemaVersion !== INTAKE_VERSION || typeof value.storageConsent !== 'boolean' || !object(value.answers)) throw new IntakeValidationError();
  const a = value.answers;
  onlyKeys(a, Object.keys(emptyIntakeDraft().answers));
  if (a.goals !== undefined && (!Array.isArray(a.goals) || a.goals.length > 3 || a.goals.some((goal) => typeof goal !== 'string' || !INTAKE_GOALS.includes(goal as never)))) {
    throw new IntakeValidationError('Choose up to three skin goals.');
  }
  const goals = [...new Set((a.goals ?? []) as IntakeAnswers['goals'])];
  if (goals.includes('unsure') && goals.length > 1) throw new IntakeValidationError('Choose a goal or choose not sure.');
  const pregnancyChoice = choice(a.pregnancyChoice, PREGNANCY_CHOICES, 'pregnancy question');
  const pregnancyStatus = choice(a.pregnancyStatus, INTAKE_PREGNANCY, 'pregnancy or breastfeeding');
  if (pregnancyStatus !== null && pregnancyChoice !== 'include') throw new IntakeValidationError('A skipped pregnancy question cannot contain an answer.');
  return { schemaVersion: INTAKE_VERSION, storageConsent: value.storageConsent, answers: {
    preferredName: text(a.preferredName, 60, 'preferred name'), ageBand: choice(a.ageBand, AGE_BANDS, 'age band'),
    goals, goalNote: text(a.goalNote, 400, 'skin goals'), skinFeel: choice(a.skinFeel, SKIN_FEELS, 'skin feel'),
    reactivity: choice(a.reactivity, REACTIVITY, 'sensitivity'), currentRoutine: text(a.currentRoutine, 800, 'current routine'),
    allergies: text(a.allergies, 600, 'allergies or reactions'), medications: text(a.medications, 600, 'relevant treatments'),
    pregnancyChoice, pregnancyStatus, sunExposure: choice(a.sunExposure, SUN_EXPOSURE, 'sun exposure'),
    spfHabit: choice(a.spfHabit, SPF_HABITS, 'sun protection'), triggers: text(a.triggers, 400, 'triggers'),
    recentProcedures: text(a.recentProcedures, 600, 'recent procedures'),
  } };
}

export const GOAL_LABELS: Record<IntakeAnswers['goals'][number], string> = {
  comfort: 'Feel calmer and more comfortable', breakouts: 'Care for breakout-prone skin', 'even-tone': 'A more even-looking tone',
  texture: 'A smoother-looking texture', dryness: 'Feel less dry', 'simple-routine': 'Find a simpler routine',
  'sun-care': 'Build a sun-care habit', unsure: 'I am still figuring it out',
};
/** Only user-declared choices map to the existing profile; nothing is inferred. */
export function intakeProfileFields(a: IntakeAnswers): { skinType?: SkinType; concerns?: string[]; pregnancyStatus: PregnancyStatus } {
  const skinTypes: Record<NonNullable<IntakeAnswers['skinFeel']>, SkinType> = {
    'tight-dry': 'dry', 'shiny-oily': 'oily', mixed: 'combination', comfortable: 'normal', varies: 'unknown', unsure: 'unknown',
  };
  return { ...(a.skinFeel ? { skinType: skinTypes[a.skinFeel] } : {}),
    ...(a.goals.length ? { concerns: a.goals.filter((goal) => goal !== 'unsure').map((goal) => GOAL_LABELS[goal]) } : {}),
    pregnancyStatus: a.pregnancyChoice === 'include' && a.pregnancyStatus && a.pregnancyStatus !== 'prefer-not-to-say'
      ? a.pregnancyStatus : 'unknown' };
}
