/**
 * Application glue.
 *
 * Sits between the API, the store and the scene director so that no Svelte
 * component ever calls the API directly and no component ever touches three.js.
 * Components render state and call these functions; everything else happens here.
 */
import { api, ApiError, setToken } from '@/lib/api.ts';
import { session, type ScanKind } from './session.svelte.ts';
import type { SessionDirector } from '@/scene/director.ts';
import { analyseFace, CaptureRejected } from '@/skin-analysis/pipeline.ts';
import {
  analyseBody,
  BodyCaptureRejected,
  PoseUnavailable,
  ProfileRejected,
  type CaptureSource,
} from '@/body-analysis/pipeline.ts';
import { isProfileKey, selectBodyFindings } from '@/body-analysis/findings.ts';
import type { BodyAnalysis } from '@/body-analysis/pipeline.ts';
import { voice } from '@/voice/controller.ts';
import { guestEvent, guestTurn } from '@/lib/local-engine.ts';
import * as sound from '@/lib/sound.ts';
import { narrationFor, scanSentiment } from '@/scan/choreography.ts';
import { POKE_LINES, CONNECTION_LOST_LINE, LONG_THINK_LINE } from '@/lib/lines.ts';
import { introSeen, introWasSkipped } from '@/lib/intro.ts';
import { BODY_HIGHER_IS_BETTER } from '@/body-analysis/metrics.ts';
import { PROFILE_HIGHER_IS_BETTER } from '@/body-analysis/profile.ts';
import { router } from '@/router/router.svelte.ts';
import {
  METRIC_LABELS,
  type BodySnapshot,
  type CharacterDirective,
  type ElohimAction,
  type ElohimTurn,
  type SkinAnalysis,
} from '@shared/types.ts';

let director: SessionDirector | null = null;

/*
 * Poke pacing. The lines themselves live in lib/lines.ts with everything else
 * she has scripted; here is only the rhythm. The reaction in the body plays
 * every time; a line only every so often, because a person who quips at every
 * touch is a fairground machine. The cooldown wobbles a few seconds either
 * way so the interval itself never becomes the pattern.
 */
let lastPokeLineAt = 0;
let pokeCooldownMs = 18_000;
let lastPokeLine: string | null = null;

/** Said once per visit; a second "bear with me" is an apology loop. */
let longThinkSaid = false;

/**
 * Whether the user has sent a message this visit. The deferred greeting
 * checks it: once they have spoken first, she never greets - see
 * `openConversation`, and the guard inside `raiseEvent` for a greeting that
 * was already in flight when they beat it to the first word.
 */
let userSpokeFirst = false;

/**
 * The live director, for dev tooling only.
 *
 * Pairs with `stepHeadless` and `captureFrame`, which exist because the host
 * pane throttles rAF to a couple of frames a second and anything time-based —
 * a cross-fade, a gesture, a settle — cannot be judged from what it draws.
 * Reaching them needed a handle, and there was not one.
 */
export function devDirector(): SessionDirector | null {
  return director;
}

export function registerDirector(instance: SessionDirector | null): void {
  director = instance;
  voice.attach(instance);

  // Tapping a hologram asks Elohim about it. Deliberately not a detail panel:
  // she is the interpreter, and the whole product falls apart the moment the
  // holograms start explaining themselves.
  if (instance) {
    instance.onPoked = (zone) => {
      if (session.thinking || session.scanActive) return;
      sound.tick(0.85);
      const now = Date.now();
      if (now - lastPokeLineAt < pokeCooldownMs) return;
      lastPokeLineAt = now;
      pokeCooldownMs = 18_000 + Math.round(Math.random() * 8_000 - 4_000);
      // Random, but never the line she said last - repetition is what makes
      // a scripted quip sound scripted.
      const pool = POKE_LINES[zone].filter((l) => l !== lastPokeLine);
      const line = pool[Math.floor(Math.random() * pool.length)];
      lastPokeLine = line;
      session.pushMessage({
        id: `poke-${now}`,
        role: 'elohim',
        content: line,
        createdAt: new Date().toISOString(),
      });
      voice.speak(line);
    };

    instance.onMetricPicked = (key) => {
      if (session.thinking) return;
      director?.applyDirective({
        state: 'EXPLAINING',
        expression: 'focused',
        gesture: 'point_to_hologram',
        intensity: 0.6,
      });
      // The point and the glance hold for a beat before the reply cycle
      // starts; `sendMessage` applies THINKING immediately, and without the
      // pause the gesture that acknowledged the tap was never seen.
      window.setTimeout(() => {
        void sendMessage(`Tell me about my ${METRIC_LABELS[key].toLowerCase()}.`);
      }, 700);
    };

    // Fired by the director after several seconds of visible thinking.
    instance.onLongThink = () => {
      if (longThinkSaid || session.introPlaying) return;
      longThinkSaid = true;
      voice.speak(LONG_THINK_LINE);
    };
  }
}

/** Applies one intro beat's stage direction. The intro layer has no director handle. */
export function introDirective(directive: CharacterDirective): void {
  director?.applyDirective(directive);
}

