/**
 * The holographic assembly (ARCHITECTURE §8).
 *
 * The analysis happens *around her*, not on a screen beside her. She stands on
 * a platform of light with her readouts floating at arm's reach, a contour model
 * of the face being measured turning slowly on her far side, and threads running
 * from her to each panel. She is inside her instrument.
 *
 * This replaces two earlier arrangements, and the reasons both were wrong are
 * worth keeping. The first projected DOM labels from 3D anchors, so their screen
 * position came from the camera frustum and nothing else on the page could know
 * where they would land — they collided with the conversation. The second fixed
 * that by moving everything into a DOM panel pinned to the right of the screen,
 * which solved the collision and turned the analysis into a television on the
 * wall: correct, legible, and completely inert.
 *
 * Canvas-textured quads are the resolution. They are genuinely in the room, so
 * they move with the camera and carry depth; their text is drawn once at high
 * resolution, so it stays sharp; and being world-space they cannot collide with
 * anything in the DOM because they are not in it.
 */
import * as THREE from 'three';
import {
  ConnectorBank,
  FaceModel,
  ScanBeam,
  METRIC_FACE_REGIONS,
  REGION_ANCHORS,
} from './primitives.ts';
import { HoloCard, TONE_BAD, TONE_GOOD, TONE_NEUTRAL, type CardTone } from './cards.ts';
import { HoloRings } from './rings.ts';
import { HoloProjection } from './projection.ts';
import { HoloPortrait } from './portrait.ts';
import { HoloFaceMesh3D, type ScanMesh } from './face-mesh-3d.ts';
import { HoloDemo } from './demo.ts';
import { firstBodyDemo } from './demo-library.ts';
import type { BodyAnalysis } from '@/body-analysis/pipeline.ts';
import {
  BODY_HIGHER_IS_BETTER,
  BODY_METRIC_LABELS,
  BODY_NOISE_FLOOR,
} from '@/body-analysis/metrics.ts';
import {
  bodyAverage,
  isProfileKey,
  selectBodyFindings,
  type AnyBodyMetricKey,
} from '@/body-analysis/findings.ts';
import { EXPLANATION, observationsFor } from '@/skin-analysis/observations.ts';
import * as sound from '@/lib/sound.ts';
import {
  PROFILE_HIGHER_IS_BETTER,
  PROFILE_METRIC_LABELS,
  PROFILE_NOISE_FLOOR,
} from '@/body-analysis/profile.ts';
import { extentsAt, solveLayout, type LayoutResult, type ViewFrustum } from './layout.ts';
import {
  averageGoodness,
  hasIssues,
  headlineOf,
  selectFindings,
  SLOT_COUNT,
} from './presented.ts';
import { PALETTE } from '@/character/palette.ts';
import { radialTexture } from '@/scene/textures.ts';
import { clamp, damp, smoothstep } from '@/lib/math.ts';
import {
  METRIC_HIGHER_IS_BETTER,
  METRIC_LABELS,
  METRIC_NOISE_FLOOR,
  type FaceRegionKey,
  type RoutinePlan,
  type SkinAnalysis,
  type SkinMetricKey,
} from '@shared/types.ts';

/** Above anything the environments draw. */
const HOLO_RENDER_ORDER = 100;

export type PanelMode = 'scan' | 'routine';

/**
 * Threads from her to the panels.
 *
 * Three, and faint. At six they were a spray of white lines across the whole
 * frame — every panel wired to her sternum reads as cabling, not as light. A
 * few, dim, suggest the connection without drawing it.
 */
const CONNECTOR_COUNT = 3;

/*
 * The readout column.
 *
 * Two columns at different depths was the mistake. On paper they were 0.38m
 * apart; from the camera's actual position the far column projected straight on
 * top of the near one and the numbers overlapped each other — a layout that
 * only worked in the coordinate space it was authored in, and never once in the
 * shot it was authored for. One column cannot do that to itself.
 */
const HEADLINE_W = 0.4;
const HEADLINE_H = 0.27;
const STRIP_W = 0.4;
const STRIP_H = 0.094;
/**
 * The column's *left* edge, not its centre.
 *
 * Positioning by centre meant every width change moved both edges, and the
 * first one large enough to matter walked the whole column off the left of the
 * frame. Cards of two different widths sharing a left edge also read as a
 * column, which two centred stacks never quite do.
 */
const COLUMN_LEFT = -0.76;
/**
 * How much clear room to keep between the readouts and the edge of frame.
 *
 * The column used to sit at a fixed `COLUMN_LEFT` whatever shape the window
 * was, and a fixed world offset is only ever framed correctly at one aspect
 * ratio. At 16:9 it looked composed; at 0.96 the headline card's left edge
 * landed at -1.36 in clip space — a third of a screen past the edge — so the
 * routine read "TEP 1 · CLEANSE". The column is now pushed inward whenever the
 * frame is too narrow to hold it where it would rather be.
 */
const EDGE_MARGIN = 0.05;
/**
 * The least room the projection keeps between itself and her.
 *
 * Without it the edge clamp solved one problem by causing a worse one — pulled
 * in off the right edge, the hologram landed on her body.
 */
const STAND_CLEARANCE = 0.4;
/**
 * The least room the readout column keeps between its right edge and her.
 *
 * The edge clamp below slides the column inward on a narrow frame, and with
 * nothing stopping it the headline card — the widest, and at head height —
 * slid onto her face. That is the one place in the room nothing may go. The
 * column now stops short of her by this much; on a frame too narrow to hold
 * both, the column's far edge yields, not her.
 */
const COLUMN_CLEARANCE = 0.26;
const COLUMN_Z = 0.16;
/*
 * Shoulder height, not above her head.
 *
 * At 1.92 the headline card's band ran from her hairline to her chin, so in
 * routine mode "Step 1" was printed across her face. Lowered so the headline
 * sits beside her shoulder and the strips run down her side, where a
 * consultant's notes would be.
 */
const COLUMN_TOP = 1.74;
/** Centre-to-centre. Slightly more than the strip height, so they breathe. */
const STRIP_PITCH = 0.112;
/** Between the headline and the first strip. */
const HEADLINE_GAP = 0.045;

function slotPosition(index: number): [number, number, number] {
  if (index === 0) {
    return [COLUMN_LEFT + HEADLINE_W / 2, COLUMN_TOP - HEADLINE_H / 2, COLUMN_Z];
  }
  const stackTop = COLUMN_TOP - HEADLINE_H - HEADLINE_GAP;
  return [
    COLUMN_LEFT + STRIP_W / 2,
    stackTop - (index - 1) * STRIP_PITCH - STRIP_H / 2,
    COLUMN_Z,
  ];
}

/**
 * The callouts on the contour model — the label, the region it points at, and
 * the metric that region is measuring.
 *
 * Four, not nine. The model exists to say *where on your face this number came
 * from*, and a head with nine leader lines coming out of it stops answering
 * that question and starts looking like a diagram of a head.
 */
/*
 * The zone map is derived, not written down.
 *
 * It used to be seven fixed rows — forehead always Oiliness, chin always
 * Breakout signs — so a person with genuinely clear skin was shown "Chin ·
 * Breakout signs · 22" as though 22 were a finding. Every face got the same
 * seven labels, which means the labels were never about the face.
 *
 * Now each callout comes from something the scan actually found, and points at
 * the region that finding was measured from. A clear face gets few callouts. A
 * completely unremarkable one gets none, which is the honest picture of a
 * completely unremarkable face.
 */

/** Human names for the model's regions, for the label on the card. */
const REGION_TITLES: Record<string, string> = {
  forehead: 'Forehead',
  glabella: 'Brow',
  periorbitalL: 'Under eyes',
  periorbitalR: 'Under eyes',
  nose: 'Nose',
  cheekL: 'Cheek',
  cheekR: 'Cheeks',
  perioral: 'Perioral',
  chin: 'Chin',
};

