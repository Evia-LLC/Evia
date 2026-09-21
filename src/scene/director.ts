/**
 * The SessionDirector — the client-side orchestrator.
 *
 * Owns the stage, the avatar and the environments, and translates application
 * events ("Elohim is thinking", "the scan reached 40%", "enter clinical mode") into
 * scene behaviour. It is the only client module that touches both the store and
 * three.js; the character engine never reads the store, and the store never
 * imports three.
 */
import * as THREE from 'three';
import { Stage, SHOT_CLINICAL, SHOT_CLINICAL_PORTRAIT, SHOT_CONVERSATION } from './stage.ts';
import { LoungeEnvironment } from './lounge.ts';

/*
 * Where the entry-screen hologram lives.
 *
 * Depth and height are fixed because they are compositional: set back in the
 * room so perspective sizes it, at roughly her eye line. Only the horizontal
 * placement and the scale are solved per frame, because those are the two that
 * depend on how wide the window happens to be.
 */
/** The lounge lamp's colour, and the clinic's — what the glow behind her borrows. */
const AURA_WARM = 0xffc98a;
const AURA_COOL = new THREE.Color(0x9fb8ff);
/** What the glow warms toward while she is talking to you, in either room. */
const AURA_TALKING = new THREE.Color(0xffe4c4);

import type { ElohimEnvironment } from './environment.ts';
import { EseAvatar } from '@/character/ese-avatar.ts';
import type { BodyAnalysis } from '@/body-analysis/pipeline.ts';
import type { ScanMesh } from '@/holograms/face-mesh-3d.ts';
import type { ElohimAvatar } from '@/character/types.ts';
import { MutedSpeechTrack, SpeechTrack, type SpeechTrackLike } from '@/character/speech.ts';
import { session } from '@/state/session.svelte.ts';
import * as sound from '@/lib/sound.ts';
import { Cinematographer, type Facing } from './cinematography.ts';
import { Grade } from './grade.ts';
import { radialTexture } from './textures.ts';
import { clamp, damp } from '@/lib/math.ts';
import { canTransition } from '@shared/character-fsm.ts';
import { METRIC_FACE_REGIONS } from '@/holograms/primitives.ts';
import type { CharacterDirective, SkinAnalysis, SkinMetricKey } from '@shared/types.ts';

/**
 * How the latest reading compares to the one before it, as the server's
 * fallback turn derives it. It colours how she delivers the result — good news
 * is allowed to look like good news.
 */
export type ScanSentiment = 'improving' | 'declining' | 'steady';

/** The clinic's real key light warms slightly when she turns to the viewer. */
const KEY_READING = new THREE.Color(0xdfefff);
const KEY_TALKING = new THREE.Color(0xffe4c4);

/**
 * Where the contour model floats relative to her, mirroring the offset the
 * rig places it at. Duplicated rather than imported because the rig is
 * lazy-loaded, and importing a constant from it would pull three.js back into
 * the initial chunk.
 */
const FACE_GAZE = new THREE.Vector3(0.62, 1.5, -0.18);

/**
 * Served from `public/`, so it is a plain fetch with no bundler involvement.
 *
 * The `.min` build is the same asset with its 2048² texture re-encoded from PNG
 * to WebP — 7.0 MB down to 1.98 MB, which on a phone is the difference between
 * a wait and a load. See `scripts/shrink-glb.mjs`.
 */

/** Lazily loaded so the lounge boots without paying for the clinical room. */
type ClinicalModule = typeof import('./clinical.ts');
type HologramModule = typeof import('@/holograms/rig.ts');

export class SessionDirector {
  private stage: Stage;
  private avatar: ElohimAvatar;
  private lounge: LoungeEnvironment;

  private clinical: ElohimEnvironment | null = null;
  /** The whole-frame pass that makes her and the backdrop share a lens. */
  private grade: Grade;
  /** The glow behind her. See the constructor. */
  private aura: THREE.Mesh;
  private auraColour = new THREE.Color();
  private holograms: InstanceType<HologramModule['HologramRig']> | null = null;

  private speech: SpeechTrackLike | null = null;
  private speechLevel = 0;
  private gazeTarget: THREE.Vector3 | null = null;
  /**
   * What she is currently paying attention to.
   *
   * `setGaze` existed on this class and nothing ever called it, so
   * `gazeTarget` stayed null for the life of the session and she looked
   * straight ahead through every beat — reading a scan, explaining a result,
   * being spoken to. That is most of what makes a rendered person read as a
   * picture of a person.
   *
   * Resolved per frame rather than set once, because both things she looks at
   * move: the camera travels between shots and the projection is placed against
   * the frustum every frame.
   */
  private attention: 'viewer' | 'hologram' = 'viewer';
  /** Counts down while a tap holds her attention somewhere specific. */
  private glanceFor = 0;
  private glanceAt = new THREE.Vector3();
  /** When she last reacted to a touch, so a held finger is one reaction. */
  private lastAcknowledged = 0;
  /**
   * When the current touch reaction should let go, in `performance.now()`
   * milliseconds; zero when none is live. The mirror of `glanceFor`: a poke
   * borrows her face for a couple of seconds and then the turn's own
   * directive returns, where before a body poke held its pose until
   * something else happened to overwrite it.
   */
  private reactionUntil = 0;

  /** 0 = lounge, 1 = clinical. Everything in the transition reads from this. */
  private clinicalPresence = 0;
  private transitionTarget = 0;
  private clinicalEntryEpoch = 0;
  private clinicalLoading: Promise<void> | null = null;
  private transitionRate = 1 / 2.6;
  private beatCallbacks: Array<{ at: number; fired: boolean; run: () => void }> = [];

  /**
   * Chooses the framing and the blocking. Only consulted in the clinic — the
   * lounge is a single deliberate shot of her sitting with you, and cutting
   * around inside a conversation would be worse than holding.
   */
  private readonly cine = new Cinematographer();
  /** Turn added to her solved mark by the current shot. */
  private blockingYaw = 0;
  /** Where the shot wants her attention, overriding the app's gaze target. */
  private blockingGaze = new THREE.Vector3();
  /** 0 = reading the panel, 1 = talking to you. Drives the room's answer. */
  private mood = 0;
  /** Counts down to her next gesture while she is speaking. */
  private gestureTimer = 0;
  /** Whether the last beat moved her arms, so the next one moves her head. */
  private lastArmGesture = false;
  /**
   * Seconds since a beat gesture last fired, for the phrase-keyed path. The
   * estimated track reports a boundary at every comma, and a gesture on every
   * comma is a metronome — so phrases may fire a beat at most this often.
   */
  private phraseGestureGap = 0;
  /** Counts down after the room fully resolves; see the arrival beat. */
  private arrivalHold = 0;
  /** How long she has been visibly thinking, and whether patience showed. */
  private thinkSeconds = 0;
  private longThinkFired = false;
  /** One expression shift per spoken turn — see `maybeCloseTurn`. */
  private closeFired = true;
  private speechElapsed = 0;
  private speechDuration = 0;
  private turnTextLength = 0;
  /**
   * `session.spokenChars` as it stood when the turn began. The voice
   * controller zeroes it when a line starts and completes it when one ends —
   * so an unchanged value is last line's leftover, not this line's progress.
   */
  private turnSpokenBaseline = 0;
  /** When the reveal's point gesture last re-fired, so clauses don't stack it. */
  private lastRevealGesture = 0;

