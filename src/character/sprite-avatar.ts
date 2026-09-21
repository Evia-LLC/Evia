/**
 * Elohim as painted 2D art, in the same 3D scene (ARCHITECTURE §12).
 *
 * The third implementation of `ElohimAvatar`, and the one that matches what the
 * app is actually trying to be. The rooms have been photographic plates since
 * the backdrop rewrite; she was the last real-time-rendered thing left in a
 * frame that is otherwise painted, and every compositing problem — matching key
 * light to a photograph, faking a contact shadow, grading the frame to unify
 * two media, dilating a hull to soften a silhouette — existed only to hide that
 * mismatch. Paint her in the same hand as the room and the mismatch is gone
 * rather than concealed.
 *
 * The camera made this cheap. Every shot in `cinematography.ts` sits within
 * 14cm of the centre line at eye height and varies only in distance, so nothing
 * ever orbits her; the third dimension was never being used for the character.
 *
 * She is built as layers rather than one image, because a single flat portrait
 * cannot look at you:
 *
 *   body    the base painting from the shoulders down
 *   head    the same painting's head, drawn over it so it can move on its own
 *   eyes    an expression patch, swapped per `Expression`
 *   mouth   one opaque viseme drawing, gated by audible speech
 *
 * Eyes and mouth are separate patches so expression and speech compose: four
 * expressions and seven mouths give twenty-eight faces from eleven paintings,
 * and the mouth keeps moving while the expression holds.
 */
import * as THREE from 'three';

import { CharacterStateMachine } from './state-machine.ts';
import { EXPRESSION_POSES, PAINTED_PRESENCE } from './expressions.ts';
import { Spring, damp } from '@/lib/math.ts';
import type { AvatarContext, ElohimAvatar, Outfit } from './types.ts';
import type { CharacterDirective, CharacterState, Expression, Gesture, Viseme } from '@shared/types.ts';

interface Placed {
  box: [number, number, number, number];
  file: string;
}

interface Manifest {
  frame: [number, number];
  head: Placed;
  regions: Record<'mouth' | 'eyes', [number, number, number, number]> & {
    /** The blink patch is cut tighter than the expressions: eyes only, no brows. */
    eyesClosed?: [number, number, number, number];
  };
  mouths: Record<string, string>;
  eyes: Record<string, string>;
  /**
   * outfit -> pose -> body painting.
   *
   * There is exactly one head, one set of mouths and one set of expressions
   * however many outfits exist, because clothes do not change a face. Every
   * body was registered onto the same base by its eye landmarks when it was
   * baked, so the head lands identically in all of them and the patches keep
   * working across an outfit change as well as a gesture.
   */
  outfits: Record<string, Record<string, Placed>>;
}

/**
 * How much *real body*, in metres, the painting spans from its top edge to its
 * bottom edge — crown to hips, since that is where it is cropped.
 *
 * Not the height she should appear on screen. The plates and the hologram
 * layout are solved against a figure standing at the origin at human scale, and
 * the camera never gets further than about a metre from her, so the sprite has
 * to be sized as a *body* and then framed by the same camera that framed the
 * rigged model. Sizing it to fill the frame instead put her 164% of frame
 * height and shouldered the room out of shot.
 *
 * Crown ~1.77m, hips ~1.00m on a figure of her build.
 */
const FIGURE_HEIGHT = 0.77;
/** Eye line of a standing adult — what every camera shot targets. */
const EYE_HEIGHT = 1.6;

/**
 * Which painted mouth serves each viseme.
 *
 * `visemes.ts` models a mouth as three continuous channels — jaw, wide, round —
 * because blending channels gives a real intermediate shape where cross-fading
 * two unrelated poses gives a ghost. That is right for morph targets and simply
 * unavailable in paint: there is no continuum between two drawings.
 *
 * So this does what hand-drawn animation has always done and resolves to a
 * mouth chart. The timing code upstream is untouched — it still runs on the
 * continuous model, and only the last step quantises.
 */
const VISEME_MOUTH: Record<Viseme, string | null> = {
  sil: null, // the base painting's own closed mouth
  AA: 'AA',
  EE: 'EE',
  // Five drawings, not seven: the near-neighbours (IH beside EE, OU beside
  // OH) swapped against each other every few frames read as trembling,
  // and a face that is speaking needs fewer, clearer shapes held longer.
  IH: 'EE',
  OH: 'OH',
  OU: 'OH',
  MBP: 'MBP',
  FV: 'FV',
  L: 'EE',
  S: 'EE',
};

/**
 * Which painted body each gesture uses.
 *
 * A flat portrait cannot raise its own arm, so gesturing means swapping the
 * body for one painted mid-gesture. Every pose was registered onto the resting
 * one by its eye landmarks when it was baked, so her head lands in exactly the
 * same place in all three and the mouth and eye patches keep working across a
 * swap — only the arms differ, which is the whole reason they exist.
 *
 * The small head-and-shoulders gestures (nods, tilts, leans) are not here on
 * purpose: those are motion, not pose, and the head layer already does them.
 */
/**
 * How fast one body painting replaces another.
 *
 * Fast enough to read as a cut. Two paintings of a person in different poses
 * cannot tween into each other — while both are up you are looking at two
 * people — so the only kind honest overlap is a short one.
 */
const BODY_FADE_RATE = 14;

/*
 * How the head is allowed to move.
 *
 * The head layer sits over a body painting that has its own head underneath.
 * Every millimetre the layer moves exposes a sliver of that painted head at
 * the trailing edge - and at the old limits (35mm of travel, 14mm saccades) the
 * sliver was a second hairline, a second cheek, a second ear. "Two heads."
 *
 * So the head no longer *travels* to look at you; it *turns*, a degree or two
 * about the neck, and drifts by a few millimetres at most. What sells a look is
 * the tilt and the timing, not the distance. The layer is also drawn a touch
 * larger than the painted head it covers, so the little it does move never
 * uncovers anything.
 */
const HEAD_COVER = 1.035;
/** Metres of travel, at most, in either axis. */
const HEAD_TRAVEL_X = 0.006;
const HEAD_TRAVEL_Y = 0.004;
/** Radians of tilt, at most. About 1.7 degrees. */
const HEAD_TILT = 0.03;

const GESTURE_POSE: Record<Gesture, string> = {
  none: 'rest',
  nod: 'rest',
  slow_nod: 'rest',
  head_tilt: 'rest',
  lean_in: 'rest',
  hand_to_chin: 'rest',
  small_wave: 'present',
  point_to_hologram: 'present',
  open_palms: 'explain',
};

/**
 * Which eye paintings each expression would like, in order of preference.
 *
 * Resolved against the manifest once, at load, into `expressionEyes`: art
 * that has not shipped yet (smile, grin, surprised) or is mid-repaint
 * (focused) falls back to its nearest painted sibling, or to no patch at
 * all, rather than to a missing texture at runtime. The manifest is the
 * only authority on what exists; this table only says what to want.
 *
 * The history that shapes how these are shown: an earlier rig blended the
 * warm patch over the base portrait at partial opacity, scaled by
 * intensity - so her eyes were never one drawing, they were two, and the
 * blend changed every time the intensity did. That constant slight doubling
 * is what read as her face contorting. Every patch is therefore a
 * full-opacity cut, hidden under a blink, and intensity never touches
 * opacity. `showEyes` enforces the full-opacity half; the blink queue in
 * `requestEyes` hides the cut.
 */
const EXPRESSION_EYE_CHOICES: Record<Expression, readonly string[]> = {
  neutral: [],
  warm: ['warm'],
  smile: ['smile', 'warm'],
  grin: ['grin', 'smile', 'warm'],
  reassuring: ['reassuring', 'warm'],
  concerned: ['concerned'],
  curious: ['curious'],
  surprised: ['surprised', 'curious'],
  focused: ['focused'],
};

/** The smile-adjacent expressions, for the resting mouth and the mood bias. */
const WARM_FAMILY: readonly Expression[] = ['warm', 'smile', 'grin', 'reassuring'];

