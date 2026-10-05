/**
 * What she does, decided from what the director says - no drawing here.
 *
 * Each frame the figure hands `decide` a snapshot of `director.character`,
 * the region the page is lighting and the phase of the scan, and gets back an
 * intent: where she looks, what each arm is doing, how far she leans in, and
 * the head and hand impulses (nods, tilts, beat strokes) to play. The figure
 * turns the intent into joint targets and eases every one of them with
 * springs, so nothing here has to worry about smoothness.
 *
 *   examining  a region is lit: she turns to it and reaches for it with the
 *              arm nearer the hologram (her left), for as long as she is
 *              talking about it (and a moment after, so the pause between two
 *              regions is not a drop and a re-point); the other hand rests on
 *              the pedestal's rim, and an open-palm beat from the director
 *              lifts that hand off the rim instead of breaking the point.
 *              While she talks she glances back at you.
 *   presenting the reading with no region named: the mockup's pose, her left
 *              palm up toward the hologram, right hand on the rim.
 *   speaking   jaw from the audible mouth (director `mouthOpen`, zero when
 *              nothing is heard); a beat stroke of the hands and a nod on each
 *              stressed onset of that mouth, scaled by its energy.
 *   listening  a tilt of the head toward you, arms relaxed.
 *   thinking   hand to chin, eyes up and away.
 *   idle       breathing and a slow weight shift (the figure's), a glance at
 *              the viewer every few seconds.
 *   prep       the camera is up (scan capture): she steps in to the pedestal
 *              (as far as the page leaves room) and opens her palm toward
 *              the camera frame.
 *
 * The only clocks are motion clocks (how long a look is held, when an idle
 * glance comes, how long a beat takes): nothing about the reading is invented
 * or timed here - the regions and the words come from the director.
 */
import type { CharacterState, FaceRegionKey } from '@shared/types.ts';
import type { ActiveGesture } from '@/stage/director.ts';

export type Phase = 'consult' | 'prep';

/** The part of the director (and the page) the figure reads. */
export interface Snapshot {
  state: CharacterState;
  gesture: ActiveGesture | null;
  gestureSeq: number;
  /** A voice is audibly speaking through her. */
  speaking: boolean;
  /** 0..1, zero whenever nothing audible plays. */
  mouthOpen: number;
  attention: 'viewer' | 'hologram';
  /** The region the page lights (the callout she is on), or null. */
  region: FaceRegionKey | null;
  phase: Phase;
}

export type LookAt = 'viewer' | 'region' | 'hologram' | 'frame' | 'thought';
export type LeftArm = 'rest' | 'present' | 'point' | 'open' | 'frame';
export type RightArm = 'rim' | 'rest' | 'chin' | 'open';

export interface Intent {
  look: LookAt;
  left: LeftArm;
  right: RightArm;
  /** 0..1: how far she leans in toward the hologram. */
  lean: number;
  /** Head tilt, radians (+ toward her left shoulder, where the hologram is). */
  tilt: number;
  /** Nod impulse right now, radians (+ nods forward). */
  nod: number;
  /** Speech energy 0..1 (audible speech only). */
  energy: number;
  /** A beat stroke right now, 0..1 (its envelope times its strength): hands and head play it. */
  beat: number;
  /** Jaw opening 0..1. */
  jaw: number;
  /** 0..1: stepped in to the pedestal (scan prep). */
  step: number;
}

/** The arm poses the director holds (the others are head impulses that play once). */
const HELD: ReadonlySet<ActiveGesture> = new Set(['point_to_hologram', 'open_palms', 'small_wave', 'hand_to_chin']);
/** The held poses that are really a beat of the hands: played once, for `OPEN_BEAT` seconds. */
const BEATS: ReadonlySet<ActiveGesture> = new Set(['open_palms', 'small_wave']);

/** How long a newly lit region holds her eye before she may glance back at you, seconds. */
export const EXAMINE_HOLD = 2.4;
/** A newly lit region keeps her reaching for it at least this long, seconds. */
export const POINT_HOLD = 5;
/** After her line about a region ends, she keeps pointing this long (the pause before the next region). */
export const DELIVER_GRACE = 1.6;
/** Unless a voice is still audibly on it, a region is pointed at for at most this long, seconds. */
export const POINT_MAX = 12;
/** An open-palm beat: how long the hand stays open, seconds. */
export const OPEN_BEAT = 1.9;
/** While talking about a region: a glance at you this long, every `GLANCE_EVERY` seconds. */
export const GLANCE_LENGTH = 1.3;
export const GLANCE_EVERY = 4.2;
/** Idle: a look at the viewer this long, at intervals drawn from this range. */
export const IDLE_GLANCE_LENGTH = 1.6;
export const IDLE_GLANCE_GAP: [number, number] = [3.2, 6.5];
/** Speech beats: the stroke's rise and fall (seconds), the least gap between two, and the onset level. */
export const BEAT_RISE = 0.14;
export const BEAT_FALL = 0.5;
export const BEAT_GAP = 0.6;
export const BEAT_ONSET = 0.42;

