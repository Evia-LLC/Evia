/**
 * Sound.
 *
 * There was none, and a silent room is a web page. Everything here is
 * synthesised in the browser from oscillators and filtered noise - no files
 * to download, nothing to license, and every cue is a few lines that can be
 * tuned by ear. The vocabulary is small on purpose:
 *
 *   room      a low, barely-there tone under the clinic, so silence has a floor
 *   tick      the countdown, and each region as it lights
 *   lock      the mesh finding her face: a soft two-note chime
 *   shutter   the capture itself
 *   lift      the head rising into the hologram: a hum that climbs
 *   settle    a reading landing: one warm note
 *   cue       a page turning: a single soft blip
 *   swoosh    a message leaving: air, rising and gone
 *
 * Browsers refuse to make a sound until the page has been touched, so the
 * context is created on the first gesture (`primeSound`) and cues before that
 * are dropped silently. The cues respect one switch, kept in localStorage.
 *
 * The context itself is shared: her voice (voice/cloned.ts) plays through the
 * same `AudioContext`, because on iOS a context is only allowed to run if it
 * was created or resumed inside a user gesture, and there is exactly one
 * place that reliably happens - here, on the first touch. A second context
 * made later, inside a fetch callback, starts suspended and stays that way
 * while reporting success, which is a mouth that moves over silence. The
 * switch governs the cues only; her voice is not "room sound".
 */

const STORAGE_KEY = 'evia.sound';

let context: AudioContext | null = null;
let master: GainNode | null = null;
let room: { gain: GainNode; stop: () => void } | null = null;
let enabled: boolean | null = null;

function readSetting(): boolean {
  if (enabled !== null) return enabled;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    enabled = stored === null ? true : stored === '1';
  } catch {
    enabled = true;
  }
  return enabled;
}

export function soundEnabled(): boolean {
  return readSetting();
}

export function setSoundEnabled(on: boolean): void {
  enabled = on;
  try {
    localStorage.setItem(STORAGE_KEY, on ? '1' : '0');
  } catch {
    // Storage may be unavailable; the setting still holds for the session.
  }
  if (!on) stopRoom();
  if (on && context?.state === 'suspended') void context.resume();
}

/**
 * The one audio context, whatever it is for.
 *
 * Created on demand and never closed. Whether it is allowed to *run* is the
 * browser's decision, made at the first gesture - see `primeSound`.
 */
export function audioContext(): AudioContext | null {
  if (typeof window === 'undefined' || typeof AudioContext === 'undefined') return null;
  if (!context) {
    context = new AudioContext();
    master = context.createGain();
    master.gain.value = 0.9;
    master.connect(context.destination);
  }
  return context;
}

/**
 * Resolves true once the context is actually running.
 *
 * `resume()` outside a gesture may resolve late or, on iOS, not at all until
 * the next touch, so this races it against a short deadline: a caller that
 * is about to move a mouth needs to know now, not eventually.
 */
export async function audioRunning(timeoutMs = 4000): Promise<boolean> {
  const ctx = audioContext();
  if (!ctx) return false;
  // Read through a function: the state changes underneath the await, which
  // the type checker's narrowing does not expect.
  const running = () => ctx.state === 'running';
  if (running()) return true;
  await Promise.race([
    ctx.resume().catch(() => undefined),
    new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
  ]);
  return running();
}

/** The context, for a cue: only when cues are on and the context can run. */
function ready(): AudioContext | null {
  if (!readSetting()) return null;
  const ctx = audioContext();
  if (!ctx) return null;
  if (ctx.state === 'suspended') {
    void ctx.resume();
    if (ctx.state === 'suspended') return null;
  }
  return ctx;
}

/**
 * Called from any touch, pointer or key handler, so the context is unlocked
 * by the first gesture whatever it was for. Runs whether or not the cues are
 * switched off: her voice needs the unlock too.
 */
export function primeSound(): void {
  const ctx = audioContext();
  if (!ctx) return;
  if (ctx.state === 'suspended') void ctx.resume();
  // A silent buffer started inside the gesture is the reliable unlock on iOS.
  const buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.connect(ctx.destination);
  source.start();
  holdMediaSession();
}

