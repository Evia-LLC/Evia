/**
 * Development logging (ARCHITECTURE §10, brief §35).
 *
 * Everything the brief asks to be observable is observable — AI requests and
 * responses, skin analysis results, context retrieval, database operations,
 * timings, errors. What is *not* observable at any level is the sensitive
 * payload: message bodies, image refs, voice sentences, tokens, connection
 * strings, provider payloads and personal text are redacted at EVERY level,
 * including `debug` (P1-T13 — a debug flag must never become a secret tap).
 *
 * Two layers, both always on:
 *
 *   1. Key redaction — values under known-sensitive keys (chat text, voice
 *      sentences, tokens, payloads, …) are replaced with a length-preserving
 *      placeholder, recursively, so "the prompt was 4200 chars" stays
 *      diagnostically useful while the text itself never lands in a sink.
 *   2. String scrubbing — every string that reaches a sink, including free
 *      text and the log message itself, is swept for structured secrets:
 *      postgres-shaped URLs, bearer tokens, pasted API keys, `key=` query
 *      parameters, and PEM blocks.
 *
 * Residual: free-form prose that is neither under a sensitive key nor shaped
 * like a structured secret (for example personal text quoted inside an
 * `error` string) cannot be scrubbed by pattern. Callers must not log such
 * strings — the public error middleware in server/app.ts logs status codes
 * only, and provider/voice paths log sizes and codes, never bodies.
 */

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 } as const;
type Level = keyof typeof LEVELS;

const configured = (process.env.ELOHIM_LOG_LEVEL ?? 'info') as Level;
const threshold = LEVELS[configured] ?? LEVELS.info;

const COLOURS: Record<Level, string> = {
  error: '\x1b[31m',
  warn: '\x1b[33m',
  info: '\x1b[36m',
  debug: '\x1b[90m',
};

const SENSITIVE_KEYS = new Set([
  // Personal / message text — never observable, at any level.
  'content',
  'text',
  'message',
  'sentence',
  'sentences',
  'previous_text',
  'next_text',
  'previousText',
  'nextText',
  'transcript',
  'utterance',
  'reply',
  'prompt',
  // Audio and its timings ride with the sentence they voice.
  'audio',
  'words',
  'chunks',
  // Provider payloads and request bodies may echo any of the above.
  'payload',
  'body',
  // Credentials and connection material.
  'token',
  'sessionToken',
  'accessToken',
  'refreshToken',
  'authorization',
  'password',
  'passwordHash',
  'apiKey',
  'api_key',
  'secret',
  'connectionString',
  'email',
  // Stored media references identify a person's captures.
  'imageRef',
  'image_ref',
  'thumbRef',
  'image',
]);

/**
 * Structured-secret patterns swept out of every string reaching a sink.
 * Replacements carry no part of the match — the secret never survives, even
 * partially, in any log line.
 */
const SECRET_PATTERNS: Array<[RegExp, string]> = [
  // Any postgres-shaped URL, wherever it hides (env dumps, error text).
  [/postgres(?:ql)?:\/\/[^\s'"<>]+/gi, '[redacted database url]'],
  // PEM blocks (pastable CA / key material).
  [/-----BEGIN [A-Z ]+-----[\s\S]*?-----END [A-Z ]+-----/g, '[redacted certificate]'],
  // Bearer tokens on any header-shaped string.
  [/Bearer\s+[A-Za-z0-9\-._~+/=]+/g, 'Bearer [redacted]'],
  // Provider endpoints carrying the key in the query string (?key=…, &token=…).
  [/([?&](?:key|api_key|apikey|token|secret|password)=)[^&\s'"<>]*/gi, '$1[redacted]'],
  // Pasted assignments (apiKey: "…", password=…, token: '…').
  [/((?:api[_-]?key|secret|passwd|password|token)\s*[:=]\s*)['"]?[^\s'",}<>]+/gi, '$1[redacted]'],
  // Known vendor key shapes that travel without a label.
  [/\bsk-ant-[A-Za-z0-9\-_]+/g, '[redacted api key]'],
  [/\bwhsec_[A-Za-z0-9+/=]+/g, '[redacted secret]'],
];

/** Sweeps structured secrets out of free text. Idempotent. */
export function scrubString(input: string): string {
  let out = input;
  for (const [pattern, replacement] of SECRET_PATTERNS) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

/**
 * Redacts sensitive values at every log level, including `debug`.
 *
 * Length is preserved for redacted strings because "the prompt was 4200
 * chars" is diagnostically useful and the text is not. Every surviving
 * string is additionally scrubbed for structured secrets.
 */
export function redact(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return scrubString(value);
  if (Array.isArray(value)) return value.map(redact);
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEYS.has(k)) {
        out[k] = typeof v === 'string' ? `[redacted ${v.length}c]` : '[redacted]';
      } else {
        out[k] = redact(v);
      }
    }
    return out;
  }
  return value;
}

function emit(level: Level, scope: string, msg: string, extra?: unknown) {
  if (LEVELS[level] > threshold) return;
  const time = new Date().toISOString().slice(11, 23);
  const head = `${COLOURS[level]}${time} ${level.padEnd(5)} ${scope}\x1b[0m ${scrubString(msg)}`;
  if (extra === undefined) {
    console.log(head);
  } else {
    console.log(head, JSON.stringify(redact(extra)));
  }
}

export const log = {
  error: (scope: string, msg: string, extra?: unknown) => emit('error', scope, msg, extra),
  warn: (scope: string, msg: string, extra?: unknown) => emit('warn', scope, msg, extra),
  info: (scope: string, msg: string, extra?: unknown) => emit('info', scope, msg, extra),
  debug: (scope: string, msg: string, extra?: unknown) => emit('debug', scope, msg, extra),
  /** Times an async operation and logs the duration — used for scan + AI paths. */
  async timed<T>(scope: string, label: string, fn: () => Promise<T>): Promise<T> {
    const t0 = performance.now();
    try {
      const out = await fn();
      emit('info', scope, `${label} ok`, { ms: Math.round(performance.now() - t0) });
      return out;
    } catch (err) {
      emit('error', scope, `${label} failed`, {
        ms: Math.round(performance.now() - t0),
        error: (err as Error).message,
      });
      throw err;
    }
  },
};