/** As many as `SLOT_COUNT` findings can ask for; usually fewer are used. */
const MAX_CALLOUTS = SLOT_COUNT;

/*
 * The life of the assembly: three things that cost one draw call each.
 *
 *   sweep   a plane of light that crosses the room once as the instrument
 *           boots — the room being read before she reads you
 *   motes   points of light lifting off the ring field and fading, a slow
 *           steady drift that says the platform is emitting
 *   pulses  a bright bead travelling each leader line from the face to its
 *           label, so the numbers visibly come *from* the face
 *
 * Bounded by the particle budget (ARCHITECTURE §9) and dropped with the other
 * rich layers on the low tier.
 */
const MOTE_COUNT = 160;
const MOTE_RISE = 0.85;
const SWEEP_SECONDS = 1.15;
const PULSE_SECONDS = 1.6;

interface Callout {
  region: string;
  title: string;
  metric: SkinMetricKey;
}

/**
 * Picks one region per finding, without two labels landing on the same spot.
 *
 * `METRIC_FACE_REGIONS` lists every region a metric is measured from, in
 * roughly descending relevance. Taking the first free one means two findings
 * that share a primary region still get distinct anchors — hydration and
 * texture are both cheek metrics, and pointing two leader lines at the same
 * cheek would read as a fault in the display rather than as two findings.
 */
function calloutsFor(metrics: SkinMetricKey[]): Callout[] {
  const taken = new Set<string>();
  const out: Callout[] = [];
  for (const metric of metrics) {
    const candidates = METRIC_FACE_REGIONS[metric] ?? [];
    const region = candidates.find((r) => !taken.has(r)) ?? candidates[0];
    if (!region) continue;
    taken.add(region);
    out.push({ region, title: REGION_TITLES[region] ?? region, metric });
    if (out.length >= MAX_CALLOUTS) break;
  }
  return out;
}

const CALLOUT_W = 0.3;
const CALLOUT_H = 0.11;
/** Where the callouts start, as a fraction of the model's height right of its centre. */
const CALLOUT_OFFSET = 0.62;

/**
 * The contour model of the face being analysed.
 *
 * Large and beside her, at her own head height — in the reference it carries
 * roughly the visual weight she does, because it is the other half of the
 * conversation. A small model tucked behind her shoulder reads as an icon; one
 * at this scale reads as the thing being examined.
 */
const FACE_OFFSET = new THREE.Vector3(0.62, 1.5, -0.18);

/**
 * How far the scan and the demonstration step apart to stand side by side.
 *
 * They used to share one position exactly, which meant the demonstration did
 * not appear beside your body — it replaced it. The whole promise of a body
 * scan is that the hologram is *you*, so a generic figure taking that spot the
 * moment advice starts is the one swap this room must never make. They open
 * around the same centre instead, so the composition stays where it was.
 */
const DEMO_GAP = 0.46;
/*
 * Larger than it was. At 0.66 the projection was a portrait beside a person;
 * at this size it carries the visual weight she does, which is the reference
 * — the thing being examined is the other half of the conversation.
 */
const FACE_HEIGHT = 0.7;

/** The reveal's timing. Set to her speaking pace: one region per line. */
export const REVEAL_LEAD = 1.1;
export const REVEAL_STEP = 1.35;

export interface HologramRigOptions {
  /** Drops the expensive additive layers on weak hardware. */
  rich?: boolean;
}

export class HologramRig {
  /**
   * Kept at the origin with no rotation, so a child's local position *is* its
   * world position. Everything is placed relative to where she is standing, and
   * a decorative drift on this group would slide the whole assembly off her.
   */
  private group = new THREE.Group();

  private face: FaceModel;
  private beam: ScanBeam;
  private connectors: ConnectorBank;
  private rings: HoloRings;
  private projection: HoloProjection;
  /**
   * Their actual face, when there is one.
   *
   * The contour model is a fallback, not the design. Before the first scan
   * there is genuinely nothing to project and an abstract head is the honest
   * thing to show; the moment a capture exists, projecting a generic head
   * instead of the one that was measured would be a diagram pretending to be a
   * reading.
   */
  private portrait: HoloPortrait;
  private portraitMesh: THREE.Mesh;
  /**
   * A figure demonstrating what was recommended.
   *
   * Shares the projection volume with the scan portrait and takes it over while
   * playing: the scan is what was found, the demonstration is what to do about
   * it, and showing both at once would be two holograms arguing.
   */
  private demo = new HoloDemo();
  private lastAnalysis: SkinAnalysis | null = null;
  private lastPrevious: SkinAnalysis | null = null;
  /**
   * The face from the scan, in three dimensions. See `face-mesh-3d.ts`.
   *
   * When it exists it is the subject of the projection: the flat portrait
   * drops to a ghost behind it and the abstract contour model stays off.
   */
  private faceMesh: HoloFaceMesh3D | null = null;
  /**
   * The reveal: regions lighting one after another rather than all at once.
   *
   * A reading that appears in a single frame is a slide. Lit in sequence,
   * each with its tick, it is her walking the face - and the pace is set so
   * her narration of each region lands as it lights.
   */
  private reveal: {
    items: Array<{ region: FaceRegionKey; tone: 'good' | 'bad' | 'neutral' }>;
    shown: number;
    timer: number;
    step: number;
  } | null = null;
  /** Whether the expensive additive layers are on. See `HologramRigOptions`. */
  private rich: boolean;
  private sweep: THREE.Mesh;
  /** Progress of the boot sweep, or -1 when it is not running. */
  private sweepT = -1;
  private motes: THREE.Points | null = null;
  private motePhase: Float32Array = new Float32Array(0);
  private moteAngle: Float32Array = new Float32Array(0);
  private moteRadius: Float32Array = new Float32Array(0);
  private moteSpeed: Float32Array = new Float32Array(0);
  private pulses: THREE.Points;
  private pulseT: Float32Array = new Float32Array(MAX_CALLOUTS);
  private cards: HoloCard[] = [];
  private callouts: HoloCard[] = [];
  /** Which of the built cards are in use this scan. */
  private activeCallouts: Callout[] = [];
  /** Leader lines from each highlighted region out to its label. */
  private leaders: THREE.LineSegments;
  private leaderPositions: THREE.BufferAttribute;

  /** The fallback layout — nothing but the frustum solve still reads from it. */
  private layout: LayoutResult;
  /**
   * Which metrics have a card. Empty until a scan says otherwise — there is
   * nothing to present before the first one, and a rack of placeholder numbers
   * is exactly what this display was rewritten to stop doing.
   */
  private slotKeys: SkinMetricKey[] = [];
  private plan: RoutinePlan | null = null;

  /** Where she is standing, in world space. Everything hangs off this. */
  private stand = new THREE.Vector3();
  private viewer = new THREE.Vector3(0, 1.5, 3);

  /** 0..1 boot progress. Every reveal is derived from this. */
  private presence = 0;
  private presenceTarget = 0;
  private scanProgress = 0;

  /** 0 = readouts, 1 = routine. */
  private modeBlend = 0;
  private modeTarget = 0;

  /** Momentary corruption, so the projection reads as *projected*. */
  /** 0 when the projection stands alone, 1 when it has stepped aside. */
  private demoSpread = 0;
  /** The frustum the layout was last solved for, for edge clamping. */
  private view: ViewFrustum = { fovDeg: 42, aspect: 1.6, cameraY: 1.5, cameraZ: 1.42 };
  private glitch = 0;
  private glitchTimer = 14 + Math.random() * 18;

  private focused: number | null = null;

