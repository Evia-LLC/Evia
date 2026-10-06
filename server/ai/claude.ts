/**
 * The Anthropic client. The only file in Elohim that talks to the model.
 *
 * The browser never sees a key — every model call originates here, server-side.
 */
import Anthropic from "@anthropic-ai/sdk";
import { log } from "../lib/log.ts";
import { withReservation, BudgetDispatchError } from "./budget.ts";
import { newId } from "../lib/ids.ts";

/*
 * Sonnet by default. The persona plus a user's context block is a few
 * thousand cached tokens and the reply is a paragraph; Sonnet 5 writes that
 * paragraph in her voice, follows the schema, and reads a face image when
 * asked, at a fraction of Opus's price and latency. Opus is one env var away
 * for anyone who wants it (ELOHIM_MODEL=claude-opus-5).
 */
const MODEL = process.env.ELOHIM_MODEL ?? "claude-sonnet-5";
const CLASSIFIER_MODEL =
  process.env.ELOHIM_CLASSIFIER_MODEL ?? "claude-haiku-4-5";

let client: Anthropic | null = null;

/**
 * False when no credentials are configured. The orchestrator falls back to the
 * clearly-labelled local Elohim rather than pretending — ARCHITECTURE §12.
 */
export function modelAvailable(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

function getClient(): Anthropic {
  // P1-T12 — client timeout (belt): the SDK default is 10 minutes, which
  // outlives every host. Per-request timeouts below (suspenders) are the
  // binding provider budgets; this only caps misuse that forgets to pass one.
  if (!client)
    client = new Anthropic({
      maxRetries: 0,
      timeout: ANTHROPIC_REQUEST_TIMEOUT_MS,
    });
  return client;
}

/**
 * P1-T12 — model request budget.
 *
 * Host bounds (established by inspection, never assumed): Vercel
 * `maxDuration: 30` → 30 s; Netlify sets no function timeout in repo config
 * (platform default 10 s synchronous, raisable to 26 s — an operator
 * action). Design host = 26 s (Netlify raised) / 30 s (Vercel).
 *
 * Model budget: classifier 8 s (cheap haiku call; on timeout classify()
 * falls back to the deterministic local pass, so the turn still answers) /
 * main and label calls 18 s < turn/response 24 s (local-only tail after the
 * SDK resolves) < host 26/30 s. A timed-out model call with no observed
 * response settles via the fail path exactly once (see below); anything else
 * keeps the P1-T07 conservative pending semantics for ambiguous dispatches.
 */
export const ANTHROPIC_REQUEST_TIMEOUT_MS = 18_000;
export const ANTHROPIC_CLASSIFIER_TIMEOUT_MS = 8_000;

/** Per-request deadline wiring. `signal` lets a caller propagate disconnect. */
export interface ModelRequestOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
}

/** Every Anthropic request is admitted before I/O and settled before parsing.
 * UTF-8 bytes plus maximum output is deliberately conservative, not a dollar cap.
 * Include cache reads/writes in token usage: they still consume provider resources.
 */
