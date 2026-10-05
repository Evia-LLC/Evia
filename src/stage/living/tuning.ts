/**
 * How alive each room is. One place to turn a room up or down. The numbers
 * follow the specs' motion hints (home.md s9 for the lounge, scan.md s9 for
 * the consult room) and were checked by eye on the published renders (luxury
 * hotel at dusk, not a video game): if an effect can be *watched*, it is too
 * strong.
 */
import type { RoomId } from '../room-anchors.ts';

export interface LivingTuning {
  /** Plant sway at the most mobile leaf tip, as a share of the mask's featherPx (< 1 keeps edges whole). */
  sway: number;
  /** Leaf flutter at the tips, in mask px. */
  flutterPx: number;
  /** LED breathing on (1) or off (0). */
  breathe: number;
  /**
   * The LEDs' breathing range, as a multiple of their own light added to the plate (0 = as rendered):
   * [-0.1, 0] is home.md's "emission 0.9 <-> 1.0", [-0.05, 0.05] scan.md's "+-5 %".
   */
  breathRange: [number, number];
  /** LED breathing period, s. */
  breathePeriod: number;
  /** The travelling bead's strength, as a share of the LEDs' own light (0 = off). */
  travel: number;
  /** How fast it travels along a strip, m/s, and the spacing of beads, m. */
  travelSpeed: number;
  travelWaveM: number;
  /** Lamp flicker/breathing strength (1 = envelope.ts as designed: +-3 %). */
  lamps: number;
  /** Chance per 30 s slot that a window id goes dark (0 = no twinkle); twice this share of ids per minute. */
  twinkle: number;
  /** Scale from the windows mask's R (lit, haze-weighted) to "how much of this pixel is the lit window". */
  windowGain: number;
  /** A faint shimmer of distant lights (share of their brightness). */
  shimmer: number;
  /** What moves in the sky seen through the glass. */
  sky: 'dusk' | 'night' | 'day' | 'none';
  /** Cloud/haze strength (share of the sky's brightness). */
  skyAmount: number;
  /** An aircraft's beacon crossing the sky, now and then. */
  aircraft: boolean;
  /**
   * Pointer/tilt parallax:
   *   depth  every pixel by its depth (mask depth); HTML on the room's surfaces moves with it
   *   glass  only the view through the glass shifts (rooms with overlays the page places itself)
   *   none
   */
  parallax: 'depth' | 'glass' | 'none';
  /**
   * The largest shift, CSS px, for the nearest thing (depth) or the view outside (glass). With depth,
   * the far side moves the other way (less), so the most two depths part is parallaxPx * (1 + |far|):
   * home.md s9 asks for 2-4 px between the layers.
   */
  parallaxPx: number;
  /** The depth that stays put (m), and the depth that moves the full amount (m). */
  focusM: number;
  nearM: number;
  /** Consult: the glints on the pedestal's glass rings, slowly turning (share of the emitter boost; 0 = off). */
  emitter: number;
  /** Seconds per turn of the glass rings' glints. */
  emitterTurnS: number;
  /**
   * The consult room's boost layers, as the share of their lights each adds at opacity 1 (consult_post.py
   * LOOK.glow_boost: the neon layer is "LEDs x1.6"): the breathing range is divided by these.
   */
  boostStrength: { neon: number; under: number; emitter: number };
  /** Frames per second for the ambient motion (at most the device's budget). */
  fps: number;
}

const BASE: LivingTuning = {
  sway: 0.6,
  flutterPx: 0.35,
  breathe: 1,
  breathRange: [-0.1, 0],
  breathePeriod: 7,
  travel: 0.08,
  travelSpeed: 0.3,
  travelWaveM: 6,
  lamps: 1,
  twinkle: 0.015,
  windowGain: 4,
  shimmer: 0.04,
  sky: 'dusk',
  skyAmount: 0.08,
  aircraft: true,
  parallax: 'depth',
  // Lounge: near (2.5 m) moves 2.75 px, the skyline 1.25 px the other way: 4 px apart at most.
  parallaxPx: 2.75,
  focusM: 8,
  nearM: 2.5,
  emitter: 0,
  emitterTurnS: 45,
  boostStrength: { neon: 0.6, under: 0.8, emitter: 1 },
  fps: 30,
};

export const LIVING_TUNING: Partial<Record<RoomId, LivingTuning>> = {
  /* Home, the gate, the phone lounge: a dusk skyline, a candle, a globe, LED coves, plants. */
  lounge: BASE,
  /*
   * The sidebar strip, under dark glass: the same room, a little quieter, no parallax (it is a column),
   * and 15 fps: behind frosted glass the slow motions need no more, and every frame the room changes,
   * the browser re-blurs the glass over it.
   */
  'lounge-strip-window': { ...BASE, sway: 0.55, parallax: 'none', aircraft: true, travel: 0.06, fps: 15 },
  /* Products: a daylit blush room; the plants move in the air, the pendant breathes, the light outside drifts. */
  'products-hero': {
    ...BASE,
    sway: 0.55,
    breathe: 0,
    travel: 0,
    twinkle: 0,
    sky: 'day',
    skyAmount: 0.025,
    aircraft: false,
    // Near (1.8 m) 2.2 px, the view outside 1.8 px the other way: 4 px apart at most.
    parallaxPx: 2.2,
    focusM: 4,
    nearM: 1.8,
  },
  /*
   * Scan: a night skyline behind glass, rose-gold LEDs, the pedestal's emitter. scan.md s9: "very subtle
   * breathing of the cove/LED glows (+-5 % over 8 s). The pedestal glass rings slowly rotate. The city
   * bokeh twinkles." The hologram pulses on its own 3 s rhythm above the emitter, so the emitter keeps
   * to the room's slow breath and its rings turn rather than pulse.
   * The hologram, the character and the wall/pedestal text are placed on this plate by the Scan page,
   * so only the view outside moves with the pointer.
   */
  consult: {
    ...BASE,
    breathe: 1,
    breathRange: [-0.05, 0.05],
    breathePeriod: 8,
    travel: 0.05,
    travelSpeed: 0.25,
    twinkle: 0.02,
    windowGain: 1.6,
    shimmer: 0.05,
    sky: 'night',
    skyAmount: 0.05,
    parallax: 'glass',
    parallaxPx: 3,
    emitter: 0.18,
    emitterTurnS: 45,
  },
};

export function tuningFor(room: RoomId): LivingTuning | null {
  return LIVING_TUNING[room] ?? null;
}