  private statsTimer = 0;
  /** Where the presenter should stand, per the layout. Damped towards. */
  private presenterTarget = new THREE.Vector3(0, 0, 0);
  private presenterYawTarget = 0;
  private presentation: 'film' | 'intake' | 'app' = 'app';
  private disposed = false;



  /** The floor line she stands on in the clinic. */
  private static readonly PRESENTER_Z = 0.28;

  constructor(canvas: HTMLCanvasElement, forcedTier: 'auto' | 'low' | 'medium' | 'high' = 'auto') {
    this.stage = new Stage(canvas, forcedTier);
    // The room contains its own floor; the cropped avatar needs no foot shadow.
    this.lounge = new LoungeEnvironment({
      particles: this.stage.settings.particles,
      ground: false,
    });
    this.stage.scene.add(this.lounge.group);

    const avatar = new EseAvatar();
    avatar.onDirectiveRejected = (info) =>
      console.warn(`[elohim/character] rejected ${info.reason}: ${info.detail}`);
    avatar.mount(this.stage.scene);
    this.avatar = avatar;

    session.characterStatus = 'loading';
    void avatar.load().then(async () => {
      if (this.disposed) return;
      avatar.root.visible = true;
      await this.stage.renderer.compileAsync(this.stage.scene, this.stage.camera);
      if (!this.disposed) {
        avatar.root.visible = this.presentation !== 'film';
        session.characterStatus = 'ready';
      }
    }).catch((error: unknown) => {
      if (this.disposed) return;
      session.characterStatus = 'error';
      console.error('[elohim/character] could not load Elohim', error);
      // Keep the portal and a truthful loading error; never replace Ese with
      // a different character when her model cannot be downloaded.
    });



    this.grade = new Grade(this.stage.camera);
    // The camera has children now, so it has to be in the scene graph for their
    // world matrices to update.
    this.stage.scene.add(this.stage.camera);

    /*
     * The light she stands in.
     *
     * A painted figure over a photographed room can look pasted on however
     * well the two are matched, because nothing in the room ever answers to
     * her. This is one soft additive glow behind her, breathing with her,
     * warm in the lounge and cool in the clinic, and brighter while she
     * speaks — the room noticing that someone is in it. One quad, no light.
     */
    this.aura = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({
        map: radialTexture(2.2),
        transparent: true,
        opacity: 0,
        color: AURA_WARM,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: false,
        toneMapped: false,
      }),
    );
    this.aura.renderOrder = -6;
    this.aura.frustumCulled = false;
    this.stage.scene.add(this.aura);

    this.stage.onTierResolved = (tier) => {
      session.qualityTier = tier;
      // Kept as a hook: the painted rig has no hull to dilate, so this is a
      // no-op today and the seam stays honest for whatever implements it next.
      this.avatar.setFringe?.(tier !== 'low');
      console.info(`[elohim/stage] quality tier resolved to "${tier}"`);
    };
    this.stage.onFrame = (dt, elapsed) => this.frame(dt, elapsed);
    this.stage.start();

