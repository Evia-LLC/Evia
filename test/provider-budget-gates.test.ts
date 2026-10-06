/** P1-T08: no paid provider request may run after budget admission fails. */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { admit, anthropicCreate, dbRow, dbRun, vendorFetch } = vi.hoisted(() => ({
  admit: vi.fn(),
  anthropicCreate: vi.fn(),
  dbRow: vi.fn(),
  dbRun: vi.fn(),
  vendorFetch: vi.fn(),
}));

vi.mock('../server/ai/budget.ts', () => ({
  withReservation: admit,
  BudgetDispatchError: class BudgetDispatchError extends Error {
    dispatched: boolean;
    constructor(message: string, dispatched: boolean) {
      super(message);
      this.dispatched = dispatched;
    }
  },
}));

vi.mock('@anthropic-ai/sdk', () => ({
  default: class Anthropic {
    messages = { create: anthropicCreate };
  },
  AuthenticationError: class AuthenticationError extends Error {},
}));

vi.mock('../server/db/index.ts', () => ({ row: dbRow, run: dbRun }));

const { structuredTurn, classifyTurn, readProductLabel } = await import('../server/ai/claude.ts');
const { analyseWithPerfectCorp } = await import('../server/ai/perfectcorp.ts');
const { speakLine } = await import('../server/voice/tts.ts');

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('ANTHROPIC_API_KEY', 'test-key');
  vi.stubEnv('PERFECTCORP_API_KEY', 'test-key');
  vi.stubEnv('ELOHIM_VOICE_API_KEY', 'test-key');
  vi.stubEnv('ELOHIM_VOICE_ID', 'voice-id');
  admit.mockRejectedValue(new Error('over budget: global_turns'));
  dbRow.mockResolvedValue(undefined);
  dbRun.mockResolvedValue(undefined);
});

describe('Anthropic dispatch gates', () => {
  it('blocks model, classifier and label calls before SDK network I/O', async () => {
    await expect(structuredTurn({
      userId: 'u1', personaPrefix: 'p', contextBlock: 'c', messages: [], schema: {},
    })).rejects.toThrow('over budget');
    await expect(classifyTurn('classify this', {}, 'u1')).rejects.toThrow('over budget');
    await expect(readProductLabel('/9j/4AAQ', 'image/jpeg', 'u1')).rejects.toThrow('over budget');
    expect(anthropicCreate).not.toHaveBeenCalled();
    expect(admit).toHaveBeenCalledTimes(3);
  });
});

describe('vision and voice dispatch gates', () => {
  it('blocks Perfect Corp before the first upload request', async () => {
    await expect(analyseWithPerfectCorp(new Uint8Array([255, 216, 255, 217]), {
      userId: 'u1', fetch: vendorFetch,
    })).rejects.toThrow('over budget');
    expect(vendorFetch).not.toHaveBeenCalled();
  });

  it('blocks an uncached voice line before ElevenLabs network I/O', async () => {
    await expect(speakLine('A new line.', {}, 'u1')).rejects.toThrow('over budget');
    expect(vendorFetch).not.toHaveBeenCalled();
    expect(admit).toHaveBeenCalledTimes(1);
  });

  it('serves a cached voice line without a reservation or provider request', async () => {
    dbRow.mockResolvedValue({
      audio: Buffer.from('audio'), content_type: 'audio/mpeg', words_json: '[]', duration: 1,
      created_at: new Date().toISOString(),
    });
    // P1-T11: only exact stock-line hits are cacheable, so the cached
    // fixture must be a real stock sentence; arbitrary text always misses.
    const line = await speakLine("Hey, it's Elohim. This is what I sound like.", {}, 'u1');
    expect(line.cached).toBe(true);
    expect(admit).not.toHaveBeenCalled();
    expect(vendorFetch).not.toHaveBeenCalled();
  });
});