async function paidMessage(
  userId: string,
  params: Anthropic.MessageCreateParamsNonStreaming,
  opts: ModelRequestOptions = {},
): Promise<Anthropic.Message> {
  if (!userId) throw new Error("A budget identity is required.");
  const estimatedUnits =
    Buffer.byteLength(JSON.stringify(params), "utf8") + params.max_tokens;
  const { result } = await withReservation(
    {
      operationId: `anthropic:${newId()}`,
      userId,
      provider: "anthropic",
      unit: "chat-tokens",
      estimatedUnits,
    },
    async () => {
      let response: Anthropic.Message;
      try {
        // The SDK's `timeout` number is honored by the real transport, but a
        // caller disconnect (`opts.signal`) and signal-observing stubs need a
        // real signal too — mint one per request combining both.
        const timer = AbortSignal.timeout(
          opts.timeoutMs ?? ANTHROPIC_REQUEST_TIMEOUT_MS,
        );
        const signal = opts.signal
          ? AbortSignal.any([timer, opts.signal])
          : timer;
        response = await getClient().messages.create(params, {
          timeout: opts.timeoutMs ?? ANTHROPIC_REQUEST_TIMEOUT_MS,
          signal,
        });
      } catch (err) {
        // No model response was observed, so nothing billable was confirmed:
        // the timed-out dispatch settles via the fail path (releases the
        // estimate, records nothing), exactly once, through withReservation.
        // Name-based detection keeps this working under SDK mocks that stub
        // only part of the error hierarchy (see test/provider-budget-gates).
        const name = (err as Error)?.name;
        if (
          name === "APIConnectionTimeoutError" ||
          name === "AbortError" ||
          opts.signal?.aborted
        ) {
          throw new BudgetDispatchError("Model request timed out.", false);
        }
        throw err;
      }
      return {
        result: response,
        actual: {
          inputTokens:
            response.usage.input_tokens +
            (response.usage.cache_read_input_tokens ?? 0) +
            (response.usage.cache_creation_input_tokens ?? 0),
          outputTokens: response.usage.output_tokens,
        },
      };
    },
  );
  return result;
}

export interface StructuredCallOptions {
  userId: string;
  /** Frozen prefix — carries the cache breakpoint. Must not vary per turn. */
  personaPrefix: string;
  /** Stable-per-user context. Placed after the persona, before the volatile turn. */
  contextBlock: string;
  messages: Anthropic.MessageParam[];
  schema: unknown;
  maxTokens?: number;
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
  /** Provider budget override (default ANTHROPIC_REQUEST_TIMEOUT_MS). */
  timeoutMs?: number;
  /** Caller disconnect propagation. */
  signal?: AbortSignal;
}

export interface StructuredCallResult<T> {
  value: T;
  usage: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
  };
}

/**
 * One structured turn. Returns parsed JSON matching `schema`.
 *
 * System blocks are ordered stable-first (persona, then context) so the cache
 * prefix survives; the volatile turn lives in `messages`.
 */
export async function structuredTurn<T>(
  opts: StructuredCallOptions,
): Promise<StructuredCallResult<T>> {
  const response = await paidMessage(
    opts.userId,
    {
      model: MODEL,
      max_tokens: opts.maxTokens ?? 2000,
      system: [
        {
          type: "text",
          text: opts.personaPrefix,
          cache_control: { type: "ephemeral" },
        },
        { type: "text", text: opts.contextBlock },
      ],
      messages: opts.messages,
      thinking: { type: "adaptive" },
      output_config: {
        effort: opts.effort ?? "medium",
        format: { type: "json_schema", schema: opts.schema },
      },
    } as Anthropic.MessageCreateParamsNonStreaming,
    { timeoutMs: opts.timeoutMs, signal: opts.signal },
  );

  if (response.stop_reason === "refusal") {
    throw new ModelRefusal(
      response.stop_details?.explanation ?? "The model declined this turn.",
    );
  }

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");

  log.debug("ai", "structured turn", {
    stop: response.stop_reason,
    usage: response.usage,
    chars: text.length,
  });

  let value: T;
  try {
    value = JSON.parse(text) as T;
  } catch {
    throw new Error(`Model returned unparseable JSON (${text.length} chars).`);
  }

  return {
    value,
    usage: {
      input: response.usage.input_tokens,
      output: response.usage.output_tokens,
      cacheRead: response.usage.cache_read_input_tokens ?? 0,
      cacheWrite: response.usage.cache_creation_input_tokens ?? 0,
    },
  };
}

/**
 * Cheap classification pass. Runs on the small model because it is a labelling
 * job, not a reasoning one, and it sits on the latency path of every turn.
 */
export async function classifyTurn<T>(
  prompt: string,
  schema: unknown,
  userId: string,
  opts: ModelRequestOptions = {},
): Promise<T> {
  const response = await paidMessage(
    userId,
    {
      model: CLASSIFIER_MODEL,
      max_tokens: 300,
      messages: [{ role: "user", content: prompt }],
      output_config: { format: { type: "json_schema", schema } },
    } as Anthropic.MessageCreateParamsNonStreaming,
    {
      timeoutMs: opts.timeoutMs ?? ANTHROPIC_CLASSIFIER_TIMEOUT_MS,
      signal: opts.signal,
    },
  );

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  return JSON.parse(text) as T;
}