/** What the face falls back to before the manifest has resolved anything. */
const NO_EYES: Record<Expression, string | null> = {
  neutral: null,
  warm: null,
  smile: null,
  grin: null,
  reassuring: null,
  concerned: null,
  curious: null,
  surprised: null,
  focused: null,
};

/**
 * The overall temperature of her direction, derived per directive.
 *
 * Coarser than `Expression` on purpose: the idle machinery should not care
 * whether she was told "smile" or "reassuring", only whether the moment is
 * warm, worried or neither, because that is what decides where an idle
 * glance may wander and how long it may stay.
 */
type Mood = 'concerned' | 'warm' | 'neutral';

/** How quiet a syllable has to be before the mouth simply closes. */
const MOUTH_SILENT_BELOW = 0.18;

/**
 * How long a mouth drawing stays on the face before another may replace it.
 *
 * Real word timing arrives with a shape every fifty milliseconds or so, and
 * cutting between seven drawings at that rate is not speech, it is a
 * flicker - on a phone it read as her whole face shaking. Hand-drawn mouths
 * are held for two or three frames at a dozen a second; this is that. A
 * shape that would have shown for less than this is simply skipped, which
 * loses the short consonants and keeps the vowels, and that is what an eye
 * sees in a talking face anyway.
 */
const MOUTH_HOLD_SECONDS = 0.13;

function quad(width: number, height: number, texture: THREE.Texture | null, order: number): THREE.Mesh {
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    // Unlit on purpose. The painting already carries its own key, rim and
    // bounce; lighting it again would be lighting it twice.
    toneMapped: false,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), material);
  mesh.renderOrder = order;
  mesh.frustumCulled = false;
  return mesh;
}

export class SpriteAvatar implements ElohimAvatar {
  readonly root = new THREE.Group();

  private readonly fsm = new CharacterStateMachine();
  private manifest: Manifest | null = null;
  private loader = new THREE.TextureLoader();
  private textures = new Map<string, THREE.Texture>();
  private disposables: Array<THREE.BufferGeometry | THREE.Material | THREE.Texture> = [];

  /**
   * The painting, lifted to standing height inside `root`.
   *
   * `root.position` is the contract for *where she stands* — the director
   * anchors the hologram rig, her gaze origin and the contact shadow to it, so
   * it has to stay on the floor at the origin. Raising `root` itself to put her
   * eye line at 1.6m took the entire hologram rig up with it and parked the
   * readouts at y=3, a metre and a half above the top of frame.
   */
  private figure = new THREE.Group();
  /**
   * Everything that moves with the head: the head painting and both patches.
   *
   * Its origin is the base of her neck, not the centre of the frame. A tilt
   * about the frame's centre - half a metre below the head - does not tilt the
   * head, it slides it sideways like a drawer, which is what the old motion
   * looked like. About the neck, the same few degrees read as a person.
   */
  private headGroup = new THREE.Group();
  private neck = new THREE.Vector3();
  /**
   * A body painting waiting to replace the current one.
   *
   * Two paintings of a person in different poses cannot tween: while both are
   * up you are looking at two people. So the swap is not faded at all any more
   * - it is *cut*, and the cut is hidden under a blink, the way an animator
   * hides one. The wanted body is parked here until the lids are shut.
   */
  private pendingBody: string | null = null;
  /** One quad per `outfit/pose`, cross-faded between. */
  private bodies = new Map<string, THREE.Mesh>();
  /*
   * Casual by default, because the app opens in the lounge.
   *
   * `setOutfit` is only called on a scene transition, so whatever this starts
   * as is what she wears until the first one — and starting in a lab coat in
   * her own living room was exactly the wrong way round.
   */
  private outfit = 'casual';
  private pose = 'rest';
  /** The body currently showing, and the one it is replacing. Nothing else. */
  private showing: string | null = null;
  private outgoing: string | null = null;
  private head: THREE.Mesh | null = null;
  /** Sweeps down over the eyes to blink. Built at load from her own brow. */
  private lid: THREE.Mesh | null = null;
  /** Seconds until the next blink, and how far through one we are. */
  private blinkIn = 1.2 + Math.random() * 2.4;
  private blinkPhase = -1;
  /** Set when a blink should be followed immediately by a second one. */
  private blinkAgain = false;
  /**
   * Where she is looking within whatever she is looking at.
   *
   * Eyes do not rest. Even fixed on one thing they jump every second or so —
   * brow, mouth, back to the eyes — and a gaze that holds perfectly still is
   * the single clearest tell that a face is a picture. These are small offsets
   * added on top of the real target, retargeted on their own clock.
   */
  private saccadeX = 0;
  private saccadeY = 0;
  private saccadeIn = 0.8;
  private eyes: THREE.Mesh | null = null;
  /** Which eye patch is on the face right now; null is the painting's own. */
  private shownEyes: string | null = null;
  /** An eye patch waiting for the lids to close. `undefined` = nothing waiting. */
  private pendingEyes: string | null | undefined = undefined;
  /** Reduced-motion factor as of the last frame, for decisions made off-frame. */
  private calmNow = 1;
  /**
   * Idle life for the face.
   *
   * A person listening does not hold one expression for a minute. Every so
   * often she takes on a brief curious or focused look and returns - each
   * change a cut under a blink, so nothing ever blends.
   */
  private idleLookIn = 6 + Math.random() * 6;
  private idleLookLeft = 0;
  /**
   * Eye darts.
   *
   * The head moves a few millimetres to look; the *eyes* did not move at all,
   * and eyes that never move are the tell. When the manifest carries painted
   * gaze frames - irises left, right, up, down - a saccade becomes a cut to
   * one of them for a third of a second and a cut back. No blink needed: an
   * eye dart is itself faster than the eye can inspect.
   */
  private dartIn = 2.6 + Math.random() * 3.4;
  private dartLeft = 0;
  private dartKey: string | null = null;
  /** Two quads so a viseme change cross-fades rather than pops. */
  private mouthA: THREE.Mesh | null = null;
  private mouthB: THREE.Mesh | null = null;
  private currentMouth: string | null = null;
  /** When the drawing now on the face went up, in seconds; see MOUTH_HOLD_SECONDS. */
  private mouthShownAt = -1;

  private loaded = false;
  private baseScale = 1;
  private breathPivotY = 0;
  private breathPhase = 0;
  private breathRate = PAINTED_PRESENCE.IDLE.breathRate;
  private breathDepth = 1;
  private idleScale = 1;
  private motionScale = 1;

  // The same springs the other rigs damp, so the motion reads the same.
  // Softer than the rigged model's springs: a head that snaps to a new target
  // in a tenth of a second is a camera pan, not a look.
  private readonly gazeX = new Spring(0, 22);
  private readonly gazeY = new Spring(0, 22);
  private readonly tilt = new Spring(0, 18);

  private gazeTarget: THREE.Vector3 | null = null;
  private readonly localGaze = new THREE.Vector3();
  private eyeLocalY = 0;
  private expression: Expression = 'warm';
  private intensity = 0.7;
  private intensityTarget = 0.7;
  private visemeWeight = 0;
  private requestedViseme: Viseme = 'sil';
  private visemeUpdatedAt = -Infinity;
  private lastAudibleAt = -Infinity;
  /** The directive's state, kept because THINKING renders differently. */
  private state: CharacterState = 'IDLE';
  /** See `Mood`. Derived in `applyDirective`, read by every idle system. */
  private mood: Mood = 'warm';
  /** `EXPRESSION_EYE_CHOICES` resolved against the manifest, at load. */
  private expressionEyes: Record<Expression, string | null> = { ...NO_EYES };
  /**
   * The gesture impulse in flight, if any.
   *
   * Gestures on this rig are not poses (those are body cuts) but short,
   * one-shot rides on the springs the head already runs on: a target offset
   * with an envelope, started by a directive and forgotten when it ends.
   */
  private gestureKind: Gesture | null = null;
  private gestureT = 0;
  private gestureLen = 0;
  private gestureSign = 1;
  private gestureStartedAt = -Infinity;
  /** Damped 0..1 envelope for the lean, so an interrupted lean settles back. */
  private leanEnv = 0;
  /**
   * A deliberate gaze-frame request for the dart machinery: thought glances
   * and hand-to-chin ask for a specific direction with a longer dwell,
   * instead of the random schedule. Honoured as soon as nothing else owns
   * the eyes; replaced, not queued, by the next directive.
   */
  private dartAsk: { key: string; dwell: number } | null = null;
  /** Seconds until a THINKING beat re-glances, so a long think stays alive. */
  private thinkIn = 0;
  /** Whether the resting smile mouth is up; see `updateRestingMouth`. */
  private restingMouthUp = false;
  /** Stretch on the shut/open phases of the current blink; concern lingers. */
  private blinkStretch = 1;
  /**
   * Rolling mean of the real speech envelope, and the emphasis dip it can
   * trigger. A syllable well above her own recent loudness gets a couple of
   * millimetres of head nod - emphasis, not bobbing, so it is rate-limited.
   */
  private levelMean = 0;
  private emphasisLeft = 0;
  private emphasisCooldown = 0;

