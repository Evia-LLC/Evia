/**
 * The sample-only deployment (VITE_SAMPLE_DEMO=1, the `sample_demo` release
 * profile vercel.json builds) meets this branch's sample mode.
 *
 * Visitors arrive in sample mode. The gate's two ways in stay different: the
 * sample preview keeps sample data on, while "Look around without an account"
 * is the live guest visit that DEMO_USER_TEST step 5 walks through (chat, then
 * /scan with the facial consent, the camera and a local reading), so it sets
 * sample data aside. Signing out goes back to the deployment's default. A
 * signed-in account found at boot keeps sample data aside, as it was at sign-in.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  chat: vi.fn(),
  chatEvent: vi.fn(),
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

vi.stubEnv('VITE_SAMPLE_DEMO', '1');

const { enterLiveGuest, enterSamplePreview, signOut } = await import('../src/state/controller.ts');
const { SAMPLE_ONLY_DEPLOYMENT, readSampleAtBoot, sample, sampleForRestoredAccount } = await import(
  '../src/sample/mode.svelte.ts'
);
const { session } = await import('../src/state/session.svelte.ts');

function stubBrowser(href: string, storage = new Map<string, string>()) {
  vi.stubGlobal('window', {
    location: { href },
    history: { state: null, replaceState: vi.fn() },
  });
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => void storage.set(k, v),
    removeItem: (k: string) => void storage.delete(k),
  });
  return storage;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new Error('no network in this test');
    }),
  );
  session.reset();
  sample.on = true;
});

afterEach(() => {
  session.reset();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('a sample-only deployment', () => {
  it('is this build', () => {
    expect(SAMPLE_ONLY_DEPLOYMENT).toBe(true);
  });

  it('starts a visitor with no stored choice in sample mode', () => {
    sample.on = false;
    stubBrowser('https://evia.example/');
    readSampleAtBoot();
    expect(sample.on).toBe(true);
  });

  it('makes the guest way the live visit, and signing out brings sample mode back', async () => {
    enterLiveGuest();
    expect(session.guest).toBe(true);
    expect(sample.on).toBe(false);

    await signOut();
    expect(session.guest).toBe(false);
    expect(sample.on).toBe(true);
  });

  it('keeps sample data on for the preview way', async () => {
    enterSamplePreview();
    expect(session.guest).toBe(true);
    expect(sample.on).toBe(true);

    await signOut();
    expect(sample.on).toBe(true);
  });

  it('keeps sample data aside for an account found signed in at boot, unless the address asked for it', () => {
    stubBrowser('https://evia.example/progress');
    readSampleAtBoot();
    expect(sample.on).toBe(true);
    sampleForRestoredAccount();
    expect(sample.on).toBe(false);

    stubBrowser('https://evia.example/progress?sample=1');
    readSampleAtBoot();
    sampleForRestoredAccount();
    expect(sample.on).toBe(true);
  });
});
