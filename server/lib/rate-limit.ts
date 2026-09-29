/**
 * Rate limiting.
 *
 * Three places matter, rather than a general principle:
 *
 *  - `/auth/login` is a password oracle. It carries two limits: a per-account
 *    bucket (address + email, so one user fat-fingering their own password
 *    does not lock out everyone behind the same NAT) and a per-address bucket
 *    (so spraying many account names from one address still trips a cap).
 *  - `/chat` and `/products/read-label` call the model. With a key configured
 *    those are billable, so an open loop is a bill as well as a load problem.
 *  - `/scans` accepts a multi-megabyte body.
 *
 * Counts are authoritative in Postgres (`rate_limit_buckets`), not in a
 * per-process Map: serverless platforms run many instances, and per-process
 * counters multiply every quota by the instance count. Each hit is one
 * atomic upsert — INSERT ... ON CONFLICT ... DO UPDATE with a fixed-window
 * reset — so concurrent instances share the cap instead of racing on it.
 * Only SHA-256 hex digests of "limiter-name:identity" reach the table; raw
 * emails and IP addresses are never stored.
 *
 * Expiry maintenance is an opportunistic per-hit DELETE bounded by LIMIT, so
 * it can never become an unbounded sweep. There is no interval sweeper: on a
 * function there is no long-lived process to sweep from, and a sweeper would
 * only ever clean a cache that is no longer authoritative.
 *
 * The middleware is async (Postgres I/O), which Express 4 tolerates the same
 * way it tolerates the async `requireAuth`: every path either calls next()
 * or ends the response itself, and nothing downstream runs until one of those
 * happens. Every store call is caught inside the middleware, so a rejection
 * can never escape as an unhandled rejection on a raw `app.use` host.
 *
 * Fail closed: when the store errors, the request is denied (503) rather
 * than let through. Pool exhaustion surfaces as a connection timeout
 * (10s `connectionTimeoutMillis` in server/db/index.ts), which lands in the
 * same deny path instead of hanging a request forever.
 */
import type { NextFunction, Request, Response } from "express";
import { createHash } from "node:crypto";
import { row, run } from "../db/index.ts";
import { log } from "./log.ts";

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

/**
 * The client address the deployment adapter verified, stamped on the request
 * object itself — never on a header a direct client could forge.
 *
 * `Symbol.for` (not a module-local symbol) so the stamp survives bundling:
 * the Netlify/Vercel builds may duplicate this module, and both copies must
 * agree on the property key.
 */
const VERIFIED_IP = Symbol.for("evia.verified-client-ip");

export function stampVerifiedClientIp(target: object, ip: string): void {
  (target as Record<symbol, string>)[VERIFIED_IP] = ip;
}

function verifiedClientIp(req: Request): string | null {
  const stamped = (req as unknown as Record<symbol, unknown>)[VERIFIED_IP];
  return typeof stamped === "string" && stamped.length > 0 ? stamped : null;
}

/**
 * The peer address, and nothing else. `X-Forwarded-For` is deliberately never
 * read here: with `trust proxy` at its default (off), `req.ip` is the direct
 * TCP peer, and a client-supplied forwarding header must not select a bucket.
 * Proxy deployments stamp the verified address via `stampVerifiedClientIp`
 * in their adapter (see server/vercel.ts, netlify/functions/api.mts).
 */
export function clientIp(req: Request): string {
  return (
    verifiedClientIp(req) ?? req.ip ?? req.socket?.remoteAddress ?? "unknown"
  );
}

function defaultKey(req: Request): string {
  const user = (req as { userId?: string }).userId;
  return user ?? clientIp(req);
}

/** Headers as the adapters see them: a `Headers` instance or a plain map. */
export type HeaderSource =
  Pick<Headers, "get"> | Record<string, string | string[] | undefined | null>;