  onDirectiveRejected: ((info: { reason: string; detail: string }) => void) | null = null;

  constructor() {
    this.figure.name = 'elohim-figure';
    this.headGroup.name = 'elohim-head-motion';
    this.fsm.onRejected = (info) => this.onDirectiveRejected?.(info);
    this.figure.add(this.headGroup);
    this.root.add(this.figure);
  }

  async load(manifestUrl: string): Promise<void> {
    const base = manifestUrl.replace(/[^/]+$/, '');
    const manifest = (await (await fetch(manifestUrl)).json()) as Manifest;
    this.manifest = manifest;

    // Resolve what each expression wants against what actually shipped. Done
    // here, once, so nothing at frame rate ever reaches for a missing key.
    for (const expression of Object.keys(EXPRESSION_EYE_CHOICES) as Expression[]) {
      this.expressionEyes[expression] =
        EXPRESSION_EYE_CHOICES[expression].find((key) => manifest.eyes[key]) ?? null;
    }

    const [frameW, frameH] = manifest.frame;

    /*
     * Metres of world space per source pixel.
     *
     * Taken from any one body: every pose in every outfit was registered onto
     * the same base when it was baked, so they all share a scale. Everything
     * below is laid out in source pixels and multiplied by this, which keeps
     * the manifest the single source of truth for where any piece sits.
     */
    const reference = Object.values(Object.values(manifest.outfits)[0] ?? {})[0];
    if (!reference) throw new Error('The character manifest contains no bodies.');
    this.baseScale = FIGURE_HEIGHT / (reference.box[3] - reference.box[1]);

    const px = (v: number) => v * this.baseScale;
    // All cropped poses breathe around the same source-frame hip line.
    this.breathPivotY = px(-frameH / 2);
    this.eyeLocalY = px(frameH / 2 - (manifest.regions.eyes[1] + manifest.regions.eyes[3]) / 2);
    /** Source-pixel box -> a quad placed in the figure's local space. */
    const place = (mesh: THREE.Mesh, box: [number, number, number, number]) => {
      const w = box[2] - box[0];
      const h = box[3] - box[1];
      mesh.scale.set(px(w), px(h), 1);
      mesh.position.set(
        px(box[0] + w / 2 - frameW / 2),
        // Source pixels run down the image; world Y runs up it.
        px(frameH / 2 - (box[1] + h / 2)),
        0,
      );
    };

    const texture = async (file: string) => {
      const cached = this.textures.get(file);
      if (cached) return cached;
      const loaded = await this.loader.loadAsync(base + file);
      loaded.colorSpace = THREE.SRGBColorSpace;
      // Painted art with no mip chain shimmers when the camera dollies; these
      // are small enough that mips cost almost nothing.
      loaded.generateMipmaps = true;
      loaded.minFilter = THREE.LinearMipmapLinearFilter;
      loaded.anisotropy = 4;
      this.textures.set(file, loaded);
      this.disposables.push(loaded);
      return loaded;
    };

    /*
     * Every body quad exists at once; only the one she is standing in is
     * waited for. Loading all six paintings serially before she could appear
     * was most of the ten seconds the first frame used to take - five of the
     * six are other poses and the other outfit, none of which the first
     * second of the app can show. Each mesh is painted when its file lands
     * and marked ready; a cut to an unpainted body simply waits.
     */
    const paint = (mesh: THREE.Mesh, file: string) =>
      texture(file).then((loaded) => {
        const material = mesh.material as THREE.MeshBasicMaterial;
        material.map = loaded;
        material.needsUpdate = true;
        mesh.userData.ready = true;
      });
    const background: Array<Promise<unknown>> = [];

    for (const [outfit, poses] of Object.entries(manifest.outfits)) {
      for (const [pose, painted] of Object.entries(poses)) {
        const mesh = quad(1, 1, null, 1);
        mesh.name = `elohim-body-${outfit}-${pose}`;
        place(mesh, painted.box);
        // Remember where `place` put it. Breath is applied as an offset from
        // this every frame; read back off `position.y` and it compounds.
        mesh.userData.restY = mesh.position.y;
        mesh.userData.file = painted.file;
        (mesh.material as THREE.Material).opacity = 0;
        mesh.visible = false;
        this.figure.add(mesh);
        this.bodies.set(`${outfit}/${pose}`, mesh);
      }
    }
    if (!this.bodies.has(this.key())) {
      // Whatever the manifest actually shipped, rather than an empty figure.
      const first = [...this.bodies.keys()][0];
      if (first) [this.outfit, this.pose] = first.split('/');
    }
    for (const [key, mesh] of this.bodies) {
      const file = mesh.userData.file as string;
      if (key === this.key()) await paint(mesh, file);
      else background.push(paint(mesh, file));
    }

    /*
     * The neck: the bottom centre of the head box, in the figure's space. The
     * head group sits there, and every part of the head is placed relative to
     * it, so a rotation of the group is a rotation about the neck.
     */
    const hb = manifest.head.box;
    this.neck.set(px((hb[0] + hb[2]) / 2 - frameW / 2), px(frameH / 2 - hb[3]), 0.001);
    this.headGroup.position.copy(this.neck);
    const placeOnNeck = (mesh: THREE.Mesh, box: [number, number, number, number]) => {
      place(mesh, box);
      mesh.position.sub(this.neck);
      mesh.position.z = 0;
    };

    this.head = quad(1, 1, await texture(manifest.head.file), 2);
    this.head.name = 'elohim-head';
    placeOnNeck(this.head, manifest.head.box);
    this.headGroup.add(this.head);
    /*
     * The whole head — painting, eyes, lids, mouths — is drawn a little larger
     * than the painted head beneath it, so the small amount it moves never
     * uncovers a second hairline. Scaled as one group about the neck: scaling
     * only the painting put its eyes 13px above the eye patch, and every blink
     * flashed a misregistered lid across her face for four frames.
     */
    this.headGroup.scale.setScalar(HEAD_COVER);

    // Patches start empty; `setExpression` and `setViseme` fill them.
    const eyesBox = manifest.regions.eyes;
    this.eyes = quad(1, 1, await texture(manifest.eyes.warm), 3);
    this.eyes.name = 'elohim-eyes';
    placeOnNeck(this.eyes, eyesBox);
    (this.eyes.material as THREE.Material).opacity = 0;
    this.headGroup.add(this.eyes);

    /*
     * The lid, built from her own brow.
     *
     * There is no closed-eye painting in the set, and blinking was the one
     * thing on the list that genuinely was not implemented — the blink code in
     * this project lives in `procedural-avatar.ts`, which is the fallback rig
     * nobody sees. Rather than spend generation credits on eleven more
     * paintings, the lid is a strip of skin lifted from just above the eye box
     * and swept down over it.
     *
     * That works because a blink is 100ms. The eye has no time to inspect the
     * shape; what it registers is that the eyes were interrupted. It is the
     * oldest trick in cel animation and it is free.
     */
    /*
     * A painted closed eye, not a lid faked from her own skin.
     *
     * The first attempt built a strip out of the brow and swept it down. That
     * works in cel art and does not work here: on a photoreal painting it read
     * as a censor bar, and after sampling from the cheek and blurring the
     * features out of it, it was a soft smudge rather than an eyelid. Four
     * versions in, that was the ceiling of the trick.
     *
     * So the eye is painted, registered onto the base by its brow line, and cut
     * with the same feathered mask as the four expression patches. It costs one
     * 20KB file and behaves like everything else in the rig.
     */
    if (manifest.eyes.closed) {
      this.lid = quad(1, 1, await texture(manifest.eyes.closed), 4);
      this.lid.name = 'elohim-blink';
      placeOnNeck(this.lid, manifest.regions.eyesClosed ?? eyesBox);
      (this.lid.material as THREE.Material).opacity = 0;
      this.lid.visible = false;
      this.headGroup.add(this.lid);
    }

    const mouthBox = manifest.regions.mouth;
    for (const key of ['mouthA', 'mouthB'] as const) {
      const mesh = quad(1, 1, await texture(manifest.mouths.AA), 4);
      mesh.name = `elohim-${key}`;
      placeOnNeck(mesh, mouthBox);
      (mesh.material as THREE.Material).opacity = 0;
      this.headGroup.add(mesh);
      this[key] = mesh;
    }

    // The rest arrives behind her: other bodies, mouths, expressions. Cuts
    // to anything not yet here are skipped and retried, so nothing pops in.
    void Promise.all([
      ...background,
      ...Object.values(manifest.mouths).map(texture),
      ...Object.values(manifest.eyes).map(texture),
    ]).catch(() => {});

    // Lift the painting — not the root — so her eye line lands where every
    // camera shot targets it.
    this.figure.position.y = EYE_HEIGHT - px(frameH / 2 - (eyesBox[1] + eyesBox[3]) / 2);
    this.loaded = true;
    this.requestExpression(this.expression);
  }

