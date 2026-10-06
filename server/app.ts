/**
 * The Express app itself, with nothing that assumes a long-lived process.
 *
 * Split out of `index.ts` because the same app now runs two ways: as a server
 * you start locally, and as a Netlify Function that is created, used and thrown
 * away per request. Everything that was previously done once at module scope —
 * applying migrations, seeding the demo account, sweeping sessions — had to
 * move behind `ready()`, because on a function there is no "once": module scope
 * runs again on every cold start, and it runs concurrently across instances.
 */
// Must come first: it populates process.env before any module below reads it.
import './lib/env.ts';

import express from 'express';
import { analysisRouter } from './routes/analysis.ts';
import { analysisProvider, perfectCorpAvailable, sampleDemoEnabled } from './ai/perfectcorp.ts';
import { migrate } from './db/index.ts';
import { authRouter } from './routes/auth.ts';
import { apiRouter } from './routes/api.ts';
import { publicRouter } from './routes/public.ts';
import { adminRouter } from './routes/admin.ts';
import { modelAvailable, MODEL } from './ai/claude.ts';
import { clonedVoiceAvailable, guestVoiceAllowed, speakLine, VoiceUnavailable } from './voice/tts.ts';
import { guestVoiceLimiter } from './lib/rate-limit.ts';
import { blobStorageAvailable } from './lib/crypto.ts';
import { row } from './db/index.ts';
import { seedDemoUser } from './demo/seed.ts';
import { sweepExpiredSessions } from './db/users.ts';
import { log } from './lib/log.ts';

export const app = express();

// Only routes that carry an image get the large body limit. Path-based limits
// stay because the adapters need the body to route, but auth still runs at
// the router before any image bytes are validated, and per-purpose decoded
// ceilings in server/lib/image-input.ts apply post-auth. POST /api/scans is
// NOT listed: it stores structured readings only (raw capture bytes are
// stripped there), so it rides the 64kb small body like every other endpoint.
const IMAGE_ROUTES = ['/api/analysis/face', '/api/products/read-label', '/api/admin/catalogue/import'];
const largeBody = express.json({ limit: '12mb' });
const smallBody = express.json({ limit: '64kb' });
app.use((req, res, next) =>
  (IMAGE_ROUTES.includes(req.path) || /^\/api\/scans\/[^/]+\/progress-photo$/.test(req.path)
    ? largeBody : smallBody)(req, res, next),
);

/**
 * P1-T13 — the public capability check. Anonymous-safe by construction.
 *
 * Booleans and flags only: what the entry screen and the voice fallback need
 * to decide (model on/off, voice configured, image storage, demo mode, and
 * whether anything is behind the API at all). No budget totals, no database
 * configuration, no error details, no provider payloads — those live on
 * GET /api/admin/diagnostics, behind admin auth.
 *
 * Cost: exactly one cheap bounded query (`SELECT 1`) reporting database
 * reachability. Nothing else here touches the database; spend totals are
 * computed on demand on the admin endpoint, not on every poll.
 */
app.get('/api/health', async (_req, res) => {
  let database = false;
  try {
    await row('SELECT 1 AS ok');
    database = true;
  } catch {
    database = false;
  }
  res.json({
    ok: database,
    database,
    modelAvailable: modelAvailable(),
    model: modelAvailable() ? MODEL : null,
    imageStorage: blobStorageAvailable(),
    clonedVoice: clonedVoiceAvailable(),
    guestVoice: guestVoiceAllowed(),
    demoMode: process.env.DEMO_MODE === '1',
  });
});

app.get('/api/public/analysis', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({ provider: analysisProvider(), available: perfectCorpAvailable(), sampleDemo: sampleDemoEnabled() });
});
app.use('/api/analysis', analysisRouter);
app.use('/api/auth', authRouter);

/*
 * Her voice for someone without an account.
 *
 * A guest's replies come from the local engine in their own browser and carry
 * their own readings, so sending a line to the voice provider is a transfer
 * to a third party. The guest chooses it: the voice toggle on the entry
 * screen says where the audio comes from, and it is off until they turn it
 * on. The operator can close the door entirely with ELOHIM_GUEST_VOICE=0.
 */