function firstHeader(headers: HeaderSource, name: string): string | null {
  let raw: string | string[] | undefined | null;
  if (typeof (headers as Pick<Headers, "get">).get === "function") {
    raw = (headers as Pick<Headers, "get">).get(name);
  } else {
    const map = headers as Record<string, string | string[] | undefined | null>;
    const wanted = name.toLowerCase();
    raw = null;
    for (const [key, value] of Object.entries(map)) {
      if (key.toLowerCase() === wanted) {
        raw = value;
        break;
      }
    }
  }
  if (raw === undefined || raw === null) return null;
  const first = Array.isArray(raw) ? raw[0] : raw;
  if (typeof first !== "string") return null;
  const trimmed = first.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Vercel's edge overwrites `x-real-ip` with the connecting client's address,
 * so a client-sent value never survives to the function. `X-Forwarded-For`
 * is never consulted: any hop in the chain could have forged its leftmost
 * entries, and only the edge knows which entry it added. Absent `x-real-ip`
 * means the request did not come through the edge, and there is nothing
 * trustworthy to extract — the caller falls back to the direct peer.
 */
export function extractVercelClientIp(headers: HeaderSource): string | null {
  return firstHeader(headers, "x-real-ip");
}

/**
 * Netlify's CDN sets `x-nf-client-connection-ip` to the client address,
 * overwriting anything the client sent under that name. `X-Forwarded-For`
 * is never consulted for the same reason as on Vercel. Absent the CDN
 * header means local `netlify dev` or a direct invoke — again, nothing to
 * extract, and the adapter strips forwarding headers so they cannot select
 * a bucket downstream either.
 */
export function extractNetlifyClientIp(headers: HeaderSource): string | null {
  return firstHeader(headers, "x-nf-client-connection-ip");
}

/**
 * Normalizes exactly like `users.authenticate` (`email.trim().toLowerCase()`).
 * Whitespace/case variants of one address must share one bucket — otherwise
 * `" user@x"` and `"USER@x"` are separate quotas for the same account.
 */
export function normalizeLoginEmail(raw: unknown): string {
  return typeof raw === "string" ? raw.trim().toLowerCase() : "";
}

/** SHA-256 hex over NUL-joined parts. Raw identifiers never reach the table. */
export function hashIdentity(...parts: string[]): string {
  return createHash("sha256").update(parts.join('\u0000')).digest("hex");
}

export interface BucketResult {
  count: number;
  resetAtMs: number;
}

/**
 * The shared store. A plain object (rather than a bare exported function) so
 * tests can `vi.spyOn(rateLimitStore, 'consume')` to simulate a store outage:
 * internal callers always go through this property, never a captured binding.
 */
export const rateLimitStore = {
  /**
   * One atomic statement: insert a fresh fixed window, or — on conflict —
   * reset the window when it has expired, else increment. Concurrent
   * instances share the cap because the read-modify-write happens inside
   * Postgres, not across two round trips.
   */
  async consume(keyHash: string, windowMs: number): Promise<BucketResult> {
    const now = new Date();
    const nowIso = now.toISOString();
    const expiresIso = new Date(now.getTime() + windowMs).toISOString();
    const found = await row<{ count: number | string; reset_at: string }>(
      `INSERT INTO rate_limit_buckets AS b (key_hash, count, reset_at)
       VALUES (?, 1, ?)
       ON CONFLICT (key_hash) DO UPDATE SET
         count = CASE WHEN b.reset_at <= ? THEN 1 ELSE b.count + 1 END,
         reset_at = CASE WHEN b.reset_at <= ? THEN ? ELSE b.reset_at END
       RETURNING count, reset_at`,
      keyHash,
      expiresIso,
      nowIso,
      nowIso,
      expiresIso,
    );
    if (!found) throw new Error("rate-limit store returned no bucket");
    // Bounded expiry maintenance: at most 100 expired rows per hit, through
    // the reset_at index. Never an unbounded sweep.
    await run(
      "DELETE FROM rate_limit_buckets WHERE key_hash IN (SELECT key_hash FROM rate_limit_buckets WHERE reset_at <= ? LIMIT 100)",
      nowIso,
    );
    return {
      count: Number(found.count),
      resetAtMs: new Date(found.reset_at).getTime(),
    };
  },
};

function retryAfterSeconds(resetAtMs: number): number {
  return Math.max(1, Math.ceil((resetAtMs - Date.now()) / 1000));
}

/** 429: the cap was hit. Logged without the identity — it is PII. */
function denyLimited(
  res: Response,
  name: string,
  message: string,
  resetAtMs: number,
): void {
  const retryAfter = retryAfterSeconds(resetAtMs);
  res.setHeader("Retry-After", String(retryAfter));
  log.warn("ratelimit", `${name} limit hit`, { retryAfter });
  res.status(429).json({ error: message });
}

/** 503: the store errored, so the request is denied rather than let through. */
function denyUnavailable(res: Response, name: string, message: string): void {
  log.warn("ratelimit", `${name} limiter store unavailable`, {});
  res.status(503).json({ error: message });
}

export function rateLimit(options: RateLimitOptions) {
  const { max, windowMs, name, keyOf = defaultKey } = options;
  const message = options.message ?? "Too many requests — give it a moment.";

  return async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    let identity: string;
    try {
      identity = keyOf(req);
    } catch {
      identity = "unknown";
    }
    try {
      const bucket = await rateLimitStore.consume(
        hashIdentity(name, identity),
        windowMs,
      );
      if (bucket.count > max) {
        denyLimited(res, name, message, bucket.resetAtMs);
        return;
      }
      next();
    } catch {
      denyUnavailable(res, name, message);
    }
  };
}