    // Developer handle (brief §35). Exposes the scene for inspection and lets it
    // be stepped without requestAnimationFrame, which never fires in a tab that
    // is not compositing. Dev builds only.
    if (import.meta.env.DEV) {
      (window as unknown as { __elohim?: SessionDirector }).__elohim = this;
    }
  }

  /**
   * Steps the scene, then renders one frame at an explicit size and returns it
   * as a PNG data URL. Dev tooling — the only way to see the scene when the
   * host pane is not compositing.
   */
  captureFrame(width = 1280, height = 720, settleFrames = 90): string {
    // Solve the layout for the capture's aspect, not the live canvas's: they
    // differ, and geometry solved against one lands outside the other.
    const shot = this.clinicalShot();
    this.holograms?.setLayout({
      fovDeg: shot.fov,
      aspect: width / Math.max(1, height),
      cameraY: shot.target.y,
      cameraZ: shot.position.z,
    });

    for (let i = 0; i < settleFrames; i++) this.stage.stepManually(1 / 60);
    const url = this.stage.captureFrame(width, height);

    this.holograms?.setLayout(this.viewFrustum());
    return url;
  }

  /** Steps `frames` frames without rAF, then reports the budget. Dev tooling. */
  stepHeadless(frames = 1, dt = 1 / 60): { calls: number; triangles: number } {
    for (let i = 0; i < frames; i++) this.stage.stepManually(dt);
    return this.stage.stats();
  }

  /** Current scene mode plus rig counts — used by the budget check. */
  inspect() {
    return {
      avatar: this.avatar.stats(),
      frame: this.stage.stats(),
      tier: this.stage.tier,
      clinicalLoaded: this.clinical !== null,
      sceneMode: session.sceneMode,
    };
  }

  // -------------------------------------------------------------------------
  // Frame
  // -------------------------------------------------------------------------

  private frame(dt: number, elapsed: number): void {
    this.advanceTransition(dt);

    if (this.speech) {
      const { viseme, weight, level } = this.speech.advance(dt);
      this.avatar.setViseme(viseme, weight);
      this.speechLevel = level;
      this.speechElapsed += dt;
      // Her phrasing, when the track can report it. A boundary is the instant
      // a pause starts — exactly where a person lands a beat gesture.
      const phrase = this.speech.consumePhrase?.() ?? false;
      if (phrase) this.maybeCloseTurn(false);
      this.gesticulate(dt, phrase);
      if (this.speech.finished) {
        this.speech = null;
        this.speechLevel = 0;
        this.avatar.setViseme('sil', 0);
        // The last chance for the turn's closing expression to land.
        this.maybeCloseTurn(true);
        // Settle back into whatever she was doing, without inventing a mood.
        // The resting state is only adopted where the FSM allows it — a
        // result mood like HAPPY cannot legally reach ANALYSIS_COMPLETE, and
        // it outlives the line that delivered it.
        const rest = session.sceneMode === 'clinical' ? 'ANALYSIS_COMPLETE' : 'IDLE';
        this.avatar.applyDirective({
          ...this.currentDirective,
          state: canTransition(this.currentDirective.state, rest)
            ? rest
            : this.currentDirective.state,
        });
      }
    }

    // A touch reaction lives for a couple of seconds, then lets go — the
    // expression mirror of the glance decay. The gesture channel is left at
    // rest on the way out: the reaction's impulse has played, and re-firing
    // the turn's own beat two seconds late would read as a second reaction.
    if (this.reactionUntil > 0 && performance.now() >= this.reactionUntil) {
      this.reactionUntil = 0;
      /*
       * Head gestures are impulses and would replay on a reapply, so they
       * are dropped - but the three arm gestures are painted body poses, and
       * a turn that landed during the reaction still deserves its arms.
       * Stripping those cut her from open palms back to rest mid-sentence.
       */
      const g = this.currentDirective.gesture;
      const pose = g === 'open_palms' || g === 'point_to_hologram' || g === 'small_wave';
      this.avatar.applyDirective({ ...this.currentDirective, gesture: pose ? g : 'none' });
    }

    // Thinking is allowed to take a moment; after seven seconds it should
    // stop looking like a stall. She softens and nods — the interaction
    // layer decides whether the patience line gets spoken.
    if (this.currentDirective.state === 'THINKING') {
      this.thinkSeconds += dt;
      if (!this.longThinkFired && this.thinkSeconds >= 7) {
        this.longThinkFired = true;
        this.applyDirective({ ...this.currentDirective, expression: 'warm', gesture: 'slow_nod' });
        this.onLongThink?.();
      }
    } else {
      this.thinkSeconds = 0;
      this.longThinkFired = false;
    }

    // The camera holds the finished room for a breath before going to work.
    if (this.arrivalHold > 0) {
      this.arrivalHold -= dt;
      if (this.arrivalHold <= 0) this.cine.request('present', true);
    }

    // Directed only on the way in and while there: the exit is a walk home,
    // not a scene, and letting the cinematographer keep recutting it was what
    // stranded the camera on a clinic framing after the room had gone.
    const directed = this.presentation === 'app' && session.sceneMode !== 'lounge' && this.transitionTarget === 1;
    if (directed) this.direct(dt);
    // In the lounge she is talking with you, which is what mood = 1 means.
    else this.mood = damp(this.mood, 1, 1.5, dt);

    // She walks to her mark rather than teleporting. In the lounge that mark is
    // the origin; in the clinical room it is beside the panel.
    const root = this.avatar.root;
    root.position.x = damp(root.position.x, this.presenterTarget.x, 2.6, dt);
    root.position.z = damp(root.position.z, this.presenterTarget.z, 2.6, dt);
    root.position.y = damp(root.position.y, this.presenterTarget.y, 2.6, dt);
    root.rotation.y = damp(root.rotation.y, this.presenterYawTarget + this.blockingYaw, 2.6, dt);

    this.resolveAttention(dt);

    this.avatar.update(dt, {
      elapsed,
      // In the clinic the shot decides where she looks. Being looked at while
      // she talks to you, and looked past while she reads the panel, is most of
      // what makes her feel present rather than aimed at the lens forever.
      gazeTarget: directed ? this.blockingGaze : this.gazeTarget,
      speechLevel: this.speechLevel,
      reducedMotion: session.user?.preferences.reducedMotion ?? window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    });

    // The light behind her follows her, and answers to what she is doing:
    // brighter when she turns to you, brighter again while she speaks, and
    // warmed toward the talking amber by the same mood that grades the room.
    {
      const material = this.aura.material as THREE.MeshBasicMaterial;
      const reduced = session.user?.preferences.reducedMotion ?? false;
      const breath = reduced ? 0 : Math.sin(elapsed * 0.9) * 0.012;
      this.aura.position.set(root.position.x, 1.28, root.position.z - 0.1);
      this.aura.scale.set(1.9, 2.5, 1);
      this.auraColour
        .setHex(AURA_WARM)
        .lerp(AURA_COOL, this.clinicalPresence)
        .lerp(AURA_TALKING, this.mood);
      material.color.copy(this.auraColour);
      material.opacity = 0.06 + this.mood * 0.06 + breath + this.speechLevel * 0.14;
    }

    this.grade.setStrength(this.clinicalPresence);
    // The film stock follows the room, but never all the way: a full-cool mix
    // crushed the frame, so the clinic tops out around 0.8. The lounge idles a
    // touch off full warm and leans warm while she speaks — the stock itself
    // answering her voice.
    this.grade.setMood(
      this.clinicalPresence * 0.8 +
        (1 - this.clinicalPresence) * 0.08 * (1 - clamp(this.speechLevel * 1.5)),
    );
    this.grade.update(elapsed);

    this.lounge.update(dt, elapsed);
    this.clinical?.update(dt, elapsed);
    if (this.holograms) {
      // Placed before updating, so the assembly is already around her on the
      // frame it is drawn rather than a frame behind her.
      this.stageHolograms();
      this.holograms.update(dt, elapsed, session.user?.preferences.reducedMotion ?? false);
    }

    this.statsTimer += dt;
    if (this.statsTimer > 0.5) {
      this.statsTimer = 0;
      const s = this.stage.stats();
      session.devStats = { ...s, frameMs: Math.round(this.stage.frameMs * 10) / 10 };
    }
  }

  /**
   * One frame of direction: pick the framing, point the camera, turn her, and
   * decide what she is looking at.
   */
  private direct(dt: number): void {
    this.cine.setAspect(this.stage.aspect < 0.85);
    const blocking = this.cine.update(dt);

    this.stage.setShot(blocking.shot, this.cine.rate);
    this.blockingYaw = blocking.yawBias;

    this.gradeRoom(dt, blocking.facing);

    if (blocking.facing === 'panel') {
      // The contour model of the face being analysed, which is what she is
      // actually reading when she is not looking at you.
      this.blockingGaze.copy(this.avatar.root.position).add(FACE_GAZE);
    } else {
      // At the lens. She is talking to whoever is holding the phone.
      this.stage.camera.getWorldPosition(this.blockingGaze);
    }
  }

  /**
   * Warms the room when she turns to you and cools it when she reads.
   *
   * The clinical room had exactly one lighting state for the entire session,
   * which is the lighting equivalent of a locked-off camera — nothing on screen
   * acknowledged that anything was happening. This is small on purpose: a
   * slide towards amber that should be felt rather than noticed.
   *
   * Real room surfaces now respond to this key light. Only colour changes;
   * transition intensity remains owned by the environment.
   */
  private gradeRoom(dt: number, facing: Facing): void {
    this.mood = damp(this.mood, facing === 'viewer' ? 1 : 0, 1.5, dt);
    this.clinical?.lights.key.color.lerpColors(KEY_READING, KEY_TALKING, this.mood);
  }

  /**
   * Moves her hands while she talks.
   *
   * Gestures used to fire once, on the directive that began a turn, so she made
   * a single motion and then held still through a paragraph of speech. People
   * do not do that — they gesture *through* a sentence, in beats.
   *
   * Keyed to her phrasing where the track can report it: a beat lands the
   * instant a pause starts, which is where speakers actually put them. The
   * estimated track counts commas as boundaries, so the phrase path is
   * throttled to one beat every couple of seconds. The wall timer stays
   * underneath as the fallback — for a track with no phrase reporting, and
   * for a long unbroken clause where no boundary ever comes.
   */
  private gesticulate(dt: number, phrase: boolean): void {
    this.gestureTimer -= dt;
    this.phraseGestureGap += dt;
    const onPhrase = phrase && this.phraseGestureGap >= 2;
    if (!onPhrase && this.gestureTimer > 0) return;
    // The fallback stays irregular on purpose: a gesture on a fixed metronome
    // reads as a loop. Four to eight seconds, because a person explaining
    // something moves in phrases, not in ticks.
    this.gestureTimer = 4.2 + Math.random() * 3.6;
    this.phraseGestureGap = 0;

    const presenting =
      session.sceneMode !== 'lounge' &&
      (this.cine.shotName === 'present' || this.cine.shotName === 'reading');
    /*
     * Head gestures lead; arm gestures are the exception.
     *
     * An arm gesture is a cut to a different painting of her (hidden under a
     * blink by the rig, but a cut all the same), and a cut every few seconds
     * reads as a slideshow. Head movement is continuous and free. So the
     * arms come out about a third of the time, and never twice in a row.
     *
     * The pool bends to the turn's mood. Delivering a concerned result with
     * open palms is a weather presenter's cheer on a bad chart: concern keeps
     * the head low and slow. Anything else gets the full vocabulary.
     */
    const concerned =
      this.currentDirective.state === 'CONCERNED' ||
      this.currentDirective.expression === 'concerned';
    const heads: CharacterDirective['gesture'][] = concerned
      ? ['slow_nod', 'head_tilt']
      : ['nod', 'slow_nod', 'head_tilt', 'lean_in'];
    let arms: CharacterDirective['gesture'][] = presenting
      ? ['point_to_hologram', 'open_palms']
      : ['open_palms'];
    if (concerned) arms = arms.filter((g) => g !== 'open_palms');
    const lastWasArm = this.lastArmGesture;
    const useArm = !lastWasArm && arms.length > 0 && Math.random() < 0.38;
    const pool = useArm ? arms : heads;
    const gesture = pool[Math.floor(Math.random() * pool.length)];
    this.lastArmGesture = useArm;

    // Only the gesture changes. Her state and expression belong to the turn she
    // is in the middle of, and overwriting those mid-sentence would make her
    // mood flicker.
    this.avatar.applyDirective({ ...this.currentDirective, gesture });
  }

  /**
   * One expression shift per spoken turn: a happy-family turn closes on the
   * painted smile as she reaches her last phrase.
   *
   * A person delivering good news does not hold one face for the whole
   * paragraph — the smile arrives as the point lands. "Last phrase" is a
   * judgement call made from what is measurable: a phrase boundary past
   * roughly 70% of the line, or the settle when the line ends, whichever
   * comes first. Progress prefers the voice controller's spoken-character
   * count (real audio truth) and falls back to elapsed time against the
   * estimated track's duration.
   */
  private maybeCloseTurn(settling: boolean): void {
    if (this.closeFired) return;
    const d = this.currentDirective;
    const happyFamily =
      d.state === 'HAPPY' ||
      d.expression === 'smile' ||
      d.expression === 'grin' ||
      d.expression === 'reassuring';
    if (!happyFamily) {
      // The turn's mood is fixed at `elohimSpoke`; decide once and stop polling.
      this.closeFired = true;
      return;
    }
    if (!settling && this.speechProgress() < 0.7) return;
    this.closeFired = true;
    if (d.expression === 'smile') return; // already there; nothing to cut to
    this.currentDirective = { ...d, expression: 'smile' };
    // Mid-line the cut is applied now; on the settle the caller's own
    // directive spread carries it, so she does not get two cuts in a frame.
    if (!settling) this.avatar.applyDirective(this.currentDirective);
  }

  /** How far through the current line she is, 0..1, best evidence first. */
  private speechProgress(): number {
    const spoken = session.spokenChars;
    if (spoken > 0 && spoken !== this.turnSpokenBaseline && this.turnTextLength > 0) {
      // spokenChars indexes the cleaned speakable text, which is never longer
      // than the raw line, so this underestimates slightly — the close fires
      // late rather than early, which is the right way to be wrong.
      return clamp(spoken / this.turnTextLength);
    }
    if (this.speechDuration > 0) return clamp(this.speechElapsed / this.speechDuration);
    return 0;
  }

  private currentDirective: CharacterDirective = {
    state: 'IDLE',
    expression: 'warm',
    gesture: 'none',
    intensity: 0.5,
  };

  // -------------------------------------------------------------------------
  // Conversation hooks
  // -------------------------------------------------------------------------

  /** Called the moment the user starts typing — she notices. */
  userIsTyping(): void {
    // In the clinic she turns from the panel back to you. That turn is the
    // whole point: it says she noticed.
    this.cine.request('converse');
    if (session.sceneMode !== 'lounge') return;
    this.applyDirective({ ...this.currentDirective, state: 'LISTENING', gesture: 'none' });
  }

  userSubmitted(): void {
    // Hand to chin, because THINKING is now a behaviour rather than a label:
    // the pose is the thought being visibly held.
    this.applyDirective({
      state: 'THINKING',
      expression: 'focused',
      gesture: 'hand_to_chin',
      intensity: 0.55,
    });
  }

  /**
   * Fires once when a think has run long — about seven seconds — after she
   * has already softened on screen. Set by the controller, which owns the
   * once-per-conversation patience line; the director never speaks.
   */
  onLongThink: (() => void) | null = null;

  /**
   * Elohim responds: adopt her directive and start the line's timing.
   *
   * The timing runs from here - beat gestures land on it and she settles back
   * when it ends - but the lips stay shut. A mouth moving over silence is the
   * one thing this must never do, so the lips belong to whichever voice
   * actually produces sound: the voice controller swaps in a real track the
   * moment audio starts (`useSpeechTrack`), and if nothing ever speaks the
   * muted timing simply runs its course. 'keep' leaves whatever track is
   * running alone, for a turn that lands while the introduction narrates.
   */
  elohimSpoke(directive: CharacterDirective, text: string, mouth: 'wait' | 'keep' = 'wait'): void {
    this.applyDirective(directive);
    // The line's estimated timeline is built either way: it is the mouth when
    // nothing speaks, and the progress yardstick for the turn's closing
    // expression when something does.
    const estimated = new SpeechTrack(text);
    if (mouth === 'wait') this.speech = new MutedSpeechTrack(estimated);
    this.speechElapsed = 0;
    this.speechDuration = estimated.duration;
    this.turnTextLength = text.length;
    this.turnSpokenBaseline = session.spokenChars;
    this.closeFired = false;
    // First beat lands shortly after she starts, not immediately — nobody
    // gestures on their opening syllable. The phrase path waits with it.
    this.gestureTimer = 0.9;
    this.phraseGestureGap = 0;

    // What she is doing decides how she is framed. Pointing at a readout is a
    // presenting shot; anything else, while she is speaking to you, is a
    // conversation — and a conversation is filmed close.
    if (session.sceneMode !== 'lounge') {
      this.cine.request(directive.gesture === 'point_to_hologram' ? 'present' : 'converse');
    }
  }

  /**
   * Hands the mouth to an externally driven track — the voice controller uses
   * this to swap the estimated timeline for one locked to real audio once word
   * boundaries start arriving.
   */
  useSpeechTrack(track: SpeechTrackLike): void {
    // The muted timing may have run out while the audio was being fetched -
    // a short reply, a slow network - and the frame loop will then have
    // settled her back already. Undo that: the turn's own state returns for
    // as long as she is actually speaking, and the opening-syllable rule for
    // gestures starts over. Not while a touch reaction holds her face,
    // though - the audio arriving here is usually the poke line itself, and
    // restoring the turn's directive at that instant wiped the reaction a
    // beat after it landed.
    if (!this.speech && performance.now() >= this.reactionUntil) {
      this.avatar.applyDirective(this.currentDirective);
      this.gestureTimer = Math.max(this.gestureTimer, 0.9);
      this.phraseGestureGap = 0;
    }
    this.speech = track;
  }

  /**
   * Closes the mouth: the voice stopped, failed, or was never going to speak.
   *
   * The line's timing is kept, muted, rather than dropped, so she still
   * settles back into her resting state when it ends instead of holding the
   * last gesture forever.
   */
  stopMouth(): void {
    if (this.speech && !(this.speech instanceof MutedSpeechTrack)) {
      this.speech = new MutedSpeechTrack(this.speech);
    }
    this.speechLevel = 0;
    this.avatar.setViseme('sil', 0);
  }

  applyDirective(directive: CharacterDirective): void {
    this.currentDirective = directive;
    this.avatar.applyDirective(directive);
  }

  /**
   * Lights the face region a readout was measured from.
   *
   * Called by the DOM panel when a metric row is hovered or focused. The
   * readouts live in the interface now; this is the only thing the room still
   * needs to know about them.
   */
  focusMetricSlot(index: number | null): void {
    this.holograms?.setFocus(index);
  }

  /** Set by the app; fires when the user taps a metric. */
  onMetricPicked: ((key: SkinMetricKey) => void) | null = null;

  /** Where she looks. Passing null returns her to the camera. */