/*
 * Typing makes her attend - and nothing else.
 *
 * The first keystroke of a turn makes her look up from what she was doing;
 * the signal re-arms once the keys have been quiet for a few seconds, so a
 * long message is one glance, not a nag.
 *
 * It used to also stop her mid-line, on the theory that people do not talk
 * over someone who has started to answer. In hand it was a disaster: tapping
 * the box silenced the very reply you had just asked for, because reaching
 * for the keyboard is not interrupting, it is queueing. She now finishes her
 * sentence while you type and yields at the one moment that really is your
 * turn - when you send.
 */
let typingIdleTimer = 0;
let typingArmed = true;

export function notifyTyping(): void {
  if (typingArmed) {
    typingArmed = false;
    director?.userIsTyping();
  }
  window.clearTimeout(typingIdleTimer);
  typingIdleTimer = window.setTimeout(() => {
    typingArmed = true;
  }, 3_000);
}

/**
 * Wires the microphone to the same path a typed message takes. Voice is an
 * input method, not a separate mode — the orchestrator never learns which one
 * was used.
 */
export async function initVoice(): Promise<void> {
  const caps = await voice.prepare(
    session.user?.preferences.locale ?? 'en',
    session.user?.preferences.voiceURI ?? null,
    session.guest,
  );
  session.canListen = caps.canListen;
  session.canSpeak = caps.canSpeak;
  session.voiceName = caps.voiceName;
  session.clonedVoice = caps.cloned;

  voice.onTranscript = (text) => {
    session.voiceDraft = '';
    void sendMessage(text);
  };
  voice.onInterim = (text) => {
    session.voiceDraft = text;
  };
  voice.onError = (message) => {
    session.chatError = message;
  };
}

/**
 * Re-resolves the voice: after the user changes it in preferences, and on
 * iOS the moment the first touch opens the synthesiser, which is later than
 * the capability check that ran at boot.
 */
export async function refreshVoice(): Promise<void> {
  const caps = await voice.prepare(
    session.user?.preferences.locale ?? 'en',
    session.user?.preferences.voiceURI ?? null,
    session.guest,
  );
  session.canListen = caps.canListen;
  session.canSpeak = caps.canSpeak;
  session.voiceName = caps.voiceName;
  session.clonedVoice = caps.cloned;
}

export function previewVoice(voiceURI: string | null): void {
  voice.preview(voiceURI, session.user?.preferences.locale ?? 'en');
}

export async function listVoiceOptions() {
  return voice.availableVoices();
}

export function toggleListening(): void {
  if (voice.listening) voice.stopListening();
  else voice.startListening(localeTag());
}

/** Web Speech wants a full BCP-47 tag; the profile stores a bare language. */
function localeTag(): string {
  const locale = session.user?.preferences.locale ?? 'en';
  return locale.includes('-') ? locale : `${locale}-US`;
}

export function stopSpeaking(): void {
  voice.stopSpeaking();
}

/**
 * A promise, or `null` after `ms` - never a hang.
 *
 * The API runs as a serverless function and a cold start can hold a request
 * for several seconds. Nothing about the first paint depends on the answer,
 * so the boot takes the response if it is quick and otherwise proceeds
 * optimistically while the real answer lands in the background.
 */
function within<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([
    promise,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
  ]);
}

export async function bootstrap(): Promise<void> {
  try {
    const quick = await within(api.health(), 3500);
    if (quick === null) {
      // Cold start. Assume the usual shape, let the truth correct it shortly,
      // and keep the gate interactive rather than blank in the meantime.
      void api
        .health()
        .then((late) => {
          session.modelAvailable = late.modelAvailable;
          session.demoMode = late.demoMode;
          session.imageStorage = late.imageStorage;
          session.guestVoice = late.guestVoice === true;
          session.databaseAvailable = late.database !== false;
        })
        .catch(() => {
          session.serverReachable = false;
        });
      void within(api.me(), 8000).then((me) => {
        if (me) {
          session.user = me.user;
          session.modelAvailable = me.modelAvailable;
          void loadUserData();
        }
      });
      return;
    }
    const health = quick;
    session.modelAvailable = health.modelAvailable;
    session.demoMode = health.demoMode;
    session.imageStorage = health.imageStorage;
    session.guestVoice = health.guestVoice === true;
    // A server with nothing behind it. Everything on the device still works;
    // accounts, history and conversation do not, and the gate says which.
    session.databaseAvailable = health.database !== false;
    if (!session.databaseAvailable) return;
  } catch {
    // The API being unreachable is a real state, not an exception to swallow.
    session.serverReachable = false;
    session.chatError = 'I cannot reach my server right now.';
    return;
  }

  try {
    const me = await api.me();
    session.user = me.user;
    session.modelAvailable = me.modelAvailable;
    await loadUserData();
  } catch (err) {
    // 401 is the server working and saying no. Anything else — the store
    // being down mid-session, say — must also land on the gate rather than
    // leave the boot screen up forever.
    if (!(err instanceof ApiError)) throw err;
    if (err.status !== 401) session.databaseAvailable = false;
  }
}

export async function signIn(email: string, password: string): Promise<void> {
  const { token, user } = await api.login(email, password);
  setToken(token);
  session.user = user;
  await loadUserData();
}

export async function register(
  email: string,
  password: string,
  displayName: string,
): Promise<void> {
  const { token, user } = await api.register(email, password, displayName);
  setToken(token);
  session.user = user;
  await loadUserData();
}

