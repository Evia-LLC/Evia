/**
 * The 2D stage director.
 *
 * What the three.js `SessionDirector` did for the painted character and the
 * hologram rig, without drawing anything: it takes the controller's and the
 * voice's directions, runs them through the character state machine, and
 * publishes the result as two reactive records. The SVG figure draws
 * `character` - her state, face, gesture, mouth and gaze - and the scan page
 * draws `hologram` - the reading, the live mesh and which region she is
 * talking about. Neither record is ever written from outside.
 *
 * Also the only writer of the presentation fields on the session the scan
 * page depends on: `sceneMode` (walking between the lounge and the consult
 * room), `panelMode` (reading or routine) and `scanProgress`/`scanStage`.
 * Without them the scan page could never show a reading.
 *
 * The timing that used to live in the render loop is kept where it earned
 * its place: the mouth follows the speech track frame by frame, she moves in
 * beats on her own phrasing while she talks, settles back when the line ends,
 * softens after a long think, and a touch borrows her face for a couple of
 * seconds and gives it back. The frame loop only runs while a line does.
 */
import { canTransition, resolveDirective, sanitiseDirective } from '@shared/character-fsm.ts';
import {
  DEFAULT_DIRECTIVE,
  type CharacterDirective,
  type CharacterState,
  type Expression,
  type Gesture,
  type SkinAnalysis,
  type SkinMetricKey,
} from '@shared/types.ts';
import type { BodyAnalysis } from '@/body-analysis/pipeline.ts';
import { MutedSpeechTrack, SpeechTrack, type SpeechTrackLike, type Viseme } from '@/character/speech.ts';
import { narrationFor } from '@/scan/choreography.ts';
import type { ScanMesh } from '@/scan/mesh.ts';
import { session } from '@/state/session.svelte.ts';
import * as sound from '@/lib/sound.ts';
import { clamp } from '@/lib/math.ts';
import type {
  ActiveGesture,
  Attention,
  BodyPresentation,
  CharacterView,
  Director,
  HologramView,
  PokeZone,
  ScanSentiment,
  TourReport,
} from './director.ts';
import { OFF_VIEW, type TourView } from './tour-machine.ts';
import { tour } from './tour.svelte.ts';

type Timer = ReturnType<typeof setTimeout> | undefined;

/** How long a walk between rooms takes when motion is allowed. */
const ENTER_MS = 900;
const EXIT_MS = 450;
/** A think this long stops looking like a stall: she softens, and the controller may say so. */
const LONG_THINK_MS = 7_000;
/** How long a touch borrows her face, and how soon a held finger may borrow it again. */
const REACTION_MS = 2_200;
const REACTION_GAP_MS = 900;
/** How long a tap holds her eye before she looks back. */
const GLANCE_SECONDS = 1.6;
/**
 * The timed reveal, for when no voice is pacing it: a grace period for a
 * voice to start, then one region a step. A region her voice lights pushes
 * the next timed step back, so the timer only resumes if the voice stalls.
 */
const REVEAL_GRACE_MS = 1_400;
const REVEAL_STEP_MS = 1_100;
/** The re-point on a revealed region, at most this often, so a dense sentence does not jab. */
const REVEAL_POINT_GAP_MS = 1_100;
/** Longest frame step the speech track is advanced by after a stall. */
const MAX_FRAME_SECONDS = 0.25;

/** Gestures that are held poses rather than impulses; they survive a touch reaction. */
const POSE_GESTURES = new Set<Gesture>(['open_palms', 'point_to_hologram', 'small_wave']);

class CharacterModel implements CharacterView {
  state = $state<CharacterState>(DEFAULT_DIRECTIVE.state);
  expression = $state<Expression>(DEFAULT_DIRECTIVE.expression);
  gesture = $state<ActiveGesture | null>(null);
  gestureSeq = $state(0);
  intensity = $state(DEFAULT_DIRECTIVE.intensity);
  speaking = $state(false);
  viseme = $state<Viseme>('sil');
  mouthOpen = $state(0);
  gazeX = $state(0);
  gazeY = $state(0);
  attention = $state<Attention>('viewer');
}

/*
 * Raw state for everything that is handed in whole: a mesh is a few
 * thousand typed-array entries and a reading is a deep record, and neither
 * is ever edited in place, so deep proxies would be cost for nothing.
 */
