/**
 * The controller, driving the 2D director.
 *
 * The director's own tests call it directly. These go the way the scan page
 * does - through the controller, with the director registered as `App.svelte`
 * registers it - because that path is the one that has to keep working: the
 * room walk a scan starts, the panel it flips, and a scan page that still
 * opens after someone signed out halfway through a capture.
 *
 * Then sample mode's one hard rule: nothing a sample visit produces is
 * written to the server, even when an account is signed in. The API client,
 * the voice and the face pipeline are stand-ins; everything else is real.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SkinAnalysis, SkinAppearanceMetrics, UserSummary } from '../shared/types.ts';

const api = vi.hoisted(() => ({
  chat: vi.fn(),
  chatEvent: vi.fn(),
  saveScan: vi.fn(),
  saveBodyScan: vi.fn(),
  saveProgressPhoto: vi.fn(),
  publicPicks: vi.fn(),
  routinePlan: vi.fn(),
  picks: vi.fn(),
  logout: vi.fn(),
  me: vi.fn(),
}));
vi.mock('../src/lib/api.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/api.ts')>()),
  api,
}));

const voice = vi.hoisted(() => ({
  attach: vi.fn(),
  speak: vi.fn(),
  stopSpeaking: vi.fn(),
  dispose: vi.fn(),
  preload: vi.fn(async () => {}),
  willSpeak: vi.fn(() => 'none' as const),
  speakAndWait: vi.fn(async () => {}),
}));
vi.mock('../src/voice/controller.ts', () => ({ voice }));

const analyseFace = vi.hoisted(() => vi.fn());
vi.mock('../src/skin-analysis/pipeline.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/skin-analysis/pipeline.ts')>()),
  analyseFace,
}));

const {
  cancelScanFlow,
  enterGuestMode,
  enterSamplePreview,
  enterScanPage,
  raiseEvent,
  registerDirector,
  runAnalysis,
  sendMessage,
  signOut,
  startScanFlow,
  togglePanelView,
} = await import('../src/state/controller.ts');
const { director } = await import('../src/stage/director.ts');
const { session } = await import('../src/state/session.svelte.ts');
const { sample } = await import('../src/sample/mode.svelte.ts');

const account: UserSummary = {
  id: 'user-1',
  email: 'demo@evia.local',
  displayName: 'Demo',
  createdAt: '2026-09-01T00:00:00.000Z',
  profile: {
    skinType: 'unknown',
    fitzpatrick: null,
    concerns: [],
    sensitivities: [],
    pregnancyStatus: 'unknown',
    updatedAt: '2026-09-01T00:00:00.000Z',
  },
  preferences: {
    explanationStyle: 'adaptive',
    voiceEnabled: false,
    voiceURI: null,
    reducedMotion: false,
    qualityTier: 'auto',
    locale: 'en',
  },
  consents: {},
  scanCount: 0,
} as unknown as UserSummary;

const metrics: SkinAppearanceMetrics = {
  hydration: 30,
  oiliness: 70,
  redness: 60,
  texture: 50,
  pores: 50,
  darkSpots: 50,
  evenness: 50,
  underEye: 50,
  acneIndicators: 50,
};
const reading = {
  capturedAt: '2026-09-24T10:00:00.000Z',
  metrics,
  confidence: 0.9,
  quality: { brightness: 0.5, blur: 0.1, faceCoverage: 0.6, ok: true, issues: [] },
  regions: {},
  modelVersion: 'test',
  imageStored: false,
} as unknown as SkinAnalysis;

let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  fetchSpy = vi.fn(async () => {
    throw new Error('no network in this test');
  });
  vi.stubGlobal('fetch', fetchSpy);
  sample.on = false;
  session.reset();
  director.reset();
  registerDirector(director);
});

afterEach(() => {
  registerDirector(null);
  director.reset();
  session.reset();
  sample.on = false;
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('the scan flow, through the controller', () => {
  it('installs the hooks the director calls back through', () => {
    expect(typeof director.onPoked).toBe('function');
    expect(typeof director.onMetricPicked).toBe('function');
    expect(typeof director.onLongThink).toBe('function');
    expect(voice.attach).toHaveBeenCalledWith(director);
  });

  it('walks into the consult room for a scan and back out when it is cancelled', async () => {
    await startScanFlow('face');
    expect(session.scanActive).toBe(true);
    expect(session.sceneMode).toBe('transitioning');
    vi.advanceTimersByTime(1_000);
    expect(session.sceneMode).toBe('clinical');
    expect(director.character.state).toBe('CLINICAL_ANALYSIS');

    director.setCapture('abc123');
    director.showRoutine();
    cancelScanFlow();
    expect(session.scanActive).toBe(false);
    expect(session.panelMode).toBe('scan');
    expect(director.hologram.capture).toBeNull();
    vi.advanceTimersByTime(1_000);
    expect(session.sceneMode).toBe('lounge');
  });

  it('flips the panel between the reading and the routine, and does nothing without a director', () => {
    togglePanelView();
    expect(session.panelMode).toBe('routine');
    togglePanelView();
    expect(session.panelMode).toBe('scan');

    registerDirector(null);
    togglePanelView();
    expect(session.panelMode).toBe('scan');
  });

  it('opens the capture again after a sign-out halfway through one', async () => {
    enterGuestMode();
    enterScanPage();
    vi.advanceTimersByTime(1_000);
    expect(session.scanActive).toBe(true);
    expect(session.sceneMode).toBe('clinical');

    await signOut();
    expect(session.scanActive).toBe(false);
    expect(session.scanProgress).toBe(0);
    expect(session.sceneMode).toBe('lounge');
    // Her greeting was still in flight: it is abandoned, not delivered to no
    // one (which threw), and it leaves no think behind for the next visit.
    await vi.advanceTimersByTimeAsync(1_000);
    expect(session.thinking).toBe(false);
    expect(session.messages).toEqual([]);

    // Back in, still on /scan: the page must walk into the room again rather
    // than believe a capture is already open.
    enterGuestMode();
    enterScanPage();
    expect(session.scanActive).toBe(true);
    expect(session.sceneMode).toBe('transitioning');
    vi.advanceTimersByTime(1_000);
    expect(session.sceneMode).toBe('clinical');
  });

  it('greets the next visit even when the last one spoke first', async () => {
    enterGuestMode();
    const sent = sendMessage('Hello?');
    await vi.advanceTimersByTimeAsync(3_000);
    await sent;
    await signOut();

    enterGuestMode();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(session.messages.map((m) => m.role)).toEqual(['elohim']);
  });
});

describe('sample mode never writes to the server', () => {
  it('is entered from the gate as a guest visit with sample data on', () => {
    enterSamplePreview();
    expect(sample.on).toBe(true);
    expect(session.guest).toBe(true);
  });

  it('sends a signed-in account\'s messages to the server when sample mode is off', async () => {
    session.user = account;
    api.chat.mockRejectedValue(new Error('offline'));
    const sent = sendMessage('Is my skin dry?');
    await vi.advanceTimersByTimeAsync(3_000);
    await sent;
    expect(api.chat).toHaveBeenCalledTimes(1);
  });

  it('keeps a signed-in account\'s conversation on the local engine while it is on', async () => {
    session.user = account;
    sample.on = true;

    const sent = sendMessage('Is my skin dry?');
    await vi.advanceTimersByTimeAsync(3_000);
    await sent;
    // An event with extras is the one path that uses a raw fetch.
    const event = raiseEvent('scan_complete', undefined, { spokenNarration: 'Hydration first.' });
    await vi.advanceTimersByTimeAsync(3_000);
    await event;

    expect(api.chat).not.toHaveBeenCalled();
    expect(api.chatEvent).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    // Her replies still arrived, from the browser.
    expect(session.messages.filter((m) => m.role === 'elohim').length).toBe(2);
  });

  it('keeps a signed-in account\'s scan in memory and never offers to save it', async () => {
    session.user = account;
    sample.on = true;
    analyseFace.mockResolvedValue({ analysis: reading, imageBase64: 'abc123' });
    api.publicPicks.mockResolvedValue({ plan: null, picks: [] });

    await startScanFlow('face');
    const run = runAnalysis({} as never, 'face');
    await vi.advanceTimersByTimeAsync(5_000);
    await run;

    expect(api.saveScan).not.toHaveBeenCalled();
    expect(api.routinePlan).not.toHaveBeenCalled();
    expect(api.picks).not.toHaveBeenCalled();
    expect(api.chatEvent).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    // The shelf was built from the numbers on screen instead.
    expect(api.publicPicks).toHaveBeenCalledTimes(1);
    expect(session.latestScan).toBe(reading);
    expect(session.pendingCapture?.scanId).toBeUndefined();
    expect(session.pendingCapture?.state).not.toBe('save-available');
    expect(session.scanActive).toBe(false);
  });
});