  mount(parent: THREE.Object3D): void {
    parent.add(this.root);
  }

  applyDirective(directive: CharacterDirective): void {
    const previous = this.fsm.directive;
    this.fsm.apply(directive);
    const resolved = this.fsm.directive;
    const wasThinking = this.state === 'THINKING';
    const newBeat = resolved.state !== this.state || resolved.expression !== this.expression;
    this.state = resolved.state;
    this.expression = resolved.expression;
    this.intensityTarget = resolved.intensity;
    /*
     * The mood: which family the directive lands in, not which member.
     * CONCERNED as a *state* counts even when the expression does not say so,
     * because the director sometimes pairs a concerned beat with a softened
     * face and the idle machinery should still move carefully through it.
     */
    this.mood =
      resolved.expression === 'concerned' || resolved.state === 'CONCERNED'
        ? 'concerned'
        : WARM_FAMILY.includes(resolved.expression)
          ? 'warm'
          : 'neutral';
    // A directive ends any idle look; the turn's expression is the face now.
    if (newBeat) this.idleLookLeft = 0;
    // And any queued glance direction: the new beat owns the eyes.
    if (newBeat) this.dartAsk = null;
    // A think that has just begun glances away almost immediately - looking
    // up to consider is the entrance of the state, not a lull inside it.
    if (this.state === 'THINKING' && !wasThinking) this.thinkIn = 0.2 + Math.random() * 0.4;
    if (newBeat) this.requestExpression(resolved.expression);
    this.pose = GESTURE_POSE[resolved.gesture] ?? 'rest';
    // Repeated delivery must not rewind an in-flight nod. A later phrase may
    // repeat it once the previous gesture has settled.
    if (newBeat || resolved.gesture !== previous.gesture ||
        (!this.gestureKind && this.clockS - this.gestureStartedAt > this.gestureLen + 0.4)) {
      this.startGesture(resolved.gesture);
    }
  }

  /**
   * Starts a head-and-shoulders gesture as an impulse on the springs.
   *
   * Only the motion gestures come through here; the body-cut gestures
   * (open_palms, small_wave, point_to_hologram) are poses and already ran
   * through `GESTURE_POSE` above. An in-flight gesture finishes its arc.
   */
  private startGesture(gesture: Gesture): void {
    if (gesture === this.gestureKind) return;
    switch (gesture) {
      case 'nod':
        this.gestureLen = 0.65;
        break;
      case 'slow_nod':
        this.gestureLen = 1.4;
        break;
      case 'head_tilt':
        this.gestureLen = 1.5;
        break;
      case 'lean_in':
        this.gestureLen = 1.6;
        break;
      case 'hand_to_chin':
        // The tilt of head_tilt plus a deliberate glance down, as if at a
        // hand that the painting does not actually raise. The dart machinery
        // takes the glance as soon as nothing else owns the eyes.
        this.gestureLen = 1.5;
        this.dartAsk = { key: 'look-down', dwell: 0.5 + Math.random() * 0.25 };
        break;
      default:
        this.gestureKind = null;
        return;
    }
    this.gestureKind = gesture;
    this.gestureT = 0;
    this.gestureStartedAt = this.clockS;
    // Tilt toward the side she is already turned to; a coin toss when square.
    this.gestureSign =
      this.gazeX.value > 0.0015 ? 1 : this.gazeX.value < -0.0015 ? -1 : Math.random() < 0.5 ? -1 : 1;
  }

  /**
   * Asks for an expression. It arrives on the next blink.
   *
   * Two eye drawings must never be on screen together, so a change is a cut,
   * and a cut is hidden where an animator hides one: while the lids are shut.
   * With no lid to hide under - before the paintings have loaded, or under
   * reduced motion - it simply cuts.
   */
  private requestExpression(expression: Expression): void {
    const key = expression === this.expression ? this.baseEyeKey() : this.expressionEyes[expression];
    if (expression === 'surprised' && this.eyeReady(key)) {
      // A startle never waits for a blink. This is the calm-below-0.5 direct
      // cut, taken on purpose: surprise that arrives politely is not surprise.
      if (this.dartKey) {
        this.dartKey = null;
        this.dartLeft = 0;
      }
      this.pendingEyes = undefined;
      this.pendingPriority = false;
      this.showEyes(key, true);
      return;
    }
    this.requestEyes(key, true);
  }

  /**
   * The eye patch her face rests on right now, before any glance or dart.
   *
   * Usually the active expression's resolved patch. THINKING borrows the
   * focused eyes when the manifest has them, whatever the expression says -
   * thought is in the eyes or it is nowhere.
   */
  private baseEyeKey(): string | null {
    if (this.state === 'THINKING' && this.manifest?.eyes.focused) return 'focused';
    return this.expressionEyes[this.expression];
  }

  /**
   * The blink-hidden cut behind every eye change; see `requestExpression`.
   *
   * `priority` marks a request that carries the turn's meaning - the
   * expression itself - as opposed to a glance or a dart. The pending slot
   * holds one key, and a cosmetic look must never evict a waiting emotion:
   * that is how a worried reply once played with her face never turning
   * concerned, because an idle glance had overwritten it in the queue.
   */
  private requestEyes(key: string | null, priority = false): boolean {
    if (!priority && this.pendingPriority && this.pendingEyes !== undefined) return false;
    if (!priority && !this.dartKey && key !== this.shownEyes &&
        this.clockS - this.eyesShownAt < SpriteAvatar.EYES_HOLD_SECONDS) return false;
    // A dart in progress yields to a real eye change.
    if (this.dartKey) {
      this.dartKey = null;
      this.dartLeft = 0;
    }
    if (key === this.shownEyes) {
      this.pendingEyes = undefined;
      this.pendingPriority = false;
      return true;
    }
    if ((!this.loaded || !this.lid || this.calmNow < 0.5) && this.showEyes(key, true)) {
      this.pendingEyes = undefined;
      this.pendingPriority = false;
      return true;
    }
    this.pendingEyes = key;
    this.pendingPriority = priority;
    if (this.eyeReady(key) && this.blinkPhase < 0) this.blinkIn = Math.min(this.blinkIn, 0.08);
    return true;
  }