class HologramModel implements HologramView {
  mesh = $state.raw<ScanMesh | null>(null);
  analysis = $state.raw<SkinAnalysis | null>(null);
  previous = $state.raw<SkinAnalysis | null>(null);
  sentiment = $state<ScanSentiment | null>(null);
  body = $state.raw<BodyPresentation | null>(null);
  revealQueue = $state.raw<readonly SkinMetricKey[]>([]);
  revealed = $state.raw<readonly SkinMetricKey[]>([]);
  activeRegion = $state<SkinMetricKey | null>(null);
  capture = $state<string | null>(null);
  demo = $state.raw<unknown | null>(null);
}

class StageDirector implements Director {
  readonly character = new CharacterModel();
  readonly hologram = new HologramModel();
  /** The consult tour's view, as the tour runner last published it. */
  private tourView = $state.raw<TourView>(OFF_VIEW);

  onPoked: ((zone: PokeZone) => void) | null = null;
  onMetricPicked: ((key: SkinMetricKey) => void) | null = null;
  onLongThink: (() => void) | null = null;
  onTourReport: ((report: TourReport) => void) | null = null;

  get tour(): TourView {
    return this.tourView;
  }

  /**
   * The turn's directive, after the state machine. What she shows can
   * briefly differ - a beat gesture, a touch reaction - and always comes
   * back to this.
   */
  private current: CharacterDirective = { ...DEFAULT_DIRECTIVE };

  // The line on her lips.
  private track: SpeechTrackLike | null = null;
  private frameHandle = 0;
  private lastFrame = 0;
  private speechElapsed = 0;
  private speechDuration = 0;
  private turnTextLength = 0;
  /**
   * `session.spokenChars` as it stood when the turn began. The voice
   * controller zeroes it when a line starts and completes it when one ends,
   * so an unchanged value is the last line's leftover, not this one's.
   */
  private turnSpokenBaseline = 0;
  /** One expression shift per spoken turn - see `maybeCloseTurn`. */
  private closeFired = true;
  /** Counts down to the next beat while she speaks. */
  private gestureTimer = 0;
  /** Seconds since the last phrase-keyed beat; commas must not become a metronome. */
  private phraseGestureGap = 0;
  /** Whether the last beat was an arm pose, so the next one is a head movement. */
  private lastArmGesture = false;

  // Touch and attention.
  private lastAcknowledged = -Infinity;
  private reactionUntil = 0;
  private reactionTimer: Timer;
  private glanceTimer: Timer;
  private hologramGaze = { x: 0.55, y: 0.1 };

  // Thinking.
  private thinkTimer: Timer;
  private longThinkFired = false;

  // Rooms. A token per walk, so a walk that was overtaken never lands.
  private roomTarget: 'lounge' | 'clinical' = 'lounge';
  private roomTimer: Timer;
  private roomToken = 0;

  // The reveal.
  private revealTimer: Timer;
  private lastRevealPoint = -Infinity;

  // -------------------------------------------------------------------------
  // The conversation
  // -------------------------------------------------------------------------

  applyDirective(directive: CharacterDirective): void {
    const { directive: clean } = sanitiseDirective(directive);
    // An illegal edge keeps her state but still adopts the face and gesture,
    // so she reacts even when the requested pose was not reachable.
    const { directive: resolved } = resolveDirective(this.current.state, clean);
    this.current = resolved;
    this.show(resolved, true);
    this.watchThinking();
  }

  /** The first keystroke of a turn: she looks up from what she was doing. */
  userIsTyping(): void {
    // In the consult room she turns from the reading back to you, and that
    // turn is the whole acknowledgement.
    if (session.sceneMode !== 'lounge') {
      this.lookAt('viewer');
      return;
    }
    this.applyDirective({ ...this.current, state: 'LISTENING', gesture: 'none' });
  }

  userSubmitted(): void {
    // Hand to chin: the pose is the thought being visibly held.
    this.applyDirective({ state: 'THINKING', expression: 'focused', gesture: 'hand_to_chin', intensity: 0.55 });
  }

  elohimSpoke(directive: CharacterDirective, text: string, mouth: 'wait' | 'keep' = 'wait'): void {
    this.applyDirective(directive);
    // The estimate is the line's timing either way: the muted track when
    // nothing speaks, and the yardstick for the closing expression when
    // something does. The lips stay shut until a voice hands over a track.
    const estimated = new SpeechTrack(text);
    if (mouth === 'wait') this.setTrack(new MutedSpeechTrack(estimated));
    this.speechElapsed = 0;
    this.speechDuration = estimated.duration;
    this.turnTextLength = text.length;
    this.turnSpokenBaseline = session.spokenChars;
    this.closeFired = false;
    // Nobody gestures on their opening syllable.
    this.gestureTimer = 0.9;
    this.phraseGestureGap = 0;
    this.lookAt('viewer');
  }

