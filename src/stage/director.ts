/**
 * The stage director's contract.
 *
 * The controller and the voice pipeline direct her through this surface and
 * nothing else: what she is doing, which face she is making, when her mouth
 * moves, which room she is in and what the hologram is showing. It replaces
 * the three.js `SessionDirector` method for method, so the application glue
 * did not have to learn a new vocabulary when the renderer went away.
 *
 * Nothing here draws. The implementation (`director.svelte.ts`) keeps two
 * reactive records - `character` for the SVG figure and `hologram` for the
 * scan page - and the components that draw read them. See `README.md` in
 * this folder for what each field means to the people drawing from it.
 *
 * The contract's own imports are type-only, so `import type` from this file
 * costs nothing at runtime - which is how the controller and the voice
 * pipeline take it, keeping them free of the implementation. The one value
 * here is the re-export of the singleton at the bottom, for the components
 * that read it; importing `director` loads the implementation, the session
 * store and `lib/sound.ts` with it.
 */
import type { BodyAnalysis } from '@/body-analysis/pipeline.ts';
import type { SpeechTrackLike, Viseme } from '@/character/speech.ts';
import type { ScanMesh } from '@/scan/mesh.ts';
import type { ScanSentiment } from '@/scan/choreography.ts';
import type { TourCaps, TourView } from './tour-machine.ts';
import type {
  CharacterDirective,
  CharacterState,
  Expression,
  Gesture,
  SkinAnalysis,
  SkinMetricKey,
} from '@shared/types.ts';

export type { ScanSentiment };
export type { TourView, TourStep, TourSide, TourBeat, TourCaps } from './tour-machine.ts';

/** What her stage (and the page) report to the consult tour (specs/consult-tour.md 5.3). */
export type TourReport =
  | { kind: 'contact'; seq: number } // her fingertip met the spot (her stage)
  | { kind: 'figure'; present: boolean; caps: TourCaps }; // her stage appeared / went (her stage or the page)

/** Where a tap landed on her: her face, or the rest of her. */
export type PokeZone = 'face' | 'body';

/** What she is paying attention to when nothing more specific has her eye. */
export type Attention = 'viewer' | 'hologram';

/** A gesture she is actually making. `'none'` is published as `null`. */
export type ActiveGesture = Exclude<Gesture, 'none'>;

/** What the SVG figure draws from. Every field is reactive. */
export interface CharacterView {
  /** The character state from `shared/character-fsm.ts`, after its transition rules. */
  readonly state: CharacterState;
  readonly expression: Expression;
  /** The gesture being made, or null at rest. */
  readonly gesture: ActiveGesture | null;
  /**
   * Bumped every time a gesture is (re)started, including the same gesture
   * twice - a second nod is a second nod. Key a gesture animation on it.
   */
  readonly gestureSeq: number;
  /** How strongly to play the expression, 0..1. */
  readonly intensity: number;
  /** True while a voice is audibly speaking through her mouth. */
  readonly speaking: boolean;
  /** The mouth shape the speech track is on; `'sil'` when closed. */
  readonly viseme: Viseme;
  /** How far into that shape, 0..1. Zero whenever nothing audible is playing. */
  readonly mouthOpen: number;
  /** Where she looks, -1..1 each way from straight at the viewer: x toward the viewer's right, y down. */
  readonly gazeX: number;
  readonly gazeY: number;
  readonly attention: Attention;
}

/** A body reading on display, with the one it is compared against. */
export interface BodyPresentation {
  analysis: BodyAnalysis;
  previous: BodyAnalysis | null;
}

/** What the scan page's hologram draws from. Every field is reactive; nothing here outlives the session. */
export interface HologramView {
  /** The live face mesh from this capture. Cleared by the controller when the presentation ends. */
  readonly mesh: ScanMesh | null;
  /** The skin reading being presented, and the one before it. */
  readonly analysis: SkinAnalysis | null;
  readonly previous: SkinAnalysis | null;
  /** How the reading moved, as her delivery reads it. Null until something is presented. */
  readonly sentiment: ScanSentiment | null;
  readonly body: BodyPresentation | null;
  /** The metrics her narration names, in the order they light. */
  readonly revealQueue: readonly SkinMetricKey[];
  /** The ones lit so far - always a prefix of `revealQueue`, plus any she named out of order. */
  readonly revealed: readonly SkinMetricKey[];
  /** The metric she is talking about right now. A metric key, not a face region. */
  readonly activeRegion: SkinMetricKey | null;
  /** The measured frame as a data URL, in memory only, for as long as the reading is on screen. */
  readonly capture: string | null;
  /** A demonstration to play. Nothing supplies one today; see `demoForBody`. */
  readonly demo: unknown | null;
}

