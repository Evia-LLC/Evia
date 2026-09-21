import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({ row: vi.fn(), run: vi.fn(), rows: new Map<string, unknown>() }));
vi.mock('../server/db/index.ts', () => ({ row: db.row, run: db.run }));
vi.mock('../server/lib/log.ts', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
import { speakLine, voiceConfig, voiceCacheKey, wavFromPCM, VoiceUnavailable } from '../server/voice/tts.ts';
import { VOICE_PREVIEW_LINE } from '../src/lib/lines.ts';

beforeEach(() => {
  vi.stubEnv('OPENAI_API_KEY', 'test-only-placeholder');
  for (const key of ['OPENAI_TTS_MODEL', 'OPENAI_TTS_VOICE', 'OPENAI_TTS_INSTRUCTIONS']) vi.stubEnv(key, '');
  vi.stubEnv('OPENAI_TTS_SPEED', '1');
  db.rows.clear(); db.row.mockReset(); db.run.mockReset();
  db.row.mockImplementation(async (_sql: string, key: string) => db.rows.get(key));
  db.run.mockImplementation(async (sql: string, ...args: unknown[]) => {
    if (sql.startsWith('INSERT')) db.rows.set(args[0] as string, {
      audio: args[4], content_type: args[5], words_json: args[6], duration: args[7],
    });
  });
  vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array(48_000), { headers: { 'Content-Type': 'audio/pcm' } })));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('one OpenAI voice and truthful timing', () => {
  it('requires an OpenAI server key and never falls through to legacy credentials', async () => {
    vi.stubEnv('OPENAI_API_KEY', ''); vi.stubEnv('ELOHIM_VOICE_API_KEY', 'legacy'); vi.stubEnv('ELOHIM_VOICE_ID', 'old');
    expect(voiceConfig()).toBeNull(); await expect(speakLine('Hello')).rejects.toBeInstanceOf(VoiceUnavailable);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('defaults to the pinned mini TTS model and Marin', () => {
    expect(voiceConfig()).toMatchObject({ voiceId: 'marin', modelId: 'gpt-4o-mini-tts-2025-12-15', speed: 1 });
  });
  it('validates speed and caps instructions without consulting an arbitrary endpoint', () => {
    vi.stubEnv('OPENAI_TTS_SPEED', 'NaN'); vi.stubEnv('OPENAI_TTS_INSTRUCTIONS', 'a'.repeat(5000));
    vi.stubEnv('ELOHIM_VOICE_ENDPOINT', 'https://untrusted.invalid');
    expect(voiceConfig()?.speed).toBe(1); expect(voiceConfig()?.instructions.length).toBe(4096);
    expect(voiceConfig()?.endpoint).toBe('https://api.openai.com/v1/audio/speech');
  });
  it('sends the exact OpenAI speech schema and returns audio without fabricated alignment', async () => {
    const result = await speakLine('Hello **there** ✨.');
    const [url, request] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe('https://api.openai.com/v1/audio/speech');
    expect(JSON.parse(request!.body as string)).toMatchObject({ model: 'gpt-4o-mini-tts-2025-12-15', voice: 'marin',
      input: 'Hello there .', response_format: 'pcm', stream_format: 'audio', speed: 1 });
    expect(request!.headers).toHaveProperty('Authorization', 'Bearer test-only-placeholder');
    expect(request!.signal).toBeInstanceOf(AbortSignal);
    expect(result.contentType).toBe('audio/wav'); expect(result.words).toEqual([]);
    expect(result.duration).toBe(1); expect(result.chunks[0].words).toEqual([]);
  });
  it('writes a correctly sized mono 24 kHz signed 16-bit WAV', () => {
    const wav = wavFromPCM(Buffer.alloc(24_000));
    expect(wav.toString('ascii', 0, 4)).toBe('RIFF'); expect(wav.readUInt32LE(4)).toBe(wav.length - 8);
    expect(wav.readUInt16LE(22)).toBe(1); expect(wav.readUInt32LE(24)).toBe(24_000);
    expect(wav.readUInt16LE(34)).toBe(16); expect(wav.readUInt32LE(40)).toBe(24_000);
  });
  it('rejects empty or partial PCM samples', () => {
    expect(() => wavFromPCM(Buffer.alloc(0))).toThrow(); expect(() => wavFromPCM(Buffer.alloc(3))).toThrow();
  });
  it('keys cache by voice, model, instructions and speed without the credential', () => {
    const config = voiceConfig()!; const baseline = voiceCacheKey(config, 'hello');
    for (const override of [{ voiceId: 'coral' }, { modelId: 'other' }, { instructions: 'different' }, { speed: 0.9 }]) {
      expect(voiceCacheKey({ ...config, ...override }, 'hello')).not.toBe(baseline);
    }
    expect(voiceCacheKey({ ...config, apiKey: 'different-secret' }, 'hello')).toBe(baseline);
  });
  it('reuses cached audio and derives duration from samples rather than cached estimates', async () => {
    await speakLine(VOICE_PREVIEW_LINE);
    const cached = [...db.rows.values()][0] as { duration: number; words_json: string };
    cached.duration = 999; cached.words_json = '[{"word":"not alignment"}]';
    const result = await speakLine(VOICE_PREVIEW_LINE);
    expect(result.cached).toBe(true); expect(result.duration).toBe(1); expect(result.words).toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('never reads or writes personal replies in the durable shared cache', async () => {
    const personal = 'Ada, you told me about your pregnancy and skin concerns.';
    await speakLine(personal);
    await speakLine(personal);
    expect(db.row).not.toHaveBeenCalled(); expect(db.run).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('does not let a public sentence prefix allowlist a personal extension', async () => {
    await speakLine(`${VOICE_PREVIEW_LINE} Ada, you mentioned a pregnancy.`);
    const written = db.run.mock.calls.filter(([sql]) => String(sql).startsWith('INSERT'));
    expect(written.every((call) => call[4] === VOICE_PREVIEW_LINE)).toBe(true);
    expect(written.some((call) => String(call[4]).includes('pregnancy'))).toBe(false);
  });
  it('deduplicates simultaneous requests for the same sentence', async () => {
    const results = await Promise.all([speakLine('A repeated greeting.'), speakLine('A repeated greeting.')]);
    expect(fetch).toHaveBeenCalledTimes(1); expect(results[0].audio).toEqual(results[1].audio);
  });
  it('joins multiple sentences into one valid WAV rather than concatenating WAV headers', async () => {
    const line = 'This first sentence is long enough to form its own audio chunk. This second sentence is also long enough to form another audio chunk.';
    const result = await speakLine(line);
    expect(result.chunks.length).toBe(2); expect(result.duration).toBe(2);
    expect(result.audio.length).toBe(96_044); expect(result.audio.readUInt32LE(40)).toBe(96_000);
    expect(result.chunks[1].start).toBe(1);
    expect(line.slice(result.chunks[1].charOffset)).toBe(result.chunks[1].text);
  });
  it('does not cache provider failures and permits a later retry', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response('private provider detail', { status: 429 }));
    await expect(speakLine('Try again.')).rejects.toThrow('429'); expect(db.rows.size).toBe(0);
    expect((await speakLine('Try again.')).duration).toBe(1); expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('rejects invalid provider audio instead of caching a successful-looking empty clip', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(new Uint8Array(3)));
    await expect(speakLine('Invalid clip.')).rejects.toThrow('invalid PCM'); expect(db.rows.size).toBe(0);
  });
});