  useSpeechTrack(track: SpeechTrackLike): void {
    // The muted timing may have run out while the audio was being fetched,
    // and she will have settled already; the turn's face comes back for as
    // long as she is actually speaking. Not over a touch reaction, though -
    // the audio arriving now is usually the poke line itself.
    if (!this.track && !this.reacting()) {
      this.show(this.current);
      this.gestureTimer = Math.max(this.gestureTimer, 0.9);
      this.phraseGestureGap = 0;
    }
    this.setTrack(track);
  }

  stopMouth(): void {
    if (this.track && !(this.track instanceof MutedSpeechTrack)) {
      this.track = new MutedSpeechTrack(this.track);
    }
    this.character.viseme = 'sil';
    this.character.mouthOpen = 0;
    this.character.speaking = false;
  }

  // -------------------------------------------------------------------------
  // Rooms
  // -------------------------------------------------------------------------

  async enterClinical(): Promise<void> {
    if (session.sceneMode === 'clinical') return;
    if (session.sceneMode === 'transitioning' && this.roomTarget === 'clinical') return;
    const token = ++this.roomToken;
    this.roomTarget = 'clinical';
    session.sceneMode = 'transitioning';
    // The consult room has a floor under its silence.
    sound.startRoom();
    clearTimeout(this.roomTimer);
    this.roomTimer = setTimeout(() => {
      // Signing out mid-walk resets the room under the timer; it must not
      // put her back in the clinic afterwards.
      if (token !== this.roomToken || session.sceneMode !== 'transitioning') return;
      session.sceneMode = 'clinical';
      // A mood left over from the last result (HAPPY, CONCERNED) has no edge
      // to CLINICAL_ANALYSIS; step through IDLE rather than be blocked.
      if (!canTransition(this.current.state, 'CLINICAL_ANALYSIS') && canTransition(this.current.state, 'IDLE')) {
        this.current = { ...this.current, state: 'IDLE' };
      }
      this.applyDirective({ state: 'CLINICAL_ANALYSIS', expression: 'focused', gesture: 'none', intensity: 0.7 });
    }, this.walkMs(ENTER_MS));
  }

  exitClinical(): void {
    if (session.sceneMode === 'lounge') return;
    if (session.sceneMode === 'transitioning' && this.roomTarget === 'lounge') return;
    // The tour belongs to the room too: it ends (quiet, nothing lit) before the reading goes.
    tour.end('left');
    const token = ++this.roomToken;
    this.roomTarget = 'lounge';
    session.sceneMode = 'transitioning';
    sound.stopRoom();
    // The reading belongs to the room. Leaving it is a privacy boundary as
    // much as a scene change, so the capture goes with it.
    this.clearHologram();
    this.lookAt('viewer');
    // She keeps the mood the reading put her in; the walk back is part of
    // the same conversation.
    this.applyDirective({
      state: 'IDLE',
      expression: this.current.expression,
      gesture: 'none',
      intensity: this.current.intensity,
    });
    clearTimeout(this.roomTimer);
    this.roomTimer = setTimeout(() => {
      if (token !== this.roomToken || session.sceneMode !== 'transitioning') return;
      session.sceneMode = 'lounge';
    }, this.walkMs(EXIT_MS));
  }

  showRoutine(): void {
    session.panelMode = 'routine';
    // Reassuring rather than merely warm: this is the "here is what we do
    // about it" beat.
    this.applyDirective({ state: 'EXPLAINING', expression: 'reassuring', gesture: 'point_to_hologram', intensity: 0.65 });
  }

  showScan(): void {
    session.panelMode = 'scan';
  }

  // -------------------------------------------------------------------------
  // The scan
  // -------------------------------------------------------------------------

  setScanProgress(progress: number, stage: string): void {
    session.scanProgress = clamp(progress);
    session.scanStage = stage;
    // She is reading it, so she is looking at it.
    if (progress > 0 && progress < 1) this.lookAt('hologram');
  }