export async function signOut(): Promise<void> {
  voice.dispose();
  // A guest was never signed in, so there is no session to end and no server
  // to tell. Asking would only produce an error about a thing that never was.
  if (!session.guest) await api.logout();
  setToken(null);
  session.reset();
}

/**
 * Look around without an account.
 *
 * Exists because the parts of this app worth looking at on a real device — the
 * room, the character, the capture, the analysis, the readouts — all run in the
 * browser and need nothing from a server. Requiring an account to see them was
 * a rule inherited from the parts that do.
 *
 * The user object below is local and deliberately unlike a real one: no id that
 * any request could be made with, and both consents withheld, so nothing can
 * take a route that would try to store something. What a guest gets is the
 * genuine article measured on their own phone; what they do not get is a
 * conversation or a history, and the interface says so rather than inventing
 * either.
 */
export function enterGuestMode(): void {
  session.guest = true;
  session.chatError = null;
  session.user = {
    id: 'guest',
    email: '',
    displayName: 'there',
    createdAt: new Date().toISOString(),
    profile: {
      skinType: 'unknown',
      fitzpatrick: null,
      concerns: [],
      sensitivities: [],
      pregnancyStatus: 'unknown',
      updatedAt: new Date().toISOString(),
    },
    /*
     * Her voice, on, when the server offers it to guests.
     *
     * A guest's line is sent to the voice provider to be spoken, and that is
     * said on the entry screen next to the switch that turns it off. The
     * button that brought them here is the gesture the browser needs to let
     * audio start, so the first thing they hear is her.
     */
    preferences: { ...DEFAULT_GUEST_PREFERENCES, voiceEnabled: session.guestVoice },
    consents: { image_storage: false, cloud_reasoning: false },
    scanCount: 0,
  };

  /*
   * She speaks first here too. The local engine answers `opened` the same
   * way the server's fallback does, and on a first visit the greeting waits
   * for the introduction so it answers her narration instead of racing it.
   */
  void openConversation();
}

/** Turns her voice on or off for an account, and remembers it. */
export async function setVoiceEnabled(enabled: boolean): Promise<void> {
  if (!session.user || session.guest) return;
  session.user = {
    ...session.user,
    preferences: { ...session.user.preferences, voiceEnabled: enabled },
  };
  if (!enabled) voice.stopSpeaking();
  try {
    await api.updatePreferences({ voiceEnabled: enabled });
  } catch {
    // The switch still holds for the session; it simply was not remembered.
  }
}

/** Turns her voice on or off for a guest. Nothing is stored; nothing to store it in. */
export function setGuestVoice(enabled: boolean): void {
  if (!session.user || !session.guest) return;
  session.user = {
    ...session.user,
    preferences: { ...session.user.preferences, voiceEnabled: enabled },
  };
  if (!enabled) voice.stopSpeaking();
}

/** A guest has nothing stored, so these are the defaults and stay them. */
const DEFAULT_GUEST_PREFERENCES = {
  explanationStyle: 'adaptive' as const,
  voiceEnabled: false,
  voiceURI: null,
  reducedMotion: false,
  qualityTier: 'auto' as const,
  locale: 'en',
};

async function loadUserData(): Promise<void> {
  const [history, scans, summary, body] = await Promise.all([
    api.chatHistory(),
    api.scans(),
    api.scanSummary(),
    /*
     * Body history, fetched alongside but kept apart.
     *
     * This is what makes a body scan a measurement rather than a moment: with
     * the previous reading loaded, the next scan has something to be compared
     * against. Without it every scan was a first reading forever, which is the
     * one thing a tracking feature cannot be.
     */
    api.bodyScans().catch(() => ({ scans: [] })),
  ]);
  session.messages = history.messages;
  session.scans = scans.scans;
  session.latestScan = scans.scans[0] ?? null;
  session.summary = summary.summary;
  session.bodyScans = body.scans;
  session.latestBody = body.scans[0] ?? null;

  /*
   * She speaks first: into an empty transcript, and into one that has gone
   * quiet for hours - reopening the app onto yesterday's last exchange with
   * nothing said reads as her ignoring you. Fire-and-forget on purpose: a
   * first-run account waits for the introduction to end, and `bootstrap`
   * (which awaits this function) is what lets the introduction mount at all.
   */
  const newest = session.messages[session.messages.length - 1];
  const age = newest ? Date.now() - Date.parse(newest.createdAt) : Infinity;
  if (!newest || !Number.isFinite(age) || age > OPENED_AFTER_MS) void openConversation();
}

/** How long the transcript may sit quiet before a return earns a fresh hello. */
const OPENED_AFTER_MS = 4 * 60 * 60 * 1000;

/**
 * Raises `opened` once she is actually free to greet.
 *
 * On a first run the introduction is about to play, and her greeting must
 * answer it rather than race it - so the raise waits for `introPlaying` to
 * flip false. If the intro was skipped, or never ran at all, the server keeps
 * one self-introducing greeting for exactly that, and `introSkipped` asks
 * for it.
 */
async function openConversation(): Promise<void> {
  if (!introSeen()) await introFinished();
  // If they spoke first while the intro was winding down, the conversation
  // is already open and the greeting stands down. A hello that arrives after
  // your worried question is not a greeting, it is a non sequitur - and it
  // was overwriting the reply's whole emotional direction when it landed.
  if (userSpokeFirst) return;
  const skipped = introWasSkipped() || !introSeen();
  await raiseEvent('opened', undefined, skipped ? { introSkipped: true } : undefined);
}

