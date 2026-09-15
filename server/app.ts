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
import { migrate } from './db/index.ts';
import { authRouter } from './routes/auth.ts';
import { apiRouter } from './routes/api.ts';
import { publicRouter } from './routes/public.ts';
import { adminRouter } from './routes/admin.ts';
import { modelAvailable, MODEL } from './ai/claude.ts';
import { clonedVoiceAvailable, guestVoiceAllowed, speakLine, VoiceUnavailable } from './voice/tts.ts';
import { guestVoiceLimiter } from './lib/rate-limit.ts';
import { blobStorageAvailable } from './lib/crypto.ts';
import { todaySummary } from './ai/budget.ts';
import { seedDemoUser } from './demo/seed.ts';
import { sweepExpiredSessions } from './db/users.ts';
import { log } from './lib/log.ts';

export const app = express();

// Only the two routes that carry an image get the large body limit; every
// other endpoint was accepting 12 MB of JSON for no reason.
const IMAGE_ROUTES = ['/api/scans', '/api/products/read-label', '/api/admin/catalogue/import'];
const largeBody = express.json({ limit: '12mb' });
const smallBody = express.json({ limit: '64kb' });
app.use((req, res, next) =>
  (IMAGE_ROUTES.includes(req.path) ? largeBody : smallBody)(req, res, next),
);

app.get('/api/health', async (_req, res) => {
  res.json({
    ok: true,
    modelAvailable: modelAvailable(),
    model: modelAvailable() ? MODEL : null,
    imageStorage: blobStorageAvailable(),
    clonedVoice: clonedVoiceAvailable(),
    guestVoice: guestVoiceAllowed(),
    demoMode: process.env.DEMO_MODE === '1',
    // Today's spend against the caps, so "is the model on" and "has it been
    // switched off by the budget" are both answerable from one request.
    budget: modelAvailable() ? await todaySummary() : null,
  });
});

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
    });
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

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  log.error('http', 'unhandled error', { error: err.message });
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
