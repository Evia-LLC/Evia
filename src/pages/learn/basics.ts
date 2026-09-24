/**
 * Routine basics: the short, evergreen guides at the top of Learn.
 *
 * Every sentence is general and cosmetic (SRS MED-01): no condition names, no
 * diagnosis, treatment or referral, nothing personal, and no number that
 * could read as a measurement. The same text shows in sample and real mode,
 * because it is not data. Each line is listed for counsel in
 * design/counsel/misc.md; change them there first.
 */
import type { IconName } from '@/ui/icons.ts';

export interface Basic {
  title: string;
  body: string;
  icon: IconName;
}

export const BASICS: readonly Basic[] = [
  {
    title: 'Cleanse gently',
    body: 'A mild cleanser once or twice a day is usually enough. If skin feels tight afterwards, a gentler formula may suit it better.',
    icon: 'droplet',
  },
  {
    title: 'Hydrate, then seal',
    body: "Humectants such as glycerin or hyaluronic acid draw water into the skin's surface; a moisturiser on top helps hold it there.",
    icon: 'sparkle',
  },
  {
    title: 'Sunscreen every morning',
    body: 'A broad-spectrum sunscreen is the last step of a morning routine. Reapply it when you spend long stretches outdoors.',
    icon: 'sun',
  },
  {
    title: 'One new product at a time',
    body: 'Introduce new products one by one, a week or so apart, so you can tell what suits your skin.',
    icon: 'plus',
  },
  {
    title: 'Patch test first',
    body: 'Try anything new on a small area for a few days before using it more widely, and always read the label.',
    icon: 'circle-check',
  },
  {
    title: 'Thin to thick',
    body: 'A simple order is cleanser, then lighter serums, then moisturiser, then sunscreen in the morning.',
    icon: 'reorder',
  },
  {
    title: 'Go easy on strong actives',
    body: 'Several exfoliating acids or retinoids at once can leave skin feeling dry or uncomfortable. One at a time is plenty.',
    icon: 'shield',
  },
  {
    title: 'Give it time',
    body: 'Most products need several weeks of regular use before any change is visible. Consistency counts for more than quantity.',
    icon: 'calendar',
  },
];

/** The line under the basics and the glossary. */
export const LEARN_NOTE = 'General cosmetic information for everyday skincare, not medical advice.';
