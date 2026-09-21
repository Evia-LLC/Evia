/** Server-only Responses transport. No SDK/browser key and no stored Responses. */
type Schema = Record<string, unknown>;
export type InputContent = { type: 'input_text'; text: string } |
  { type: 'input_image'; image_url: string; detail: 'auto' | 'high' | 'low' };
export interface InputMessage {
  role: 'user' | 'assistant' | 'system' | 'developer';
  content: string | InputContent[];
}
export class ModelRefusal extends Error {
  constructor(message: string) { super(message); this.name = 'ModelRefusal'; }
}
export class OpenAIRequestError extends Error {
  status: number | undefined;
  constructor(message: string, status?: number) {
    super(message); this.name = 'OpenAIRequestError'; this.status = status;
  }
}
function object(value: unknown): value is Schema {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Optional app fields become required nullable fields on the wire. */
export function strictSchema(input: unknown): Schema {
  if (!object(input)) throw new Error('A JSON object schema is required.');
  const result: Schema = { ...input };
  if (object(input.properties) || input.type === 'object') {
    const properties = object(input.properties) ? input.properties : {};
    const required = new Set(Array.isArray(input.required) ? input.required : []);
    result.type = 'object'; result.additionalProperties = false;
    result.required = Object.keys(properties);
    result.properties = Object.fromEntries(Object.entries(properties).map(([name, child]) => {
      const schema = strictSchema(child);
      return [name, required.has(name) ? schema : { anyOf: [schema, { type: 'null' }] }];
    }));
  }
  if (object(input.items)) result.items = strictSchema(input.items);
  if (Array.isArray(input.anyOf)) result.anyOf = input.anyOf.map(strictSchema);
  if (object(input.$defs)) result.$defs = Object.fromEntries(Object.entries(input.$defs).map(([key, value]) => [key, strictSchema(value)]));
  return result;
}

/** Validates the schema vocabulary used by the app before accepting model JSON. */
function matches(value: unknown, schema: Schema, root: Schema): boolean {
  if (typeof schema.$ref === 'string') {
    const reference = schema.$ref;
    if (!reference.startsWith('#/')) return false;
    let target: unknown = root;
    for (const part of reference.slice(2).split('/')) {
      if (!object(target)) return false;
      target = target[part.replace(/~1/g, '/').replace(/~0/g, '~')];
    }
    return object(target) && matches(value, target, root);
  }
  if (Array.isArray(schema.anyOf) && !schema.anyOf.some((branch) => object(branch) && matches(value, branch, root))) return false;
  if (Array.isArray(schema.enum) && !schema.enum.some((entry) => JSON.stringify(entry) === JSON.stringify(value))) return false;
  if ('const' in schema && JSON.stringify(schema.const) !== JSON.stringify(value)) return false;
  const types = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : [];
  if (types.length && !types.some((type) => type === 'null' ? value === null :
    type === 'object' ? object(value) : type === 'array' ? Array.isArray(value) :
    type === 'integer' ? typeof value === 'number' && Number.isInteger(value) :
    type === 'number' ? typeof value === 'number' && Number.isFinite(value) : typeof value === type)) return false;
  if (object(value) && object(schema.properties)) {
    const required = Array.isArray(schema.required) ? schema.required : [];
    if (required.some((key) => typeof key !== 'string' || !Object.hasOwn(value, key))) return false;
    for (const [key, child] of Object.entries(value)) {
      const childSchema = Object.hasOwn(schema.properties, key) ? schema.properties[key] : undefined;
      if (!object(childSchema)) { if (schema.additionalProperties === false) return false; }
      else if (!matches(child, childSchema, root)) return false;
    }
  }
  if (Array.isArray(value)) {
    if (typeof schema.minItems === 'number' && value.length < schema.minItems) return false;
    if (typeof schema.maxItems === 'number' && value.length > schema.maxItems) return false;
    if (object(schema.items) && value.some((item) => !matches(item, schema.items as Schema, root))) return false;
  }
  if (typeof value === 'number') {
    if (typeof schema.minimum === 'number' && value < schema.minimum) return false;
    if (typeof schema.maximum === 'number' && value > schema.maximum) return false;
  }
  if (typeof value === 'string') {
    if (typeof schema.minLength === 'number' && value.length < schema.minLength) return false;
    if (typeof schema.maxLength === 'number' && value.length > schema.maxLength) return false;
    if (typeof schema.pattern === 'string' && !new RegExp(schema.pattern).test(value)) return false;
  }
  return true;
}

/** Restore the app's original optional-field contract after strict validation. */
export function restoreOptionalFields(value: unknown, schema: unknown): unknown {
  if (!object(schema)) return value;
  if (Array.isArray(value) && object(schema.items)) return value.map((item) => restoreOptionalFields(item, schema.items));
  if (!object(value) || !object(schema.properties)) return value;
  const required = new Set(Array.isArray(schema.required) ? schema.required : []);
  const result: Schema = {};
  for (const [key, child] of Object.entries(value)) {
    if (child === null && !required.has(key)) continue;
    result[key] = restoreOptionalFields(child, schema.properties[key]);
  }
  return result;
}

interface ResponsesPayload {
  status?: string;
  error?: unknown;
  incomplete_details?: { reason?: string };
  output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string; refusal?: string }> }>;
  usage?: { input_tokens?: number; output_tokens?: number; input_tokens_details?: { cached_tokens?: number; cache_write_tokens?: number } };
}
export interface OpenAIStructuredOptions {
  model: string;
  instructions: string;
  input: InputMessage[];
  schema: unknown;
  name?: string;
  maxTokens?: number;
}

