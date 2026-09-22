/**
 * Development logging (ARCHITECTURE §10, brief §35).
 *
 * Everything the brief asks to be observable is observable — AI requests and
 * responses, skin analysis results, context retrieval, database operations,
 * timings, errors. What is *not* observable in production is the sensitive
 * payload: message bodies, image refs and tokens are redacted unless the log
 * level is explicitly `debug`.
 */

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 } as const;
type Level = keyof typeof LEVELS;

const configured = (process.env.EVIA_LOG_LEVEL ?? 'info') as Level;
const threshold = LEVELS[configured] ?? LEVELS.info;
const isDebug = threshold >= LEVELS.debug;

const COLOURS: Record<Level, string> = {
  error: '\x1b[31m',
  warn: '\x1b[33m',
  info: '\x1b[36m',
  debug: '\x1b[90m',
};

const SENSITIVE_KEYS = new Set([
  'content',
  'text',
  'message',
  'imageRef',
  'image_ref',
  'thumbRef',
  'image',
  'token',
  'password',
  'passwordHash',
  'apiKey',
  'email',
]);

/**
 * Redacts sensitive values unless running at debug level. Length is preserved
 * because "the prompt was 4200 chars" is diagnostically useful and the text is
 * not.
 */
export function redact(value: unknown): unknown {
  if (isDebug) return value;
  if (value === null || value === undefined) return value;
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
  const head = `${COLOURS[level]}${time} ${level.padEnd(5)} ${scope}\x1b[0m ${msg}`;
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