  private eyeReady(key: string | null): boolean {
    return key === null || !!(this.manifest?.eyes[key] && this.textures.has(this.manifest.eyes[key]));
  }

  /**
   * When the drawing now on her eyes went up, in seconds. Several systems are
   * allowed to ask for her eyes - the turn's expression, the mood-biased
   * idle look, the thinking glances, the darts, the phrase-close smile - and
   * each is reasonable alone. Together, unthrottled, they changed her face
   * five times in six seconds, which read as every expression at once. This
   * is the one gate they all pass through.
   */
  private eyesShownAt = -1;
  private static readonly EYES_HOLD_SECONDS = 1.1;
  /** Whether the queued pending patch carries the turn's expression. */
  private pendingPriority = false;
  /** The avatar's own clock, accumulated from update(dt) - never wall time,
   * so the hold behaves identically live and under headless stepping. */
  private clockS = 0;

  /**
   * Puts an eye patch on, fully, or takes it off. Never in between.
   *
   * `sanctioned` marks the moments a change is allowed through regardless of
   * the hold: the shut frame of a blink (the cut is invisible), a startle,
   * and the agitated direct-cut path. Everything else - darts, glances -
   * respects the hold, which is what keeps five well-meaning systems from
   * flicking her face like a slideshow.
   */
  private showEyes(key: string | null, sanctioned = false): boolean {
    if (!this.manifest || !this.eyes || !this.eyeReady(key)) return false;
    if (key === this.shownEyes) return true;
    if (key !== this.shownEyes) {
      if (!sanctioned && key !== null && this.eyesShownAt >= 0 &&
          this.clockS - this.eyesShownAt < SpriteAvatar.EYES_HOLD_SECONDS) {
        // A dart retries later; it must not start a dwell for a frame that
        // never appeared, nor evict a queued emotional cue.
        return false;
      }
      this.eyesShownAt = this.clockS;
    }
    const material = this.eyes.material as THREE.MeshBasicMaterial;
    const file = key ? this.manifest.eyes[key] : undefined;
    const texture = file ? this.textures.get(file) : null;
    if (!key || !texture) {
      material.opacity = 0;
      this.eyes.visible = false;
      this.shownEyes = null;
      return true;
    }
    material.map = texture;
    material.needsUpdate = true;
    material.opacity = 1;
    this.eyes.visible = true;
    this.shownEyes = key;
    return true;
  }

  setOutfit(outfit: Outfit): void {
    // Preloaded art switches on the next blink; a slow load keeps the old outfit.
    if (this.bodies.has(`${outfit}/${this.pose}`)) this.outfit = outfit;
  }

  /** The body currently wanted: this outfit, this gesture. */
  private key(): string {
    return `${this.outfit}/${this.pose}`;
  }

  /**
   * The mouth is cut, never faded.
   *
   * It used to cross-fade between shapes over a few frames, on the theory
   * that a fade was gentler than a jump. Between two *drawings* it is not: for
   * those frames both mouths are on screen at half strength, and a mouth with
   * two sets of lips and a see-through chin is the single thing that most
   * made her face look wrong while she spoke. Every hand-drawn mouth ever
   * animated has been a cut between shapes at a dozen frames a second, and
   * that is what this is now. A shape is on the face fully or not at all;
   * the loudness of a syllable decides which shape, not how transparent.
   */
  setViseme(viseme: Viseme, weight: number): void {
    this.visemeWeight = Number.isFinite(weight) ? THREE.MathUtils.clamp(weight, 0, 1) : 0;
    this.requestedViseme = viseme;
    this.visemeUpdatedAt = this.clockS;
    // Cancellation and explicit silence close immediately, even mid-hold.
    // Opening waits for the frame's audio level so a text-only track cannot mime.
    if (viseme === 'sil' || this.visemeWeight === 0) this.showMouth(null);
  }

  private showMouth(key: string | null): void {
    if (!this.loaded || !this.manifest || !this.mouthA) return;
    if (key === this.currentMouth) return;
    if (key && this.currentMouth && this.clockS - this.mouthShownAt < MOUTH_HOLD_SECONDS) return;

    const material = this.mouthA.material as THREE.MeshBasicMaterial;
    const file = key ? this.manifest.mouths[key] : null;
    const texture = file ? this.textures.get(file) : null;
    if (key && !texture) return;
    this.mouthShownAt = this.clockS;
    this.restingMouthUp = false;
    if (key && texture) {
      material.map = texture;
      material.needsUpdate = true;
      material.opacity = 1;
      this.mouthA.visible = true;
    } else {
      material.opacity = 0;
      this.mouthA.visible = false;
    }
    this.currentMouth = key && texture ? key : null;
  }

  private updateSpeech(level: number): void {
    if (level <= 0 || this.clockS - this.visemeUpdatedAt > 0.25) {
      this.showMouth(null);
      return;
    }
    this.lastAudibleAt = this.clockS;
    const key = this.visemeWeight < MOUTH_SILENT_BELOW ? null : VISEME_MOUTH[this.requestedViseme];
    this.showMouth(key);
  }

  /**
   * The resting smile, between and after words.
   *
   * When nothing is being said and the moment is warm, "no mouth" is the
   * wrong mouth: the base painting's neutral lips under smiling eyes read as
   * polite distance. If the manifest ships a smile mouth it goes on instead
   * of nothing - a full cut like every other mouth, on the same quad speech
   * uses, and speech takes the quad back the instant it has a shape to show.
   * With no smile painting in the manifest this does nothing at all.
   */
  private updateRestingMouth(): void {
    if (!this.manifest || !this.mouthA) return;
    if (this.currentMouth !== null) {
      // Speech owns the quad. Remember only that we are not showing.
      this.restingMouthUp = false;
      return;
    }
    const file = this.manifest.mouths.smile;
    const texture = file ? this.textures.get(file) : undefined;
    const wanted = !!texture && WARM_FAMILY.includes(this.expression);
    if (wanted === this.restingMouthUp) return;

    const material = this.mouthA.material as THREE.MeshBasicMaterial;
    if (wanted && texture) {
      // Respect the mouth hold, so a syllable's close is seen as a close
      // before the smile settles in rather than cutting straight through it.
      if (this.clockS - Math.max(this.mouthShownAt, this.lastAudibleAt) < 0.22) return;
      material.map = texture;
      material.needsUpdate = true;
      material.opacity = 1;
      this.mouthA.visible = true;
    } else {
      material.opacity = 0;
      this.mouthA.visible = false;
    }
    this.restingMouthUp = wanted;
    this.mouthShownAt = this.clockS;
  }

  lookAt(target: THREE.Vector3 | null): void {
    this.gazeTarget = target;
  }