  setCapture(base64: string | null): void {
    if (base64 === null) {
      this.hologram.capture = null;
      return;
    }
    // The pipelines hand over bare base64 JPEG; the page wants something an
    // <img> or a texture loader takes as it is.
    this.hologram.capture = /^(data|blob):/.test(base64) ? base64 : `data:image/jpeg;base64,${base64}`;
  }

  setFaceMesh(mesh: ScanMesh | null): void {
    this.hologram.mesh = mesh;
  }

  presentAnalysis(analysis: SkinAnalysis, previous: SkinAnalysis | null, sentiment?: ScanSentiment): void {
    // The reading resolving is heard as well as seen.
    sound.lift(1.6);
    this.hologram.body = null;
    this.hologram.demo = null;
    this.hologram.analysis = analysis;
    this.hologram.previous = previous;
    this.hologram.sentiment = sentiment ?? 'steady';
    // The same clauses, in the same order, the controller paces her voice
    // by - narrationFor is deterministic - so a voice-driven reveal and the
    // timed one light the regions identically.
    this.hologram.revealQueue = narrationFor(analysis, previous)?.clauses.map((c) => c.key) ?? [];
    this.hologram.revealed = [];
    this.hologram.activeRegion = null;
    // The reading is done; now she is telling you about it.
    this.lookAt('viewer');
    this.presentWithSentiment(sentiment);
    this.scheduleReveal(REVEAL_GRACE_MS);
  }

  presentBody(analysis: BodyAnalysis, previous: BodyAnalysis | null, sentiment?: ScanSentiment): void {
    this.clearReveal();
    this.hologram.analysis = null;
    this.hologram.previous = null;
    this.hologram.demo = null;
    // The reveal belongs to a skin reading; one left from an earlier scan
    // would light skin metrics over a body.
    this.hologram.revealQueue = [];
    this.hologram.revealed = [];
    this.hologram.activeRegion = null;
    this.hologram.body = { analysis, previous };
    this.hologram.sentiment = sentiment ?? 'steady';
    this.lookAt('viewer');
    this.presentWithSentiment(sentiment);
  }

  revealRegion(key: SkinMetricKey): void {
    this.light(key);
    // Her voice is pacing the reveal; the timer steps back to a watchdog.
    if (this.hologram.revealed.length < this.hologram.revealQueue.length) {
      this.scheduleReveal(REVEAL_STEP_MS * 2);
    } else {
      this.clearReveal();
    }
  }

  releaseRegion(): void {
    this.hologram.activeRegion = null;
    // The point that lit the region is let go; her state and face stay the turn's.
    if (this.current.gesture !== 'none') this.current = { ...this.current, gesture: 'none' };
    this.show(this.current);
  }

  publishTour(next: TourView): void {
    this.tourView = next;
  }

  reportTour(report: TourReport): void {
    this.onTourReport?.(report);
  }

  /**
   * No demonstrations ship with the 2D stage - the old library played
   * painted clips of the old character. Null keeps the controller's
   * demonstration beat dormant rather than pointing at nothing.
   */
  demoForBody(_keys: readonly string[]): unknown | null {
    return null;
  }

  showDemo(clip: unknown): void {
    this.hologram.demo = clip;
  }

  // -------------------------------------------------------------------------
  // Touch and attention
  // -------------------------------------------------------------------------

  glanceAtScreen(x: number, y: number, seconds = GLANCE_SECONDS): void {
    this.character.gazeX = clamp(x, -1, 1);
    this.character.gazeY = clamp(y, -1, 1);
    clearTimeout(this.glanceTimer);
    this.glanceTimer = setTimeout(() => {
      this.glanceTimer = undefined;
      this.aimGaze();
    }, seconds * 1000);
  }

  setHologramDirection(x: number, y: number): void {
    this.hologramGaze = { x: clamp(x, -1, 1), y: clamp(y, -1, 1) };
    this.aimGaze();
  }

  lookAt(what: Attention): void {
    this.character.attention = what;
    this.aimGaze();
  }

  /**
   * A tap that landed on her. She reacts in the body - a tilt for the face,
   * a small wave for the rest - and the controller gets the zone so she can
   * say something about it. Rate-limited: a held finger is one reaction.
   */
  pokeAt(zone: PokeZone): void {
    const now = performance.now();
    if (now - this.lastAcknowledged < REACTION_GAP_MS) return;
    this.lastAcknowledged = now;
    this.react({
      expression: zone === 'face' ? 'surprised' : 'curious',
      gesture: zone === 'face' ? 'head_tilt' : 'small_wave',
      intensity: 0.7,
    });
    this.onPoked?.(zone);
  }

