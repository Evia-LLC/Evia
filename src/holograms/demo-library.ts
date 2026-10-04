/**
 * Which demonstration goes with which finding.
 *
 * The link is the point. A demonstration that plays because the app has one is
 * decoration; a demonstration that plays *because a reading said so* is the
 * explanation of the reading. So every clip here names the metric that summons
 * it, and `demoFor` is the only way to get one — there is no path that shows a
 * figure doing an exercise nobody was told they needed.
 *
 * `because` is written to be spoken. Evia reads it aloud while the figure
 * moves, so it is one sentence, in her voice, and it says why the movement
 * addresses the thing that was measured — not what the movement is called.
 *
 * Skincare demonstrations name ingredients, never brands, exactly like the rest
 * of the routine engine. "Work your ceramide cream along the orbital bone" is
 * both the honest instruction and the more useful one: it survives the user
 * switching products.
 */
import type { DemoClip } from './demo.ts';
import type { AnyBodyMetricKey } from '@/body-analysis/findings.ts';
import type { SkinMetricKey } from '@shared/types.ts';

/** Demonstrations tied to a posture reading. */
const BODY_DEMOS: Partial<Record<AnyBodyMetricKey, DemoClip>> = {
  headForward: {
    url: '/demos/chin-tuck.webp',
    frames: 16,
    fps: 10,
    title: 'Chin tuck',
    because:
      'Your head sits forward of your shoulders, so the muscles at the back of your neck are ' +
      'holding it up all day. Drawing the chin straight back — not down — is what lets them stop.',
  },
  /*
   * Tied to the abdominal profile, and worded carefully.
   *
   * That reading is torso depth at the belly against depth at the chest, and
   * two different things move it: how much is there, and how well the
   * abdominal wall holds it in. A movement can only ever change the second. So
   * `because` says what the drill trains and stops there — no exercise
   * flattens a stomach by being performed, and a demonstration that implied
   * otherwise would be the app making a promise its own measurement cannot keep.
   */
  abdominalProfile: {
    url: '/demos/abdominal-brace.webp',
    frames: 16,
    fps: 8,
    title: 'Abdominal brace',
    because:
      'Your abdominal profile is how deep your middle sits from front to back. Drawing your ' +
      'navel gently toward your spine on the out-breath trains the muscle that holds that ' +
      'wall in — which is the part of the reading a movement can change.',
  },
};

/** Demonstrations tied to a skin reading. */
const SKIN_DEMOS: Partial<Record<SkinMetricKey, DemoClip>> = {};

export function bodyDemoFor(metric: AnyBodyMetricKey): DemoClip | null {
  return BODY_DEMOS[metric] ?? null;
}

export function skinDemoFor(metric: SkinMetricKey): DemoClip | null {
  return SKIN_DEMOS[metric] ?? null;
}

/**
 * The first finding in the list that has something to show.
 *
 * Findings are already ranked by how much they matter, so this shows the
 * demonstration for the most important thing that has one — rather than for
 * whichever happens to be in the library.
 */
export function firstBodyDemo(metrics: AnyBodyMetricKey[]): DemoClip | null {
  for (const metric of metrics) {
    const clip = bodyDemoFor(metric);
    if (clip) return clip;
  }
  return null;
}