/**
 * Resolves once the introduction has run its course - marked seen and off
 * screen - or after a generous cap, so a broken intro cannot mute her forever.
 */
async function introFinished(capMs = 90_000): Promise<void> {
  const deadline = Date.now() + capMs;
  while (Date.now() < deadline) {
    if (introSeen() && !session.introPlaying) return;
    await pause(200);
  }
}

/**
 * The opening beat. Elohim speaks first — the product is a conversation, and
 * conversations do not start with an empty text box.
 *
 * This goes through the event endpoint rather than sending a fabricated "hey"
 * as the user, so the transcript stays an honest record of what was actually
 * said. Every later turn reads that transcript.
 */
export async function raiseEvent(
  event: 'opened' | 'scan_complete' | 'body_scan_complete',
  body?: BodySnapshot,
  extras?: { spokenNarration?: string; introSkipped?: boolean },
): Promise<void> {
  // A guest talks to the local engine, in the browser. Same engine the server
  // falls back to, same label, same real numbers - just no server.
  if (session.guest) {
    session.thinking = true;
    director?.userSubmitted();
    await pause(500);
    // A greeting that was already in flight when the user beat it to the
    // first word is abandoned, not delivered late over their turn.
    if (event === 'opened' && userSpokeFirst) {
      session.thinking = false;
      return;
    }
    absorbTurn(
      guestEvent(event, body, event === 'scan_complete' ? session.picks : [], {
        introSkipped: extras?.introSkipped,
      }),
    );
    session.thinking = false;
    return;
  }
  session.thinking = true;
  director?.userSubmitted();
  try {
    const { turn } = extras
      ? await chatEventWithExtras(event, body, extras)
      : await api.chatEvent(event, body);
    // Same rule as the guest path: a greeting overtaken by the user's own
    // first message is dropped rather than delivered over their turn.
    if (event === 'opened' && userSpokeFirst) return;
    absorbTurn(turn);
  } catch (err) {
    failSoftly(err);
  } finally {
    session.thinking = false;
  }
}

/**
 * The event endpoint, with the extras `api.chatEvent` predates.
 *
 * A plain fetch rather than a widened client method: the API module holds the
 * bearer token privately, but the server also reads the HttpOnly session
 * cookie, which this same-origin request carries. If the cookie is not there
 * - a browser with site data blocked - the call falls back to the typed
 * client and the extras are simply lost, which costs colour, not the turn.
 */
async function chatEventWithExtras(
  event: 'opened' | 'scan_complete' | 'body_scan_complete',
  body: BodySnapshot | undefined,
  extras: { spokenNarration?: string; introSkipped?: boolean },
): Promise<{ turn: ElohimTurn }> {
  const res = await fetch('/api/chat/event', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ event, body, extras }),
  });
  if (res.status === 401) return api.chatEvent(event, body);
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, payload.error ?? 'Something went wrong on my side.');
  return payload as { turn: ElohimTurn };
}

/**
 * A failed turn, delivered by her rather than by a strip of red text.
 *
 * The concerned idle directive also releases THINKING, which nothing else
 * resets on failure - without it she stood frozen mid-thought over an error
 * she never mentioned. The strip stays for the one case speaking past would
 * be a lie: a 401, where the session itself has ended.
 */
function failSoftly(err: unknown): void {
  if (err instanceof ApiError && err.status === 401) {
    session.chatError = err.message;
    return;
  }
  director?.applyDirective({ state: 'IDLE', expression: 'concerned', gesture: 'none', intensity: 0.6 });
  session.pushMessage({
    id: `elohim-${Date.now()}`,
    role: 'elohim',
    content: CONNECTION_LOST_LINE,
    createdAt: new Date().toISOString(),
  });
  voice.speak(CONNECTION_LOST_LINE);
}

export async function sendMessage(text: string): Promise<void> {
  const trimmed = text.trim();
  if (!trimmed) return;
  userSpokeFirst = true;
  /*
   * A turn already in flight - the arrival greeting, or a slow reply - used
   * to make this function return silently, which ate the message: the user
   * typed, pressed send, and nothing happened at the exact moment a new
   * visitor is most likely to type. Their words wait their turn instead,
   * briefly; only a genuinely jammed pipeline drops them, and even then the
   * composer still holds their text.
   */
  if (session.thinking) {
    const until = Date.now() + 8_000;
    while (session.thinking && Date.now() < until) await pause(120);
    if (session.thinking) return;
  }

  // She yields the floor the moment you actually speak.
  if (session.speaking) voice.stopSpeaking();

  session.chatError = null;
  session.pendingOffer = null;

  session.pushMessage({
    id: `local-${Date.now()}`,
    role: 'user',
    content: trimmed,
    createdAt: new Date().toISOString(),
  });
  // The message leaving. Her reply lands without a sound of its own: her
  // voice, when she has one, is the sound of a reply.
  sound.swoosh();

  session.thinking = true;
  director?.userSubmitted();

  if (session.guest) {
    // A beat to think, as the server would take. Instant answers read as
    // canned even when they are not.
    await pause(450 + Math.min(900, trimmed.length * 12));
    absorbTurn(guestTurn(trimmed));
    session.thinking = false;
    return;
  }

  try {
    const { turn } = await api.chat(trimmed);
    absorbTurn(turn);
  } catch (err) {
    failSoftly(err);
  } finally {
    session.thinking = false;
  }
}

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Resolves once she has finished speaking, so staged moments - a panel, a
 * demonstration - land after the sentence that introduces them rather than
 * during it. Instant when she cannot speak at all; a short grace covers the
 * gap between a line being queued and its audio actually starting; the guard
 * means a voice that never reports its end cannot hold the stage forever.
 */