/**
   * Where she looks, worked out each frame.
   *
   * A glance beats everything: if someone just touched the screen, that is the
   * most interesting thing that has happened and she looks at it. Otherwise she
   * watches the projection while it is being read and the viewer the rest of
   * the time — which is the difference between a scan she is performing and a
   * result she is telling you about.
   */
  private resolveAttention(dt: number): void {
    if (this.glanceFor > 0) {
      this.glanceFor -= dt;
      this.gazeTarget = this.glanceAt;
      return;
    }

    if (this.attention === 'hologram' && this.holograms) {
      this.gazeTarget = this.holograms.projectionPoint(new THREE.Vector3());
      return;
    }

    this.gazeTarget = this.stage.camera.position;
  }

  /** Whether her attention is on the projection or on the person watching. */
  lookAt(what: 'viewer' | 'hologram'): void {
    this.attention = what;
  }

  /**
   * Something happened at a point on screen; look at it.
   *
   * The point arrives in clip space and is unprojected onto the plane she
   * stands on, so a tap near her shoulder pulls her eyes to her shoulder rather
   * than to somewhere behind the wall.
   */
  glanceAtScreen(ndcX: number, ndcY: number, seconds = 1.6): void {
    const point = new THREE.Vector3(ndcX, ndcY, 0.5).unproject(this.stage.camera);
    const camera = this.stage.camera.position;
    const direction = point.sub(camera).normalize();
    const planeZ = this.avatar.root.position.z;
    const distance = (planeZ - camera.z) / (direction.z || -1);
    this.glanceAt.copy(camera).addScaledVector(direction, distance);
    this.glanceFor = seconds;
  }