export interface Director {
  readonly character: CharacterView;
  readonly hologram: HologramView;
  /**
   * What the consult tour is doing (the region-by-region walkthrough on the Scan page). Reactive.
   * Written only by the tour runner (`src/stage/tour.svelte.ts`, through `publishTour`).
   */
  readonly tour: TourView;

  /** A tap landed on her. Installed by the controller. */
  onPoked: ((zone: PokeZone) => void) | null;
  /** A metric on the hologram was picked. Installed by the controller. */
  onMetricPicked: ((key: SkinMetricKey) => void) | null;
  /** She has been visibly thinking for a long while. Installed by the controller. */
  onLongThink: (() => void) | null;
  /** Her stage's (and the page's) reports to the tour. Installed by the tour runner at attach. */
  onTourReport: ((report: TourReport) => void) | null;

  // --- the conversation ---------------------------------------------------
  /** Adopts a directive, through the state machine's transition rules. */
  applyDirective(directive: CharacterDirective): void;
  userIsTyping(): void;
  userSubmitted(): void;
  /**
   * She answers: adopt the turn's directive and start the line's timing with
   * her lips shut. 'keep' leaves a running track alone (the intro narrating).
   */
  elohimSpoke(directive: CharacterDirective, text: string, mouth?: 'wait' | 'keep'): void;
  /** Hands the mouth to a track driven by real audio or real word timing. */
  useSpeechTrack(track: SpeechTrackLike): void;
  /** Closes the mouth; the line's timing runs on, muted. */
  stopMouth(): void;

  // --- rooms --------------------------------------------------------------
  /** Lounge to consult room: `session.sceneMode` goes 'transitioning', then 'clinical'. */
  enterClinical(): Promise<void>;
  /** Back to the lounge: 'transitioning', then 'lounge'. Clears the hologram. */
  exitClinical(): void;
  /** The panel shows the reading (`session.panelMode = 'scan'`). */
  showScan(): void;
  /** The panel shows the routine plan (`session.panelMode = 'routine'`). */
  showRoutine(): void;

  // --- the scan -----------------------------------------------------------
  /** Pipeline progress, 0..1, published as `session.scanProgress` / `session.scanStage`. */
  setScanProgress(progress: number, stage: string): void;
  /** The measured frame (raw base64 JPEG or a data URL), or null to drop it. */
  setCapture(base64: string | null): void;
  setFaceMesh(mesh: ScanMesh | null): void;
  presentAnalysis(analysis: SkinAnalysis, previous: SkinAnalysis | null, sentiment?: ScanSentiment): void;
  presentBody(analysis: BodyAnalysis, previous: BodyAnalysis | null, sentiment?: ScanSentiment): void;
  /** Lights the metric her narration just reached (and everything queued before it). */
  revealRegion(key: SkinMetricKey): void;
  /** The tour's step is over: nothing is lit any more (`activeRegion` null) and her held gesture is released (no state change). */
  releaseRegion(): void;
  /** The tour runner's writer. Nobody else calls it. */
  publishTour(next: TourView): void;
  /** Her stage (and the page) report to the tour. Forwarded to `onTourReport`. */
  reportTour(report: TourReport): void;
  /** The demonstration for a body reading, or null when there is none. */
  demoForBody(keys: readonly string[]): unknown | null;
  showDemo(clip: unknown): void;

  // --- touch and attention -------------------------------------------------
  /** A glance at a point, in the gaze units above, for `seconds`. */
  glanceAtScreen(x: number, y: number, seconds?: number): void;
  /** Where the hologram is from her point of view, in gaze units, for the pages that place one. */
  setHologramDirection(x: number, y: number): void;
  lookAt(what: Attention): void;
  /** A tap that landed on her; she reacts and the controller may answer. */
  pokeAt(zone: PokeZone): void;
  /** A tap somewhere in the room; she notices. */
  acknowledgeTouch(): void;
  /** A metric was picked on the hologram; forwards to `onMetricPicked`. */
  pickMetric(key: SkinMetricKey): void;

  /** Back to the state she boots in: signing out, deleting the account. */
  reset(): void;
  dispose(): void;
}

export { director } from './director.svelte.ts';
