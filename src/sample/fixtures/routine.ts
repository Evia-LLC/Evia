/**
 * SAMPLE DATA - the Routine mockup's own content (ref1.png, right panel), for
 * sample mode only. Every string and number is copied from
 * work/evia-rebuild/specs/routine.md sections 2 and 7, including the parts
 * the real plan cannot produce (durations, amounts, instructions, the tip, the
 * lesson's timeline and the done / current / locked states), which is exactly
 * why it is sample data.
 *
 * The mockup shows the morning tab only, so the evening and weekly tabs are
 * designed empty states: an evening list would need steps, states and an
 * order the mockup never shows (BUILD-PLAN decision 2). Opened, the why card
 * lists the morning steps with their own one-liners from the list - the
 * mockup's words, there so the mockup's chevron does something. Wording
 * flagged for counsel is listed in design/counsel/routine.md.
 */
import type { RoutineStepView, RoutineView } from '@/view/routine.ts';

const blank = {
  imageUrl: null,
  stepLabel: null,
  reason: null,
  lookFor: [],
  coveredBy: [],
  hasPick: false,
} satisfies Partial<RoutineStepView>;

const cleanser: RoutineStepView = {
  ...blank,
  key: 'gentle-cleanser',
  title: 'Gentle Cleanser',
  description: 'Remove impurities without stripping your skin.',
  amount: '30–60 seconds',
  duration: '30–60 seconds',
  instructions: null,
  tip: null,
  state: 'done',
  art: 'tube',
  lesson: null,
};

const toner: RoutineStepView = {
  ...blank,
  key: 'hydrating-toner',
  title: 'Hydrating Toner',
  description: 'Prep and rebalance your skin.',
  amount: '30 seconds',
  duration: '30 seconds',
  instructions:
    'After cleansing, apply a few drops of toner to your hands or a cotton pad and gently press onto your face and neck.',
  tip: {
    title: 'Evia tip',
    lines: ['Use gentle, patting motions. Don’t rub. Let it absorb for a few seconds before the next step.'],
  },
  state: 'current',
  art: 'bottle',
  lesson: { caption: ['Gentle, upward', 'motions'], positionSec: 12, durationSec: 30 },
};

const serum: RoutineStepView = {
  ...blank,
  key: 'niacinamide-serum',
  title: 'Niacinamide Serum',
  description: 'Helps with tone, texture and oil balance.',
  amount: '2–3 drops',
  duration: null,
  instructions: null,
  tip: null,
  state: 'locked',
  art: 'dropper',
  lesson: null,
};

const moisturiser: RoutineStepView = {
  ...blank,
  key: 'moisturiser',
  title: 'Moisturiser',
  description: 'Lock in hydration and support your skin barrier.',
  amount: 'A pea-sized amount',
  duration: null,
  instructions: null,
  tip: null,
  state: 'locked',
  art: 'jar',
  lesson: null,
};

export const SAMPLE_ROUTINE: RoutineView = {
  mode: 'sample',
  status: 'ready',
  subtitle: 'Your personalised skincare plan',
  description: 'Step-by-step guidance, tailored to your skin, your goals and your lifestyle.',
  sequence: true,
  split: true,
  splitNote: null,
  initialSlot: 'morning',
  canReorder: true,
  slots: [
    {
      id: 'morning',
      label: 'Morning',
      icon: 'sun',
      heading: 'Your morning routine',
      meta: '4 steps • ~6 min',
      steps: [cleanser, toner, serum, moisturiser],
      focus: 1,
      coveredFrom: null,
      empty: null,
    },
    {
      id: 'evening',
      label: 'Evening',
      icon: 'moon',
      heading: 'Your evening routine',
      meta: '0 steps',
      steps: [],
      focus: 0,
      coveredFrom: null,
      empty: {
        title: 'No evening steps in this sample',
        body: 'The sample shows a morning routine only. When a plan says which steps are for the evening, they appear here.',
      },
    },
    {
      id: 'weekly',
      label: 'Weekly',
      icon: 'calendar',
      heading: 'Your weekly routine',
      meta: '0 steps',
      steps: [],
      focus: 0,
      coveredFrom: null,
      empty: {
        title: 'No weekly steps in this sample',
        body: 'When a plan includes something to do once or twice a week, it appears here.',
      },
    },
  ],
  why: {
    title: 'Why this routine?',
    body: 'This routine is based on your skin analysis, your concerns and your goals. It may change over time as we learn more about your skin.',
    // Opened, the card lists each morning step with its own line from the list.
    details: [cleanser, toner, serum, moisturiser].map((s) => ({ title: s.title, text: s.description ?? '' })),
  },
};