/**
 * Keeps iOS treating the page as something that plays media.
 *
 * On an iPhone or iPad, Web Audio counts as an "ambient" sound: it obeys the
 * silent switch and Silent mode, and it can be muted while a media element
 * would not be. The speech synthesiser is not subject to any of this - which
 * is exactly how her own voice could be silent while the robotic one was
 * heard. Playing a looping, silent media element from the first gesture
 * moves the page's audio session into the playback category, and everything
 * the context produces afterwards comes out of the speaker, silent switch
 * or not. The element is kept, and nudged again whenever the page comes
 * back to the foreground, because iOS pauses it in the background.
 */
let session: HTMLAudioElement | null = null;

function silentWav(): string {
  // A tenth of a second of PCM silence, 8 kHz mono, built here rather than
  // shipped: forty-four bytes of header and eight hundred of nothing.
  const samples = 800;
  const bytes = new ArrayBuffer(44 + samples * 2);
  const view = new DataView(bytes);
  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + samples * 2, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 8000, true);
  view.setUint32(28, 16000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, 'data');
  view.setUint32(40, samples * 2, true);
  return URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }));
}

function holdMediaSession(): void {
  if (typeof document === 'undefined' || typeof Audio === 'undefined') return;
  if (!session) {
    session = new Audio(silentWav());
    session.loop = true;
    session.setAttribute('playsinline', '');
    session.preload = 'auto';
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) void session?.play().catch(() => undefined);
    });
  }
  void session.play().catch(() => undefined);
}

function envelope(
  ctx: AudioContext,
  node: AudioNode,
  at: number,
  attack: number,
  hold: number,
  release: number,
  peak: number,
): GainNode {
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(peak, at + attack);
  gain.gain.setValueAtTime(peak, at + attack + hold);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + attack + hold + release);
  node.connect(gain);
  gain.connect(master!);
  return gain;
}

function tone(
  ctx: AudioContext,
  frequency: number,
  type: OscillatorType,
  at: number,
  attack: number,
  hold: number,
  release: number,
  peak: number,
  glideTo?: number,
): void {
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(frequency, at);
  if (glideTo !== undefined) osc.frequency.exponentialRampToValueAtTime(glideTo, at + attack + hold + release);
  envelope(ctx, osc, at, attack, hold, release, peak);
  osc.start(at);
  osc.stop(at + attack + hold + release + 0.05);
}

function noiseBuffer(ctx: AudioContext, seconds: number): AudioBuffer {
  const length = Math.floor(ctx.sampleRate * seconds);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}

// --- cues ------------------------------------------------------------------

/** The countdown, or a region lighting. Short, dry, unmistakable. */
export function tick(pitch = 1): void {
  const ctx = ready();
  if (!ctx) return;
  const t = ctx.currentTime;
  tone(ctx, 1320 * pitch, 'sine', t, 0.004, 0.02, 0.07, 0.11);
  tone(ctx, 2640 * pitch, 'sine', t, 0.002, 0.01, 0.04, 0.04);
}

/** The mesh finding her face. Two notes, rising, soft. */
export function lock(): void {
  const ctx = ready();
  if (!ctx) return;
  const t = ctx.currentTime;
  tone(ctx, 880, 'sine', t, 0.01, 0.06, 0.25, 0.16);
  tone(ctx, 1318.5, 'sine', t + 0.11, 0.01, 0.08, 0.4, 0.14);
  tone(ctx, 2637, 'triangle', t + 0.11, 0.005, 0.02, 0.2, 0.03);
}

/** The capture. A short filtered click with a little body under it. */
export function shutter(): void {
  const ctx = ready();
  if (!ctx) return;
  const t = ctx.currentTime;
  const source = ctx.createBufferSource();
  source.buffer = noiseBuffer(ctx, 0.08);
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = 2400;
  filter.Q.value = 1.2;
  source.connect(filter);
  envelope(ctx, filter, t, 0.002, 0.01, 0.06, 0.22);
  source.start(t);
  tone(ctx, 180, 'sine', t, 0.003, 0.02, 0.09, 0.12, 90);
}

