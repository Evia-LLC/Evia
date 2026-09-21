import { GOAL_LABELS, type IntakeAnswers } from '@shared/intake.ts';
import type { CharacterDirective } from '@shared/types.ts';

/** Fixed public narration only. Never interpolate an entered answer here. */
export const INTAKE_WELCOME_LINE = 'I know how tiring it can feel when your skin doesn’t feel like you. I’m Ese, your AI skincare companion. There’s no judgment here. Let’s get to know you, one question at a time.';
export const INTAKE_COMPLETE_LINE = 'Thank you for sharing what feels comfortable. You decide what I remember. Shall we make a little space for your skincare journey?';
export interface IntakeQuestion {
  key: Exclude<keyof IntakeAnswers, 'goalNote'>;
  section: string;
  prompt: string;
  help: string;
  kind: 'text' | 'single' | 'goals';
  options?: Array<{ value: string; label: string }>;
  limit?: number;
  placeholder?: string;
  sensitive?: boolean;
  directive: CharacterDirective;
}
const interested: CharacterDirective = { state: 'LISTENING', expression: 'curious', gesture: 'head_tilt', intensity: 0.38 };
const reassuring: CharacterDirective = { state: 'EXPLAINING', expression: 'reassuring', gesture: 'open_palms', intensity: 0.45 };
const warm: CharacterDirective = { state: 'IDLE', expression: 'warm', gesture: 'slow_nod', intensity: 0.42 };
const options = (pairs: Array<[string, string]>) => pairs.map(([value, label]) => ({ value, label }));
export const INTAKE_QUESTIONS: readonly IntakeQuestion[] = [
  { key: 'preferredName', section: 'A little about you', prompt: 'What would you like me to call you?',
    help: 'A first name or nickname is enough. You can leave this blank.', kind: 'text', limit: 60, placeholder: 'Your preferred name', directive: warm },
  { key: 'ageBand', section: 'A little about you', prompt: 'Would you like to share your age range?',
    help: 'Optional. I do not need your birthday or exact age.', kind: 'single', directive: interested,
    options: options([['under-18', 'Under 18'], ['18-24', '18–24'], ['25-34', '25–34'], ['35-44', '35–44'], ['45-54', '45–54'], ['55-64', '55–64'], ['65-plus', '65+'], ['prefer-not-to-say', 'Prefer not to say']]) },
  { key: 'goals', section: 'What matters to you', prompt: 'What would you most like your skincare to help with?',
    help: 'Choose up to three. There is no ideal skin you have to aim for.', kind: 'goals', directive: reassuring,
    options: Object.entries(GOAL_LABELS).map(([value, label]) => ({ value, label })) },
  { key: 'skinFeel', section: 'Your everyday skin', prompt: 'How does your skin usually feel?',
    help: 'Think about an ordinary day. This is your experience, not a diagnosis or a measurement.', kind: 'single', directive: interested,
    options: options([['tight-dry', 'Tight or dry'], ['shiny-oily', 'Shiny or oily'], ['mixed', 'Different in different areas'], ['comfortable', 'Generally comfortable'], ['varies', 'It changes a lot'], ['unsure', 'I am not sure']]) },
  { key: 'reactivity', section: 'Your everyday skin', prompt: 'How often does a product leave your skin feeling irritated?',
    help: 'For example, stinging, itching or redness after using it. You do not need to label a condition.', kind: 'single', directive: reassuring,
    options: options([['often', 'Often'], ['sometimes', 'Sometimes'], ['rarely', 'Rarely'], ['unsure', 'I am not sure']]) },
  { key: 'currentRoutine', section: 'What you already use', prompt: 'What is in your routine at the moment?',
    help: 'Product names or steps are enough. Include actives you know about, such as retinoids, exfoliating acids or acne treatments. A simple routine is welcome too.',
    kind: 'text', limit: 800, placeholder: 'Morning, evening, and any occasional products…', directive: interested },
  { key: 'allergies', section: 'Care, without assumptions', prompt: 'Any known ingredient allergies or past product reactions?',
    help: 'Optional. Share only what you know; “not sure” is fine. A current reaction with trouble breathing or swallowing needs urgent medical care.',
    kind: 'text', sensitive: true, limit: 600, placeholder: 'An ingredient or product, and what happened…', directive: reassuring },
  { key: 'medications', section: 'Care, without assumptions', prompt: 'Any current medicines or skin treatments you want me to keep in mind?',
    help: 'Optional. Relevant names are enough; no doses or full medical history. Ese cannot tell you to stop or change prescribed treatment.',
    kind: 'text', sensitive: true, limit: 600, placeholder: 'For example, a prescribed skin treatment—or skip', directive: reassuring },
  { key: 'pregnancyChoice', section: 'Only if you are comfortable', prompt: 'Would you like to include a pregnancy or breastfeeding question?',
    help: 'Some skincare ingredients need extra care. Anyone can skip this question; I will not infer an answer.', kind: 'single', sensitive: true, directive: reassuring,
    options: options([['include', 'Yes, include it'], ['skip', 'Skip this personal question']]) },
  { key: 'pregnancyStatus', section: 'Only if you are comfortable', prompt: 'Is any of this relevant to your skincare right now?',
    help: 'This cannot confirm whether a product is suitable. Ask your clinician about products during pregnancy or breastfeeding.', kind: 'single', sensitive: true, directive: reassuring,
    options: options([['pregnant', 'Pregnant'], ['trying', 'Trying to conceive'], ['breastfeeding', 'Breastfeeding'], ['no', 'None of these'], ['prefer-not-to-say', 'Prefer not to say']]) },
  { key: 'sunExposure', section: 'Your day-to-day life', prompt: 'How much time do you usually spend outdoors?',
    help: 'An everyday pattern is enough. You do not need to share your location.', kind: 'single', directive: interested,
    options: options([['mostly-indoors', 'Mostly indoors'], ['some-outdoor-time', 'Some time outside'], ['often-outdoors', 'Often outdoors'], ['varies', 'It varies']]) },
  { key: 'spfHabit', section: 'Your day-to-day life', prompt: 'How often do you use sunscreen with SPF?',
    help: 'This is a starting point, not a score. You can describe the product in your routine answer.', kind: 'single', directive: warm,
    options: options([['most-days', 'Most days'], ['some-days', 'Some days'], ['rarely', 'Rarely'], ['unsure', 'I am not sure']]) },
  { key: 'triggers', section: 'What you have noticed', prompt: 'Have you noticed anything that seems to unsettle your skin?',
    help: 'Optional. For example, a particular product, fragrance, weather or a change in routine. Noticing a pattern does not prove its cause.',
    kind: 'text', limit: 400, placeholder: 'Anything you would like to mention…', directive: interested },
  { key: 'recentProcedures', section: 'A final bit of context', prompt: 'Any recent skin procedures or treatments you want to mention?',
    help: 'Optional. For example, a peel, laser treatment, waxing or microneedling, and roughly when. Your treating professional’s aftercare advice comes first.',
    kind: 'text', sensitive: true, limit: 600, placeholder: 'A treatment and approximate timing—or skip', directive: reassuring },
];
export function visibleIntakeQuestions(answers: IntakeAnswers): IntakeQuestion[] {
  return INTAKE_QUESTIONS.filter((question) => question.key !== 'pregnancyStatus' || answers.pregnancyChoice === 'include');
}