/**
 * Optional qualitative read of a face image. Layered on top of the deterministic
 * metrics, never in place of them — only called with explicit consent.
 */
export async function describeSkinImage(
  imageBase64: string,
  mediaType: "image/jpeg" | "image/png",
  metricSummary: string,
  userId: string,
  opts: ModelRequestOptions = {},
): Promise<string[]> {
  const response = await paidMessage(
    userId,
    {
      model: MODEL,
      max_tokens: 800,
      system:
        "You are assisting a skincare appearance analysis. Describe only what is visually " +
        'observable in the image. Use observational phrasing ("there is visible…"), never ' +
        "diagnostic phrasing. Do not name diseases. Do not estimate age, gender, ethnicity " +
        "or attractiveness. Return 2-5 short observations.",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: mediaType,
                data: imageBase64,
              },
            },
            {
              type: "text",
              text: `Measured appearance metrics for this capture:\n${metricSummary}\n\nAdd qualitative observations the numbers would miss.`,
            },
          ],
        },
      ],
      output_config: {
        format: {
          type: "json_schema",
          schema: {
            type: "object",
            additionalProperties: false,
            required: ["observations"],
            properties: {
              observations: {
                type: "array",
                items: { type: "string" },
                maxItems: 5,
              },
            },
          },
        },
      },
    } as Anthropic.MessageCreateParamsNonStreaming,
    { timeoutMs: opts.timeoutMs, signal: opts.signal },
  );

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  const parsed = JSON.parse(text) as { observations: string[] };
  return parsed.observations ?? [];
}

/**
 * Reads an ingredient panel from a photo. Used only when the user has opted
 * into cloud reasoning; the default path is local OCR.
 */
export async function readProductLabel(
  imageBase64: string,
  mediaType: "image/jpeg" | "image/png",
  userId: string,
  opts: ModelRequestOptions = {},
): Promise<{ ingredients: string[]; rawText: string; confidence: number }> {
  const response = await paidMessage(
    userId,
    {
      model: MODEL,
      max_tokens: 2000,
      system:
        "You read cosmetic ingredient panels. Transcribe the INCI list exactly as printed, " +
        "in order, without correcting, translating or inventing ingredients. If part of the " +
        "list is unreadable, omit it rather than guessing. Report your own confidence " +
        "honestly: a blurred or partially visible panel is low confidence.",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: mediaType,
                data: imageBase64,
              },
            },
            {
              type: "text",
              text: "Transcribe the ingredient list from this label.",
            },
          ],
        },
      ],
      output_config: {
        format: {
          type: "json_schema",
          schema: {
            type: "object",
            additionalProperties: false,
            required: ["ingredients", "rawText", "confidence"],
            properties: {
              ingredients: { type: "array", items: { type: "string" } },
              rawText: {
                type: "string",
                description: "The panel as printed, including any header.",
              },
              confidence: { type: "number", minimum: 0, maximum: 1 },
            },
          },
        },
      },
    } as Anthropic.MessageCreateParamsNonStreaming,
    { timeoutMs: opts.timeoutMs, signal: opts.signal },
  );

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  return JSON.parse(text) as {
    ingredients: string[];
    rawText: string;
    confidence: number;
  };
}

export class ModelRefusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModelRefusal";
  }
}

export function describeApiError(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError)
    return "The configured API key was rejected.";
  if (err instanceof Anthropic.RateLimitError)
    return "Rate limited — try again in a moment.";
  if (err instanceof Anthropic.BadRequestError)
    return `Bad request: ${err.message}`;
  if (err instanceof Anthropic.APIConnectionError)
    return "Could not reach the API.";
  if (err instanceof Anthropic.APIError)
    return `API error ${err.status}: ${err.message}`;
  return (err as Error)?.message ?? "Unknown error";
}

export { MODEL, CLASSIFIER_MODEL };