  /** A tap somewhere else: curiosity, never a change of state. */
  acknowledgeTouch(): void {
    const now = performance.now();
    if (now - this.lastAcknowledged < REACTION_GAP_MS) return;
    this.lastAcknowledged = now;
    this.react({ expression: 'curious', gesture: 'head_tilt' });
  }

  pickMetric(key: SkinMetricKey): void {
    this.onMetricPicked?.(key);
  }

  // -------------------------------------------------------------------------
  // Lifetime
  // -------------------------------------------------------------------------

  reset(): void {
    tour.end('reset');
    this.stopEverything();
    if (this.roomTarget === 'clinical') sound.stopRoom();
    this.roomTarget = 'lounge';
    this.roomToken++;
    this.clearHologram();
    this.current = { ...DEFAULT_DIRECTIVE };
    this.show(this.current);
    this.character.attention = 'viewer';
    this.character.gazeX = 0;
    this.character.gazeY = 0;
    this.longThinkFired = false;
    this.lastAcknowledged = -Infinity;
    this.lastRevealPoint = -Infinity;
  }

  dispose(): void {
    tour.end('reset');
    this.stopEverything();
    this.clearHologram();
    this.onPoked = null;
    this.onMetricPicked = null;
    this.onLongThink = null;
  }

  /**
   * Advances the line by `dt` seconds. The frame loop calls it; exposed for
   * tests and for dev tooling in a pane that throttles animation frames.
   */
  step(dt: number): void {
    const track = this.track;
    if (!track) return;
    const { viseme, weight } = track.advance(dt);
    this.speechElapsed += dt;
    this.character.viseme = viseme;
    this.character.mouthOpen = clamp(weight);
    this.character.speaking = !(track instanceof MutedSpeechTrack) && !track.finished;

    // Her phrasing, when the track can report it: a pause starting is
    // exactly where a person lands a beat.
    const phrase = track.consumePhrase?.() ?? false;
    if (phrase) this.maybeCloseTurn(false);
    this.gesticulate(dt, phrase);

    if (track.finished) {
      this.track = null;
      this.character.viseme = 'sil';
      this.character.mouthOpen = 0;
      this.character.speaking = false;
      this.maybeCloseTurn(true);
      // Settle back into what she was doing, without inventing a mood. The
      // resting state is adopted only where the state machine allows it: a
      // result mood like HAPPY has no edge to ANALYSIS_COMPLETE, and it
      // outlives the line that delivered it.
      const rest: CharacterState = session.sceneMode === 'clinical' ? 'ANALYSIS_COMPLETE' : 'IDLE';
      if (canTransition(this.current.state, rest)) this.current = { ...this.current, state: rest };
      this.show(this.current);
      this.watchThinking();
    }
  }

  // -------------------------------------------------------------------------
  // Inside
  // -------------------------------------------------------------------------

  /**
   * Publishes a directive to the figure. `replay` restarts the gesture even
   * when it is the one already showing - a second nod is a second nod.
   */
  private show(directive: CharacterDirective, replay = false): void {
    const c = this.character;
    c.state = directive.state;
    c.expression = directive.expression;
    c.intensity = directive.intensity;
    const gesture = directive.gesture === 'none' ? null : directive.gesture;
    if (gesture !== null && (replay || gesture !== c.gesture)) c.gestureSeq++;
    c.gesture = gesture;
  }

  private setTrack(track: SpeechTrackLike): void {
    this.track = track;
    this.wake();
  }

  private wake(): void {
    if (this.frameHandle || typeof requestAnimationFrame === 'undefined') return;
    this.lastFrame = performance.now();
    this.frameHandle = requestAnimationFrame(this.frame);
  }

  private frame = (now: number): void => {
    this.frameHandle = 0;
    const dt = Math.min(MAX_FRAME_SECONDS, Math.max(0, (now - this.lastFrame) / 1000));
    this.lastFrame = now;
    this.step(dt);
    if (this.track) this.frameHandle = requestAnimationFrame(this.frame);
  };

  private reacting(): boolean {
    return performance.now() < this.reactionUntil;
  }