async function waitForQuiet(guardMs = 15_000): Promise<void> {
  if (!session.canSpeak || session.user?.preferences.voiceEnabled !== true) return;
  const deadline = Date.now() + guardMs;
  const graceEnd = Date.now() + 900;
  let heard = session.speaking;
  while (Date.now() < deadline) {
    if (session.speaking) heard = true;
    else if (heard || Date.now() >= graceEnd) return;
    await pause(120);
  }
}

/** Applies one turn to the store, the character and the UI. */
function absorbTurn(turn: ElohimTurn): void {
  // A turn arriving is the success that retires any earlier failure notice,
  // and it opens a fresh turn for the typing interrupt.
  session.chatError = null;
  session.pushMessage({
    id: `elohim-${Date.now()}`,
    role: 'elohim',
    content: turn.text,
    createdAt: new Date().toISOString(),
    emotion: turn.classification.emotion,
    intent: turn.classification.intent,
    directive: turn.directive,
    demo: turn.demo,
  });

  /*
   * The line's timing starts now, lips shut; the voice controller gives the
   * mouth to whichever engine actually makes sound, and to nothing if none
   * does. While the introduction is narrating, the words land in the
   * transcript, the intro's voice keeps the mouth, and the turn is not spoken
   * twice.
   */
  director?.elohimSpoke(turn.directive, turn.text, session.introPlaying ? 'keep' : 'wait');
  if (!session.introPlaying) voice.speak(turn.text);
  handleActions(turn.actions);

  // A preference change lands server-side; reflect it without a full reload.
  if (turn.memoryWrites.some((w) => w.key === 'explanation_style')) {
    void api.me().then((me) => {
      session.user = me.user;
    });
  }
}

function handleActions(actions: ElohimAction[]): void {
  for (const action of actions) {
    switch (action.type) {
      case 'offer_scan':
        session.pendingOffer = action;
        break;
      case 'enter_clinical':
        // The scan page is the clinic; arriving on it opens the capture.
        router.go('/scan');
        break;
      case 'show_progress':
      case 'show_history':
        router.go('/progress');
        break;
      case 'ask_explanation_style':
        // Handled conversationally by Elohim; nothing for the UI to force.
        break;
    }
  }
}

/** Opens the clinical room. The capture itself is driven by the scan overlay. */
export async function startScanFlow(kind: ScanKind = 'face'): Promise<void> {
  session.pendingOffer = null;
  session.scanActive = true;
  session.scanKind = kind;
  session.bodyScanStep = 'front';
  session.scanProgress = 0;
  session.scanStage = '';
  await director?.enterClinical();
}

export function cancelScanFlow(): void {
  session.scanActive = false;
  session.scanProgress = 0;
  director?.showScan();
  director?.exitClinical();
}

/**
 * The scan page arriving.
 *
 * Opens the capture unless there is already a reading on display — coming
 * back to `/scan` after a scan should show the result, not throw it away and
 * ask for another.
 */
export function enterScanPage(): void {
  if (session.scanActive) return;
  if (session.sceneMode !== 'lounge') return;
  void startScanFlow(session.scanKind);
}

/** The scan page leaving. Whatever was open, she walks out of the clinic. */
export function leaveScanPage(): void {
  if (session.sceneMode === 'lounge' && !session.scanActive) return;
  cancelScanFlow();
}

/**
 * Asks her something from another page.
 *
 * The conversation is the home page, so the question goes there first and is
 * asked once she is in frame. Tapping a ring on the progress page is exactly
 * tapping a hologram in the clinic: she explains, the page does not.
 */
export async function askElohim(text: string): Promise<void> {
  router.go('/');
  await sendMessage(text);
}

/** Flips the clinical panel between the scan readout and the routine plan. */
export function togglePanelView(): void {
  if (!director) return;
  if (session.panelMode === 'routine') director.showScan();
  else director.showRoutine();
}

/**
 * Runs the real pipeline on a real frame, stores the result, and hands the
 * numbers to the holograms. Nothing here is simulated.
 */
/**
 * A body scan.
 *
 * Kept entirely separate from the skin path — different pipeline, different
 * metrics, different model version, and its own list in the session. The one
 * thing they share is the hologram, which contours whatever image it is handed
 * and does not need to know what is in it.
 *
 * Persisted to `body_scans` — its own table, for the same reason. The
 * longitudinal engine never sees it, so a shoulder ratio can never be charted
 * against a hydration score.
 */
