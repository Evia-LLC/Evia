/**
 * SAMPLE DATA - the Home mockup's own text (ref1.png, left panel), for sample
 * mode only. Every string is copied from work/evia-rebuild/specs/home.md
 * section 7, including the parts real mode cannot produce: the name
 * "Destiny", the "Premium Member" line (there is no subscription) and the
 * fixed afternoon salutation. No portrait anywhere (BUILD-PLAN decision 3):
 * the avatar is initials and the tip tile carries a mark, not a face.
 *
 * Wording flagged for counsel is listed in design/counsel/home.md.
 */
import type { HomeView } from '@/view/home.ts';

export const SAMPLE_HOME: HomeView = {
  salutation: 'Good afternoon,',
  name: 'Destiny',
  question: ['How’s your skin', 'feeling today?'],
  profileName: 'Destiny',
  membership: 'Premium Member',
  notifications: 0,
  tip: {
    title: 'A quick tip from Evia',
    body: 'Your evening routine matters too — consistency is key.',
  },
  tagline: ['WELLNESS', 'CONFIDENCE', 'LONG-TERM SKIN HEALTH'],
  wall: {
    niche: ['REAL INSIGHTS', 'REAL PROGRESS', 'A BRIGHTER YOU'],
    sign: ['CONFIDENCE', 'LOOKS GOOD', 'ON YOU'],
  },
  actions: { look: false, changed: false },
};