  update(dt: number, ctx: AvatarContext): void {
    if (!this.loaded || !Number.isFinite(dt) || dt <= 0) return;
    // A resumed tab should settle from its current pose, not skip a blink's
    // closed frame or consume an entire gesture in one update.
    dt = Math.min(dt, 0.05);
    this.clockS += dt;
    const calm = ctx.reducedMotion ? 0.15 : 1;
    this.calmNow = calm;
    this.motionScale = damp(this.motionScale, calm, 6, dt);
    this.intensity = damp(this.intensity, this.intensityTarget, 4, dt);
    const presence = PAINTED_PRESENCE[this.state];
    this.idleScale = damp(this.idleScale, presence.idleScale, 3, dt);
    const motion = this.motionScale;
    const audioLevel = Number.isFinite(ctx.speechLevel) ? THREE.MathUtils.clamp(ctx.speechLevel, 0, 1) : 0;
    this.updateSpeech(audioLevel);

    /*
     * Gaze, as head movement rather than eye movement.
     *
     * A painted eye cannot swivel, but a head can turn a few degrees and read as
     * looking — and because the head is its own layer sitting over the body's
     * own painted head, a small offset shows a sliver of what is underneath
     * rather than a hole.
     */
    let targetX = 0;
    let targetY = 0;
    let targetTilt = 0;
    const gazeTarget = this.gazeTarget ?? ctx.gazeTarget;
    if (gazeTarget) {
      const local = this.figure.worldToLocal(this.localGaze.copy(gazeTarget));
      targetX = THREE.MathUtils.clamp(local.x * 0.01, -HEAD_TRAVEL_X, HEAD_TRAVEL_X);
      targetY = THREE.MathUtils.clamp((local.y - this.eyeLocalY) * 0.008, -HEAD_TRAVEL_Y, HEAD_TRAVEL_Y);
      // The look is mostly this: a tilt into the direction, about the neck.
      targetTilt = THREE.MathUtils.clamp(-local.x * 0.022, -HEAD_TILT, HEAD_TILT);
    }
    targetX *= motion;
    targetY *= motion;
    targetTilt *= motion;

    /*
     * Saccades, on their own clock.
     *
     * Retargeted every second or so with a bias upward and inward, which is
     * where a listening face actually looks — at the other person's eyes rather
     * than randomly around them. Small enough that it never reads as her
     * looking away from you, large enough that the face is never still.
     *
     * Held steady under reduced motion rather than removed: the request is for
     * less movement, and a face frozen mid-glance is not less movement, it is a
     * photograph.
     */
    this.saccadeIn -= dt;
    if (this.saccadeIn <= 0) {
      this.saccadeIn = 0.9 + Math.random() * 2.4;
      this.saccadeX = (Math.random() - 0.5) * 0.0025;
      this.saccadeY = (Math.random() - 0.35) * 0.0018;
    }

    /*
     * Gesture impulses: offsets riding the same springs as the gaze.
     *
     * A nod is not a pose; it is the gaze target dipping and coming back, and
     * the spring turns that command into flesh. Amplitude follows the
     * directive's intensity - a half-hearted nod and an emphatic one are the
     * same curve at different sizes - and reduced motion scales it down the
     * same way it scales everything else.
     */
    const ampScale = (0.7 + 0.6 * this.intensity) * motion;
    let gestureY = 0;
    let gestureTilt = 0;
    let leanTarget = 0;
    if (this.gestureKind) {
      this.gestureT += dt;
      const u = this.gestureT / this.gestureLen;
      if (u >= 1) {
        this.gestureKind = null;
      } else {
        switch (this.gestureKind) {
          case 'nod':
            gestureY = -HEAD_TRAVEL_Y * ampScale * Math.sin(Math.PI * u);
            break;
          case 'slow_nod':
            // One considered acknowledgement, with a gentle ease at both ends.
            gestureY = -HEAD_TRAVEL_Y * 0.85 * ampScale * Math.sin(Math.PI * u) ** 2;
            break;
          case 'head_tilt':
          case 'hand_to_chin': {
            // Ease in, genuinely hold, then let the spring carry it home.
            const env = u < 0.15 ? u / 0.15 : u > 0.8 ? (1 - u) / 0.2 : 1;
            gestureTilt = this.gestureSign * HEAD_TILT * 0.8 * ampScale * env;
            break;
          }
          case 'lean_in':
            // The envelope is what eases; the metres are decided below.
            leanTarget = Math.sin(Math.PI * u);
            break;
          default:
            break;
        }
      }
    }

    /*
     * Emphasis, read off the actual voice.
     *
     * A rolling mean of the speech envelope over the last second or so; a
     * syllable that jumps well clear of it earns a couple of millimetres of
     * dip, once, with a refractory period. The threshold keeps this to the
     * syllables she leans on; the cooldown keeps it emphasis rather than
     * bobbing.
     */
    this.levelMean = damp(this.levelMean, audioLevel, 1.25, dt);
    this.emphasisCooldown -= dt;
    if (
      this.emphasisLeft <= 0 &&
      this.emphasisCooldown <= 0 &&
      audioLevel > 0.12 &&
      this.levelMean > 0.04 &&
      audioLevel > this.levelMean * 1.4
    ) {
      this.emphasisLeft = 0.2;
      this.emphasisCooldown = 0.9;
    }
    let emphasisY = 0;
    if (this.emphasisLeft > 0) {
      emphasisY = -0.0018 * Math.sin(Math.PI * (1 - this.emphasisLeft / 0.2)) * motion;
      this.emphasisLeft -= dt;
    }

    this.gazeX.step(targetX + this.saccadeX * motion * this.idleScale, dt);
    this.gazeY.step(targetY + this.saccadeY * motion * this.idleScale + gestureY + emphasisY, dt);

    /*
     * Breath, and the slow weight shift under it.
     *
     * The body rises and falls by a few millimetres at a resting rate; the head
     * rides it with a little lag and a little less travel, because a head is
     * heavy and the neck absorbs some of the movement. The drift is slower
     * still - a person settling their weight from one foot to the other - and
     * it tilts the head a fraction rather than moving it, which is the
     * difference between someone standing and a picture of someone standing.
     */
    /*
     * Breath is the chest rising, not the picture bobbing.
     *
     * The body painting grows a fraction of a percent taller from the hips
     * up - about a centimetre at the shoulders, at a resting rate, a little
     * quicker while she is speaking - and the head rides up on the neck by
     * the same amount, a beat behind. A whole figure sliding up and down by
     * three millimetres was invisible; a chest that lifts is a person.
     */
    // Integrating a damped rate preserves phase across every state and syllable.
    this.breathRate = damp(this.breathRate, presence.breathRate, 2, dt);
    this.breathDepth = damp(this.breathDepth, presence.breathDepth, 2, dt);
    this.breathPhase = (this.breathPhase + dt * this.breathRate) % (Math.PI * 2);
    const breathK = (Math.sin(this.breathPhase) * 0.5 + 0.5) * 0.007 * this.breathDepth * motion;
    const drift = Math.sin(this.clockS * 0.31 + 0.9) * motion * this.idleScale;
    const expressionTilt = THREE.MathUtils.clamp(EXPRESSION_POSES[this.expression].headTilt * 0.2, -0.009, 0.009);
    const tiltTarget = targetTilt + gestureTilt + (presence.tilt + expressionTilt * this.intensity) * motion + drift * 0.006;
    this.tilt.step(THREE.MathUtils.clamp(tiltTarget, -HEAD_TILT, HEAD_TILT), dt);

    /*
     * The lean, when there is one.
     *
     * Two to three centimetres toward the camera - scale cannot fake this,
     * because the camera is close enough that real translation reads as
     * parallax against the backdrop - plus a whisper of head scale on top.
     * The envelope is damped rather than applied raw so a directive that
     * interrupts a lean settles her back instead of snapping her back.
     */
    this.leanEnv = damp(this.leanEnv, (leanTarget + presence.lean) * motion, 4, dt);
    this.figure.position.z = (0.02 + 0.01 * this.intensity) * this.leanEnv;
    this.headGroup.scale.setScalar(HEAD_COVER * (1 + 0.005 * this.leanEnv));

    // How far the neck rises with the chest, from the body that is showing.
    const rise = breathK * (this.neck.y - this.breathPivotY);

    this.headGroup.position.set(
      this.neck.x + this.gazeX.value + drift * 0.0012,
      this.neck.y + this.gazeY.value + rise * 0.92,
      this.neck.z,
    );
    this.headGroup.rotation.z = this.tilt.value;

    /*
     * If the face wants a patch whose painting had not arrived when it was
     * asked for, take it as soon as the background load delivers it. Without
     * this she would wear the fallback until the next directive happened to
     * ask again.
     */
    if (
      this.shownEyes === null &&
      this.pendingEyes === undefined &&
      this.dartKey === null &&
      this.blinkPhase < 0
    ) {
      const wanted = this.baseEyeKey();
      const file = wanted ? this.manifest?.eyes[wanted] : undefined;
      if (file && this.textures.has(file)) this.requestEyes(wanted);
    }

    if (this.pendingEyes !== undefined && this.eyeReady(this.pendingEyes) && this.blinkPhase < 0) {
      if (calm < 0.5) {
        if (this.showEyes(this.pendingEyes, true)) {
          this.pendingEyes = undefined;
          this.pendingPriority = false;
        }
      } else {
        this.blinkIn = Math.min(this.blinkIn, 0.08);
      }
    }
    this.updateThink(dt * (calm < 0.5 ? 0.3 : 1));
    this.updateIdleLook(dt, calm);
    this.updateDart(dt, calm);
    this.updateRestingMouth();

    // The second mouth quad is retired: nothing cross-fades any more.
    if (this.mouthB) this.mouthB.visible = false;

    /*
     * Cross-fade the body between outfits and gestures — two paintings, never six.
     *
     * The previous version damped *every* body that was not the wanted one
     * toward `0.98 - arriving`. Since `arriving` starts near zero, that target
     * is ~0.92 for all five others — so a pose change did not fade one drawing
     * into another, it faded all six of them in. Half a second after a gesture
     * changed, the casual and clinical bodies were on screen together at
     * 0.29-0.82 opacity: a woman in a sweater and the same woman in a lab coat,
     * each with her own painted head, plus the head layer over the top.
     *
     * That is the "two heads clashing" — and it fired every few seconds while
     * she spoke, because the idle gesture picker changes her gesture on a 2.6-4.8s
     * timer and half those gestures map to a different body pose.
     *
     * So: exactly one body arrives, exactly one leaves, and everything else is
     * zero. The swap is also quicker now. The old third of a second was chosen
     * to read as movement, but two paintings of a person in different poses do
     * not tween — they overlap — so the honest choice is to make the overlap
     * short enough to read as a cut. The head layer is continuous across it and
     * is what the viewer is actually watching.
     */
    const wanted = this.key();
    // A rest directive can arrive before the present pose's blink. Only the
    // latest request is allowed to land, including while textures are loading.
    if (this.pendingBody && this.pendingBody !== wanted) this.pendingBody = null;
    const wantedReady = this.bodies.get(wanted)?.userData.ready === true;
    if (wantedReady && wanted !== this.showing && wanted !== this.pendingBody) {
      if (this.showing === null) {
        // Nothing to hide the cut under: the first body, or reduced motion.
        // Fade, quickly, rather than wait for a blink that is not coming.
        this.outgoing = this.showing;
        this.showing = wanted;
      } else if (!this.lid || calm < 0.5) {
        this.cutTo(wanted);
      } else {
        // Park it, and blink at the first opportunity.
        this.pendingBody = wanted;
        if (this.blinkPhase < 0) this.blinkIn = Math.min(this.blinkIn, 0.06);
      }
    }

    for (const [label, mesh] of this.bodies) {
      const material = mesh.material as THREE.MeshBasicMaterial;
      if (label === this.showing) {
        material.opacity = damp(material.opacity, 1, BODY_FADE_RATE, dt);
      } else if (label === this.outgoing) {
        material.opacity = damp(material.opacity, 0, BODY_FADE_RATE, dt);
        if (material.opacity < 0.01) this.outgoing = null;
      } else {
        // Never allowed to drift upward. This is the line that was wrong.
        material.opacity = 0;
      }
      mesh.visible = material.opacity > 0.01;
      // Grown from the hips: the quad stretches and its centre moves up by
      // half the growth, so the feet stay where they are.
      const rest = (mesh.userData.restY as number) ?? 0;
      const baseH = (mesh.userData.baseScaleY as number) ?? mesh.scale.y;
      mesh.userData.baseScaleY = baseH;
      mesh.scale.y = baseH * (1 + breathK);
      mesh.position.y = rest + breathK * (rest - this.breathPivotY);
    }

    this.updateBlink(dt, calm);
  }

/**
   * Blinking.
   *
   * Asymmetric on purpose: a real blink snaps shut and opens more slowly, and
   * making the two halves equal is the single thing that makes a synthetic
   * blink read as a shutter. Roughly 70ms down, a beat closed, 130ms up.
   *
   * The interval is random within a range rather than fixed, and every so often
   * a blink is doubled, because a metronome reads as a machine — which is the
   * exact impression this is here to remove.
   */
  private updateBlink(dt: number, calm: number): void {
    if (!this.lid) return;

    if (this.blinkPhase < 0) {
      // Reduced motion slows the schedule right down rather than stopping it:
      // a face that never blinks at all is unsettling in its own way.
      this.blinkIn -= dt * (calm < 0.5 ? 0.35 : 1);
      if (this.blinkIn > 0) return;
      this.blinkPhase = 0;
      // Concern makes each blink heavier as well as rarer: the lids stay
      // down a beat longer and lift more slowly. Decided when the blink
      // starts so a mid-blink directive cannot warp the one in flight.
      this.blinkStretch = this.mood === 'concerned' ? 1 + 0.6 * this.intensity : 1;
    }

    this.blinkPhase += dt;

    /*
     * The close is close to a cut.
     *
     * The lid is a painted closed eye faded over the open one, and a linear
     * 70ms fade spent four frames at partial opacity - a translucent double
     * exposure of both eyes at once, which is what read as unnatural. A real
     * blink closes faster than the eye can track: two frames to shut, a
     * genuine beat closed, and an eased open that lingers shut a touch before
     * lifting.
     */
    // The snap shut is physics and never stretches; the beat closed and the
    // lift are manner, and concern is allowed to slow them.
    const DOWN = 0.035;
    const SHUT = 0.09 * this.blinkStretch;
    const UP = 0.12 * this.blinkStretch;
    const total = DOWN + SHUT + UP;
    const t = this.blinkPhase;

    let closed: number;
    if (t < DOWN) closed = Math.sqrt(t / DOWN);
    else if (t < DOWN + SHUT) closed = 1;
    else {
      const u = (t - DOWN - SHUT) / UP;
      closed = Math.max(0, 1 - u * u * (3 - 2 * u));
    }

    // Eyes shut: the one moment a cut between two paintings is invisible.
    if (closed >= 1) {
      if (this.pendingBody) this.cutTo(this.pendingBody);
      if (this.pendingEyes !== undefined) {
        // The shut frame is the sanctioned moment: the cut is invisible, so
        // the hold does not apply.
        if (this.showEyes(this.pendingEyes, true)) {
          this.pendingEyes = undefined;
          this.pendingPriority = false;
        }
      }
    }

    (this.lid.material as THREE.MeshBasicMaterial).opacity = closed;
    this.lid.visible = closed > 0.01;

    if (t >= total) {
      this.blinkPhase = -1;
      (this.lid.material as THREE.MeshBasicMaterial).opacity = 0;
      this.lid.visible = false;
      if (this.pendingBody || (this.pendingEyes !== undefined && this.eyeReady(this.pendingEyes))) {
        // A swap arrived mid-blink and missed the shut frame. Blink again.
        this.blinkIn = 0.12;
      } else if (this.blinkAgain) {
        // The second half of a double blink follows almost immediately.
        this.blinkAgain = false;
        this.blinkIn = 0.09;
      } else {
        this.blinkIn = this.nextBlinkInterval();
        this.blinkAgain = Math.random() < 0.14;
      }
    }
  }

