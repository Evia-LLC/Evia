/**
 * The Home screen's view model (BUILD-PLAN section 3.2).
 *
 * The page renders only from a `HomeView`. In sample mode that is the
 * mockup's own text (`src/sample/fixtures/home.ts`, ref1's left panel);
 * otherwise it is built here from what the app actually has
 * (specs/data-map.md section 2):
 *
 * - the name is the account's display name, as typed at sign-up. A guest, or
 *   an account that gave none, has none, so the salutation stands alone
 *   ("Good evening.") rather than greeting "there" or "friend";
 * - the salutation comes from the local clock;
 * - there is no membership or subscription, so no membership line;
 * - there is no notification feed, so the bell has no badge;
 * - there is no tip service, so the tip is one of a short reviewed list of
 *   general habits (`src/pages/home/tips.ts`), one a day;
 * - the decor copy (wall niche, acrylic sign, tagline) is fixed wording, the
 *   same in both modes, and is listed for counsel rather than rewritten;
 * - Home shows no score, measurement or analysis value in either mode. The
 *   two ways into the rest of the app the old Home had ("Let me look", "What
 *   changed") stay in real mode as quiet links; the second only once there
 *   is a scan to compare.
 */
import { sample } from '@/sample/mode.svelte.ts';
import { session } from '@/state/session.svelte.ts';
import { SAMPLE_HOME } from '@/sample/fixtures/home.ts';
import { TIP_TITLE, tipFor } from '@/pages/home/tips.ts';

export interface HomeTip {
  title: string;
  body: string;
}

export interface HomeView {
  /** "Good afternoon," - with a trailing comma when a name follows, a full stop when not. */
  salutation: string;
  /** The display name as the big serif line, without its full stop; null for a guest. */
  name: string | null;
  /** The question under the greeting, in its two lines. */
  question: readonly [string, string];
  /** The name on the profile pill. */
  profileName: string;
  /** The line under it; null hides it (real mode: there is no membership). */
  membership: string | null;
  /** Unread notifications; 0 shows no badge. */
  notifications: number;
  tip: HomeTip;
  /** The bottom tagline's segments, drawn with bars between them. */
  tagline: readonly string[];
  /** Decor on the room plate: the backlit niche and the acrylic sign. */
  wall: { niche: readonly string[]; sign: readonly string[] };
  /** Real-mode shortcuts into the app; none in sample mode (the mockup has none). */
  actions: { look: boolean; changed: boolean };
}

/** Copy that is the same in both modes (the mockup's own words). */
export const HOME_QUESTION = ['How’s your skin', 'feeling today?'] as const;
export const HOME_TAGLINE = ['WELLNESS', 'CONFIDENCE', 'LONG-TERM SKIN HEALTH'] as const;
export const HOME_WALL = {
  niche: ['REAL INSIGHTS', 'REAL PROGRESS', 'A BRIGHTER YOU'],
  sign: ['CONFIDENCE', 'LOOKS GOOD', 'ON YOU'],
} as const;

/** The part of the day, from the local clock. */
export function salutationFor(date: Date): string {
  const hour = date.getHours();
  if (hour < 5) return 'Still up';
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

export interface HomeRealInput {
  now: Date;
  guest: boolean;
  displayName: string | null;
  hasScan: boolean;
}

/*
 * The stand-ins the app stores when no name was given: "friend" for an
 * account whose name box was left empty (server/db/users.ts), "there" for a
 * guest. Neither is a name, so Home does not print one in its display serif
 * ("Good evening, friend.") - the same rule the server's own greetings follow
 * (server/ai/fallback.ts).
 */
const PLACEHOLDER_NAMES = new Set(['friend', 'there']);

export function buildHome({ now, guest, displayName, hasScan }: HomeRealInput): HomeView {
  const typed = displayName?.trim() || null;
  const name = guest || !typed || PLACEHOLDER_NAMES.has(typed.toLowerCase()) ? null : typed;
  const part = salutationFor(now);
  return {
    salutation: name ? `${part},` : `${part}.`,
    name,
    question: HOME_QUESTION,
    profileName: guest ? 'Guest' : (name ?? ''),
    membership: null,
    notifications: 0,
    tip: { title: TIP_TITLE, body: tipFor(now) },
    tagline: HOME_TAGLINE,
    wall: HOME_WALL,
    actions: { look: true, changed: hasScan },
  };
}

/** Sample mode's fixture, or the real view from the session. */
export function homeView(now: Date = new Date()): HomeView {
  if (sample.on) return SAMPLE_HOME;
  return buildHome({
    now,
    guest: session.guest,
    displayName: session.user?.displayName ?? null,
    hasScan: session.latestScan !== null || session.scans.length > 0,
  });
}
