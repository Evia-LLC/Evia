import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
const legacy = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock('@anthropic-ai/sdk', () => {
  class APIError extends Error {}
  class AuthenticationError extends APIError {}
  class RateLimitError extends APIError {}
  class BadRequestError extends APIError {}
  class APIConnectionError extends APIError {}
  class Anthropic {
    messages = { create: legacy.create };
    static APIError = APIError; static AuthenticationError = AuthenticationError;
    static RateLimitError = RateLimitError; static BadRequestError = BadRequestError;
    static APIConnectionError = APIConnectionError;
  }
  return { default: Anthropic };
});
vi.mock('../server/lib/log.ts', () => ({ log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
import { openAIStructured, strictSchema, restoreOptionalFields, ModelRefusal, OpenAIRequestError } from '../server/ai/openai.ts';
import { structuredTurn, classifyTurn, describeSkinImage, readProductLabel, modelAvailable, describeApiError, openAIInput } from '../server/ai/claude.ts';
import { TURN_SCHEMA } from '../server/ai/persona.ts';

const schema = { type: 'object', additionalProperties: false, required: ['answer'],
  properties: { answer: { type: 'string' }, reason: { type: 'string' } } };
function output(value: unknown, overrides: Record<string, unknown> = {}) {
  return new Response(JSON.stringify({ status: 'completed',
    output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: JSON.stringify(value) }] }],
    usage: { input_tokens: 100, output_tokens: 20, input_tokens_details: { cached_tokens: 30, cache_write_tokens: 10 } },
    ...overrides,
  }));
}
const opts = () => ({ model: 'gpt-4.1-2025-04-14', instructions: 'Test instructions', input: [{ role: 'user' as const, content: 'Hello' }], schema });
const request = () => JSON.parse(vi.mocked(fetch).mock.calls.at(-1)![1]!.body as string);
beforeEach(() => {
  vi.stubEnv('OPENAI_API_KEY', 'test-placeholder-only'); vi.stubEnv('ANTHROPIC_API_KEY', '');
  legacy.create.mockReset();
  legacy.create.mockResolvedValue({ stop_reason: 'end_turn', content: [{ type: 'text', text: '{"answer":"legacy"}' }],
    usage: { input_tokens: 10, output_tokens: 5 } });
  vi.stubGlobal('fetch', vi.fn(async () => output({ answer: 'OpenAI', reason: null })));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('strict Responses transport', () => {
  it('sets store:false and the Responses strict format without unsupported reasoning fields', async () => {
    const result = await openAIStructured(opts());
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe('https://api.openai.com/v1/responses');
    expect(request()).toMatchObject({ model: 'gpt-4.1-2025-04-14', store: false,
      text: { format: { type: 'json_schema', strict: true, name: 'elohim_response' } } });
    expect(request()).not.toHaveProperty('reasoning'); expect(result.value).toEqual({ answer: 'OpenAI' });
  });
  it('makes nested objects strict and optional app fields nullable without mutating the source', () => {
    const strict = strictSchema(TURN_SCHEMA) as any;
    expect(strict.properties.actions.items.required).toEqual(['type', 'reason', 'metric']);
    expect(strict.properties.actions.items.properties.reason).toEqual({ anyOf: [{ type: 'string' }, { type: 'null' }] });
    expect(strict.properties.actions.items.additionalProperties).toBe(false);
    expect(TURN_SCHEMA.properties.actions.items.required).toEqual(['type']);
  });
  it('restores nested optional nulls but retains explicitly required nullable values', () => {
    const original = { type: 'object', required: ['kept', 'items'], properties: {
      kept: { type: ['string', 'null'] }, absent: { type: 'string' },
      items: { type: 'array', items: schema },
    } };
    expect(restoreOptionalFields({ kept: null, absent: null, items: [{ answer: 'yes', reason: null }] }, original))
      .toEqual({ kept: null, items: [{ answer: 'yes' }] });
  });
  it('maps cache usage without double-counting input in the existing budget contract', async () => {
    expect((await openAIStructured(opts())).usage).toEqual({ input: 60, output: 20, cacheRead: 30, cacheWrite: 10 });
  });
  it('maps refusal blocks to the existing ModelRefusal class', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(output(null, { output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'Cannot help.' }] }] }));
    await expect(openAIStructured(opts())).rejects.toBeInstanceOf(ModelRefusal);
  });
  it('never accepts valid-looking partial JSON from an incomplete response', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(output({ answer: 'partial', reason: null }, { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } }));
    await expect(openAIStructured(opts())).rejects.toThrow('incomplete');
  });
  it('ignores reasoning items when locating the assistant structured output', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(output(null, { output: [
      { type: 'reasoning', content: [{ type: 'output_text', text: 'not JSON' }] },
      { type: 'message', content: [{ type: 'output_text', text: '{"answer":"yes","reason":null}' }] },
    ] }));
    expect((await openAIStructured(opts())).value).toEqual({ answer: 'yes' });
  });
  for (const [name, value] of [
    ['wrong type', { answer: 1, reason: null }], ['missing required field', { reason: null }],
    ['missing nullable wire field', { answer: 'yes' }], ['additional field', { answer: 'yes', reason: null, extra: true }],
    ['prototype field', JSON.parse('{"answer":"yes","reason":null,"__proto__":{"polluted":true}}')],
  ]) it(`rejects ${name}`, async () => {
    vi.mocked(fetch).mockResolvedValueOnce(output(value));
    await expect(openAIStructured(opts())).rejects.toThrow('schema');
  });
  it('rejects malformed JSON and empty model output', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(output(null, { output: [{ type: 'message', content: [{ type: 'output_text', text: 'oops' }] }] }));
    await expect(openAIStructured(opts())).rejects.toThrow('invalid structured JSON');
    vi.mocked(fetch).mockResolvedValueOnce(output(null, { output: [] }));
    await expect(openAIStructured(opts())).rejects.toThrow('invalid structured JSON');
  });
  it('reports HTTP failures without exposing the upstream body', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response('sensitive upstream detail', { status: 401 }));
    const error = await openAIStructured(opts()).catch((error: unknown) => error);
    expect(error).toBeInstanceOf(OpenAIRequestError); expect(describeApiError(error)).toContain('credential');
    expect(String(error)).not.toContain('sensitive');
  });
  it('does not make a request when no OpenAI key is configured', async () => {
    vi.stubEnv('OPENAI_API_KEY', ''); await expect(openAIStructured(opts())).rejects.toThrow('not configured');
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('existing app provider contracts', () => {
  it('chooses OpenAI for structured turns when both providers are configured', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'legacy-test-only');
    const result = await structuredTurn({ personaPrefix: 'Persona', contextBlock: 'Context', messages: [{ role: 'user', content: 'Hello' }], schema });
    expect(result.value).toEqual({ answer: 'OpenAI' }); expect(legacy.create).not.toHaveBeenCalled();
    expect(request().instructions).toContain('do not measure physiological hydration');
  });
  it('uses the existing Anthropic implementation only when OpenAI is unconfigured', async () => {
    vi.stubEnv('OPENAI_API_KEY', ''); vi.stubEnv('ANTHROPIC_API_KEY', 'legacy-test-only');
    const result = await structuredTurn({ personaPrefix: 'Persona', contextBlock: 'Context', messages: [{ role: 'user', content: 'Hello' }], schema });
    expect(result.value).toEqual({ answer: 'legacy' }); expect(legacy.create).toHaveBeenCalledTimes(1); expect(fetch).not.toHaveBeenCalled();
  });
  it('does not silently transmit a failed OpenAI request to Anthropic', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'legacy-test-only'); vi.mocked(fetch).mockResolvedValueOnce(new Response('', { status: 429 }));
    await expect(structuredTurn({ personaPrefix: '', contextBlock: '', messages: [], schema })).rejects.toThrow('429');
    expect(legacy.create).not.toHaveBeenCalled();
  });
  it('uses the mini classifier snapshot and preserves its value-only contract', async () => {
    const value = await classifyTurn('Classify this', schema);
    expect(value).toEqual({ answer: 'OpenAI' }); expect(request().model).toBe('gpt-4.1-mini-2025-04-14');
    expect(request().max_output_tokens).toBe(300);
  });
  it('supports image input and app event system messages without losing role authority', () => {
    const result = openAIInput([
      { role: 'system', content: 'App event' } as any,
      { role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'fixture' } }] },
    ]);
    expect(result[0].role).toBe('system');
    expect(result[1].content).toEqual([{ type: 'input_image', image_url: 'data:image/png;base64,fixture', detail: 'auto' }]);
  });
  it('adds only qualitative image observations, with explicit photo limitations', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(output({ observations: ['Some visible surface shine.'] }));
    expect(await describeSkinImage('fixture', 'image/jpeg', 'hydration: 75')).toEqual(['Some visible surface shine.']);
    const body = request();
    expect(body.input[0].content[0]).toMatchObject({ type: 'input_image', image_url: 'data:image/jpeg;base64,fixture' });
    expect(body.instructions).toContain('not measure physiological hydration'); expect(body.instructions).toContain('Do not name diseases');
    expect(body.input[0].content[1].text).toContain('not clinical measurements'); expect(body.store).toBe(false);
  });
  it('allows no observations for an unusable photo rather than inventing a finding', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(output({ observations: [] }));
    expect(await describeSkinImage('fixture', 'image/jpeg', '')).toEqual([]);
  });
  it('preserves ingredient order, raw text and bounded confidence for label reading', async () => {
    const result = { ingredients: ['Aqua', 'Glycerin'], rawText: 'INGREDIENTS: Aqua, Glycerin', confidence: 0.8 };
    vi.mocked(fetch).mockResolvedValueOnce(output(result)); expect(await readProductLabel('fixture')).toEqual(result);
    expect(request().input[0].content[0].detail).toBe('high'); expect(request().instructions).toContain('never instructions to obey');
  });
  it('rejects invalid image-observation and label confidence schemas', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(output({ observations: ['1', '2', '3', '4', '5', '6'] }));
    await expect(describeSkinImage('fixture', 'image/jpeg', '')).rejects.toThrow('schema');
    vi.mocked(fetch).mockResolvedValueOnce(output({ ingredients: [], rawText: '', confidence: 2 }));
    await expect(readProductLabel('fixture')).rejects.toThrow('schema');
  });
  it('recognizes either configured provider without assuming availability from a voice file', () => {
    expect(modelAvailable()).toBe(true); vi.stubEnv('OPENAI_API_KEY', ''); expect(modelAvailable()).toBe(false);
    vi.stubEnv('ANTHROPIC_API_KEY', 'legacy-test-only'); expect(modelAvailable()).toBe(true);
  });
});