const deg = (d: number): number => (d * Math.PI) / 180;

/** A small deterministic generator, so a figure's idle rhythm is the same in every test. */
function seeded(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 1_000_000) / 1_000_000;
  };
}

/** An impulse's envelope: up and back down again over `length` seconds, smooth at both ends. */
export function pulse(t: number, length: number): number {
  if (t <= 0 || t >= length) return 0;
  const s = Math.sin((Math.PI * t) / length);
  return s * s;
}

/** A beat stroke's envelope: a quick stroke out (`BEAT_RISE`), a slower return (`BEAT_FALL`). */
export function stroke(t: number): number {
  if (t <= 0 || t >= BEAT_RISE + BEAT_FALL) return 0;
  if (t < BEAT_RISE) return Math.sin((Math.PI / 2) * (t / BEAT_RISE));
  const k = (t - BEAT_RISE) / BEAT_FALL;
  return 0.5 + 0.5 * Math.cos(Math.PI * k);
}

export class Behaviour {
  private clock = 0;
  private held: ActiveGesture | null = null;
  private lastSeq = -1;
  private impulse: { gesture: ActiveGesture; at: number } | null = null;
  private armBeat: { gesture: ActiveGesture; at: number } | null = null;
  private region: FaceRegionKey | null = null;
  private regionSince = -Infinity;
  private lastDelivering = -Infinity;
  private energy = 0;
  private lastMouth = 0;
  private beatAt = -Infinity;
  private beatStrength = 0;
  private beatSide = 1;
  private nextIdleGlance: number;
  private idleGlanceUntil = -Infinity;
  private readonly rnd: () => number;

  constructor(seed = 7) {
    this.rnd = seeded(seed);
    this.nextIdleGlance = this.gap();
  }

  private gap(): number {
    return IDLE_GLANCE_GAP[0] + this.rnd() * (IDLE_GLANCE_GAP[1] - IDLE_GLANCE_GAP[0]);
  }

  /** Seconds since the region she is on was lit (Infinity when none). */
  get examining(): number {
    return this.region ? this.clock - this.regionSince : Infinity;
  }