export async function openAIStructured<T>(options: OpenAIStructuredOptions): Promise<{
  value: T; usage: { input: number; output: number; cacheRead: number; cacheWrite: number };
}> {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) throw new OpenAIRequestError('OpenAI is not configured.');
  const schema = strictSchema(options.schema);
  if (schema.type !== 'object') throw new Error('Structured response root must be an object.');
  let response: Response;
  try {
    response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: options.model, instructions: options.instructions,
        input: options.input, store: false, max_output_tokens: options.maxTokens ?? 2000,
        text: { format: { type: 'json_schema', name: options.name ?? 'elohim_response', strict: true, schema } } }),
      signal: AbortSignal.timeout(60_000),
    });
  } catch { throw new OpenAIRequestError('Could not reach OpenAI before the request deadline.'); }
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    throw new OpenAIRequestError(`OpenAI request failed (${response.status}).`, response.status);
  }
  let payload: ResponsesPayload;
  try { payload = await response.json() as ResponsesPayload; }
  catch { throw new OpenAIRequestError('OpenAI returned an unreadable response.'); }
  const content = (payload.output ?? []).filter((item) => item.type === 'message').flatMap((item) => item.content ?? []);
  const refusal = content.find((part) => part.type === 'refusal');
  if (refusal) throw new ModelRefusal(refusal.refusal || 'The model declined this request.');
  if (payload.status !== 'completed' || payload.error) throw new OpenAIRequestError('OpenAI returned an incomplete response.');
  const text = content.filter((part) => part.type === 'output_text').map((part) => part.text ?? '').join('');
  let value: unknown;
  try { value = JSON.parse(text); }
  catch { throw new OpenAIRequestError('OpenAI returned invalid structured JSON.'); }
  if (!matches(value, schema, schema)) throw new OpenAIRequestError('OpenAI response did not match the required schema.');
  const count = (value: number | undefined) => Number.isFinite(value) && (value ?? 0) >= 0 ? Math.floor(value!) : 0;
  const total = count(payload.usage?.input_tokens);
  const cacheRead = Math.min(total, count(payload.usage?.input_tokens_details?.cached_tokens));
  const cacheWrite = Math.min(total - cacheRead, count(payload.usage?.input_tokens_details?.cache_write_tokens));
  return { value: restoreOptionalFields(value, options.schema) as T, usage: {
    // Existing budget contract counts cache tokens separately from ordinary input.
    input: total - cacheRead - cacheWrite, output: count(payload.usage?.output_tokens), cacheRead, cacheWrite,
  } };
}
