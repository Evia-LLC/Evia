/**
 * The whole API, as one Vercel function.
 *
 * Vercel routes every `/api/*` request here (see vercel.json) and hands it to
 * the same Express app the local server and the Netlify function run. Vercel's
 * Node runtime speaks Node's own request and response objects, so the Express
 * app can take the request directly - no event translation, unlike Netlify.
 *
 * `ready()` is awaited per invocation: memoised, so a warm instance pays
 * nothing; on a cold one it applies migrations before the first request is
 * served. Without a reachable database that throws, and the answer is the
 * same honest one the Netlify function gives - health says what is and is
 * not configured, everything else says the database is missing.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { app, ready } from "./app.ts";
import { modelAvailable } from "./ai/claude.ts";
import { blobStorageAvailable } from "./lib/crypto.ts";
import { clonedVoiceAvailable, guestVoiceAllowed } from "./voice/tts.ts";
import {
  extractVercelClientIp,
  stampVerifiedClientIp,
} from "./lib/rate-limit.ts";

export default async function handler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  /*
   * Trusted client address for the abuse limiter.
   *
   * Vercel's edge overwrites `x-real-ip` with the connecting client's address
   * before the function ever runs, so a client-sent value under that name
   * never survives — trusting it here means trusting Vercel, not the caller.
   * `X-Forwarded-For` is never consulted (any hop could have forged its
   * leftmost entries). When the header is absent there is nothing trustworthy
   * to extract, and the limiter falls back to the direct peer. Stamped before
   * anything else so every downstream middleware sees the same address.
   */
  const trustedIp = extractVercelClientIp(req.headers);
  if (trustedIp !== null) stampVerifiedClientIp(req, trustedIp);
  try {
    await ready();
  } catch (err) {
    const configured = Boolean(
      process.env.NETLIFY_DATABASE_URL || process.env.DATABASE_URL,
    );
    const reason = (
      err instanceof Error ? `${err.name}: ${err.message}` : String(err)
    )
      .replace(/postgres(ql)?:\/\/\S+/g, "<url>")
      .slice(0, 200);
    const path = (req.url ?? "/").split("?")[0];
    res.setHeader("content-type", "application/json; charset=utf-8");
    if (path === "/api/health") {
      res.statusCode = 200;
      res.end(
        JSON.stringify({
          ok: false,
          database: false,
          databaseConfigured: configured,
          databaseError: reason,
          modelAvailable: modelAvailable(),
          model: null,
          imageStorage: blobStorageAvailable(),
          clonedVoice: clonedVoiceAvailable(),
          guestVoice: guestVoiceAllowed(),
          demoMode: false,
        }),
      );
      return;
    }
    res.statusCode = 503;
    res.end(
      JSON.stringify({
        error: configured
          ? "The database is configured but could not be reached just now, so nothing can be saved or signed in to."
          : "This deployment has no database attached, so nothing can be saved or signed in to.",
      }),
    );
    return;
  }
  app(req, res);
}