  /**
   * When the next blink is due, shaped by the moment.
   *
   * High-intensity concern blinks slower - a worried listener's lids are
   * heavy, not busy. Excitement blinks quicker. Thought slows the schedule
   * too, because eyes fixed on an idea forget to blink. All of it is a
   * scale on the same random base, so no mood ever becomes a metronome.
   */
  private nextBlinkInterval(): number {
    let interval = 2.6 + Math.random() * 3.8;
    if (this.mood === 'concerned') {
      interval *= 1 + 0.8 * this.intensity;
    } else if (this.state === 'EXCITED' || this.expression === 'grin' || this.expression === 'surprised') {
      interval *= 1 - 0.35 * this.intensity;
    }
    if (this.state === 'THINKING') interval *= 1.5;
    return interval;
  }

  /**
   * The idle machinery's tempo: how often darts and idle looks come around.
   *
   * Above one is livelier than baseline. Intensity speeds everything up -
   * except under concern, where it does the opposite: a worried face goes
   * quieter as the worry deepens, not busier.
   */
  private liveliness(): number {
    if (this.mood === 'concerned') return Math.max(0.5, 1 - 0.35 * this.intensity);
    return 0.85 + 0.5 * this.intensity;
  }

  /**
   * The brief looks that make a listening face a face.
   *
   * Every so often, when she is not speaking, she takes on a passing look
   * and lets it go. Each way is a cut under a blink. Which looks, how often
   * and for how long all come from the mood the last directive set: warm
   * moments glance warmly, worried ones glance down and dwell, and a
   * neutral room gets the old curiosity. Under reduced motion the schedule
   * slows to a crawl rather than stopping.
   */
  private updateIdleLook(dt: number, calm: number): void {
    // Thought owns the eyes; its own glancing lives in updateThink.
    if (this.state === 'THINKING' || this.state === 'LISTENING' || this.state === 'CLINICAL_ANALYSIS') return;
    if (this.idleLookLeft > 0) {
      this.idleLookLeft -= dt;
      if (this.idleLookLeft <= 0) {
        this.requestEyes(this.baseEyeKey());
        this.idleLookIn = this.idleLookInterval();
      }
      return;
    }
    if (this.clockS - this.lastAudibleAt < 0.6) return;
    // Deep concern holds its face rather than glancing through it: the
    // expression persists through the idle instead of resetting to variety.
    if (this.mood === 'concerned' && this.intensity >= 0.7) return;
    this.idleLookIn -= dt * (calm < 0.5 ? 0.3 : 1);
    if (this.idleLookIn > 0) return;

    /*
     * The glance pool, by mood. Entries are eye keys - expression patches
     * and gaze frames mix freely here, since both are just drawings of where
     * her attention went. Filtered to what shipped, and to what is not
     * already on her face, so a glance is always a change.
     */
    const pool = (
      this.mood === 'concerned'
        ? ['concerned', 'look-down', 'look-down']
        : this.mood === 'warm'
          ? ['warm', 'warm', 'curious']
          : ['curious']
    ).filter((key) => this.manifest?.eyes[key] && key !== this.shownEyes);
    if (pool.length === 0) {
      this.idleLookIn = this.idleLookInterval();
      return;
    }
    if (!this.requestEyes(pool[Math.floor(Math.random() * pool.length)])) return;
    // Concern dwells longest; everything dwells longer as intensity rises.
    const base = this.mood === 'concerned' ? 3.0 + Math.random() * 1.5 : 2.2 + Math.random() * 1.6;
    this.idleLookLeft = base * (0.7 + 0.6 * this.intensity);
  }

