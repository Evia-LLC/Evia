import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const session: Record<string, any> = {
    reset: vi.fn(function (this: Record<string, any>) {
      Object.assign(this, { user: null, messages: [], scans: [], summary: null, latestScan: null,
        bodyScans: [], latestBody: null, localImages: {}, lastMesh: null,
        entryStage: 'film', onboardingActive: false });
    }),
  };
  return {
    session,
    api: Object.fromEntries(['health', 'me', 'login', 'register', 'logout', 'chatHistory', 'scans', 'scanSummary', 'bodyScans']
      .map(name => [name, vi.fn()])),
    setToken: vi.fn(),
    voice: { prepare: vi.fn(), dispose: vi.fn(), attach: vi.fn() },
    router: { go: vi.fn(), is: vi.fn() },
  };
});
vi.mock('@/lib/api.ts', () => ({ api: mocks.api, setToken: mocks.setToken,
  ApiError: class ApiError extends Error { constructor(public status: number, message: string) { super(message); } } }));
vi.mock('@/state/session.svelte.ts', () => ({ session: mocks.session }));
vi.mock('@/voice/controller.ts', () => ({ voice: mocks.voice }));
vi.mock('@/router/router.svelte.ts', () => ({ router: mocks.router }));
vi.mock('@/skin-analysis/pipeline.ts', () => ({ analyseFace: vi.fn(), CaptureRejected: class extends Error {} }));
vi.mock('@/body-analysis/pipeline.ts', () => ({ analyseBody: vi.fn(), BodyCaptureRejected: class extends Error {},
  PoseUnavailable: class extends Error {}, ProfileRejected: class extends Error {} }));
vi.mock('@/lib/sound.ts', () => ({}));

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const health = { modelAvailable: true, demoMode: false, imageStorage: false, guestVoice: true, database: true };
const caps = { canListen: false, canSpeak: true, voiceName: 'AI voice', cloned: true };
const user = (id: string) => ({ id, displayName: id, preferences: { locale: 'en', voiceURI: null } });
const credentials = (id: string) => ({ token: `token-${id}`, user: user(id) });
async function flush() { for (let i = 0; i < 12; i++) await Promise.resolve(); }