  /**
   * Advances by `dt` seconds and decides. `reduced` (reduced motion) drops idle glances and
   * beat strokes, which would need frames drawn for nothing but motion.
   */
  decide(s: Snapshot, dt: number, reduced = false): Intent {
    this.clock += Math.max(0, dt);
    const t = this.clock;

    // The gesture the director shows: a held arm pose stays while it is showing, and while a
    // head gesture (a nod, a tilt) plays over it; the director showing none releases it. An
    // open-palm beat is played once, however long the director leaves it showing.
    if (s.gesture === null) this.held = null;
    else if (HELD.has(s.gesture)) this.held = s.gesture;
    if (this.lastSeq === -1) {
      // The first look: whatever the director shows already is not a new gesture to play.
      this.lastSeq = s.gestureSeq;
    } else if (s.gestureSeq !== this.lastSeq) {
      this.lastSeq = s.gestureSeq;
      if (s.gesture && !HELD.has(s.gesture)) this.impulse = { gesture: s.gesture, at: t };
      if (s.gesture && BEATS.has(s.gesture)) this.armBeat = { gesture: s.gesture, at: t };
    }
    if (this.armBeat && (t - this.armBeat.at > OPEN_BEAT || this.held !== this.armBeat.gesture)) this.armBeat = null;

    if (s.region !== this.region) {
      this.region = s.region;
      this.regionSince = s.region ? t : -Infinity;
    }

    // Audible speech energy: quick to rise, slow to fall.
    const mouth = s.speaking ? Math.max(0, Math.min(1, s.mouthOpen)) : 0;
    const rate = mouth > this.energy ? 18 : 3.5;
    this.energy += (mouth - this.energy) * Math.min(1, rate * Math.max(0, dt));
    const energy = s.speaking ? this.energy : this.energy * 0.6;
    // A beat on a stressed onset: the mouth opening past the onset level after a gap.
    if (!reduced && s.speaking && mouth >= BEAT_ONSET && this.lastMouth < BEAT_ONSET && t - this.beatAt >= BEAT_GAP) {
      this.beatAt = t;
      this.beatStrength = 0.55 + 0.45 * Math.min(1, Math.max(mouth, this.energy));
      this.beatSide = -this.beatSide;
    }
    this.lastMouth = mouth;
    const beat = reduced ? 0 : stroke(t - this.beatAt) * this.beatStrength;

    const delivering = s.speaking || s.state === 'EXPLAINING' || s.state === 'SPEAKING';
    if (delivering) this.lastDelivering = t;

    const thinking = s.state === 'THINKING' || this.held === 'hand_to_chin';
    const listening = s.state === 'LISTENING';
    const talking = s.speaking || energy > 0.05;

    // ---- where she looks -------------------------------------------------
    let look: LookAt;
    if (s.phase === 'prep') {
      look = this.idleGlance(t, reduced) ? 'viewer' : 'frame';
    } else if (thinking) {
      look = 'thought';
    } else if (listening) {
      look = 'viewer';
    } else if (s.region) {
      const since = t - this.regionSince;
      if (since < EXAMINE_HOLD || s.attention === 'hologram') look = 'region';
      else if (talking) look = (since - EXAMINE_HOLD) % GLANCE_EVERY > GLANCE_EVERY - GLANCE_LENGTH ? 'viewer' : 'region';
      else look = this.idleGlance(t, reduced) ? 'viewer' : 'region';
    } else if (s.attention === 'hologram') {
      look = 'hologram';
    } else if (talking) {
      look = 'viewer';
    } else {
      look = this.idleGlance(t, reduced) ? 'viewer' : 'hologram';
    }

    // ---- arms -------------------------------------------------------------
    const beating = this.armBeat !== null;
    let left: LeftArm;
    let right: RightArm = 'rim';
    if (s.phase === 'prep') {
      left = 'frame';
    } else if (thinking) {
      left = 'rest';
      right = 'chin';
    } else if (listening) {
      left = 'rest';
    } else if (s.region && this.pointing(t, s.speaking)) {
      // Reaching for the region she is talking about; a beat opens the other hand instead.
      left = 'point';
      if (beating) right = 'open';
    } else if (beating) {
      left = 'open';
    } else {
      left = 'present';
    }

    // ---- head impulses and posture ----------------------------------------
    let nod = 0;
    let tilt = 0;
    let leanKick = 0;
    if (this.impulse) {
      const since = t - this.impulse.at;
      const g = this.impulse.gesture;
      if (g === 'nod') nod = deg(10) * pulse(since, 0.7);
      else if (g === 'slow_nod') nod = deg(8) * pulse(since, 1.4);
      else if (g === 'head_tilt') tilt = deg(12) * pulse(since, 1.8);
      else if (g === 'lean_in') leanKick = 0.35 * pulse(since, 1.8);
      if (since > 2) this.impulse = null;
    }
    if (listening) tilt += deg(8);
    if (thinking) tilt -= deg(7);
    if (look === 'region' || look === 'hologram') tilt += deg(5);
    // A beat lands in the head too: a small nod, and a tilt to alternate sides.
    nod += deg(6) * beat;
    tilt += deg(4) * beat * this.beatSide;

    const lean = s.phase === 'prep' ? 0.55 : thinking || listening ? 0.25 : left === 'point' ? 0.95 : 0.7;

    return {
      look,
      left,
      right,
      lean: Math.min(1, lean + leanKick),
      tilt,
      nod,
      energy,
      beat,
      jaw: mouth,
      step: s.phase === 'prep' ? 1 : 0,
    };
  }

  /** She reaches for the lit region while it is new, and while she is still talking about it. */
  private pointing(t: number, audible: boolean): boolean {
    const since = t - this.regionSince;
    if (since < POINT_HOLD) return true;
    return t - this.lastDelivering < DELIVER_GRACE && (since < POINT_MAX || audible);
  }

  private idleGlance(t: number, reduced: boolean): boolean {
    if (reduced) return false;
    if (t >= this.nextIdleGlance) {
      this.idleGlanceUntil = t + IDLE_GLANCE_LENGTH;
      this.nextIdleGlance = t + IDLE_GLANCE_LENGTH + this.gap();
    }
    return t < this.idleGlanceUntil;
  }
}