  /** Seconds until the next idle look: concern makes them scarce. */
  private idleLookInterval(): number {
    const base = this.mood === 'concerned' ? 9 + Math.random() * 8 : 6 + Math.random() * 7;
    return base / this.liveliness();
  }

  /**
   * What thinking looks like: looking away to where the thought is.
   *
   * When the directive's state is THINKING, the idle look stands down and
   * this asks the dart machinery for a look-up or look-down with a longer
   * dwell - long enough to read as consideration, not a flicker - and asks
   * again every four seconds or so, so a long think stays visibly alive
   * rather than settling into a stare.
   */
  private updateThink(dt: number): void {
    if (this.state !== 'THINKING') return;
    this.thinkIn -= dt;
    if (this.thinkIn > 0) return;
    this.thinkIn = 4.4 + Math.random() * 1.8;
    this.dartAsk = {
      // Mostly up - the classic searching-for-it look - down for variety.
      key: Math.random() < 0.65 ? 'look-up' : 'look-down',
      dwell: 1.0 + Math.random() * 0.6,
    };
  }

  /**
   * A gaze frame on for a beat, then off.
   *
   * Only while nothing else owns the eyes: not mid-blink, not while an idle
   * glance has replaced the resting face, not while a directive's look is
   * pending. A deliberate ask (thought, hand-to-chin) is honoured first and
   * keeps its requested dwell; the random schedule is biased toward the side
   * she is already turning her head, and toward "down" while she speaks -
   * people look away from you to find a word.
   */
  private updateDart(dt: number, calm: number): void {
    if (!this.manifest || !this.eyes) return;
    const gazes = ['look-left', 'look-right', 'look-up', 'look-down'].filter(
      (k) => this.manifest?.eyes[k] && this.textures.has(this.manifest.eyes[k]),
    );
    if (gazes.length === 0) return;

    if (this.dartLeft > 0) {
      this.dartLeft -= dt;
      if (this.dartLeft <= 0 && this.dartKey) {
        // Back to whatever the face rests on now, not to a remembered one -
        // a directive may have changed the base while the eyes were away.
        if (this.shownEyes === this.dartKey) this.requestEyes(this.baseEyeKey());
        this.dartKey = null;
        this.dartIn = ((this.state === 'LISTENING' ? 8 : 4) + Math.random() * 4) / this.liveliness();
      }
      return;
    }

    // The eyes are free when the face is at rest: mid-glance, mid-blink and
    // mid-request all keep their claim.
    if (this.blinkPhase >= 0 || this.pendingEyes !== undefined) return;
    if (this.shownEyes !== this.baseEyeKey()) return;

    if (this.dartAsk) {
      const { key, dwell } = this.dartAsk;
      if (gazes.includes(key) && this.showEyes(key)) {
        this.dartAsk = null;
        this.dartKey = key;
        this.dartLeft = dwell;
        return;
      }
      return;
    }

    // Listening and examination keep their attention on the supplied target.
    // Their tiny spring-driven saccades still move, without random mood swaps.
    if (this.state === 'LISTENING' || this.state === 'CLINICAL_ANALYSIS' || calm < 0.5) return;
    this.dartIn -= dt * (calm < 0.5 ? 0.35 : 1);
    if (this.dartIn > 0) return;

    let pool = gazes;
    if (this.currentMouth) pool = gazes.filter((k) => k !== 'look-up');
    // Lean the dart the way the head is turning.
    const side = this.gazeX.value > 0.002 ? 'look-left' : this.gazeX.value < -0.002 ? 'look-right' : null;
    const key =
      side && pool.includes(side) && Math.random() < 0.5
        ? side
        : pool[Math.floor(Math.random() * pool.length)];
    if (this.showEyes(key)) {
      this.dartKey = key;
      this.dartLeft = 0.65 + Math.random() * 0.35;
    }
  }

  /** Replaces the body outright. Only ever called with the eyes closed. */
  private cutTo(label: string): void {
    if (!this.bodies.has(label)) return;
    // Its painting has not arrived yet. The pending swap stays parked and the
    // next blink tries again, which is invisible - she keeps the body she has.
    if (this.bodies.get(label)!.userData.ready !== true) return;
    for (const [key, mesh] of this.bodies) {
      const material = mesh.material as THREE.MeshBasicMaterial;
      material.opacity = key === label ? 1 : 0;
      mesh.visible = key === label;
    }
    this.showing = label;
    this.outgoing = null;
    this.pendingBody = null;
  }

  /**
   * What a screen tap landed on, if it landed on her.
   *
   * The head quad wins over the body when both are hit - it is drawn over the
   * body and overlaps its top. Only the body she is actually wearing counts;
   * the invisible poses would otherwise catch taps beside her.
   */
  hitZone(raycaster: THREE.Raycaster): 'face' | 'body' | null {
    if (!this.loaded || !this.head) return null;
    if (raycaster.intersectObject(this.head, false).length > 0) return 'face';
    const worn = [...this.bodies.values()].filter(
      (mesh) => mesh.visible && (mesh.material as THREE.MeshBasicMaterial).opacity > 0.5,
    );
    if (worn.length && raycaster.intersectObjects(worn, false).length > 0) return 'body';
    return null;
  }

  stats(): { meshes: number; triangles: number } {
    const meshes = [this.head, this.eyes, this.lid, this.mouthA, this.mouthB, ...this.bodies.values()]
      .filter(Boolean);
    return { meshes: meshes.length, triangles: meshes.length * 2 };
  }

  dispose(): void {
    for (const item of this.disposables) item.dispose();
    this.loaded = false;
    for (const mesh of [this.head, this.eyes, this.lid, this.mouthA, this.mouthB, ...this.bodies.values()]) {
      if (!mesh) continue;
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
    this.root.removeFromParent();
  }
}
