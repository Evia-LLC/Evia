/**
 * Shot selection and blocking.
 *
 * The clinical room was built, lit and populated, and then filmed with a single
 * locked-off camera for the entire session. That is the whole reason it read as
 * a model standing in a room rather than a consultation: her face was sixty
 * pixels tall, she never turned to the display she was describing, and nothing
 * on screen changed in response to anything she said.
 *
 * This module is the missing layer. It does not draw anything. It decides where
 * the camera should be, which way she should face, and where she should be
 * looking, given what is happening in the conversation — and it refuses to
 * change its mind too often, because a camera that recuts every two seconds is
 * worse than one that never moves.
 */
import * as THREE from 'three';
import type { CameraShot } from './stage.ts';

export type ShotName = 'establish' | 'present' | 'converse' | 'reading';

/** Where she is turned, and what she is looking at. */
export type Facing = 'panel' | 'viewer';

export interface Blocking {
  shot: CameraShot;
  facing: Facing;
  /** Added to the presenter yaw the layout solves, in radians. */
  yawBias: number;
}

interface ShotPair {
  landscape: CameraShot;
  portrait: CameraShot;
  facing: Facing;
  yawBias: number;
  /** How long the camera takes to arrive, in seconds. Shorter is snappier. */
  seconds: number;
}

const shot = (
  position: [number, number, number],
  target: [number, number, number],
  fov: number,
): CameraShot => ({
  position: new THREE.Vector3(...position),
  target: new THREE.Vector3(...target),
  fov,
});

/**
 * The shot vocabulary.
 *
 * Four framings, each with a portrait variant, because a phone is not a
 * cropped laptop: the display panel takes the top of a portrait frame rather
 * than its right-hand third, so every shot has to sit her lower and closer.
 *
 * The durations matter as much as the positions. Pulling back to establish is
 * slow and unhurried; coming in to listen to someone is quicker, because that
 * is how attention actually moves. Each is the full travel time of the move,
 * eased in and out by the stage's damped camera.
 */
const SHOTS: Record<ShotName, ShotPair> = {
  /**
   * The room. Used on arrival and when the routine lands — the two moments
   * where the point is the place rather than the person.
   */
  establish: {
    landscape: shot([-0.14, 1.62, 2.62], [0.1, 1.3, -0.2], 42),
    portrait: shot([-0.05, 1.62, 2.5], [0.03, 1.3, -0.15], 50),
    facing: 'panel',
    yawBias: 0.16,
    seconds: 2.2,
  },

  /**
   * Presenting. She is turned towards the display, three-quarters to camera,
   * framed from the waist so a gesture towards the panel is actually visible.
   */
  present: {
    // Waist up, and close.
    //
    // An earlier version pulled back far enough to show her whole body and the
    // floor, on the reasoning that more of the instrument on screen was better.
    // It was not: she became a figure standing in a room, and the room — which
    // is detailed and well lit — won. She is the subject. The readouts come to
    // her at this distance, and the ring field sits on the bottom edge.
    landscape: shot([-0.02, 1.52, 2.12], [0.06, 1.42, 0], 40),
    /*
     * Portrait sits lower than it did. The shot used to look at 1.48 so her
     * head cleared a display panel pinned to the top of a phone; that panel is
     * gone and the words now rise from the bottom, so a frame aimed that high
     * was forty percent ceiling. Aimed at her sternum, the band above the sheet
     * holds her, the projection and the top of the column.
     */
    portrait: shot([0, 1.52, 2.0], [0.02, 1.34, 0], 47),
    facing: 'panel',
    yawBias: 0.3,
    seconds: 1.6,
  },

  /**
   * Conversation. Close, square to her, her face large enough to read — this
   * is the shot that makes her a person you are talking to rather than an
   * exhibit. Used when she asks something or is listening.
   */
  converse: {
    landscape: shot([-0.02, 1.52, 1.34], [0.04, 1.46, 0], 32),
    portrait: shot([0, 1.58, 1.36], [0, 1.52, 0], 38),
    facing: 'viewer',
    yawBias: -0.22,
    seconds: 1.1,
  },

  /**
   * Reading your skin. Slightly low and close, held still, with her attention
   * on the panel rather than on you — the moment is supposed to feel clinical,
   * and being looked *past* is part of that.
   */
  reading: {
    landscape: shot([-0.1, 1.5, 1.78], [0.04, 1.46, 0], 34),
    portrait: shot([-0.03, 1.54, 1.74], [0.01, 1.42, 0], 41),
    facing: 'panel',
    yawBias: 0.24,
    seconds: 1.4,
  },
};

/**
 * How long a shot must hold before another may replace it.
 *
 * Without this the camera thrashes: a scan finishing, a directive arriving and
 * a turn of speech land within a second of each other and each wants a
 * different framing. Urgent changes can override it — see `request`.
 */
const MIN_HOLD_SECONDS = 3.4;

export class Cinematographer {
  private current: ShotName = 'establish';
  private held = 0;
  private portrait = false;

  /** A little life on the held frame, so a static shot is never truly static. */
  private drift = 0;

  /**
   * Chooses the shot.
   *
   * `urgent` is for beats that *are* the moment — the scan starting, the
   * routine landing — where cutting late is worse than cutting often.
   */
  request(name: ShotName, urgent = false): void {
    if (name === this.current) return;
    if (!urgent && this.held < MIN_HOLD_SECONDS) return;
    this.current = name;
    this.held = 0;
  }

  setAspect(portrait: boolean): void {
    this.portrait = portrait;
  }

  get shotName(): ShotName {
    return this.current;
  }

  update(dt: number): Blocking {
    this.held += dt;
    this.drift += dt;

    const pair = SHOTS[this.current];
    const base = this.portrait ? pair.portrait : pair.landscape;

    // A hand-held float, well under the threshold of being noticed as motion
    // but enough that the frame is never mathematically still. Two
    // incommensurable periods, so it does not visibly loop.
    const sway = Math.sin(this.drift * 0.21) * 0.012;
    const bob = Math.sin(this.drift * 0.34 + 1.3) * 0.006;

    return {
      shot: {
        position: new THREE.Vector3(
          base.position.x + sway,
          base.position.y + bob,
          base.position.z,
        ),
        // The look-target drifts with the camera at most of its amplitude.
        // With the target pinned, the sway was a rotation about it — a
        // camera panning minutely on a tripod head. Moving both, the frame
        // floats as a whole, which is what a held camera actually does; the
        // remaining fraction keeps a trace of drift in the aim.
        target: new THREE.Vector3(
          base.target.x + sway * 0.6,
          base.target.y + bob * 0.6,
          base.target.z,
        ),
        fov: base.fov,
      },
      facing: pair.facing,
      yawBias: pair.yawBias,
    };
  }

  /**
   * How long the camera should take to reach the current shot, in seconds.
   *
   * Still named `rate` because the director hands it straight through to
   * `Stage.setShot`; the meaning moved from a damping constant to a duration
   * when the stage's camera went critically damped.
   */
  get rate(): number {
    return SHOTS[this.current].seconds;
  }

  reset(name: ShotName = 'establish'): void {
    this.current = name;
    this.held = MIN_HOLD_SECONDS;
  }
}