app.post('/api/public/voice/speak', guestVoiceLimiter, async (req, res) => {
  const text = typeof req.body?.text === 'string' ? req.body.text : '';
  if (!text.trim()) {
    res.status(400).json({ error: 'Nothing to say.' });
    return;
  }
  if (!guestVoiceAllowed()) {
    res.status(503).json({ error: 'The cloned voice is not available to guests here.' });
    return;
  }
  try {
    // The sentence's neighbours ride along for prosody, clamped, exactly as
    // on the account route - a guest hears the same delivery.
    const line = await speakLine(text, {
      previousText:
        typeof req.body?.previous_text === 'string' ? req.body.previous_text.slice(0, 600) : undefined,
      nextText: typeof req.body?.next_text === 'string' ? req.body.next_text.slice(0, 600) : undefined,
    }, 'guest:voice');
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      audio: line.audio.toString('base64'),
      contentType: line.contentType,
      words: line.words,
      duration: line.duration,
      cached: line.cached,
      // One chunk IS the flat audio; sending it twice doubles the
      // latency-critical transfer for every short line.
      ...(line.chunks.length <= 1 ? {} : { chunks: line.chunks.map((chunk) => ({
        text: chunk.text,
        audio: chunk.audio.toString('base64'),
        contentType: chunk.contentType,
        words: chunk.words,
        duration: chunk.duration,
        start: chunk.start,
        charOffset: chunk.charOffset,
        cached: chunk.cached,
      })) }),
    });
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('over budget:')) {
      res.status(429).json({ error: 'The shared voice allowance is exhausted. Try again later.' });
      return;
    }
    if (err instanceof VoiceUnavailable) {
      res.status(503).json({ error: err.message });
      return;
    }
    log.error('voice', 'guest line failed', { error: (err as Error).message });
    res.status(502).json({ error: 'Her voice did not come through.' });
  }
});

app.use('/api/public', publicRouter);
app.use('/api/admin', adminRouter);
app.use('/api', apiRouter);

/**
 * P1-T13 — the stable public error vocabulary.
 *
 * The frontend depends on the *distinctions* (400/401/403/409/413/429/503),
 * never on the detail: every status carries one fixed generic message, and
 * raw exception text, stacks, URLs, tokens and personal text never reach the
 * response. Anything unlisted — including provider failures and boot errors
 * forwarded here — is a 500 with the same generic message.
 */
const PUBLIC_ERROR_MESSAGES = new Map<number, string>([
  [400, 'That request could not be read.'],
  [401, 'You need to sign in to continue.'],
  [403, 'That is not available for this account.'],
  [409, 'That conflicts with what is already saved.'],
  [413, 'That upload is too large.'],
  [429, 'Too many requests. Try again shortly.'],
  [503, 'The service is temporarily unavailable. Try again later.'],
]);

/**
 * Maps a thrown status to its public shape. Exported so the contract is
 * unit-testable without booting the server. Unknown, missing or non-numeric
 * statuses collapse to the generic 500 — never to the input.
 */
export function publicErrorFor(status: unknown): {
  status: number;
  error: string;
} {
  const message =
    typeof status === 'number' ? PUBLIC_ERROR_MESSAGES.get(status) : undefined;
  if (message === undefined) return { status: 500, error: 'Something went wrong.' };
  return { status: status as number, error: message };
}

app.use((err: Error & { status?: number; type?: string }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  // Body-limit routing answers with the right status instead of a generic
  // 500: 413 when a payload dies at the transport ceiling above, 400 when the
  // JSON itself cannot be parsed. Messages are byte-identical to the
  // pre-P1-T13 contract (P1-T05 mapping — preserved).
  if (err?.type === 'entity.too.large' || err?.status === 413) {
    res.status(413).json({ error: 'That upload is too large.' });
    return;
  }
  if (err?.status === 400) {
    res.status(400).json({ error: 'That request could not be read.' });
    return;
  }
  const mapped = publicErrorFor(err?.status);
  if (mapped.status !== 500) {
    // Status code only — the detail rides in neither the response nor the
    // log line, because an error message can quote personal text no
    // pattern scrubber could recognise.
    log.error('http', 'request failed', { status: mapped.status });
    res.status(mapped.status).json({ error: mapped.error });
    return;
  }
  log.error('http', 'unhandled error');
  res.status(500).json({ error: 'Something went wrong.' });
});

/**
 * One-time startup work, safe to call on every request.
 *
 * Memoised as a promise rather than a boolean: two requests arriving together
 * on a cold instance would both see "not done yet" and both start migrating.
 * They await the same promise instead, and the advisory lock inside `migrate`
 * covers the same race across separate instances.
 */
let readiness: Promise<void> | null = null;

export function ready(): Promise<void> {
  readiness ??= (async () => {
    await migrate();

    if (process.env.DEMO_MODE === '1') {
      const demo = await seedDemoUser();
      // The password is deliberately not logged. It is a fixed constant in
      // seed.ts, so anyone who can read the source can read it there — but a
      // log line puts it in the platform's log store, which is a different
      // audience, and redact() only walks `extra`, never the message.
      if (demo) log.info('demo', 'demo user ready', { email: demo.email });
    }

    // Expired sessions were only removed when that exact token was presented
    // again, so rows for tokens nobody ever reuses accumulated forever.
    await sweepExpiredSessions();
  })().catch((err) => {
    // A failed startup must not be cached as done — the next request should be
    // allowed to try again rather than serving a permanently broken instance.
    readiness = null;
    throw err;
  });
  return readiness;
}
