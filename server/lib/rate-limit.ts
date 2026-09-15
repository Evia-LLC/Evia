/**
 * Rate limiting.
 *
 * There was none, which mattered in three specific places rather than as a
 * general principle:
 *
 *  - `/auth/login` was an unthrottled password oracle.
 *  - `/chat` and `/products/read-label` call the model. With a key configured
 *    those are billable, so an open loop is a bill as well as a load problem.
 *  - `/scans` accepts a multi-megabyte body.
 *
 * A fixed-window counter in memory, deliberately: this is a single-process
 * server with a local SQLite file, so a Redis-backed limiter would be
 * infrastructure the product does not otherwise have. If Elohim ever runs more
 * than one process this needs to move to a shared store, and the interface here
 * is narrow enough that it can.
 */
import type { NextFunction, Request, Response } from 'express';
import { log } from './log.ts';

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

/** Bounded sweep so a long-running process cannot grow the map forever. */
setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}, 60_000).unref();

export interface RateLimitOptions {
  /** Requests allowed per window. */
  max: number;
  windowMs: number;
  /** Distinguishes one limiter from another in the key. */
  name: string;
  /** Defaults to the authenticated user, falling back to the peer address. */
  keyOf?: (req: Request) => string;
  message?: string;
}

function defaultKey(req: Request): string {
  return req.userId ?? req.ip ?? req.socket.remoteAddress ?? 'unknown';
}

export function rateLimit(options: RateLimitOptions) {
  const { max, windowMs, name, keyOf = defaultKey } = options;
  const message = options.message ?? 'Too many requests — give it a moment.';

  return (req: Request, res: Response, next: NextFunction): void => {
    const key = `${name}:${keyOf(req)}`;
    const now = Date.now();
    const bucket = buckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      next();
      return;
    }

    bucket.count++;
    if (bucket.count > max) {
      const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
      res.setHeader('Retry-After', String(retryAfter));
      // Logged without the key: it is either a user id or an IP address.
      log.warn('ratelimit', `${name} limit hit`, { retryAfter });
      res.status(429).json({ error: message });
      return;
    }

    next();
  };
}

/**
 * Login is keyed by address *and* the email being tried, so one attacker
 * spraying many accounts is throttled, and one user fat-fingering their own
 * password does not lock out everyone behind the same NAT.
 */
export const loginLimiter = rateLimit({
  name: 'login',
  max: 10,
  windowMs: 15 * 60_000,
  keyOf: (req) =>
    `${req.ip ?? 'unknown'}|${String((req.body as { email?: string })?.email ?? '').toLowerCase()}`,
  message: 'Too many sign-in attempts. Wait a few minutes and try again.',
});

export const registerLimiter = rateLimit({
  name: 'register',
  max: 5,
  windowMs: 60 * 60_000,
  keyOf: (req) => req.ip ?? 'unknown',
  message: 'Too many accounts created from here. Try again later.',
});

/** Conversation turns. Generous for a human, closed for a loop. */
export const chatLimiter = rateLimit({
  name: 'chat',
  max: 40,
  windowMs: 60_000,
  message: "That's faster than I can think. Give me a second.",
});

/** Vision calls are the most expensive thing the server does. */
export const visionLimiter = rateLimit({
  name: 'vision',
  max: 12,
  windowMs: 10 * 60_000,
  message: 'That is a lot of label reads. Try again in a few minutes.',
});

/**
 * Voice synthesis is billed per character, so this is a spend limit as much as
 * an abuse limit. Sized for a real conversation in SENTENCES, not lines: the
 * client requests each sentence of a reply separately so the first can play
 * while the rest render, which puts a three-sentence reply at three requests
 * in one burst. The chat limiter still caps turns at 40 a minute, and the
 * characters billed are the same either way - only the request count grew.
 */
export const voiceLimiter = rateLimit({
  name: 'voice',
  max: 150,
  windowMs: 60_000,
  message: 'That is a lot of talking. Give me a moment.',
});

/**
 * Guests have no account to key on, so this is per address and tighter: a
 * conversation's worth of sentences an hour, not a script's.
 */
export const guestVoiceLimiter = rateLimit({
  name: 'guest-voice',
  max: 240,
  windowMs: 60 * 60_000,
  keyOf: (req) => req.ip ?? 'unknown',
  message: 'That is a lot of talking for one sitting. Give it a little while.',
});

export const scanLimiter = rateLimit({
  name: 'scan',
  max: 20,
  windowMs: 10 * 60_000,
  message: 'Plenty of scans for now — come back in a few minutes.',
});