  /** Borrows her face for a moment; the turn's own comes back when it expires. */
  private react(face: Partial<CharacterDirective>): void {
    this.reactionUntil = performance.now() + REACTION_MS;
    this.show({ ...this.current, ...face }, true);
    clearTimeout(this.reactionTimer);
    this.reactionTimer = setTimeout(() => {
      this.reactionTimer = undefined;
      this.reactionUntil = 0;
      // Head gestures are impulses and would replay; the held arm poses are
      // the turn's own and stay.
      const g = this.current.gesture;
      this.show({ ...this.current, gesture: POSE_GESTURES.has(g) ? g : 'none' });
    }, REACTION_MS);
  }

  private aimGaze(): void {
    if (this.glanceTimer !== undefined) return;
    const target = this.character.attention === 'hologram' ? this.hologramGaze : { x: 0, y: 0 };
    this.character.gazeX = target.x;
    this.character.gazeY = target.y;
  }

  /** After seven seconds of THINKING she softens and nods, once per think. */
  private watchThinking(): void {
    if (this.current.state !== 'THINKING') {
      clearTimeout(this.thinkTimer);
      this.thinkTimer = undefined;
      this.longThinkFired = false;
      return;
    }
    if (this.thinkTimer !== undefined || this.longThinkFired) return;
    this.thinkTimer = setTimeout(() => {
      this.thinkTimer = undefined;
      if (this.current.state !== 'THINKING') return;
      this.longThinkFired = true;
      this.applyDirective({ ...this.current, expression: 'warm', gesture: 'slow_nod' });
      this.onLongThink?.();
    }, LONG_THINK_MS);
  }

  /** How she delivers a result: the same sentiment her spoken turn was built from. */
  private presentWithSentiment(sentiment: ScanSentiment | undefined): void {
    if (sentiment === 'improving') {
      // There is no CLINICAL_ANALYSIS -> HAPPY edge; good news arrives as a
      // result first.
      if (this.current.state === 'CLINICAL_ANALYSIS') {
        this.applyDirective({ state: 'ANALYSIS_COMPLETE', expression: 'smile', gesture: 'none', intensity: 0.7 });
      }
      this.applyDirective({ state: 'HAPPY', expression: 'smile', gesture: 'point_to_hologram', intensity: 0.7 });
    } else if (sentiment === 'declining') {
      this.applyDirective({ state: 'CONCERNED', expression: 'concerned', gesture: 'point_to_hologram', intensity: 0.65 });
    } else {
      this.applyDirective({ state: 'ANALYSIS_COMPLETE', expression: 'warm', gesture: 'point_to_hologram', intensity: 0.6 });
    }
  }

  /**
   * Lights a region: everything queued up to and including it (the
   * narration is the authority on order, so nothing skipped is left dark),
   * or just it when it was not queued. She points at it and glances over.
   */
  private light(key: SkinMetricKey): void {
    const queue = this.hologram.revealQueue;
    const lit = this.hologram.revealed;
    const at = queue.indexOf(key, lit.length);
    if (at >= 0) {
      this.hologram.revealed = [...lit, ...queue.slice(lit.length, at + 1)];
    } else if (!lit.includes(key)) {
      this.hologram.revealed = [...lit, key];
    }
    if (this.hologram.revealed.length !== lit.length) sound.tick(1 + this.hologram.revealed.length * 0.05);
    this.hologram.activeRegion = key;

    const now = performance.now();
    if (now - this.lastRevealPoint >= REVEAL_POINT_GAP_MS) {
      this.lastRevealPoint = now;
      this.show({ ...this.current, gesture: 'point_to_hologram' }, true);
      this.glanceAtScreen(this.hologramGaze.x, this.hologramGaze.y, 0.9);
    }
  }

  private scheduleReveal(ms: number): void {
    clearTimeout(this.revealTimer);
    this.revealTimer = setTimeout(() => this.revealNext(), ms);
  }

  private revealNext(): void {
    this.revealTimer = undefined;
    // The consult tour lights the regions, one place at a time: the timed reveal lights nothing
    // while a tour is on, or while the controller waits for the first run of this reading.
    if (this.tourView.phase !== 'off' || this.tourView.awaited) return;
    const queue = this.hologram.revealQueue;
    const next = queue[this.hologram.revealed.length];
    if (next === undefined) return;
    // While she is speaking, her voice paces the lights; wait for it.
    if (!session.speaking) this.light(next);
    if (this.hologram.revealed.length < queue.length) this.scheduleReveal(REVEAL_STEP_MS);
  }