async function runBodyAnalysis(
  source: CaptureSource,
  side: CaptureSource | null,
): Promise<void> {
  const previous = session.latestBody;
  try {
    const { analysis, imageBase64, profileImageBase64 } = await analyseBody(
      source,
      side,
      (progress, stage) => {
        director?.setScanProgress(progress, stage);
      },
    );

    /*
     * Stored before it is shown, so the reading the room presents is the
     * reading that was kept — including the id and the image flags, which only
     * the server knows.
     *
     * Both frames are offered only with storage consent, exactly like a face
     * capture. Without it the numbers are saved and the pictures are not, which
     * is what the capture screen promises.
     */
    /*
     * A guest's readings live in memory, which is enough to track.
     *
     * Two scans in one sitting still compare properly — the previous one is
     * simply the one already in this list rather than the one the server has —
     * so the movement finding, the noise floor and the "+67 since last" line
     * all behave exactly as they do for an account. They just do not outlive
     * the tab, and the interface says so.
     */
    let scan = analysis;
    let storedPrevious = previous;

    if (!session.guest) {
      const consented = session.user?.consents.image_storage === true;
      const saved = await api.saveBodyScan(
        analysis,
        consented ? imageBase64 : undefined,
        consented ? (profileImageBase64 ?? undefined) : undefined,
      );
      scan = saved.scan;
      storedPrevious = saved.previous;
    }

    session.bodyScans = [scan, ...session.bodyScans];
    session.latestBody = scan;

    /*
     * The hologram projects whichever frame the headline reading came from.
     *
     * If the abdominal profile is what the scan turned up, the front view is
     * the one picture that does not show it — so the projection follows the
     * measurement rather than defaulting to the more flattering angle.
     */
    /*
      * Compared against the row the server says came before it.
      *
      * Not the copy the session was holding: that is only as fresh as the last
      * load, and a trend drawn against a stale row is a trend against the wrong
      * month. The server owns the history, so it owns the answer to "previous".
      */
    const before = storedPrevious ?? previous;
    const top = selectBodyFindings(scan, before)[0];
    const showProfile = top !== undefined && isProfileKey(top.key) && profileImageBase64 !== null;
    director?.setCapture(showProfile ? profileImageBase64 : imageBase64);
    director?.presentBody(scan, before, bodySentiment(scan, before));
    session.scanActive = false;
    session.bodyScanStep = 'front';

    /*
     * Her own event, carrying its own numbers.
     *
     * `scan_complete` tells the model the results are "in the context block
     * above as the most recent scan" — which is the most recent *skin* scan, so
     * a body scan used to make her talk about the user's pores. Body readings
     * are not stored anywhere, so they travel with the event.
     */
    await raiseEvent('body_scan_complete', snapshotFor(scan, before));

    /*
     * The remedy, after the reading.
     *
     * Deliberately once she has finished speaking rather than alongside
     * `presentBody`: the figure starting to move while she is still saying what
     * she found turns the explanation into background. Her reply is spoken
     * asynchronously, so "finished" is `waitForQuiet`, not the event promise
     * resolving. `demoForBody` returns null unless a finding actually has a
     * demonstration, so nothing plays for a reading the library has nothing to
     * say about.
     */
    const demo = director?.demoForBody(selectBodyFindings(scan, before).map((f) => f.key));
    if (demo) {
      await waitForQuiet();
      director?.showDemo(demo);
    }
  } catch (err) {
    director?.setScanProgress(0, '');
    /*
     * A bad side view costs the side view, not the scan.
     *
     * The front frame was already accepted and measured by the time this can
     * throw, so sending the user back to the start would be throwing away good
     * work to punish a bad angle. The overlay keeps the front capture and asks
     * for the second frame again.
     */
    if (err instanceof ProfileRejected) {
      session.bodyScanStep = 'side';
      speakRejection(err.message);
      return;
    }
    session.scanActive = false;
    if (err instanceof BodyCaptureRejected) {
      speakRejection(err.message);
      return;
    }
    if (err instanceof PoseUnavailable) {
      // The model file is the one thing a body scan cannot do without, and
      // pretending otherwise would mean inventing joint positions.
      speakRejection('Body scanning needs the pose model, which is not installed on this server.');
      return;
    }
    throw err;
  }
}

/**
 * Runs the scan the user asked for.
 *
 * Routed by choice rather than by guessing at the frame. Automatic detection
 * was built and then removed: a skin-chroma classifier read 83% of a full-body
 * photograph as skin, because a cream sweater and a warm background both pass a
 * chroma test, and it could not separate the two cases at all. The alternative
 * — running the pose model on every scan to find out — costs an 11MB download
 * before a face scan that will never use it.
 *
 * Neither is better than a button. And a wrong guess here is expensive in a way
 * a button never is: the face pipeline does not fail on a torso, it returns
 * confident numbers about the wrong subject and labels one of them "Forehead".
 *
 * Each pipeline still validates its own input, so asking for the wrong one is
 * caught and explained rather than measured.
 */