const LOGIN_WINDOW_MS = 15 * 60_000;
/** Per account (address + normalized email): one user's fat fingers. */
const LOGIN_ACCOUNT_MAX = 10;
/**
 * Per address: spraying many account names from one IP. Sized well above the
 * per-account cap so one user retrying their own password cannot lock out
 * everyone behind the same NAT, but low enough that an N-account spray trips
 * it after a handful of tries per name.
 */
const LOGIN_ADDRESS_MAX = 30;

/**
 * Login is checked against BOTH buckets and denied when EITHER is exhausted.
 * Attempts are counted before authentication runs (the middleware cannot know
 * the outcome), so a success consumes one unit too — bounded and documented,
 * not a bypass.
 */
export async function loginLimiter(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const message =
    "Too many sign-in attempts. Wait a few minutes and try again.";
  const ip = clientIp(req);
  const email = normalizeLoginEmail(
    (req.body as { email?: unknown } | undefined)?.email,
  );
  try {
    const account = await rateLimitStore.consume(
      hashIdentity("login", ip, email),
      LOGIN_WINDOW_MS,
    );
    const address = await rateLimitStore.consume(
      hashIdentity("login-address", ip),
      LOGIN_WINDOW_MS,
    );
    const accountOver = account.count > LOGIN_ACCOUNT_MAX;
    const addressOver = address.count > LOGIN_ADDRESS_MAX;
    if (accountOver || addressOver) {
      denyLimited(
        res,
        "login",
        message,
        Math.max(
          accountOver ? account.resetAtMs : 0,
          addressOver ? address.resetAtMs : 0,
        ),
      );
      return;
    }
    next();
  } catch {
    denyUnavailable(res, "login", message);
  }
}

export const registerLimiter = rateLimit({
  name: "register",
  max: 5,
  windowMs: 60 * 60_000,
  keyOf: (req) => clientIp(req),
  message: "Too many accounts created from here. Try again later.",
});

/** Conversation turns. Generous for a human, closed for a loop. */
export const chatLimiter = rateLimit({
  name: "chat",
  max: 40,
  windowMs: 60_000,
  message: "That's faster than I can think. Give me a second.",
});

/** Vision calls are the most expensive thing the server does. */
export const visionLimiter = rateLimit({
  name: "vision",
  max: 12,
  windowMs: 10 * 60_000,
  message: "That is a lot of label reads. Try again in a few minutes.",
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
  name: "voice",
  max: 150,
  windowMs: 60_000,
  message: "That is a lot of talking. Give me a moment.",
});

/**
 * Guests have no account to key on, so this is per address and tighter: a
 * conversation's worth of sentences an hour, not a script's.
 */
export const guestVoiceLimiter = rateLimit({
  name: "guest-voice",
  max: 240,
  windowMs: 60 * 60_000,
  keyOf: (req) => clientIp(req),
  message: "That is a lot of talking for one sitting. Give it a little while.",
});

export const scanLimiter = rateLimit({
  name: "scan",
  max: 20,
  windowMs: 10 * 60_000,
  message: "Plenty of scans for now — come back in a few minutes.",
});