let controller: typeof import('../src/state/controller.ts');
beforeEach(async () => {
  vi.resetModules(); vi.clearAllMocks(); vi.useFakeTimers();
  for (const fn of Object.values(mocks.api)) fn.mockReset();
  mocks.voice.prepare.mockReset().mockResolvedValue(caps);
  mocks.session.reset();
  Object.assign(mocks.session, { guest: false, introPlaying: false, serverReachable: true,
    databaseAvailable: true, modelAvailable: false, chatError: null, voiceStatus: '', canSpeak: false });
  mocks.api.health.mockResolvedValue(health);
  mocks.api.me.mockResolvedValue({ user: user('restored'), modelAvailable: true });
  mocks.api.login.mockResolvedValue(credentials('signed-in'));
  mocks.api.register.mockResolvedValue(credentials('new-account'));
  mocks.api.logout.mockResolvedValue({ ok: true });
  mocks.api.chatHistory.mockResolvedValue({ messages: [{ id: 'saved-chat' }] });
  mocks.api.scans.mockResolvedValue({ scans: [{ id: 'saved-face' }] });
  mocks.api.scanSummary.mockResolvedValue({ summary: { count: 1 } });
  mocks.api.bodyScans.mockResolvedValue({ scans: [{ id: 'saved-body' }] });
  controller = await import('../src/state/controller.ts');
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

describe('account restoration respects an explicit choice', () => {
  it('restores an untouched session and its history', async () => {
    await controller.bootstrap();
    expect(mocks.session.user.id).toBe('restored');
    expect(mocks.session.messages).toEqual([{ id: 'saved-chat' }]);
    expect(mocks.session.scans).toEqual([{ id: 'saved-face' }]);
    expect(mocks.session.bodyScans).toEqual([{ id: 'saved-body' }]);
  });

  it('does not even request the account after a guest choice during health loading', async () => {
    const pending = deferred<typeof health>(); mocks.api.health.mockReturnValue(pending.promise);
    const boot = controller.bootstrap(); controller.enterGuestMode(); pending.resolve(health); await boot;
    expect(mocks.session.user.id).toBe('guest'); expect(mocks.api.me).not.toHaveBeenCalled();
  });

  it('ignores a normal-path account response after the visitor chooses guest mode', async () => {
    const pending = deferred<any>(); mocks.api.me.mockReturnValue(pending.promise);
    const boot = controller.bootstrap(); await flush(); controller.enterGuestMode();
    pending.resolve({ user: user('old-account'), modelAvailable: true }); await boot;
    expect(mocks.session.user.id).toBe('guest'); expect(mocks.session.guest).toBe(true);
    expect(mocks.api.chatHistory).not.toHaveBeenCalled();
  });

  it('does not replace an intake that began while account restoration was pending', async () => {
    const pending = deferred<any>(); mocks.api.me.mockReturnValue(pending.promise);
    const boot = controller.bootstrap(); await flush(); mocks.session.onboardingActive = true;
    pending.resolve({ user: user('old-account'), modelAvailable: true }); await boot;
    expect(mocks.session.user).toBeNull(); expect(mocks.session.onboardingActive).toBe(true);
    expect(mocks.api.chatHistory).not.toHaveBeenCalled();
  });

  it('guards the cold-start restoration path too', async () => {
    mocks.api.health.mockReturnValue(new Promise(() => {}));
    const pending = deferred<any>(); mocks.api.me.mockReturnValue(pending.promise);
    const boot = controller.bootstrap(); await vi.advanceTimersByTimeAsync(3500); await boot;
    expect(mocks.api.me).toHaveBeenCalledOnce(); controller.enterGuestMode();
    pending.resolve({ user: user('old-account'), modelAvailable: true }); await flush();
    expect(mocks.session.user.id).toBe('guest'); expect(mocks.api.chatHistory).not.toHaveBeenCalled();
  });

  it('does not replace onboarding with a cold-start account response', async () => {
    mocks.api.health.mockReturnValue(new Promise(() => {}));
    const pending = deferred<any>(); mocks.api.me.mockReturnValue(pending.promise);
    const boot = controller.bootstrap(); await vi.advanceTimersByTimeAsync(3500); await boot;
    mocks.session.onboardingActive = true;
    pending.resolve({ user: user('old-account'), modelAvailable: true }); await flush();
    expect(mocks.session.user).toBeNull(); expect(mocks.api.chatHistory).not.toHaveBeenCalled();
  });

  it('cannot restore a signed-out account even though its local identity is empty again', async () => {
    const pending = deferred<any>(); mocks.api.me.mockReturnValue(pending.promise);
    const boot = controller.bootstrap(); await flush(); await controller.signOut();
    pending.resolve({ user: user('old-account'), modelAvailable: true }); await boot;
    expect(mocks.session.user).toBeNull(); expect(mocks.api.chatHistory).not.toHaveBeenCalled();
  });

  it('handles cold-start account lookup rejection without an unhandled promise', async () => {
    mocks.api.health.mockReturnValue(new Promise(() => {}));
    const pending = deferred<any>(); mocks.api.me.mockReturnValue(pending.promise);
    const boot = controller.bootstrap(); await vi.advanceTimersByTimeAsync(3500); await boot;
    pending.reject(new Error('offline')); await flush();
    expect(mocks.session.serverReachable).toBe(false); expect(mocks.session.user).toBeNull();
  });

  it('does not overwrite a newly registered account with a delayed restored account', async () => {
    const pending = deferred<any>(); mocks.api.me.mockReturnValue(pending.promise);
    const boot = controller.bootstrap(); await flush();
    await controller.register('new@example.test', 'password', 'New');
    pending.resolve({ user: user('old-account'), modelAvailable: false }); await boot;
    expect(mocks.session.user.id).toBe('new-account');
    expect(mocks.setToken).toHaveBeenLastCalledWith('token-new-account');
  });
});

describe('authentication commits separately from optional hydration', () => {
  it('completes signup immediately while voice and history are still pending', async () => {
    mocks.api.chatHistory.mockReturnValue(new Promise(() => {}));
    mocks.voice.prepare.mockReturnValue(new Promise(() => {}));
    mocks.session.onboardingActive = true; mocks.session.introPlaying = true; mocks.session.entryStage = 'intake';
    await controller.register('new@example.test', 'password', 'New');
    expect(mocks.session.user.id).toBe('new-account');
    expect(mocks.session.onboardingActive).toBe(true); expect(mocks.session.entryStage).toBe('intake');
    expect(mocks.setToken).toHaveBeenLastCalledWith('token-new-account');
  });

  it('keeps a created account when voice and history both fail', async () => {
    mocks.api.chatHistory.mockRejectedValue(new Error('history unavailable'));
    mocks.voice.prepare.mockRejectedValue(new Error('voice unavailable'));
    await expect(controller.register('new@example.test', 'password', 'New')).resolves.toBeUndefined(); await flush();
    expect(mocks.session.user.id).toBe('new-account');
    expect(mocks.session.chatError).toContain('saved history');
    expect(mocks.session.voiceStatus).toContain('continue with text');
  });

  it('does not treat failed history loading as failed sign-in', async () => {
    mocks.api.scans.mockRejectedValue(new Error('history unavailable'));
    await expect(controller.signIn('account@example.test', 'password')).resolves.toBeUndefined();
    expect(mocks.session.user.id).toBe('signed-in');
  });

  it('still rejects failed account creation without committing an identity', async () => {
    mocks.api.register.mockRejectedValue(new Error('Email already used'));
    await expect(controller.register('new@example.test', 'password', 'New')).rejects.toThrow('Email already used');
    expect(mocks.session.user).toBeNull(); expect(mocks.setToken).not.toHaveBeenCalled();
  });

  it('clears old private data immediately when a new identity is accepted', async () => {
    mocks.session.user = user('previous'); mocks.session.messages = [{ id: 'private' }];
    mocks.session.localImages = { private: 'pixels' }; mocks.session.scans = [{ id: 'private-face' }];
    mocks.api.chatHistory.mockReturnValue(new Promise(() => {}));
    await controller.register('new@example.test', 'password', 'New');
    expect(mocks.session.messages).toEqual([]); expect(mocks.session.localImages).toEqual({});
    expect(mocks.session.scans).toEqual([]);
  });

  it('drops history that completes after the account switches to a guest', async () => {
    const pending = deferred<any>(); mocks.api.chatHistory.mockReturnValue(pending.promise);
    await controller.register('new@example.test', 'password', 'New'); controller.enterGuestMode();
    pending.resolve({ messages: [{ id: 'private-old-account' }] }); await flush();
    expect(mocks.session.user.id).toBe('guest'); expect(mocks.session.messages).toEqual([]);
    expect(mocks.session.scans).toEqual([]); expect(mocks.session.bodyScans).toEqual([]);
  });

  it('preserves new conversation and scan data created while signup hydration was pending', async () => {
    const pending = deferred<any>(); mocks.api.chatHistory.mockReturnValue(pending.promise);
    await controller.register('new@example.test', 'password', 'New');
    const freshFace = { id: 'new-face' }, freshBody = { id: 'new-body' };
    mocks.session.messages = [{ id: 'new-conversation' }];
    mocks.session.scans = [freshFace]; mocks.session.latestScan = freshFace;
    mocks.session.bodyScans = [freshBody]; mocks.session.latestBody = freshBody;
    mocks.session.summary = { count: 99 };
    pending.resolve({ messages: [] }); await flush();
    expect(mocks.session.messages).toEqual([{ id: 'new-conversation' }]);
    expect(mocks.session.latestScan).toBe(freshFace); expect(mocks.session.latestBody).toBe(freshBody);
    expect(mocks.session.summary).toEqual({ count: 99 });
  });

  it('drops an older account history load after a newer account signs in', async () => {
    const pending = deferred<any>(); mocks.api.chatHistory.mockReturnValueOnce(pending.promise)
      .mockResolvedValue({ messages: [{ id: 'new-account-chat' }] });
    await controller.register('new@example.test', 'password', 'New');
    await controller.signIn('other@example.test', 'password');
    pending.resolve({ messages: [{ id: 'private-old-account' }] }); await flush();
    expect(mocks.session.user.id).toBe('signed-in');
    expect(mocks.session.messages).toEqual([{ id: 'new-account-chat' }]);
  });

  it('does not apply stale voice capabilities to the selected guest', async () => {
    const pending = deferred<typeof caps>(); mocks.voice.prepare.mockReturnValueOnce(pending.promise)
      .mockResolvedValue({ ...caps, canSpeak: false, voiceName: null, cloned: false });
    await controller.register('new@example.test', 'password', 'New'); controller.enterGuestMode(); await flush();
    pending.resolve(caps); await flush();
    expect(mocks.session.canSpeak).toBe(false); expect(mocks.session.voiceName).toBeNull();
  });
});

describe('only the latest explicit authentication action commits', () => {
  it('ignores an older sign-in response after a newer sign-in succeeds', async () => {
    const pending = deferred<any>(); mocks.api.login.mockReturnValueOnce(pending.promise).mockResolvedValue(credentials('latest'));
    const old = controller.signIn('old@example.test', 'password'); const rejection = expect(old).rejects.toThrow('cancelled');
    await controller.signIn('latest@example.test', 'password'); pending.resolve(credentials('old')); await rejection;
    expect(mocks.session.user.id).toBe('latest'); expect(mocks.setToken).toHaveBeenCalledTimes(1);
  });

  it('does not enter an account after guest mode cancels pending signup', async () => {
    const pending = deferred<any>(); mocks.api.register.mockReturnValue(pending.promise);
    const registration = controller.register('new@example.test', 'password', 'New');
    const rejection = expect(registration).rejects.toThrow('cancelled'); controller.enterGuestMode();
    pending.resolve(credentials('late')); await rejection;
    expect(mocks.session.user.id).toBe('guest'); expect(mocks.setToken).toHaveBeenCalledExactlyOnceWith(null);
  });

  it('clears local data and routes sign-out to the film landing', async () => {
    mocks.session.user = user('account'); mocks.session.messages = [{ id: 'private' }];
    await controller.signOut();
    expect(mocks.session.user).toBeNull(); expect(mocks.session.messages).toEqual([]);
    expect(mocks.session.guest).toBe(false); expect(mocks.router.go).toHaveBeenLastCalledWith('/');
    expect(mocks.setToken).toHaveBeenLastCalledWith(null);
  });

  it('keeps a newer identity when an earlier sign-out finishes late', async () => {
    mocks.session.user = user('old'); const pending = deferred<any>(); mocks.api.logout.mockReturnValue(pending.promise);
    const logout = controller.signOut(); await controller.signIn('new@example.test', 'password');
    pending.resolve({ ok: true }); await logout;
    expect(mocks.session.user.id).toBe('signed-in'); expect(mocks.router.go).not.toHaveBeenCalled();
    expect(mocks.setToken).toHaveBeenLastCalledWith('token-signed-in');
  });

  it('still clears local identity if server sign-out fails, while reporting the failure', async () => {
    mocks.session.user = user('old'); mocks.api.logout.mockRejectedValue(new Error('offline'));
    await expect(controller.signOut()).rejects.toThrow('offline');
    expect(mocks.session.user).toBeNull(); expect(mocks.router.go).toHaveBeenCalledWith('/');
  });
});

describe('a fresh scan clears the previous presentation before entering the clinic', () => {
  it.each(['face', 'body'] as const)('clears prior %s readouts with the real director cleanup', async (kind) => {
    const { SessionDirector } = await import('../src/scene/director.ts');
    const holograms = { shutdown: vi.fn(), setFaceMesh: vi.fn() };
    const director = {
      clearScanPresentation() { SessionDirector.prototype.clearScanPresentation.call({ holograms } as any); },
      enterClinical: vi.fn(async () => {
        expect(mocks.session.scanResultVisible).toBe(false);
        expect(mocks.session.lastMesh).toBeNull();
        expect(holograms.shutdown).toHaveBeenCalledOnce();
        expect(holograms.setFaceMesh).toHaveBeenCalledWith(null);
      }),
    };
    controller.registerDirector(director as any);
    mocks.session.scanResultVisible = true;
    mocks.session.lastMesh = { points: ['previous-face'] };
    mocks.session.latestScan = { id: 'seed-history' };
    mocks.session.scanProgress = 1;
    await controller.startScanFlow(kind);
    expect(director.enterClinical).toHaveBeenCalledOnce();
    expect(mocks.session.scanKind).toBe(kind);
    expect(mocks.session.scanProgress).toBe(0);
    // History remains available on Progress, but the clinic does not display it.
    expect(mocks.session.latestScan).toEqual({ id: 'seed-history' });
  });

  it('also hides a previous result when the director is not ready yet', async () => {
    mocks.session.scanResultVisible = true; mocks.session.lastMesh = { points: ['previous-face'] };
    await controller.startScanFlow('face');
    expect(mocks.session.scanResultVisible).toBe(false);
    expect(mocks.session.lastMesh).toBeNull();
  });
});