export async function runAnalysis(
  source: CaptureSource,
  kind: ScanKind = 'face',
  side: CaptureSource | null = null,
): Promise<void> {
  if (kind === 'body') {
    await runBodyAnalysis(source, side);
    return;
  }

  const previous: SkinAnalysis | null = session.latestScan;

  try {
    const { analysis, imageBase64, crop } = await analyseFace(source, (progress, stage) => {
      director?.setScanProgress(progress, stage);
    });

    /*
     * The mesh travels with the scan, in the crop's own frame.
     *
     * The live mesh was measured on the camera frame; the image that gets kept
     * is a crop of it. Re-expressed here so that "where is the left cheek on
     * this photo" has the same answer months later on a different device, which
     * is what lets two scans be laid on top of each other.
     */
    const landmarks = meshInCrop(session.lastMesh, crop);
    if (landmarks) analysis.landmarks = landmarks;
    session.localImages = { ...session.localImages, [analysis.capturedAt]: imageBase64 };

    /*
     * A guest keeps the reading in memory and nowhere else.
     *
     * The measurement itself is identical — it was computed on this device
     * either way — so what is shown on the cards is the real thing. What a
     * guest does not get is the summary, because a longitudinal summary of one
     * scan that will not survive the tab closing is not a summary of anything.
     */
    if (session.guest) {
      session.scans = [analysis, ...session.scans];
      session.latestScan = analysis;
    } else {
      const consented = session.user?.consents.image_storage === true;
      const { scan, summary } = await api.saveScan(
        analysis,
        consented ? imageBase64 : undefined,
      );

      session.scans = [scan, ...session.scans];
      session.latestScan = scan;
      session.summary = summary;
    }

    /*
     * The hologram projects the frame that was actually measured.
     *
     * `imageBase64` exists on every scan; only uploading it is gated behind
     * storage consent. So this works whether or not the user keeps photos —
     * it simply lives as long as the session does, which is exactly as long as
     * the projection is on screen.
     */
    director?.setCapture(imageBase64);
    director?.setFaceMesh(session.lastMesh);

    /*
     * The reveal, narrated - and hers.
     *
     * The regions light one at a time on the hologram, and she says what she
     * found in each as it lights - the lines are short, deterministic, and
     * come from the same observations the cards print, so the voice and the
     * readout can never disagree. Fetched before the reveal starts so the
     * first word lands with the first light rather than a network hop later.
     */
    const narration = narrationFor(session.latestScan!, previous);
    if (narration) await voice.preload([narration.text]).catch(() => {});

    director?.presentAnalysis(session.latestScan!, previous, scanSentiment(session.latestScan!, previous));
    session.scanActive = false;

    /*
     * What to get, fetched while she talks so she can name it afterwards.
     *
     * For an account the server builds the plan from the stored scan; for a
     * guest the nine numbers go up with the request and come back as a plan
     * and picks, and nothing is kept. Either way a failure here costs the
     * shelf, not the reading - and running it under the narration means the
     * shelf is usually ready before she finishes the sentence.
     */
    const picksReady = loadPicks(analysis);

    if (narration && voice.willSpeak(narration.text) !== 'none') {
      /*
       * No directive here on purpose. `presentAnalysis` just gave her the
       * verdict's own face - a smile for an improving read, concern for a
       * declining one - and a generic focused overlay a tick later erased it
       * before a single frame rendered, which was her biggest moment
       * delivered with her flattest face. The pointing arrives per clause
       * from `revealRegion`, which spreads the verdict directive it finds.
       */
      /*
       * Her voice paces the lights. `spokenChars` is the word-boundary
       * high-water mark into this exact line (speaking starts it at zero),
       * so each region lights as she reaches its clause. A plain interval
       * rather than an $effect - this is a scripted moment inside one call,
       * not a subscription. When she cannot speak at all, this whole branch
       * is skipped and the director's own timed reveal carries the moment.
       */
      const spoken = voice.speakAndWait(narration.text);
      let lit = 0;
      const drive = window.setInterval(() => {
        while (lit < narration.clauses.length && session.spokenChars >= narration.clauses[lit].charStart) {
          director?.revealRegion(narration.clauses[lit].key);
          lit++;
        }
      }, 60);
      await spoken;
      window.clearInterval(drive);
      // A line cut short by the guard must still finish the reveal - the
      // readout cannot be hostage to the audio.
      while (lit < narration.clauses.length) director?.revealRegion(narration.clauses[lit++].key);
    }
    sound.settle();

    await picksReady;

    // She reads the result out loud, from the numbers that were just stored -
    // and the reply is told what she already said, so it builds on the
    // narration instead of reading the same numbers back.
    await raiseEvent('scan_complete', undefined, narration ? { spokenNarration: narration.text } : undefined);

    // Then the screen stops being your face and becomes your plan. Deliberately
    // after she has finished speaking: the swap is the punctuation on the
    // explanation, not a competing thing to look at while she is still talking.
    if (session.plan && session.plan.suggestions.length) {
      await waitForQuiet();
      director?.showRoutine();
    }
  } catch (err) {
    session.scanActive = false;
    director?.setScanProgress(0, '');
    sound.nope();
    if (err instanceof CaptureRejected) {
      speakRejection(`${err.message}. Give it another go when you can.`);
    } else {
      speakRejection(err instanceof Error ? err.message : 'The analysis failed.');
    }
    throw err;
  }
}

/**
 * A rejected capture, delivered by her.
 *
 * The reason still lands on `chatError`, which the capture overlay renders in
 * its live region - but she also says it, concerned rather than neutral,
 * because a silent avatar next to an error strip reads as her not noticing.
 */
function speakRejection(reason: string): void {
  session.chatError = reason;
  director?.applyDirective({ state: 'CONCERNED', expression: 'concerned', gesture: 'head_tilt', intensity: 0.6 });
  voice.speak(reason);
}

/**
 * The plan and the shelf for the reading just taken.
 *
 * Kept off the critical path of the scan: the reading is on screen before
 * this runs, and if it fails the reading stands and the shelf is simply empty.
 */