  constructor(options: HologramRigOptions = {}) {
    this.rich = options.rich !== false;
    const rich = options.rich !== false;

    this.layout = solveLayout(SLOT_COUNT);

    this.face = new FaceModel({ rich });
    this.beam = new ScanBeam();
    this.connectors = new ConnectorBank(CONNECTOR_COUNT, { rich });
    this.rings = new HoloRings(PALETTE.holo);
    this.projection = new HoloProjection(PALETTE.holo);

    this.portrait = new HoloPortrait();
    this.portraitMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({
        map: this.portrait.texture,
        transparent: true,
        opacity: 0,
        // Additive: it is light in the room, like every other part of the
        // overlay, and additive is what lets the room show through the parts
        // of the face that were dark.
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: false,
        toneMapped: false,
        fog: false,
        side: THREE.DoubleSide,
      }),
    );
    this.portraitMesh.frustumCulled = false;
    this.portraitMesh.renderOrder = 7;
    this.portraitMesh.visible = false;

    for (let i = 0; i < SLOT_COUNT; i++) {
      const card = i === 0
        ? new HoloCard(HEADLINE_W, HEADLINE_H)
        : new HoloCard(STRIP_W, STRIP_H);
      this.cards.push(card);
      this.group.add(card.mesh);
    }

    // Built to the maximum and revealed selectively: allocating cards per scan
    // would mean a canvas and a texture upload in the middle of a transition.
    for (let i = 0; i < MAX_CALLOUTS; i++) {
      const card = new HoloCard(CALLOUT_W, CALLOUT_H);
      this.callouts.push(card);
      this.group.add(card.mesh);
    }

    // Two vertices per callout: the point on the face, and the label it runs to.
    const leaderGeometry = new THREE.BufferGeometry();
    this.leaderPositions = new THREE.BufferAttribute(
      new Float32Array(MAX_CALLOUTS * 2 * 3),
      3,
    );
    this.leaderPositions.setUsage(THREE.DynamicDrawUsage);
    leaderGeometry.setAttribute('position', this.leaderPositions);
    this.leaders = new THREE.LineSegments(
      leaderGeometry,
      new THREE.LineBasicMaterial({
        color: PALETTE.holo,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: false,
      }),
    );
    this.leaders.frustumCulled = false;
    this.group.add(this.leaders);

    // The boot sweep. A tall soft bar of light, billboarded about Y.
    this.sweep = new THREE.Mesh(
      new THREE.PlaneGeometry(0.09, 3.2),
      new THREE.MeshBasicMaterial({
        map: radialTexture(1.4),
        color: PALETTE.holo,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: false,
        toneMapped: false,
      }),
    );
    this.sweep.renderOrder = HOLO_RENDER_ORDER + 6;
    this.sweep.frustumCulled = false;
    this.sweep.visible = false;
    this.group.add(this.sweep);