/**
   * A small acknowledgement that someone touched the screen.
   *
   * Only the gesture and expression, never the state: she may be mid-explanation
   * and being poked is not a reason to stop explaining. A head tilt and a
   * flicker of curiosity is what a person does when something moves beside them
   * while they are talking.
   *
   * Rate-limited, because holding a finger down produces a stream of events and
   * a face that re-reacts sixty times a second is having a seizure, not
   * noticing you.
   */
  /**
   * A tap that actually landed on her.
   *
   * Zone-aware where `acknowledgeTouch` is ambient: the raycast asks the
   * avatar what was touched, she reacts in the body - a tilt for the face, a
   * small wave for the coat - and the app layer gets the zone so she can say
   * something about it. Returns false when the tap hit the room instead.
   */
  onPoked: ((zone: 'face' | 'body') => void) | null = null;
  private pokeRay = new THREE.Raycaster();

  pokeAt(ndcX: number, ndcY: number): boolean {
    this.pokeRay.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.stage.camera);
    const zone =
      (this.avatar as { hitZone?: (ray: THREE.Raycaster) => 'face' | 'body' | null }).hitZone?.(
        this.pokeRay,
      ) ?? null;
    if (!zone) return false;

    const now = performance.now();
    if (now - this.lastAcknowledged >= 900) {
      this.lastAcknowledged = now;
      // Applied to the avatar directly, not adopted as the turn's directive:
      // the reaction is a borrowed face, and the frame loop hands it back
      // when this expires. If the app answers the poke with a spoken line,
      // that line arrives through `elohimSpoke` carrying the reaction as its
      // own directive, so the speech path cannot clobber it either.
      this.reactionUntil = now + 2200;
      this.avatar.applyDirective({
        ...this.currentDirective,
        expression: zone === 'face' ? 'surprised' : 'curious',
        gesture: zone === 'face' ? 'head_tilt' : 'small_wave',
        intensity: 0.7,
      });
      this.onPoked?.(zone);
    }
    return true;
  }

  acknowledgeTouch(): void {
    const now = performance.now();
    if (now - this.lastAcknowledged < 900) return;
    this.lastAcknowledged = now;
    // Same lease as a poke: the curiosity passes and her turn's face returns.
    this.reactionUntil = now + 2200;
    this.avatar.applyDirective({
      ...this.currentDirective,
      expression: 'curious',
      gesture: 'head_tilt',
    });
  }

  setGaze(target: THREE.Vector3 | null): void {
    this.gazeTarget = target;
  }

  // -------------------------------------------------------------------------
  // Clinical mode (ARCHITECTURE §7)
  // -------------------------------------------------------------------------

  async enterClinical(): Promise<void> {
    if (this.disposed || this.presentation !== 'app' || session.sceneMode !== 'lounge') return;
    const epoch = ++this.clinicalEntryEpoch;
    session.sceneMode = 'transitioning';
    // Arrive on the room itself. It is the one moment the place is the subject.
    this.cine.reset('establish');

    // Beat 3 needs the room to exist; load it before the lights start moving so
    // the transition never stalls waiting on a network round trip.
    try {
      await this.ensureClinicalLoaded();
    } catch {
      if (epoch === this.clinicalEntryEpoch && !this.disposed) {
        session.sceneMode = 'lounge';
        session.scanActive = false;
        session.chatError = 'The clinic could not load. Please try opening it again.';
      }
      return;
    }
    if (epoch !== this.clinicalEntryEpoch || this.disposed || this.presentation !== 'app') return;
    // The clinic has a floor under its silence. Fades in over the transition.
    sound.startRoom();

    this.transitionTarget = 1;
    this.transitionRate = 1 / 2.6;
    // The cinematographer takes over on the next frame; this only seeds the
    // move, at the establish pace so the seed and the shot agree.
    this.stage.setShot(this.clinicalShot(), 2.2);
    this.holograms?.setLayout(this.viewFrustum());
    this.adoptPresenterMark();

    // Beats 4, 5 and 8 — fired off the presence curve, so they stay in sync
    // even if a frame is dropped or the user interrupts.
    this.beatCallbacks = [
      {
        at: 0.32,
        fired: false,
        run: () => this.avatar.setOutfit('clinical', { transitionSeconds: 0.8 }),
      },
      {
        at: 0.99,
        fired: false,
        run: () => {
          session.sceneMode = 'clinical';
          this.applyDirective({
            state: 'CLINICAL_ANALYSIS',
            expression: 'focused',
            gesture: 'none',
            intensity: 0.7,
          });
        },
      },
      {
        // Once the room has *fully* resolved, hold the wide for a breath and
        // then go to work. The cut used to fire at 0.92, which moved the
        // camera while the last of the room was still fading in — a
        // first-time user never saw the finished place they had arrived at.
        at: 1,
        fired: false,
        run: () => {
          this.arrivalHold = 1.2;
        },
      },
    ];
  }

  exitClinical(): void {
    ++this.clinicalEntryEpoch;
    if (session.sceneMode === 'lounge') return;
    session.sceneMode = 'transitioning';
    sound.stopRoom();
    this.transitionTarget = 0;
    this.transitionRate = 1 / 1.6;
    // The exit is undirected (see `frame`), so this shot is the one the
    // camera actually travels home on. The move takes about as long as the
    // room takes to fade.
    this.stage.setShot(SHOT_CONVERSATION, 1.6);
    this.arrivalHold = 0;
    this.blockingYaw = 0;
    // Back to centre for the conversation.
    this.presenterTarget.set(0, 0, 0);
    this.presenterYawTarget = 0;
    this.avatar.setOutfit('casual', { transitionSeconds: 0.7 });
    this.holograms?.shutdown();
    // She keeps the mood the reading put her in. Snapping to a stock warm
    // face on the doorstep erased a concerned result the moment it mattered
    // most — the walk back to the sofa is part of the same conversation.
    this.applyDirective({
      state: 'IDLE',
      expression: this.currentDirective.expression,
      gesture: 'none',
      intensity: this.currentDirective.intensity,
    });
    this.beatCallbacks = [
      {
        at: 0.01,
        fired: false,
        run: () => {
          session.sceneMode = 'lounge';
        },
      },
    ];
  }

  /**
   * Where she stands.
   *
   * Taken from the gap the panel leaves rather than from a hardcoded offset, so
   * she cannot end up behind it at an aspect ratio nobody tested. The solved
   * layout is the fallback for the frames before the panel has measured itself.
   */
  private adoptPresenterMark(): void {
    // A fixed world position now.
    //
    // This used to solve her mark from the gap the display panel left in the
    // frame, because the panel occupied a third of it and she had to stand
    // clear. There is no panel any more — the readouts float around her — so
    // the only thing deciding where she stands is where she looks best, and
    // that is a constant. The camera does the composing.
    this.presenterTarget.set(-0.12, 0, SessionDirector.PRESENTER_Z);
    this.presenterYawTarget = 0.18;
  }

  /**
   * Puts the holographic assembly around her.
   *
   * Everything is positioned relative to where she is actually standing and
   * turned to face wherever the camera currently is, so the arrangement holds
   * as she walks to her mark and as the shot changes. Nothing here reads a DOM
   * rectangle any more: the analysis is in the room, not on a panel.
   */
  private stageHolograms(): void {
    if (!this.holograms) return;
    const cam = this.stage.camera;
    this.holograms.setViewport({
      fovDeg: cam.fov,
      aspect: cam.aspect,
      cameraY: cam.position.y,
      cameraZ: cam.position.z,
    });
    this.holograms.setStage(this.avatar.root.position, cam.position);
  }

  /**
   * Swaps the panel from the scan to the routine plan.
   *
   * The store flag is set here rather than by the caller, because there are two
   * ways in — the automatic swap after a scan, and the manual toggle — and when
   * only one of them set it the DOM and the 3D disagreed about what was on
   * screen.
   */
  showRoutine(): void {
    session.panelMode = 'routine';
    this.holograms?.setPlan(session.plan);
    this.holograms?.setMode('routine');
    this.cine.request('present', true);
    // Reassuring, not merely warm: the routine is the "here is what we do
    // about it" beat, and care is the honest register for it.
    this.applyDirective({
      state: 'EXPLAINING',
      expression: 'reassuring',
      gesture: 'point_to_hologram',
      intensity: 0.65,
    });
  }

  showScan(): void {
    session.panelMode = 'scan';
    this.holograms?.setMode('scan');
  }

  private clinicalShot() {
    return this.stage.aspect < 0.85 ? SHOT_CLINICAL_PORTRAIT : SHOT_CLINICAL;
  }

  private async ensureClinicalLoaded(): Promise<void> {
    if (this.disposed || this.clinical) return;
    this.clinicalLoading ??= (async () => {
      const [clinicalMod, holoMod]: [ClinicalModule, HologramModule] = await Promise.all([
        import('./clinical.ts'),
        import('@/holograms/rig.ts'),
      ]);
      // Imports cannot be aborted; do not mount new GPU resources after disposal.
      if (this.disposed) return;
      this.clinical = new clinicalMod.ClinicalEnvironment({
        particles: this.stage.settings.particles,
      });
      this.clinical.setPresence(0);
      this.stage.scene.add(this.clinical.group);

      this.holograms = new holoMod.HologramRig({
        rich: this.stage.settings.richEffects,
      });
      this.holograms.mount(this.stage.scene);
      this.holograms.setLayout(this.viewFrustum());
    })().finally(() => { this.clinicalLoading = null; });
    await this.clinicalLoading;
  }

  private advanceTransition(dt: number): void {
    const target = this.transitionTarget;
    if (Math.abs(this.clinicalPresence - target) > 0.0005) {
      const step = this.transitionRate * dt;
      this.clinicalPresence +=
        Math.sign(target - this.clinicalPresence) *
        Math.min(step, Math.abs(target - this.clinicalPresence));
    } else if (this.clinicalPresence !== target) {
      this.clinicalPresence = target;
    }

    const p = this.clinicalPresence;

    // Beat 2 and 3: the lounge dims ahead of the clinical room resolving, so
    // there is a moment of near-darkness between them rather than a cross-fade
    // that reads as a slideshow.
    this.lounge.setPresence(clamp(1 - p * 1.55));
    this.clinical?.setPresence(clamp((p - 0.34) / 0.66));

    const bg = this.lounge.background.clone().lerp(
      this.clinical?.background ?? this.lounge.background,
      clamp((p - 0.2) / 0.6),
    );
    this.stage.renderer.setClearColor(bg, 1);

    for (const beat of this.beatCallbacks) {
      const reached = target === 1 ? p >= beat.at : p <= beat.at;
      if (!beat.fired && reached) {
        beat.fired = true;
        beat.run();
      }
    }
  }

  // -------------------------------------------------------------------------
  // Analysis presentation
  // -------------------------------------------------------------------------

  /** Beat 6 — the scan-line sweep tracks the real pipeline, not a fixed timer. */
  setScanProgress(progress: number, stage: string): void {
    session.scanProgress = clamp(progress);
    session.scanStage = stage;
    this.holograms?.setScanProgress(clamp(progress));
    // The read is a beat of its own: hold on her while it happens.
    if (progress > 0 && progress < 1) {
      this.cine.request('reading', true);
      // She is reading it, so she is looking at it.
      this.lookAt('hologram');
    }
  }

  /**
   * When each lit region will land, in seconds from `presentAnalysis`.
   *
   * This is the *timed* reveal's schedule — the voice-off path, where the rig
   * walks its queue on a wall clock and the caller paces her text to match.
   * When her actual voice is driving, the interaction layer calls
   * `revealRegion` per clause instead and this schedule is only the watchdog
   * running behind it.
   */
  revealSchedule(count: number): number[] {
    return this.holograms?.revealSchedule(count) ?? [];
  }

  /**
   * The same schedule under the name the interaction layer chooses by: this
   * is the fallback, `revealRegion` is the voice-driven path.
   */
  revealScheduleFallback(count: number): number[] {
    return this.revealSchedule(count);
  }

  /**
   * Lights one named face region now — the voice-driven reveal.
   *
   * Called by the interaction layer as her narration reaches each region, so
   * the face lights on her words rather than on a timer. It advances the same
   * queue the timed reveal walks: everything up to and including the named
   * region lights (skipped entries are not left dark — the narration is the
   * authority on order), the tick sounds, and the rig's own timer is pushed
   * back so it becomes a watchdog that only resumes if the voice stalls.
   *
   * The rig keeps its reveal queue private and its file is owned elsewhere
   * this stage, so this reaches the queue structurally — the same pattern as
   * the avatar's optional `hitZone`. A first-class `revealRegion` on the rig
   * is preferred the moment one exists.
   */
  revealRegion(key: string): void {
    if (this.holograms) {
      const rig = this.holograms as unknown as {
        revealRegion?: (key: string) => void;
        reveal: {
          items: Array<{ region: string; tone: 'good' | 'bad' | 'neutral' }>;
          shown: number;
          timer: number;
          step: number;
        } | null;
        faceMesh: {
          highlightRegions(items: Array<{ region: string; tone: 'good' | 'bad' | 'neutral' }>): void;
        } | null;
      };
      if (rig.revealRegion) {
        rig.revealRegion(key);
      } else if (rig.reveal) {
        /*
         * The narration speaks in metric keys ('redness', 'hydration'); the
         * rig queues face regions ('cheekL', 'forehead') — it maps each
         * metric through METRIC_FACE_REGIONS when it builds the queue. The
         * same translation has to happen here or nothing ever matches and
         * the whole voice-driven path is a silent no-op, which is exactly
         * how it shipped the first time.
         */
        const wanted = new Set<string>([
          key,
          ...(METRIC_FACE_REGIONS[key as SkinMetricKey] ?? []),
        ]);
        const reveal = rig.reveal;
        let target = -1;
        for (let i = reveal.shown; i < reveal.items.length; i++) {
          if (wanted.has(reveal.items[i].region)) {
            target = i;
            break;
          }
        }
        // A key that is already lit, or not in this scan's queue, moves
        // nothing — the region she named is on screen either way.
        if (target >= 0) {
          reveal.shown = target + 1;
          rig.faceMesh?.highlightRegions(reveal.items.slice(0, reveal.shown));
          sound.tick(1 + reveal.shown * 0.05);
          if (reveal.shown >= reveal.items.length) rig.reveal = null;
          else reveal.timer = reveal.step;
        }
      }
    }

    // She points at what she is talking about — re-applying the gesture
    // restarts its impulse by design, which is exactly the re-point wanted
    // here. At most once per clause, so a dense sentence does not jab.
    const now = performance.now();
    if (now - this.lastRevealGesture >= 1100) {
      this.lastRevealGesture = now;
      this.avatar.applyDirective({ ...this.currentDirective, gesture: 'point_to_hologram' });
    }
  }

  /** Beat 7 — metrics resolve into orbit around her. */
  presentAnalysis(
    analysis: SkinAnalysis,
    previous: SkinAnalysis | null,
    sentiment?: ScanSentiment,
  ): void {
    session.scanResultVisible = true;
    this.holograms?.boot();
    // A successful scan is the only event that reveals personal face geometry.
    sound.lift(1.6);
    this.holograms?.present(analysis, previous);
    // The reading is done; now she is telling *you* about it.
    this.lookAt('viewer');
    // She turns to the numbers as they resolve, and the camera goes with her.
    this.cine.request('present', true);
    this.presentWithSentiment(sentiment);
  }

  /**
   * How she delivers a result. The presenting directive used to be one
   * hardcoded focused face for every scan, which meant the reading in her
   * voice and the reading on her face routinely disagreed. The caller passes
   * the same sentiment the spoken turn was built from; no sentiment is read
   * as steady, which is the honest default for a first scan.
   */
  private presentWithSentiment(sentiment: ScanSentiment | undefined): void {
    if (sentiment === 'improving') {
      // The FSM has no CLINICAL_ANALYSIS -> HAPPY edge: good news still has
      // to arrive as a result first. Step through ANALYSIS_COMPLETE so the
      // happy state lands instead of being blocked to a scanning posture.
      if (this.currentDirective.state === 'CLINICAL_ANALYSIS') {
        this.applyDirective({
          state: 'ANALYSIS_COMPLETE',
          expression: 'smile',
          gesture: 'none',
          intensity: 0.7,
        });
      }
      this.applyDirective({
        state: 'HAPPY',
        expression: 'smile',
        gesture: 'point_to_hologram',
        intensity: 0.7,
      });
    } else if (sentiment === 'declining') {
      this.applyDirective({
        state: 'CONCERNED',
        expression: 'concerned',
        gesture: 'point_to_hologram',
        intensity: 0.65,
      });
    } else {
      this.applyDirective({
        state: 'ANALYSIS_COMPLETE',
        expression: 'warm',
        gesture: 'point_to_hologram',
        intensity: 0.6,
      });
    }
  }

  /**
   * Shows a figure performing what was recommended.
   *
   * Separate call from `presentBody` on purpose — she says what she found
   * first, and the demonstration follows when she gets to what to do about it.
   */
  showDemo(clip: Parameters<NonNullable<typeof this.holograms>['showDemo']>[0]): void {
    void this.holograms?.showDemo(clip);
  }

  /** The demonstration matching the strongest body finding, if there is one. */
  demoForBody(metrics: Parameters<NonNullable<typeof this.holograms>['demoForBody']>[0]) {
    return this.holograms?.demoForBody(metrics) ?? null;
  }

  /** Puts a body reading on the holograms, the same way a skin one goes up. */
  presentBody(
    analysis: BodyAnalysis,
    previous: BodyAnalysis | null,
    sentiment?: ScanSentiment,
  ): void {
    session.scanResultVisible = true;
    this.holograms?.boot();
    this.holograms?.presentBody(analysis, previous);
    this.cine.request('present', true);
    this.presentWithSentiment(sentiment);
  }

  /**
   * The frame the scan was measured from, for the hologram to project.
   *
   * Deliberately separate from `presentAnalysis`: the capture exists in memory
   * on every scan while *storing* it is consent-gated, so the two arrive by
   * different routes and neither should wait on the other.
   */
  /** The 3D face from the scan, or nothing. The rig builds the hologram from it. */
  setFaceMesh(mesh: ScanMesh | null): void {
    this.holograms?.setFaceMesh(mesh);
  }

  setCapture(base64: string | null): void {
    void this.holograms?.setCapture(base64);
  }

  /** What the camera can currently see — the layout solver's only input. */
  private viewFrustum() {
    const shot = this.clinicalShot();
    return {
      fovDeg: shot.fov,
      aspect: this.stage.aspect,
      cameraY: shot.target.y,
      cameraZ: shot.position.z,
    };
  }

  resize(): void {
    this.stage.resize();
    if (this.presentation !== 'app') { this.composePresentation(); return; }
    // Order matters: the shot depends on the new aspect, and the layout depends
    // on the shot. Gated on the transition *target*, not just the mode: a
    // resize during the walk home used to re-aim the camera at the clinic and
    // send her back to her presenting mark.
    const inClinic = session.sceneMode !== 'lounge' && this.transitionTarget === 1;
    if (inClinic) this.stage.setShot(this.clinicalShot());
    this.holograms?.setLayout(this.viewFrustum());
    if (inClinic) this.adoptPresenterMark();
  }

  avatarStats() {
    return this.avatar.stats();
  }

  /** The homepage film owns first paint; the same 3D Ese then joins the intake and rooms. */
  setPresentation(mode: 'film' | 'intake' | 'app'): void {
    if (mode !== 'app' && this.presentation === 'app') this.exitClinical();
    this.presentation = mode;
    this.avatar.root.visible = mode !== 'film';
    if (mode === 'film') { this.stage.stop(); return; }
    this.composePresentation();
    this.stage.start();
  }

  private composePresentation(): void {
    if (this.presentation === 'intake') {
      const narrow = this.stage.aspect < 1.05;
      this.presenterTarget.set(narrow ? -.025 : -.48, narrow ? .91 : 0, 0);
      this.presenterYawTarget = narrow ? 0 : .09;
      this.blockingYaw = 0;
      this.avatar.root.scale.setScalar(narrow ? .6 : 1);
      this.stage.setShot({
        position: new THREE.Vector3(0, 1.42, narrow ? 2.7 : 2.25),
        target: new THREE.Vector3(0, narrow ? 1.2 : 1.4, 0),
        fov: narrow ? 44 : 41,
      }, .8);
    } else if (this.presentation === 'app') {
      this.avatar.root.scale.setScalar(1);
      if (session.sceneMode === 'lounge') {
        this.presenterTarget.set(0, 0, 0);
        this.presenterYawTarget = 0;
        this.stage.setShot(SHOT_CONVERSATION, .9);
      }
    }
  }

  clearScanPresentation(): void {
    session.scanResultVisible = false;
    this.holograms?.shutdown();
    this.holograms?.setFaceMesh(null);
  }

  retryCharacter(): void {
    if (!(this.avatar instanceof EseAvatar) || this.disposed) return;
    session.characterStatus = 'loading';
    void this.avatar.load().then(async () => {
      if (this.disposed) return;
      this.avatar.root.visible = true;
      await this.stage.renderer.compileAsync(this.stage.scene, this.stage.camera);
      if (!this.disposed) {
        this.avatar.root.visible = this.presentation !== 'film';
        session.characterStatus = 'ready';
      }
    }).catch(() => { if (!this.disposed) session.characterStatus = 'error'; });
  }

  canDragCharacter(ndcX: number, ndcY: number): boolean {
    if (this.presentation === 'film') return false;
    this.pokeRay.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.stage.camera);
    return this.avatar instanceof EseAvatar && this.avatar.hitZone(this.pokeRay) !== null;
  }

  moveCharacter(ndcX: number): void {
    if (this.presentation === 'film' || session.scanActive) return;
    const camera = this.stage.camera;
    const point = new THREE.Vector3(ndcX, 0, .5).unproject(camera);
    const direction = point.sub(camera.position).normalize();
    const distance = (this.avatar.root.position.z - camera.position.z) / (direction.z || -1);
    const worldX = camera.position.x + direction.x * distance;
    const halfWidth = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * Math.abs(camera.position.z) * camera.aspect;
    const limit = Math.max(.1, halfWidth - .38);
    this.presenterTarget.x = THREE.MathUtils.clamp(worldX, -limit, this.presentation === 'intake' && this.stage.aspect > 1.05 ? -.25 : limit);
    this.presenterYawTarget = THREE.MathUtils.clamp((worldX - this.avatar.root.position.x) * .4, -.15, .15);
  }

  dispose(): void {
    ++this.clinicalEntryEpoch;
    this.disposed = true;
    this.holograms?.dispose();
    this.clinical?.dispose();
    this.lounge.dispose();
    this.avatar.dispose();
    this.stage.dispose();
  }
}