async function loadPicks(analysis: SkinAnalysis): Promise<void> {
  session.picks = [];
  try {
    if (session.guest) {
      const profile = session.user?.profile;
      const { plan, picks } = await api.publicPicks(analysis.metrics, analysis.confidence, {
        skinType: profile?.skinType,
        concerns: profile?.concerns,
        sensitivities: profile?.sensitivities,
        pregnancyStatus: profile?.pregnancyStatus,
      });
      session.plan = plan;
      session.picks = picks;
    } else {
      const [{ plan }, { picks }] = await Promise.all([api.routinePlan(), api.picks()]);
      session.plan = plan;
      session.picks = picks;
    }
  } catch {
    // A missing shelf is not worth interrupting the moment for.
  }
}

/** Re-reads the shelf for the latest stored reading, for the routine page. */
export async function refreshPicks(): Promise<void> {
  if (session.guest || !session.latestScan) return;
  try {
    session.picks = (await api.picks()).picks;
  } catch {
    session.picks = [];
  }
}

/**
 * Flattens the live mesh into (x, y) pairs normalised to the crop rectangle.
 *
 * The mesh's points are normalised to the source frame (x by width, y by
 * height); the crop is a fraction of that same frame. Points outside the crop
 * are kept - the jawline can run past the bottom edge - because a warp needs
 * every vertex of every triangle, not just the ones that landed in shot.
 */
function meshInCrop(
  mesh: { points: Float32Array; count: number } | null,
  crop: { x: number; y: number; w: number; h: number },
): number[] | null {
  if (!mesh || mesh.count === 0 || crop.w <= 0 || crop.h <= 0) return null;
  const out: number[] = [];
  for (let i = 0; i < mesh.count; i++) {
    const x = (mesh.points[i * 3] - crop.x) / crop.w;
    const y = (mesh.points[i * 3 + 1] - crop.y) / crop.h;
    out.push(Math.round(x * 10_000) / 10_000, Math.round(y * 10_000) / 10_000);
  }
  return out;
}

export async function setConsent(
  kind: 'image_storage' | 'cloud_reasoning',
  granted: boolean,
): Promise<void> {
  await api.setConsent(kind, granted);
  const me = await api.me();
  session.user = me.user;
}

export async function deleteEverything(): Promise<number> {
  const { blobsShredded } = await api.deleteEverything();
  setToken(null);
  session.reset();
  return blobsShredded;
}

export async function refreshScans(): Promise<void> {
  const [scans, summary] = await Promise.all([api.scans(), api.scanSummary()]);
  session.scans = scans.scans;
  session.latestScan = scans.scans[0] ?? null;
  session.summary = summary.summary;
}

/**
 * Body history, loaded separately and kept in its own list.
 *
 * Its own call rather than folded into `refreshScans`, which is named for the
 * skin history and returns the longitudinal summary with it. A body reading has
 * no place in that summary and must never be handed to it.
 */
export async function refreshBodyScans(): Promise<void> {
  const { scans } = await api.bodyScans();
  session.bodyScans = scans;
  session.latestBody = scans[0] ?? null;
}


/**
 * The body reading, reduced to what Elohim needs to talk about it.
 *
 * Keys rather than labels: this payload is browser-built and ends up inside a
 * model prompt, so the server looks the wording up from its own table and drops
 * anything it does not recognise. Nothing free-form crosses.
 */
function snapshotFor(analysis: BodyAnalysis, previous: BodyAnalysis | null): BodySnapshot {
  const findings = selectBodyFindings(analysis, previous);
  return {
    findings: findings.map((finding) => {
      const value = isProfileKey(finding.key)
        ? (analysis.profile?.[finding.key] ?? 0)
        : analysis.metrics[finding.key];
      const before = isProfileKey(finding.key)
        ? previous?.profile?.[finding.key]
        : previous?.metrics[finding.key];
      return {
        key: finding.key,
        value,
        kind: finding.kind,
        delta: before === undefined ? null : value - before,
      };
    }),
    confidence: analysis.confidence,
    hasProfile: analysis.profile !== null,
  };
}

/**
 * Which way the body reading moved, net, for the staging to colour.
 *
 * Counted over the same movement findings the cards call out - a reading
 * that cleared its noise floor - with each one scored by its own direction,
 * because a waist ratio and a shoulder line do not agree about which way is
 * "better" without being told.
 */
function bodySentiment(
  current: BodyAnalysis,
  previous: BodyAnalysis | null,
): 'improving' | 'declining' | 'steady' {
  if (!previous) return 'steady';
  let net = 0;
  for (const finding of selectBodyFindings(current, previous)) {
    if (finding.kind !== 'movement') continue;
    const value = isProfileKey(finding.key)
      ? current.profile?.[finding.key]
      : current.metrics[finding.key];
    const before = isProfileKey(finding.key)
      ? previous.profile?.[finding.key]
      : previous.metrics[finding.key];
    if (value === undefined || before === undefined) continue;
    const delta = value - before;
    const higherIsBetter = isProfileKey(finding.key)
      ? PROFILE_HIGHER_IS_BETTER[finding.key]
      : BODY_HIGHER_IS_BETTER[finding.key];
    net += (higherIsBetter ? delta > 0 : delta < 0) ? 1 : -1;
  }
  return net > 0 ? 'improving' : net < 0 ? 'declining' : 'steady';
}