    // The beads on the leader lines. Colour carries the fade.
    const pulseGeometry = new THREE.BufferGeometry();
    pulseGeometry.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array(MAX_CALLOUTS * 3), 3),
    );
    pulseGeometry.setAttribute(
      'color',
      new THREE.BufferAttribute(new Float32Array(MAX_CALLOUTS * 3), 3),
    );
    this.pulses = new THREE.Points(
      pulseGeometry,
      new THREE.PointsMaterial({
        size: 0.034,
        map: radialTexture(3),
        vertexColors: true,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: false,
        sizeAttenuation: true,
      }),
    );
    this.pulses.renderOrder = HOLO_RENDER_ORDER + 4;
    this.pulses.frustumCulled = false;
    for (let i = 0; i < MAX_CALLOUTS; i++) this.pulseT[i] = (i * 0.37) % 1;
    this.group.add(this.pulses);

    if (this.rich) {
      const moteGeometry = new THREE.BufferGeometry();
      moteGeometry.setAttribute(
        'position',
        new THREE.BufferAttribute(new Float32Array(MOTE_COUNT * 3), 3),
      );
      moteGeometry.setAttribute(
        'color',
        new THREE.BufferAttribute(new Float32Array(MOTE_COUNT * 3), 3),
      );
      this.motes = new THREE.Points(
        moteGeometry,
        new THREE.PointsMaterial({
          size: 0.036,
          map: radialTexture(3),
          color: PALETTE.holo,
          vertexColors: true,
          transparent: true,
          opacity: 0,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          depthTest: false,
          sizeAttenuation: true,
        }),
      );
      this.motes.renderOrder = HOLO_RENDER_ORDER + 2;
      this.motes.frustumCulled = false;
      this.motePhase = new Float32Array(MOTE_COUNT);
      this.moteAngle = new Float32Array(MOTE_COUNT);
      this.moteRadius = new Float32Array(MOTE_COUNT);
      this.moteSpeed = new Float32Array(MOTE_COUNT);
      for (let i = 0; i < MOTE_COUNT; i++) this.respawnMote(i, Math.random());
      this.group.add(this.motes);
    }

    this.group.add(
      this.face.lines,
      this.face.points,
      this.face.cloud,
      this.face.glows,
      this.beam.mesh,
      this.connectors.lines,
      this.rings.group,
      this.projection.group,
      this.portraitMesh,
      this.demo.mesh,
    );

    // Explicit render order, for the same reason these materials disable depth
    // testing: this is an overlay layer, not scenery.
    //
    // Without it the clinical room's wall — a large transparent back-side
    // surface — sorts after the holograms in the transparent queue and paints
    // straight over them. They were being drawn correctly the whole time and
    // simply losing the sort.
    let order = HOLO_RENDER_ORDER;
    this.group.traverse((child) => {
      child.renderOrder = order++;
      const material = (child as THREE.Mesh).material as
        | (THREE.Material & { fog?: boolean })
        | undefined;
      // No fog either. Haze between the camera and a wall is depth; haze over a
      // readout is just a dimmer readout.
      if (material && !Array.isArray(material)) material.fog = false;
    });
  }

  mount(parent: THREE.Object3D): void {
    parent.add(this.group);
  }

  // -------------------------------------------------------------------------
  // Placement
  // -------------------------------------------------------------------------

  /** The floor architecture still solves against the frustum. */
  setLayout(view: ViewFrustum): void {
    this.view = view;
    this.layout = solveLayout(SLOT_COUNT, view);
  }

  /**
   * The camera as it actually is this frame.
   *
   * `setLayout` is solved once against the clinical shot, and that is right
   * for the floor architecture, which must not slide about as the camera cuts.
   * But the edge clamps below — how far the projection may sit from her, where
   * its callouts have to stop — were also measured against that fixed frustum,
   * and the presenting shot is a wider lens further back. Measured against the
   * wrong frame, they pulled the callouts onto the face with half the screen
   * still empty to the right. The clamps now read the live camera.
   */
  private liveView: ViewFrustum | null = null;
  /**
   * How much room the callouts actually have beside the model, 0..1.
   *
   * In the close conversational shot the frame is too narrow for the model and
   * its labels side by side, and the edge clamp's only remaining move is to
   * park the labels on top of the face. They yield instead: when there is no
   * room beside the model they fade, and come back as the camera pulls out.
   */
  private calloutRoom = 1;
  private calloutPresence = 1;

  setViewport(view: ViewFrustum): void {
    this.liveView = view;
  }

  /**
   * Arranges the whole assembly around her.
   *
   * Called every frame the clinic is on screen rather than once, because she
   * walks to her mark and the camera travels while she does — anything placed
   * once would be attached to where she used to be.
   */
  setStage(stand: THREE.Vector3, viewer: THREE.Vector3): void {
    this.stand.copy(stand);
    this.viewer.copy(viewer);

    this.rings.place(stand);

    /*
      * The projection leans the other way, and has two edges to respect.
      *
      * It sits to her right by a fixed offset, so the aspect ratios that pushed
      * the readouts off the left pushed the hologram off the right — at 0.96
      * the body projection was half out of frame. But simply pulling it inward
      * parks it on top of her, which is worse: the demonstration figure ended
      * up standing in her chest. So it is held between two limits — never past
      * the edge of frame, never closer to her than `STAND_CLEARANCE` — and when
      * the frame is too narrow to satisfy both, the projection shrinks until it
      * is, rather than one constraint quietly losing.
      */
    const view = this.liveView ?? this.view;
    const facePosition = this.stand.clone().add(FACE_OFFSET);
    const faceExtents = extentsAt(view, Math.max(0.05, view.cameraZ - facePosition.z));
    const naturalHalfWidth = FACE_HEIGHT * 1.12 * 0.5 + DEMO_GAP * 0.5;
    /*
     * A phone is a different problem. Its frame is barely wider than she is,
     * so a projection kept a shoulder's width clear of her hangs off the side
     * of the screen. The projection sits at her head height, and a head is
     * half the width of a pair of shoulders — so in portrait the clearance is
     * measured from her head, and the model is allowed to shrink a little
     * further before it is allowed to leave the frame.
     */
    const portrait = view.aspect < 0.85;
    const nearestX = this.stand.x + (portrait ? 0.3 : STAND_CLEARANCE);
    const roomToEdge = faceExtents.halfW - EDGE_MARGIN - nearestX;
    const fit = clamp(roomToEdge / Math.max(0.001, naturalHalfWidth), portrait ? 0.5 : 0.55, 1);
    const faceH = FACE_HEIGHT * fit;
    const gap = DEMO_GAP * fit;
    // The callouts hang off the model's right side and have to fit too. They
    // do not shrink the model; they move it — the model slides left, as far as
    // her clearance allows, until its callouts are inside the frame.
    const calloutReach = faceH * CALLOUT_OFFSET + CALLOUT_W;
    const rightLimit =
      faceExtents.halfW - EDGE_MARGIN - Math.max(naturalHalfWidth * fit, calloutReach);
    facePosition.x = Math.max(nearestX, Math.min(facePosition.x, rightLimit));
    this.face.lines.position.copy(facePosition);
    this.face.lines.scale.setScalar(faceH / this.face.height);
    // Same buffer, same transform — they are one object drawn two ways.
    this.face.points.position.copy(this.face.lines.position);
    this.face.points.scale.copy(this.face.lines.scale);
    this.face.cloud.position.copy(this.face.lines.position);
    this.face.cloud.scale.copy(this.face.lines.scale);
    this.face.glows.position.copy(this.face.lines.position);
    this.face.glows.scale.copy(this.face.lines.scale);

    // The portrait occupies the same volume the contour model does, so the
    // callouts, leader lines and projection artefacts all keep their aim
    // whichever of the two is showing.
    /*
      * Both shown together, opening around the shared centre.
      *
      * Only when there is actually a pair: a demonstration with no capture
      * behind it, or a capture with nothing playing, keeps the middle.
      */
    const spread = this.demoSpread * gap * 0.5;
    this.portraitMesh.position.copy(facePosition);
    this.portraitMesh.position.x -= spread;
    /*
     * Sized from the capture's own shape, holding its height.
     *
     * A face crop is near square and a body crop is tall, so a fixed quad
     * stretches one or the other. Height is what stays constant because the
     * projection has a place in the room — it stands where it stands, and only
     * its width follows the subject.
     */
    const projectedHeight = faceH * 1.12;
    this.portraitMesh.scale.set(
      projectedHeight * Math.max(0.35, this.portrait.aspect),
      projectedHeight,
      1,
    );
    this.portraitMesh.rotation.set(
      0,
      Math.atan2(viewer.x - facePosition.x, viewer.z - facePosition.z),
      0,
    );

    if (this.faceMesh) {
      const g = this.faceMesh.group;
      g.position.copy(facePosition);
      g.position.x -= spread;
      g.scale.setScalar(faceH * 1.12);
      this.faceMesh.baseYaw = Math.atan2(viewer.x - g.position.x, viewer.z - g.position.z);
    }

    const demoAt = facePosition.clone();
    demoAt.x += spread;
    this.demo.place(demoAt, faceH * (1.24 - 0.18 * this.demoSpread), viewer);

    // The projection artefacts wrap the model and run down to the ring table,
    // which is what says the table is emitting it.
    this.projection.place(facePosition, faceH, stand.y + 1.06);
    this.projection.face(viewer);

    const half = faceH * 0.5;
    this.beam.place(
      {
        x: facePosition.x,
        z: facePosition.z + 0.02,
        width: faceH * 0.82,
        top: facePosition.y + half,
        bottom: facePosition.y - half,
      },
      {
        // The wide band crosses *her*, where she actually stands.
        x: stand.x,
        z: stand.z + 0.02,
        width: 1.0,
        top: stand.y + 1.95,
        bottom: stand.y,
      },
    );

    // Callouts sit out to the right of the model, each at the height of the
    // region it points at, with a leader line back to that exact spot.
    const leader = this.leaderPositions.array as Float32Array;
    const scale = faceH / this.face.height;
    let lastCalloutY = 0;
    for (let i = 0; i < this.activeCallouts.length; i++) {
      const anchor = REGION_ANCHORS[this.activeCallouts[i].region];
      if (!anchor) continue;
      const from = new THREE.Vector3(
        facePosition.x + anchor.x * scale,
        facePosition.y + anchor.y * scale,
        facePosition.z + anchor.z * scale,
      );
      // Out to the right of the model — but never past the edge of frame. The
      // projection grew, and at 16:9 its own callouts were the first thing to
      // fall off the side.
      const calloutX = Math.min(
        facePosition.x + faceH * CALLOUT_OFFSET,
        faceExtents.halfW - EDGE_MARGIN - CALLOUT_W,
      );
      if (i === 0) {
        // Fully there once the labels start clear of the model's edge, gone
        // once they would sit over its centre.
        const clearAt = facePosition.x + faceH * 0.46;
        this.calloutRoom = clamp((calloutX - clearAt) / (faceH * 0.16) + 1);
      }
      const to = new THREE.Vector3(
        calloutX,
        // Never closer to the previous label than a label is tall. The anchors
        // come from the face, and the face puts the eye and cheek regions
        // within a couple of centimetres of each other — which is correct
        // anatomy and two labels printed on top of each other.
        i === 0 ? from.y : Math.min(from.y, lastCalloutY - CALLOUT_H * 0.92),
        facePosition.z + 0.04,
      );
      lastCalloutY = to.y;
      this.callouts[i].place(
        new THREE.Vector3(to.x + CALLOUT_W * 0.5, to.y, to.z),
        viewer,
      );
      leader.set([from.x, from.y, from.z, to.x, to.y, to.z], i * 6);
    }
    // Collapse the unused leader lines onto a point rather than leaving them
    // wherever the last scan put them.
    for (let i = this.activeCallouts.length; i < MAX_CALLOUTS; i++) {
      leader.set([0, 0, 0, 0, 0, 0], i * 6);
    }
    this.leaderPositions.needsUpdate = true;
    this.leaders.geometry.computeBoundingSphere();

    /*
      * Hold the column inside the frame.
      *
      * `slotPosition` returns where the readouts would like to sit, which is a
      * fixed offset from her and therefore correct at exactly one aspect ratio.
      * This is the correction: work out how wide the frame actually is at the
      * column's depth and, if the column would hang off the left edge, slide it
      * in far enough to fit. Wide windows are unaffected — the clamp only bites
      * when it has to, so the composition that was designed is the composition
      * that ships wherever there is room for it.
      *
      * The frustum is centred on the camera's axis, which the clinical shot
      * keeps at x ≈ 0, so half-width either side of zero is the usable span.
      */
    const columnZ = stand.z + COLUMN_Z;
    const columnExtents = extentsAt(view, Math.max(0.05, view.cameraZ - columnZ));
    const widestCard = Math.max(HEADLINE_W, STRIP_W);
    const leftLimit = -columnExtents.halfW + EDGE_MARGIN + widestCard / 2;
    const wantedCentre = stand.x + COLUMN_LEFT + widestCard / 2;
    // Never so far in that the column reaches her.
    const maxShift = Math.max(0, stand.x - COLUMN_CLEARANCE - (stand.x + COLUMN_LEFT + widestCard));
    const columnShift = Math.min(maxShift, Math.max(0, leftLimit - wantedCentre));

    const targets = [];
    for (let i = 0; i < this.cards.length; i++) {
      const slot = slotPosition(i);
      const position = new THREE.Vector3(
        stand.x + slot[0] + columnShift,
        stand.y + slot[1],
        stand.z + slot[2],
      );
      this.cards[i].place(position, viewer);
      targets.push({ position, yaw: 0, scale: 1 });
    }

    // Threads leave her sternum and run out to each panel, so the information
    // reads as coming from her rather than as decoration hung around her.
    const from = new THREE.Vector3(stand.x, stand.y + 1.32, stand.z + 0.08);
    this.connectors.place(from, targets.slice(0, CONNECTOR_COUNT));
  }

  /**
   * Plays a demonstration, or clears the one playing.
   *
   * Deliberately not automatic on `presentBody`: the reading and the remedy are
   * two separate beats, and running them together means the figure starts
   * moving while she is still saying what she found.
   */
  async showDemo(clip: Parameters<HoloDemo['play']>[0]): Promise<void> {
    await this.demo.play(clip);
  }