  private clearReveal(): void {
    clearTimeout(this.revealTimer);
    this.revealTimer = undefined;
  }

  private clearHologram(): void {
    this.clearReveal();
    const h = this.hologram;
    h.mesh = null;
    h.analysis = null;
    h.previous = null;
    h.sentiment = null;
    h.body = null;
    h.revealQueue = [];
    h.revealed = [];
    h.activeRegion = null;
    h.capture = null;
    h.demo = null;
  }

  private stopEverything(): void {
    if (this.frameHandle && typeof cancelAnimationFrame !== 'undefined') cancelAnimationFrame(this.frameHandle);
    this.frameHandle = 0;
    this.track = null;
    this.character.viseme = 'sil';
    this.character.mouthOpen = 0;
    this.character.speaking = false;
    for (const timer of [this.reactionTimer, this.glanceTimer, this.thinkTimer, this.roomTimer, this.revealTimer]) {
      clearTimeout(timer);
    }
    this.reactionTimer = this.glanceTimer = this.thinkTimer = this.roomTimer = this.revealTimer = undefined;
    this.reactionUntil = 0;
  }

  /**
   * Moves her hands while she talks, in beats keyed to her phrasing, with a
   * wall timer underneath for a track that reports none. Head movements
   * lead; an arm pose is the exception, never twice running, and a
   * concerned turn keeps the head low and slow. Only the gesture shown
   * changes - her state and face belong to the turn.
   */
  private gesticulate(dt: number, phrase: boolean): void {
    this.gestureTimer -= dt;
    this.phraseGestureGap += dt;
    const onPhrase = phrase && this.phraseGestureGap >= 2;
    if (!onPhrase && this.gestureTimer > 0) return;
    // Irregular on purpose: a gesture on a metronome reads as a loop.
    this.gestureTimer = 4.2 + Math.random() * 3.6;
    this.phraseGestureGap = 0;
    if (this.reacting()) return;

    const presenting = session.sceneMode !== 'lounge' && (this.hologram.analysis !== null || this.hologram.body !== null);
    const concerned = this.current.state === 'CONCERNED' || this.current.expression === 'concerned';
    const heads: Gesture[] = concerned ? ['slow_nod', 'head_tilt'] : ['nod', 'slow_nod', 'head_tilt', 'lean_in'];
    let arms: Gesture[] = presenting ? ['point_to_hologram', 'open_palms'] : ['open_palms'];
    if (concerned) arms = arms.filter((g) => g !== 'open_palms');
    const useArm = !this.lastArmGesture && arms.length > 0 && Math.random() < 0.38;
    const pool = useArm ? arms : heads;
    this.lastArmGesture = useArm;
    this.show({ ...this.current, gesture: pool[Math.floor(Math.random() * pool.length)] }, true);
  }

  /**
   * One expression shift per spoken turn: a happy-family turn closes on a
   * smile as she reaches her last phrase - a phrase boundary past about 70%
   * of the line, or the settle when it ends, whichever comes first.
   */
  private maybeCloseTurn(settling: boolean): void {
    if (this.closeFired) return;
    const d = this.current;
    const happy = d.state === 'HAPPY' || d.expression === 'smile' || d.expression === 'grin' || d.expression === 'reassuring';
    if (!happy) {
      this.closeFired = true;
      return;
    }
    if (!settling && this.speechProgress() < 0.7) return;
    this.closeFired = true;
    if (d.expression === 'smile') return;
    this.current = { ...d, expression: 'smile' };
    // On the settle the caller shows the result; mid-line it lands now.
    if (!settling) this.show(this.current);
  }

  /** How far through the line she is, 0..1: real spoken characters first, elapsed time second. */
  private speechProgress(): number {
    const spoken = session.spokenChars;
    if (spoken > 0 && spoken !== this.turnSpokenBaseline && this.turnTextLength > 0) {
      return clamp(spoken / this.turnTextLength);
    }
    if (this.speechDuration > 0) return clamp(this.speechElapsed / this.speechDuration);
    return 0;
  }

  /** A walk between rooms, or no walk at all when motion is reduced. */
  private walkMs(ms: number): number {
    if (session.user?.preferences.reducedMotion) return 0;
    if (typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches) return 0;
    return ms;
  }
}

/** The one director. Registered with the controller at boot (`App.svelte`). */
export const director = new StageDirector();
