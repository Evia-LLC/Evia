import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CAMERA_START_TIMEOUT_MS, CameraSession } from '../src/scan/camera-session.ts';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function makeStream() {
  const stops = [vi.fn(), vi.fn()];
  const stream = { getTracks: () => stops.map((stop) => ({ stop })) } as unknown as MediaStream;
  return { stream, stops };
}

function makeVideo(play = vi.fn().mockResolvedValue(undefined)) {
  return { srcObject: null, play, pause: vi.fn() } as unknown as HTMLVideoElement;
}

const sessions: CameraSession[] = [];
function session() {
  const camera = new CameraSession();
  sessions.push(camera);
  return camera;
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  sessions.splice(0).forEach((camera) => camera.stop());
  vi.useRealTimers();
});

describe('camera request ownership', () => {
  it('cancels a pending permission request immediately and stops every late track after leaving', async () => {
    const camera = session();
    const pending = deferred<MediaStream>();
    const video = makeVideo();
    const acquisition = camera.start(() => pending.promise, () => video);
    camera.stop();
    expect(await acquisition).toEqual({ kind: 'cancelled' });
    expect(vi.getTimerCount()).toBe(0);
    const late = makeStream();
    pending.resolve(late.stream);
    await Promise.resolve();
    late.stops.forEach((stop) => expect(stop).toHaveBeenCalledOnce());
    expect(video.srcObject).toBeNull();
    expect(video.play).not.toHaveBeenCalled();
  });

  it('times out an ignored permission prompt and permits a fresh explicit retry', async () => {
    const camera = session();
    const pending = deferred<MediaStream>();
    const video = makeVideo();
    const first = camera.start(() => pending.promise, () => video);
    await vi.advanceTimersByTimeAsync(CAMERA_START_TIMEOUT_MS);
    expect(await first).toEqual({ kind: 'timeout' });
    expect(vi.getTimerCount()).toBe(0);

    const retry = makeStream();
    expect(await camera.start(() => Promise.resolve(retry.stream), () => video))
      .toEqual({ kind: 'ready', stream: retry.stream });
    const late = makeStream();
    pending.resolve(late.stream);
    await Promise.resolve();
    late.stops.forEach((stop) => expect(stop).toHaveBeenCalledOnce());
    retry.stops.forEach((stop) => expect(stop).not.toHaveBeenCalled());
    expect(video.srcObject).toBe(retry.stream);
  });

  it('keeps a newer preview when an older request resolves or rejects out of order', async () => {
    const camera = session();
    const pending = deferred<MediaStream>();
    const video = makeVideo();
    const first = camera.start(() => pending.promise, () => video);
    const live = makeStream();
    const second = camera.start(() => Promise.resolve(live.stream), () => video);
    expect(await first).toEqual({ kind: 'cancelled' });
    expect((await second).kind).toBe('ready');
    pending.reject(new DOMException('Dismissed old prompt', 'NotAllowedError'));
    await Promise.resolve();
    expect(video.srcObject).toBe(live.stream);
    live.stops.forEach((stop) => expect(stop).not.toHaveBeenCalled());
  });

  it('releases tracks and detaches the video when playback fails', async () => {
    const camera = session();
    const live = makeStream();
    const error = new DOMException('Preview blocked', 'NotAllowedError');
    const video = makeVideo(vi.fn().mockRejectedValue(error));
    expect(await camera.start(() => Promise.resolve(live.stream), () => video))
      .toEqual({ kind: 'error', phase: 'preview', error });
    live.stops.forEach((stop) => expect(stop).toHaveBeenCalledOnce());
    expect(video.srcObject).toBeNull();
    expect(video.pause).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cancels during video.play and ignores its late completion', async () => {
    const camera = session();
    const live = makeStream();
    const playback = deferred<void>();
    const video = makeVideo(vi.fn().mockReturnValue(playback.promise));
    const start = camera.start(() => Promise.resolve(live.stream), () => video);
    await Promise.resolve();
    expect(video.srcObject).toBe(live.stream);
    camera.stop();
    expect(await start).toEqual({ kind: 'cancelled' });
    playback.resolve();
    await Promise.resolve();
    expect(video.srcObject).toBeNull();
    live.stops.forEach((stop) => expect(stop).toHaveBeenCalledOnce());
    expect(vi.getTimerCount()).toBe(0);
  });

  it('also bounds a playback promise that never settles', async () => {
    const camera = session();
    const live = makeStream();
    const video = makeVideo(vi.fn().mockReturnValue(new Promise(() => {})));
    const start = camera.start(() => Promise.resolve(live.stream), () => video);
    await vi.advanceTimersByTimeAsync(CAMERA_START_TIMEOUT_MS);
    expect(await start).toEqual({ kind: 'timeout' });
    live.stops.forEach((stop) => expect(stop).toHaveBeenCalledOnce());
    expect(video.srcObject).toBeNull();
  });

  it('requests permission in the initiating call and reads the preview after the DOM can mount', async () => {
    const camera = session();
    const pending = deferred<MediaStream>();
    const acquire = vi.fn(() => pending.promise);
    let video: HTMLVideoElement | null = null;
    const start = camera.start(acquire, () => video);
    expect(acquire).toHaveBeenCalledOnce();
    video = makeVideo();
    const live = makeStream();
    pending.resolve(live.stream);
    expect((await start).kind).toBe('ready');
    expect(video.srcObject).toBe(live.stream);
    camera.stop();
    camera.stop();
    live.stops.forEach((stop) => expect(stop).toHaveBeenCalledOnce());
    expect(video.srcObject).toBeNull();
  });

  it('releases an acquired stream when the preview element is gone', async () => {
    const camera = session();
    const live = makeStream();
    const result = await camera.start(() => Promise.resolve(live.stream), () => null);
    expect(result).toMatchObject({ kind: 'error', phase: 'preview' });
    live.stops.forEach((stop) => expect(stop).toHaveBeenCalledOnce());
  });

  it('returns a permission denial without keeping a timer or invoking playback', async () => {
    const camera = session();
    const video = makeVideo();
    const error = new DOMException('Denied', 'NotAllowedError');
    expect(await camera.start(() => Promise.reject(error), () => video))
      .toEqual({ kind: 'error', phase: 'acquire', error });
    expect(video.play).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