/** The head lifting into the hologram. A hum that climbs over `seconds`. */
export function lift(seconds = 1.4): void {
  const ctx = ready();
  if (!ctx) return;
  const t = ctx.currentTime;
  tone(ctx, 110, 'sawtooth', t, 0.25, seconds * 0.5, seconds * 0.5, 0.05, 220);
  tone(ctx, 220, 'sine', t, 0.3, seconds * 0.5, seconds * 0.5, 0.1, 440);
  tone(ctx, 330, 'sine', t + 0.2, 0.4, seconds * 0.4, seconds * 0.5, 0.05, 660);
  // A whisper of air riding on top.
  const source = ctx.createBufferSource();
  source.buffer = noiseBuffer(ctx, seconds + 0.5);
  const filter = ctx.createBiquadFilter();
  filter.type = 'highpass';
  filter.frequency.setValueAtTime(1200, t);
  filter.frequency.exponentialRampToValueAtTime(6000, t + seconds);
  source.connect(filter);
  envelope(ctx, filter, t, 0.4, seconds * 0.4, seconds * 0.5, 0.03);
  source.start(t);
}

/** A reading landing. One warm note with a fifth above it. */
export function settle(): void {
  const ctx = ready();
  if (!ctx) return;
  const t = ctx.currentTime;
  tone(ctx, 523.25, 'sine', t, 0.02, 0.15, 0.9, 0.14);
  tone(ctx, 784, 'sine', t + 0.06, 0.02, 0.12, 0.8, 0.08);
  tone(ctx, 1046.5, 'triangle', t + 0.12, 0.01, 0.05, 0.5, 0.025);
}

/** A page turning. One soft blip. */
export function cue(): void {
  const ctx = ready();
  if (!ctx) return;
  const t = ctx.currentTime;
  tone(ctx, 1046.5, 'sine', t, 0.008, 0.03, 0.14, 0.07);
}

/**
 * A message leaving. Air rather than a note: a burst of noise through a
 * band-pass that sweeps up and out over a quarter of a second, with a thin
 * rising whistle under it. Quiet, quick, gone before the reply starts.
 */
export function swoosh(): void {
  const ctx = ready();
  if (!ctx) return;
  const t = ctx.currentTime;
  const source = ctx.createBufferSource();
  source.buffer = noiseBuffer(ctx, 0.4);
  const band = ctx.createBiquadFilter();
  band.type = 'bandpass';
  band.Q.value = 1.6;
  band.frequency.setValueAtTime(700, t);
  band.frequency.exponentialRampToValueAtTime(3200, t + 0.22);
  band.frequency.exponentialRampToValueAtTime(5200, t + 0.34);
  source.connect(band);
  envelope(ctx, band, t, 0.03, 0.09, 0.2, 0.16);
  source.start(t);
  source.stop(t + 0.4);
  // The whistle: barely there, pitched up with the air.
  tone(ctx, 900, 'sine', t + 0.02, 0.04, 0.08, 0.16, 0.02, 2400);
}

/** Something went wrong. Low, brief, not a buzzer. */
export function nope(): void {
  const ctx = ready();
  if (!ctx) return;
  const t = ctx.currentTime;
  tone(ctx, 220, 'triangle', t, 0.01, 0.08, 0.18, 0.1, 165);
}

/**
 * The floor under the clinic: filtered noise and a very low tone, far below
 * conversation level. Started when the room opens and faded out when it
 * closes. Calling it twice is harmless.
 */
export function startRoom(): void {
  const ctx = ready();
  if (!ctx || room) return;
  const t = ctx.currentTime;

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(0.035, t + 2.5);
  gain.connect(master!);

  const source = ctx.createBufferSource();
  source.buffer = noiseBuffer(ctx, 4);
  source.loop = true;
  const low = ctx.createBiquadFilter();
  low.type = 'lowpass';
  low.frequency.value = 220;
  source.connect(low);
  low.connect(gain);
  source.start(t);

  const drone = ctx.createOscillator();
  drone.type = 'sine';
  drone.frequency.value = 55;
  const droneGain = ctx.createGain();
  droneGain.gain.value = 0.5;
  drone.connect(droneGain);
  droneGain.connect(gain);
  drone.start(t);

  // A slow breath in the level, so it is a room and not a hiss.
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 0.08;
  const lfoGain = ctx.createGain();
  lfoGain.gain.value = 0.012;
  lfo.connect(lfoGain);
  lfoGain.connect(gain.gain);
  lfo.start(t);

  room = {
    gain,
    stop: () => {
      const now = ctx.currentTime;
      gain.gain.cancelScheduledValues(now);
      gain.gain.setValueAtTime(Math.max(0.0001, gain.gain.value), now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.2);
      setTimeout(() => {
        try {
          source.stop();
          drone.stop();
          lfo.stop();
        } catch {
          // Already stopped.
        }
      }, 1400);
    },
  };
}

export function stopRoom(): void {
  room?.stop();
  room = null;
}