/**
   * Where the projection is standing, in world space.
   *
   * Exposed so the director can point her eyes at it. The mesh itself stays
   * private: what the outside needs is the place, not the object.
   */
  projectionPoint(into: THREE.Vector3): THREE.Vector3 {
    return this.portraitMesh.getWorldPosition(into);
  }

  /** The demonstration for the strongest body finding that has one. */
  demoForBody(metrics: Parameters<typeof firstBodyDemo>[0]) {
    return firstBodyDemo(metrics);
  }

  /**
   * Hands over the frame the measurements were taken from.
   *
   * Everything downstream of this is the difference between projecting a face
   * and projecting a diagram. Safe to call before or after `present`: whichever
   * arrives second re-renders with what the other left behind.
   */
  async setCapture(base64: string | null): Promise<void> {
    if (!base64) {
      // Clearing an existing portrait swaps the subject back to the contour
      // model, which is as much a re-sync as a new capture arriving.
      if (this.portrait.ready) this.resyncSpike();
      this.portrait.clear();
      return;
    }
    this.resyncSpike();
    // The analysis goes in with the capture so the portrait renders once. If
    // `present` has not run yet this is null, and `present` will render it —
    // which is the "whichever arrives second" contract above, unchanged.
    await this.portrait.setCapture(base64, this.lastAnalysis);
  }

  /**
   * Lights the region of the contour model a readout was measured from. That
   * link is the whole reason the model is on screen.
   */
  setFocus(index: number | null): void {
    this.focused = index;
    this.connectors.setFocus(index === null ? null : index % CONNECTOR_COUNT);
    this.face.setRegionFocus(index === null ? null : (this.slotKeys[index] ?? null));
  }

  // -------------------------------------------------------------------------
  // Content
  // -------------------------------------------------------------------------

  /** Beat 7 — the reading resolves onto the panels. */
  present(analysis: SkinAnalysis, previous: SkinAnalysis | null): void {
    // Only what this scan actually found, which can legitimately be nothing.
    const findings = selectFindings(analysis, previous);
    const chosen = findings.map((f) => f.key);
    /*
     * What each reading actually says, in words, and where it was seen.
     *
     * Computed here rather than in the card so the same description is
     * available to anything else that has to speak about this scan — the
     * readout and Elohim must never disagree about what was found.
     */
    const observations = observationsFor(analysis.metrics, analysis.regions ?? {});
    const concerns = hasIssues(findings);
    const headline = concerns ? headlineOf(chosen, analysis, previous) : null;

    this.lastAnalysis = analysis;
    this.lastPrevious = previous;
    if (this.portrait.ready) this.portrait.render(analysis);

    if (!headline) {
      /*
       * A clean scan is a result, not an empty state.
       *
       * The display used to guarantee six readings, so it could never say this
       * — it would pick the six least-good numbers on a perfectly good face and
       * present them as findings. One card that says nothing is flagged is a
       * more useful and more honest thing to look at than six that say the
       * equivalent of "your chin is a chin".
       */
      /*
       * Strengths still get their strips: "nothing is wrong" is more useful
       * with "and these two things are notably good" under it. What they do not
       * get is the headline, or a leader line onto the face — the annotations
       * are for things worth looking at, and a good reading is not one.
       */
      this.slotKeys = chosen;
      this.activeCallouts = [];
      this.faceMesh?.highlightRegions([]);
      this.cards[0]?.drawHeadline(
        'nothing flagged',
        'All clear',
        Math.round(averageGoodness(analysis)),
        '',
        'All readings in normal range.',
        TONE_GOOD,
        clamp(averageGoodness(analysis) / 100),
      );
      chosen.forEach((key, i) => {
        this.cards[i + 1]?.drawMetric(
          METRIC_LABELS[key],
          analysis.metrics[key],
          'good',
          TONE_GOOD,
          clamp(analysis.metrics[key] / 100),
        );
      });
      for (let i = chosen.length + 1; i < this.cards.length; i++) this.cards[i]?.blank();
      this.face.highlightMetrics([], 0);
      return;
    }

    // The strongest finding takes the big card; the rest fall in behind it.
    this.slotKeys = [headline.key, ...chosen.filter((k) => k !== headline.key)];

    this.slotKeys.forEach((key, i) => {
      const card = this.cards[i];
      if (!card) return;

      const value = analysis.metrics[key];
      const prev = previous?.metrics[key];
      const delta = prev === undefined ? null : value - prev;
      const significant = delta !== null && Math.abs(delta) >= METRIC_NOISE_FLOOR[key];

      let tone: CardTone = TONE_NEUTRAL;
      let movement = 'first reading';
      if (delta !== null) {
        if (!significant) {
          movement = 'holding steady';
        } else {
          const better = METRIC_HIGHER_IS_BETTER[key] ? delta > 0 : delta < 0;
          tone = better ? TONE_GOOD : TONE_BAD;
          // Whole points only. A tenth of a point is precision this pipeline
          // does not have.
          movement = `${delta > 0 ? '+' : '−'}${Math.abs(Math.round(delta))} since last`;
        }
      }

/*
       * The finding, not the score.
       *
       * "Pores 49" cannot be read by the person it is shown to — 49 against
       * what? — and set in 96px it claims a precision the measurement does not
       * have. The band is printed where the number used to be, the place it was
       * seen goes underneath, and the number itself stays in the record for the
       * trend to compare next month.
       *
       * A reading clamped to either end prints "Off scale" rather than 100,
       * because a pinned scale means the signal left the calibrated range —
       * which is a refusal to answer, not the most extreme possible answer.
       */
      const observed = observations.find((o) => o.key === key);
      const display = observed
        ? { value: observed.severityLabel, unit: '' }
        : undefined;
      // A location if there is one, then the band's own explanation, then the
      // headline's sentence — first thing that actually says something.
      const note =
        observed?.locus ?? (observed ? EXPLANATION[observed.severity] : undefined) ?? headline.note;

      if (i === 0) {
        card.drawHeadline(
          headline.eyebrow,
          METRIC_LABELS[key],
          value,
          movement,
          note,
          tone,
          // A band has no fill level, and a pinned reading least of all.
          observed && observed.severity === 'beyond-range' ? 0 : clamp(value / 100),
          display,
        );
      } else {
        card.drawMetric(
          METRIC_LABELS[key],
          value,
          movement,
          tone,
          observed && observed.severity === 'beyond-range' ? 0 : clamp(value / 100),
          display,
        );
      }
      // The threads speak the same three tones as the cards they run to —
      // they used to carry their own green, a fourth voice nothing else used.
      this.connectors.setTint(
        i % CONNECTOR_COUNT,
        new THREE.Color(
          tone === TONE_GOOD ? PALETTE.good : tone === TONE_BAD ? PALETTE.bad : PALETTE.holo,
        ),
      );
    });

    /*
     * The zone labels come from the findings, so the face is annotated with what
     * was actually found on it and nothing else. Each carries its own number:
     * naming a site without saying what was measured there is pointing, not
     * reporting.
     */
    // Only concerns and movements are annotated on the face. A leader line
    // pointing at an excellent reading is drawing attention to nothing.
    const lit = chosen
      .map((key) => {
        const value = analysis.metrics[key];
        const prev = previous?.metrics[key];
        const delta = prev === undefined ? null : value - prev;
        const significant = delta !== null && Math.abs(delta) >= METRIC_NOISE_FLOOR[key];
        const better = delta !== null && (METRIC_HIGHER_IS_BETTER[key] ? delta > 0 : delta < 0);
        const region = METRIC_FACE_REGIONS[key]?.[0];
        return {
          region: region as FaceRegionKey,
          tone: !significant ? ('neutral' as const) : better ? ('good' as const) : ('bad' as const),
        };
      })
      .filter((r) => Boolean(r.region));
    this.startReveal(lit);
    this.activeCallouts = calloutsFor(
      findings.filter((f) => f.kind !== 'strength').map((f) => f.key),
    );
    this.activeCallouts.forEach((callout, i) => {
      this.callouts[i]?.drawCallout(
        callout.title,
        METRIC_LABELS[callout.metric],
        analysis.metrics[callout.metric],
      );
    });

    // Cards past the findings carry nothing. Left alone they would still be
    // showing the previous scan's numbers under this scan's headline.
    for (let i = this.slotKeys.length; i < this.cards.length; i++) {
      this.cards[i]?.blank();
    }

    this.setFocus(null);
    // The regions the reading came from stay lit while the result is up.
    this.face.highlightMetrics(this.activeCallouts.map((c) => c.metric), 0.85);
  }

  /**
   * A body reading on the same rack.
   *
   * The cards, the portrait and the projection are all subject-agnostic — a
   * card shows a label and a number, the portrait contours whatever image it
   * was given. What differs is the vocabulary, so this is a parallel method
   * rather than a branch inside `present`: keeping them apart is what stops a
   * shoulder ratio ever being handed to something expecting a skin metric.
   *
   * No callouts. The face zones are anatomical rectangles on a canonical crop;
   * a body has no equivalent, and pointing a leader line at an arbitrary spot
   * on a torso would be decoration claiming to be a measurement.
   */
  presentBody(analysis: BodyAnalysis, previous: BodyAnalysis | null): void {
    // A body scan captured a body. Whatever face was projected is stale.
    this.setFaceMesh(null);
    const findings = selectBodyFindings(analysis, previous);

    /*
     * The two families of reading, looked up through one door.
     *
     * Posture metrics come from the front frame and the abdominal profile from
     * the side one, measured by different code against different model
     * versions. They are shown on the same cards, so the lookups are gathered
     * here rather than scattered through the render — and the profile keeps its
     * own noise floor, which is wider than any posture metric's for reasons
     * written down where it is defined.
     */
    const readingOf = (key: AnyBodyMetricKey, from: BodyAnalysis | null): number | undefined => {
      if (!from) return undefined;
      return isProfileKey(key) ? from.profile?.[key] : from.metrics[key];
    };
    const labelOf = (key: AnyBodyMetricKey) =>
      isProfileKey(key) ? PROFILE_METRIC_LABELS[key] : BODY_METRIC_LABELS[key];
    const floorOf = (key: AnyBodyMetricKey) =>
      isProfileKey(key) ? PROFILE_NOISE_FLOOR[key] : BODY_NOISE_FLOOR[key];
    const betterHigh = (key: AnyBodyMetricKey) =>
      isProfileKey(key) ? PROFILE_HIGHER_IS_BETTER[key] : BODY_HIGHER_IS_BETTER[key];
    this.activeCallouts = [];
    this.slotKeys = [];
    this.face.highlightMetrics([], 0);
    if (this.portrait.ready) this.portrait.render(null);

    if (findings.length === 0) {
      this.cards[0]?.drawHeadline(
        'nothing flagged',
        'Posture is even',
        Math.round(bodyAverage(analysis.metrics)),
        '',
        'Shoulders, hips and head are level.',
        TONE_GOOD,
        clamp(bodyAverage(analysis.metrics) / 100),
      );
      for (let i = 1; i < this.cards.length; i++) this.cards[i]?.blank();
      return;
    }

    findings.forEach((finding, i) => {
      const card = this.cards[i];
      if (!card) return;
      const value = readingOf(finding.key, analysis) ?? 0;
      const prev = readingOf(finding.key, previous);
      const delta = prev === undefined ? null : value - prev;
      const significant = delta !== null && Math.abs(delta) >= floorOf(finding.key);

      let tone: CardTone = TONE_NEUTRAL;
      let movement = 'first reading';
      if (delta !== null) {
        if (!significant) {
          movement = 'holding steady';
        } else {
          const better = betterHigh(finding.key) ? delta > 0 : delta < 0;
          tone = better ? TONE_GOOD : TONE_BAD;
          movement = `${delta > 0 ? '+' : '−'}${Math.abs(Math.round(delta))} since last`;
        }
      }

      const label = labelOf(finding.key);
      if (i === 0) {
        /*
         * A tracked reading is not a problem and must not be dressed as one.
         *
         * The abdominal profile is on the card because the user turned sideways
         * to have it measured, not because anything is wrong with it — so it
         * gets its own eyebrow and its own sentence, and the first one says
         * plainly that the number is a starting point rather than a verdict.
         */
        const eyebrow =
          finding.kind === 'movement'
            ? 'biggest change'
            : finding.kind === 'tracked'
              ? 'measured'
              : 'worth working on';
        const note =
          finding.kind === 'movement'
            ? 'Your largest change this scan.'
            : finding.kind === 'tracked'
              ? delta === null
                ? 'Baseline — belly depth against chest.'
                : 'Steady since your last scan.'
              : 'The posture reading furthest from level.';
        /*
         * The abdominal reading is printed as what it is: a proportion.
         *
         * "7 /100" under a filled bar is a grade, and this is the one number in
         * the app most likely to be read as a verdict on someone's body. The
         * measurement itself — torso depth at the belly against depth at the
         * chest — carries no such implication, so that is what the card shows.
         */
        const ratio = analysis.profileDetail?.depthRatio;
        const display =
          isProfileKey(finding.key) && ratio !== undefined
            ? { value: ratio.toFixed(2), unit: '× chest' }
            : undefined;
        card.drawHeadline(
          eyebrow,
          label,
          value,
          movement,
          note,
          tone,
          clamp(value / 100),
          display,
        );
      } else {
        card.drawMetric(label, value, movement, tone, clamp(value / 100));
      }
    });

    for (let i = findings.length; i < this.cards.length; i++) this.cards[i]?.blank();
  }

  /**
   * Fills the routine view. Ingredients and steps, never brands — the plan the
   * server produced already refuses to name products, and this only renders it.
   */
  setPlan(plan: RoutinePlan | null): void {
    this.plan = plan;
    if (!plan) return;
    plan.suggestions.slice(0, this.cards.length).forEach((suggestion, i) => {
      // The first step gets the headline card, which has the room for the
      // reasoning. The rest are strips: order, name, actives.
      if (i === 0) {
        this.cards[i].drawStep(
          suggestion.step,
          suggestion.title,
          suggestion.actives.join(' · '),
          suggestion.because
            ? `because ${suggestion.because.label.toLowerCase()} is ${suggestion.because.value}`
            : 'always worth it',
          TONE_NEUTRAL,
        );
      } else {
        this.cards[i].drawStepStrip(
          i,
          suggestion.step,
          suggestion.title,
          suggestion.actives.join(' · '),
          TONE_NEUTRAL,
        );
      }
    });
  }

  /**
   * Swaps the panels from the readings to the plan.
   *
   * The payoff the whole clinical sequence is built for: the numbers she just
   * explained become the thing to do about them.
   */
  setMode(mode: PanelMode): void {
    this.modeTarget = mode === 'routine' ? 1 : 0;
    if (mode === 'routine') this.setPlan(this.plan);
    /*
     * Back to the reading means back to the readings.
     *
     * The plan is drawn onto the same cards as the metrics, and switching
     * back only moved the wipe — the cards kept saying "Step 1 · Treat" under
     * a heading that said "What I see". Redrawn from the scan they came from.
     */
    if (mode === 'scan' && this.lastAnalysis) this.present(this.lastAnalysis, this.lastPrevious);
  }

  /**
   * Builds the 3D face from the active in-memory capture mesh, or clears it.
   *
   * Called before `present`, so the region lights the reading turns on land
   * on a face that is already there.
   */
  setFaceMesh(mesh: ScanMesh | null): void {
    // Only when the subject actually changes: presentBody clears an already
    // absent mesh on every call, and a spike there would fire on nothing.
    if (this.faceMesh || mesh) this.resyncSpike();
    if (this.faceMesh) {
      this.faceMesh.dispose();
      this.faceMesh = null;
    }
    if (!mesh) return;
    this.faceMesh = new HoloFaceMesh3D(mesh, HOLO_RENDER_ORDER + 3);
    this.group.add(this.faceMesh.group);
  }

  get mode(): PanelMode {
    return this.modeTarget >= 0.5 ? 'routine' : 'scan';
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  boot(): void {
    this.presenceTarget = 1;
    this.sweepT = 0;
  }

  /** Puts a mote back at the rim of the field, `phase` of the way through its rise. */
  private respawnMote(i: number, phase = 0): void {
    this.motePhase[i] = phase;
    this.moteAngle[i] = Math.random() * Math.PI * 2;
    this.moteRadius[i] = 0.16 + Math.random() * 0.34;
    this.moteSpeed[i] = 0.09 + Math.random() * 0.12;
  }

  /**
   * The ambient life, one frame.
   *
   * Everything here is positioned from where the field and the face actually
   * are this frame, so it follows her mark and the shot like the rest.
   */
  /**
   * Begins lighting `items` one at a time. The first lands after a short
   * beat - the head has to lift first - and the rest follow at REVEAL_STEP.
   * Calling it again replaces the sequence, which is what a re-present wants.
   */
  private startReveal(
    items: Array<{ region: FaceRegionKey; tone: 'good' | 'bad' | 'neutral' }>,
  ): void {
    this.faceMesh?.highlightRegions([]);
    if (!items.length) {
      this.reveal = null;
      return;
    }
    this.reveal = { items, shown: 0, timer: REVEAL_LEAD, step: REVEAL_STEP };
  }

  /** Seconds until each region is lit; the caller uses it to pace her words. */
  revealSchedule(count: number): number[] {
    return Array.from({ length: count }, (_, i) => REVEAL_LEAD + i * REVEAL_STEP);
  }

  private updateReveal(dt: number): void {
    const reveal = this.reveal;
    if (!reveal) return;
    reveal.timer -= dt;
    if (reveal.timer > 0) return;
    reveal.shown++;
    this.faceMesh?.highlightRegions(reveal.items.slice(0, reveal.shown));
    sound.tick(1 + reveal.shown * 0.05);
    if (reveal.shown >= reveal.items.length) {
      this.reveal = null;
      return;
    }
    reveal.timer = reveal.step;
  }

  private updateLife(dt: number, elapsed: number, presence: number, faceP: number): void {
    const field = this.rings.group.position;

    this.updateReveal(dt);

    // The sweep: once, across the room, on boot.
    if (this.sweepT >= 0) {
      this.sweepT += dt / SWEEP_SECONDS;
      const t = this.sweepT;
      if (t >= 1) {
        this.sweepT = -1;
        this.sweep.visible = false;
        (this.sweep.material as THREE.MeshBasicMaterial).opacity = 0;
      } else {
        const x = field.x - 1.9 + t * 3.8;
        this.sweep.position.set(x, 1.35, this.stand.z + 0.25);
        this.sweep.rotation.set(
          0,
          Math.atan2(this.viewer.x - x, this.viewer.z - this.sweep.position.z),
          0,
        );
        this.sweep.visible = true;
        (this.sweep.material as THREE.MeshBasicMaterial).opacity =
          Math.sin(t * Math.PI) * 0.85;
      }
    }

    // The motes: lifting off the field, brightest mid-rise.
    if (this.motes) {
      const pos = this.motes.geometry.getAttribute('position') as THREE.BufferAttribute;
      const col = this.motes.geometry.getAttribute('color') as THREE.BufferAttribute;
      for (let i = 0; i < MOTE_COUNT; i++) {
        this.motePhase[i] += dt * this.moteSpeed[i];
        if (this.motePhase[i] >= 1) this.respawnMote(i);
        const ph = this.motePhase[i];
        const a = this.moteAngle[i] + elapsed * 0.05;
        const r = this.moteRadius[i] * (1 - ph * 0.25);
        pos.setXYZ(
          i,
          field.x + Math.cos(a) * r,
          field.y + ph * MOTE_RISE,
          field.z + Math.sin(a) * r * 0.55,
        );
        const bright = Math.sin(ph * Math.PI) * (0.55 + 0.45 * Math.sin(elapsed * 3 + i));
        col.setXYZ(i, bright, bright, bright);
      }
      pos.needsUpdate = true;
      col.needsUpdate = true;
      (this.motes.material as THREE.PointsMaterial).opacity = presence * 0.9;
      this.motes.visible = presence > 0.02;
    }

    // The pulses: a bead per live leader, face to label.
    const leader = this.leaderPositions.array as Float32Array;
    const pos = this.pulses.geometry.getAttribute('position') as THREE.BufferAttribute;
    const col = this.pulses.geometry.getAttribute('color') as THREE.BufferAttribute;
    const live = this.activeCallouts.length;
    for (let i = 0; i < MAX_CALLOUTS; i++) {
      if (i >= live) {
        pos.setXYZ(i, 0, -10, 0);
        col.setXYZ(i, 0, 0, 0);
        continue;
      }
      this.pulseT[i] = (this.pulseT[i] + dt / PULSE_SECONDS) % 1;
      const t = this.pulseT[i];
      const o = i * 6;
      pos.setXYZ(
        i,
        leader[o] + (leader[o + 3] - leader[o]) * t,
        leader[o + 1] + (leader[o + 4] - leader[o + 1]) * t,
        leader[o + 2] + (leader[o + 5] - leader[o + 2]) * t,
      );
      const bright = Math.sin(t * Math.PI);
      col.setXYZ(i, bright, bright * 0.95, bright);
    }
    pos.needsUpdate = true;
    col.needsUpdate = true;
    (this.pulses.material as THREE.PointsMaterial).opacity = faceP * this.calloutPresence;
    this.pulses.visible = live > 0 && faceP > 0.02;
  }

  shutdown(): void {
    this.presenceTarget = 0;
    this.scanProgress = 0;
    this.setFocus(null);
  }

  setScanProgress(progress: number): void {
    this.scanProgress = clamp(progress);
    this.beam.setProgress(this.scanProgress);
  }

  update(dt: number, elapsed: number): void {
    const rate = this.presenceTarget > this.presence ? 1 / 1.35 : 1 / 0.5;
    this.presence +=
      Math.sign(this.presenceTarget - this.presence) *
      Math.min(rate * dt, Math.abs(this.presenceTarget - this.presence));

    if (this.presence < 0.002) {
      this.group.visible = false;
      return;
    }
    this.group.visible = true;

    this.updateGlitch(dt);

    const delta = this.modeTarget - this.modeBlend;
    this.modeBlend += Math.sign(delta) * Math.min(dt / 0.7, Math.abs(delta));

    // Staged cascade. Each stage is a window onto the same presence curve, so
    // the boot stays in sync even if a frame is dropped — and plays in reverse
    // on the way out for free.
    //
    // The order is the sequence the product is selling: the platform lights
    // under her, the contour model resolves, threads reach out, and only then
    // do the numbers arrive.
    const p = this.presence;
    const ringP = smoothstep(p * 2.8);
    const faceP = smoothstep((p - 0.18) * 2.4);
    const connectorP = smoothstep((p - 0.34) * 2.6);
    const cardP = smoothstep((p - 0.46) * 2.2);

    this.rings.setReveal(ringP);
    this.projection.setPresence(faceP);

    /*
     * The portrait replaces the contour model rather than layering over it.
     *
     * Two heads in the same volume is worse than either alone — the wireframe
     * reads as a cage around the face instead of as its structure. The abstract
     * model earns its place only when there is no capture to show.
     */
    this.demo.update(dt);
    /*
     * The two make room for each other rather than one deleting the other.
     *
     * Damped rather than snapped: the figure arriving is a beat in her
     * explanation, and the projection sliding a hand's width aside to admit it
     * reads as the room making space. Jumping reads as a bug.
     */
    const paired = this.portrait.ready && this.demo.playing;
    this.demoSpread = damp(this.demoSpread, paired ? 1 : 0, 3.2, dt);

    const showPortrait = this.portrait.ready;
    // Behind a 3D face the photograph becomes a ghost: enough to give the
    // lattice a face to sit on when it turns to the front, never a competitor.
    (this.portraitMesh.material as THREE.Material & { opacity: number }).opacity = showPortrait
      ? faceP * (this.faceMesh ? 0.3 : 1)
      : 0;
    if (this.faceMesh) {
      this.faceMesh.setPresence(faceP);
      this.faceMesh.update(dt, elapsed, this.glitch);
    }
    this.portraitMesh.visible = showPortrait && faceP > 0.01;
    this.face.setReveal(faceP);

    for (let i = 0; i < this.cards.length; i++) {
      // One after another rather than all together — a bank of panels that
      // arrives in a single frame reads as a texture, not as a system starting.
      const offset = (i / Math.max(1, this.cards.length - 1)) * 0.4;
      this.cards[i].setReveal(smoothstep((cardP - offset) * 2.6));
      this.connectors.setDraw(i, smoothstep((connectorP - offset * 0.8) * 2.2));
    }

    // The callouts arrive with the model, not with the numbers — they are part
    // of what the model *is*, not a layer of commentary on top of it.
    const activeCount = this.activeCallouts.length;
    this.calloutPresence = damp(this.calloutPresence, this.calloutRoom, 5, dt);
    for (let i = 0; i < this.callouts.length; i++) {
      const live = i < activeCount;
      const offset = (i / Math.max(1, activeCount - 1)) * 0.3;
      this.callouts[i].setReveal(
        live ? smoothstep((faceP - offset) * 2.6) * this.calloutPresence : 0,
      );
      this.callouts[i].update(dt, elapsed, 1, i + 10, this.glitch);
    }
    (this.leaders.material as THREE.Material & { opacity: number }).opacity =
      faceP * 0.5 * this.calloutPresence;

    this.rings.update(dt, elapsed, 1);
    this.projection.update(elapsed, this.glitch);
    /*
     * The contour model steps aside for the portrait.
     *
     * Two heads in the same volume is worse than either alone: the wireframe
     * stops reading as the face's structure and starts reading as a cage around
     * it. The abstract model earns its place only when there is nothing to
     * project — before the first scan, when showing a face would mean showing
     * one nobody captured.
     */
    const abstractP = this.portrait.ready || this.faceMesh ? 0 : faceP;
    this.face.update(dt, elapsed, abstractP, this.scanProgress, this.glitch);
    // Points carry most of the brightness; the wires are the structure under
    // them and stay quieter than they were when they were the only layer.
    // The sparse layer sat on the wire vertices and only ever reinforced the
    // lattice. The dense cloud replaced it; this stays dim as a highlight.
    (this.face.points.material as THREE.Material & { opacity: number }).opacity = abstractP * 0.2;
    this.face.points.visible = abstractP > 0.01;
    this.connectors.update(elapsed, connectorP * 0.35, this.glitch);
    this.beam.update(dt, elapsed, faceP);
    this.updateLife(dt, elapsed, p, faceP);
    // The cards share the rig's corruption rather than flickering on their
    // own: steady panels, dipping only when everything else glitches with
    // them, are what make the glitch read as one projector.
    for (let i = 0; i < this.cards.length; i++) {
      this.cards[i].update(dt, elapsed, 1, i, this.glitch);
    }
  }

  /**
   * A projection is never perfectly stable — but nearly.
   *
   * The ambient blips are rare and small: at the old cadence, every five to
   * fourteen seconds at up to full strength, the instrument read as broken
   * rather than believable. Full-strength corruption is reserved for
   * `resyncSpike`, the moment the projection changes subject, where it lands
   * as the projector re-syncing rather than as a fault.
   */
  private updateGlitch(dt: number): void {
    if (this.glitch > 0) {
      this.glitch = Math.max(0, this.glitch - dt * 7);
      return;
    }
    this.glitchTimer -= dt;
    if (this.glitchTimer <= 0) {
      this.glitchTimer = 14 + Math.random() * 18;
      this.glitch = 0.15 + Math.random() * 0.25;
    }
  }

  /**
   * One full-strength glitch, spent only when the projected subject is
   * swapped. Corruption that lands exactly as the image changes reads as the
   * machine re-locking onto a new subject; the same corruption at random
   * reads as the machine failing, which is why the ambient cadence above
   * never reaches this amplitude.
   */
  private resyncSpike(): void {
    this.glitch = 1;
  }

  /** The solved layout, for anything that still needs the frustum fallback. */
  get placement(): LayoutResult {
    return this.layout;
  }

  /** Which metric readout currently has focus, if any. */
  get focusedMetric(): SkinMetricKey | null {
    return this.focused === null ? null : (this.slotKeys[this.focused] ?? null);
  }

  dispose(): void {
    this.faceMesh?.dispose();
    this.sweep.geometry.dispose();
    (this.sweep.material as THREE.Material).dispose();
    this.pulses.geometry.dispose();
    (this.pulses.material as THREE.Material).dispose();
    if (this.motes) {
      this.motes.geometry.dispose();
      (this.motes.material as THREE.Material).dispose();
    }
    this.face.dispose();
    this.beam.dispose();
    this.connectors.dispose();
    this.rings.dispose();
    this.projection.dispose();
    this.portrait.dispose();
    this.demo.dispose();
    this.portraitMesh.geometry.dispose();
    (this.portraitMesh.material as THREE.Material).dispose();
    for (const card of this.cards) card.dispose();
    for (const card of this.callouts) card.dispose();
    this.leaders.geometry.dispose();
    (this.leaders.material as THREE.Material).dispose();
    this.group.removeFromParent();
  }
}
