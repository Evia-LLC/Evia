/**
 * The question this file exists to answer:
 *
 *   Can any user data reach the model API when cloud reasoning is OFF?
 *
 * If yes, this suite fails. PrivacyPanel tells users cloud reasoning is off by
 * default, and the context block Elohim would send carries their name, stated
 * concerns, sensitivities, every remembered fact and their whole scan history.
 * A promise like that has to be enforced by the code that transmits, not by the
 * copy that describes it.
 *
 * The model client itself is mocked, so "did anything leave" is answerable
 * exactly: `structuredTurn` is the single egress point, and the assertion is
 * that it is never invoked. The mock also records what it was called with, so a
 * consented call can be inspected for the data it actually carries.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const structuredTurn = vi.fn();
const classifyTurn = vi.fn();
const getConsents = vi.fn();

vi.mock('../server/ai/claude.ts', () => ({
  MODEL: 'test-model',
  modelAvailable: () => true,
  structuredTurn,
  classifyTurn,
  describeApiError: (err: unknown) => String(err),
}));

vi.mock('../server/ai/budget.ts', () => ({
  allowance: vi.fn(async () => ({ ok: true, reason: '' })),
  record: vi.fn(async () => undefined),
}));

vi.mock('../server/db/users.ts', () => ({
  getConsents,
  getUserSummary: vi.fn(),
  updatePreferences: vi.fn(),
}));

vi.mock('../server/db/chat.ts', () => ({
  currentConversation: vi.fn(async () => 'conv-1'),
  recentMessages: vi.fn(async () => []),
  appendMessage: vi.fn(async () => ({ id: 'msg-1' })),
  upsertMemory: vi.fn(async () => undefined),
  listMemories: vi.fn(async () => []),
}));

/** A context block carrying exactly the kind of data the promise is about. */
const SENSITIVE_BLOCK = [
  '# This user',
  'Name they go by: Ada',
  'Skin type on file: combination',
  'Stated concerns: melasma, post-inflammatory pigmentation',
  'Known sensitivities: fragrance',
  '# What you remember',
  '- [context] pregnancy: user mentioned being pregnant',
].join('\n');

vi.mock('../server/ai/context.ts', () => ({
  buildContext: vi.fn(async () => ({
    user: {
      displayName: 'Ada',
      profile: { skinType: 'combination', concerns: [], sensitivities: [] },
      preferences: { explanationStyle: 'plain' },
    },
    latest: null,
    summary: { scanCount: 0, trends: [], mixedModelVersions: false },
    block: SENSITIVE_BLOCK,
  })),
  withBody: vi.fn((ctx: unknown) => ctx),
  renderMetrics: vi.fn(() => ''),
}));

vi.mock('../server/ai/fallback.ts', () => ({
  respond: vi.fn(() => ({
    text: 'local reply',
    directive: null,
    classification: null,
    memoryWrites: [],
    actions: [],
    demo: true,
  })),
  respondToEvent: vi.fn(() => ({
    text: 'local event reply',
    directive: null,
    classification: null,
    memoryWrites: [],
    actions: [],
    demo: true,
  })),
}));

const { handleTurn, handleEvent } = await import('../server/ai/orchestrator.ts');

beforeEach(() => {
  structuredTurn.mockReset();
  classifyTurn.mockReset();
  classifyTurn.mockResolvedValue({ emotion: 'neutral', intent: 'other', confidence: 0.5 });
  getConsents.mockReset();
  structuredTurn.mockResolvedValue({
    text: 'model reply',
    directive: null,
    memoryWrites: [],
    actions: [],
  });
});

const OFF = { image_storage: false, cloud_reasoning: false };
const ON = { image_storage: false, cloud_reasoning: true };

describe('cloud reasoning OFF', () => {
  it('sends nothing to the model on a chat turn', async () => {
    getConsents.mockResolvedValue(OFF);
    await handleTurn('user-1', 'my skin is dry');
    expect(structuredTurn).not.toHaveBeenCalled();
  });

  it('sends nothing to the model on an app event', async () => {
    getConsents.mockResolvedValue(OFF);
    await handleEvent('user-1', 'opened');
    expect(structuredTurn).not.toHaveBeenCalled();
  });

  it('sends nothing on a scan-complete event, which carries fresh readings', async () => {
    getConsents.mockResolvedValue(OFF);
    await handleEvent('user-1', 'scan_complete');
    expect(structuredTurn).not.toHaveBeenCalled();
  });

  it('still answers, from the labelled local engine', async () => {
    getConsents.mockResolvedValue(OFF);
    const turn = await handleTurn('user-1', 'my skin is dry');
    expect(turn.text).toBe('local reply');
    // `demo` is what the UI reads to say she is answering locally. A silent
    // downgrade would be its own dishonesty.
    expect(turn.demo).toBe(true);
  });

  it('does not reach the model classifier either, even when that is switched on', async () => {
    // The classifier prompt carries the message and the recent turns - the
    // same data the consent is about - so it is not a separate, smaller yes.
    process.env.ELOHIM_MODEL_CLASSIFIER = '1';
    try {
      getConsents.mockResolvedValue(OFF);
      await handleTurn('user-1', 'my skin is dry');
      expect(classifyTurn).not.toHaveBeenCalled();
      expect(structuredTurn).not.toHaveBeenCalled();
    } finally {
      delete process.env.ELOHIM_MODEL_CLASSIFIER;
    }
  });

  it('is the behaviour for a user who has never touched the toggle', async () => {
    // getConsents returns false for a kind with no stored row, so "never
    // decided" and "declined" are the same thing here. That is the point.
    getConsents.mockResolvedValue({ image_storage: false, cloud_reasoning: false });
    await handleTurn('user-new', 'hello');
    expect(structuredTurn).not.toHaveBeenCalled();
  });
});

describe('cloud reasoning ON', () => {
  it('does reach the model', async () => {
    getConsents.mockResolvedValue(ON);
    await handleTurn('user-1', 'my skin is dry');
    expect(structuredTurn).toHaveBeenCalledTimes(1);
  });

  it('is the only condition under which the context block is transmitted', async () => {
    getConsents.mockResolvedValue(ON);
    await handleTurn('user-1', 'my skin is dry');
    const sent = JSON.stringify(structuredTurn.mock.calls[0]);
    expect(sent).toContain('Stated concerns: melasma');
  });
});

describe('the consent is read per request', () => {
  it('stops transmitting as soon as it is revoked', async () => {
    getConsents.mockResolvedValue(ON);
    await handleTurn('user-1', 'first');
    expect(structuredTurn).toHaveBeenCalledTimes(1);

    // No restart, no cache to clear — the next turn reads the stored row again.
    getConsents.mockResolvedValue(OFF);
    await handleTurn('user-1', 'second');
    expect(structuredTurn).toHaveBeenCalledTimes(1);
  });

  it('is read from storage rather than from anything the caller passes', async () => {
    getConsents.mockResolvedValue(OFF);
    await handleTurn('user-1', 'my skin is dry');
    expect(getConsents).toHaveBeenCalledWith('user-1');
    expect(structuredTurn).not.toHaveBeenCalled();
  });
});
