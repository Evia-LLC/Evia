/**
 * Application state, as Svelte 5 runes.
 *
 * This is the client-side model. It holds no rendering objects and no three.js
 * types — the scene director subscribes to it, never the other way round.
 */
import type { BodyAnalysis } from '@/body-analysis/pipeline.ts';
import type { ScanMesh } from '@/holograms/face-mesh-3d.ts';
import type {
  ChatMessage,
  ProductPick,
  RoutinePlan,
  ElohimAction,
  LongitudinalSummary,
  ProgressPhoto,
  SkinAnalysis,
  UserSummary,
} from '@shared/types.ts';

export type SceneMode = 'lounge' | 'transitioning' | 'clinical';

/**
 * Which scan the user asked for.
 *
 * Chosen rather than detected — see the note on `runAnalysis`. The two
 * pipelines measure different things against different model versions, and
 * being wrong about which one to run is worse than asking.
 */
export type ScanKind = 'face' | 'body';

/**
 * Which frame of a body scan is being taken.
 *
 * A body scan is two captures, because one of them cannot answer the question
 * people ask of it. A belly projects forward and a front-facing camera measures
 * width, so abdominal protrusion is close to invisible head on — the side view
 * is the only frame it is actually in.
 */
export type BodyScanStep = 'front' | 'side';
export type PendingCaptureState = 'analysing' | 'presenting' | 'save-available' | 'saved' | 'discarded';
export interface PendingCapture {
  imageBase64: string;
  capturedAt: string;
  scanId?: string;
  state: PendingCaptureState;
}

class SessionState {
  user = $state<UserSummary | null>(null);
  modelAvailable = $state(false);
  demoMode = $state(false);
  imageStorage = $state(false);

  messages = $state<ChatMessage[]>([]);
  thinking = $state(false);
  chatError = $state<string | null>(null);
  /**
   * Whether the API answered at all.
   *
   * Distinct from "not signed in". A 401 is the server working correctly and
   * saying no; an unreachable server is a different situation with a different
   * remedy, and the entry screen has to be able to tell someone which one they
   * are looking at rather than offering a sign-in form that cannot work.
   */
  serverReachable = $state(true);
  /**
   * Whether the server has somewhere to keep things.
   *
   * Distinct again from unreachable: the API answers, the static app is fine,
   * every on-device feature works — there is simply no database behind it, so
   * accounts, history and conversation are off. Stated as such on the gate.
   */
  databaseAvailable = $state(true);

  /**
   * Looking around without an account.
   *
   * Not a signed-in user with the network turned off — a different mode, and
   * the difference is stated everywhere it matters. Everything that runs on the
   * device is real here: the room, the camera, the face and body analysis, the
   * readouts. Everything that needs the server is absent rather than simulated,
   * because a demo that invents a conversation and a history is not a preview
   * of this product, it is a different product that happens to look the same.
   *
   * Nothing is written down. Scans live in memory for as long as the tab does,
   * which is enough to take two and watch a reading move, and is the honest
   * limit of what a browser alone can promise.
   */
  guest = $state(false);

  sceneMode = $state<SceneMode>('lounge');

  scans = $state<SkinAnalysis[]>([]);
  progressPhotos = $state<ProgressPhoto[]>([]);
  /**
   * Body readings, newest first.
   *
   * Kept separate from `scans` rather than given a `kind` field, because the
   * two are measured by different pipelines against different model versions
   * and nothing may ever compare one to the other. Two lists makes that
   * impossible; one list with a discriminator makes it a bug waiting to happen.
   */
  bodyScans = $state<BodyAnalysis[]>([]);
  latestBody = $state<BodyAnalysis | null>(null);
  summary = $state<LongitudinalSummary | null>(null);
  latestScan = $state<SkinAnalysis | null>(null);

  /** Set when Elohim offers a scan, so the composer can show the prompt inline. */
  pendingOffer = $state<ElohimAction | null>(null);

  /** The routine plan for the latest scan, and which face the panel is showing. */
  plan = $state<RoutinePlan | null>(null);
  panelMode = $state<'scan' | 'routine'>('scan');
  /** What she would get for the latest reading: shelf first, then the web. */
  picks = $state<ProductPick[]>([]);

  /**
   * The face mesh captured at the moment of the last scan, for the hologram.
   *
   * Presentation, not measurement - the numbers come from the skin pipeline
   * - so it lives in the session rather than in the stored scan, and is gone
   * with the tab. See `holograms/face-mesh-3d.ts`.
   */
  lastMesh = $state<ScanMesh | null>(null);

  /**
   * The crops taken this session, keyed by the scan's `capturedAt`.
   *
   * A guest never uploads a photo and a signed-in user only does with consent,
   * but either can compare two scans taken in the same sitting: the pixels are
   * right here. They live as long as the tab and are never sent anywhere from
   * this map.
   */
  /** The sole owner of a raw face JPEG. It is never durable client state. */
  pendingCapture = $state<PendingCapture | null>(null);

  /** Progress of an in-flight analysis, 0..1, driven by the real pipeline. */
  scanProgress = $state(0);
  scanStage = $state<string>('');
  scanActive = $state(false);
  /** What the in-flight scan is of. */
  scanKind = $state<ScanKind>('face');
  /** Which of the two body frames is being captured. Ignored for face scans. */
  bodyScanStep = $state<BodyScanStep>('front');

  /** Voice state (brief §21). */
  listening = $state(false);
  speaking = $state(false);
  /**
   * How far into the current line she has spoken, in characters.
   *
   * The highest charIndex + charLength seen from word-boundary events, kept
   * by the voice controller: zeroed when a new line starts, completed to the
   * line's length when it ends. The chat reveals her reply up to this point,
   * so the text keeps pace with the voice instead of landing all at once.
   */
  spokenChars = $state(0);
  canListen = $state(false);
  canSpeak = $state(false);
  voiceName = $state<string | null>(null);
  /**
   * Whether the licensed human voice is the one actually speaking.
   *
   * Reported rather than assumed: a user told Elohim has a real voice should be
   * able to see when she has fallen back to the browser's synthesiser instead.
   */
  clonedVoice = $state(false);
  /** Whether the server offers the licensed voice to someone without an account. */
  guestVoice = $state(false);
  /**
   * One line about the last thing her voice did, for the You page: playing,
   * played, or why it could not - with the audio context's state, because a
   * phone that is muted looks exactly like a voice that failed.
   */
  voiceStatus = $state('');
  /** Live interim transcript, shown in the composer while she listens. */
  voiceDraft = $state('');
  /** True while the introduction is on screen: it owns her voice until it ends. */
  introPlaying = $state(false);

  qualityTier = $state<'low' | 'medium' | 'high'>('high');
  devStats = $state<{ calls: number; triangles: number; frameMs: number } | null>(null);

  get signedIn(): boolean {
    return this.user !== null;
  }

  get displayName(): string {
    return this.user?.displayName ?? 'friend';
  }

  pushMessage(message: ChatMessage): void {
    this.messages = [...this.messages, message];
  }

  reset(): void {
    this.user = null;
    this.messages = [];
    this.scans = [];
    this.progressPhotos = [];
    this.pendingCapture = null;
    this.bodyScans = [];
    this.latestBody = null;
    this.summary = null;
    this.latestScan = null;
    this.sceneMode = 'lounge';
    this.pendingOffer = null;
    this.plan = null;
    this.picks = [];
    this.panelMode = 'scan';
    this.bodyScanStep = 'front';
    this.listening = false;
    this.speaking = false;
    this.spokenChars = 0;
  }
}

export const session = new SessionState();
