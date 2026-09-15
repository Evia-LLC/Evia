/**
 * Every authenticated route. Thin by design — these translate HTTP into calls on
 * the orchestrator, the repositories and the skin engines, and translate the
 * results back. No business logic lives here.
 */
import { asyncRouter } from '../lib/async-router.ts';
import { requireAuth } from './auth.ts';
import { handleTurn, handleEvent, type ConversationEvent } from '../ai/orchestrator.ts';
import * as users from '../db/users.ts';
import * as scansRepo from '../db/scans.ts';
import * as bodyRepo from '../db/body-scans.ts';
import * as chat from '../db/chat.ts';
import * as productsRepo from '../db/products.ts';
import { summarise } from '../skin/longitudinal.ts';
import { assessProduct, reviewRoutine } from '../skin/ingredients.ts';
import { buildRoutinePlan } from '../skin/recommend.ts';
import { pickProducts } from '../catalogue/picks.ts';
import { evaluateRoutine } from '../skin/outcomes.ts';
import { speakLine, VoiceUnavailable } from '../voice/tts.ts';
import {
  modelAvailable,
  describeSkinImage,
  readProductLabel,
  describeApiError,
} from '../ai/claude.ts';
import { renderMetrics, sanitiseBodySnapshot } from '../ai/context.ts';
import {
  blobStorageAvailable,
  putBlob,
  getBlob,
  shredBlob,
  BlobStorageUnavailable,
} from '../lib/crypto.ts';
import { newId } from '../lib/ids.ts';
import { chatLimiter, scanLimiter, visionLimiter, voiceLimiter } from '../lib/rate-limit.ts';
import { log } from '../lib/log.ts';
import {
  BODY_METRIC_KEYS,
  PROFILE_METRIC_KEYS,
  SKIN_METRIC_KEYS,
  SKIN_MODEL_VERSION,
  type BodyAnalysisRecord,
  type ConsentKind,
  PREGNANCY_STATUSES,
  type PregnancyStatus,
  type SkinAnalysis,
} from '../../shared/types.ts';

export const apiRouter = asyncRouter();
apiRouter.use(requireAuth);

// --- me ---------------------------------------------------------------------

apiRouter.get('/me', async (req, res) => {
  res.json({ user: await users.getUserSummary(req.userId!), modelAvailable: modelAvailable() });
});

apiRouter.patch('/me/profile', async (req, res) => {
  const { skinType, fitzpatrick, concerns, sensitivities, pregnancyStatus } = req.body ?? {};
  res.json({
    profile: await users.updateProfile(req.userId!, {
      ...(skinType !== undefined && { skinType }),
      // Validated rather than passed through: the column is INTEGER, and
      // Postgres rejects "III" or 2.5 where SQLite's type affinity accepted
      // them. Only I-VI is a meaningful value anyway.
      ...(Number.isInteger(fitzpatrick) &&
        fitzpatrick >= 1 &&
        fitzpatrick <= 6 && { fitzpatrick }),
      ...(Array.isArray(concerns) && { concerns }),
      ...(Array.isArray(sensitivities) && { sensitivities }),
      // Allowlisted against the union. An unrecognised value is dropped rather
      // than stored, so a malformed request cannot land something that later
      // reads as neither restricted nor unknown.
      ...(PREGNANCY_STATUSES.includes(pregnancyStatus as PregnancyStatus) && {
        pregnancyStatus: pregnancyStatus as PregnancyStatus,
      }),
    }),
  });
});

apiRouter.patch('/me/preferences', async (req, res) => {
  res.json({ preferences: await users.updatePreferences(req.userId!, req.body ?? {}) });
});

apiRouter.put('/me/consent', async (req, res) => {
  const { kind, granted } = req.body ?? {};
  if (kind !== 'image_storage' && kind !== 'cloud_reasoning') {
    res.status(400).json({ error: 'Unknown consent kind.' });
    return;
  }
  await users.setConsent(req.userId!, kind as ConsentKind, Boolean(granted));
  res.json({ consents: await users.getConsents(req.userId!) });
});

/**
 * Hard delete. Shreds blobs first, then drops the user; rows cascade.
 *
 * Both tables, and this list has to grow whenever a table starts holding a
 * blob. "Delete everything" is the one promise in this app where a missed
 * source is not a bug in a feature, it is the feature being a lie — a body
 * capture left in storage after the account is gone is exactly that.
 */
apiRouter.delete('/me/data', async (req, res) => {
  const refs = [
    ...(await scansRepo.allBlobRefs(req.userId!)),
    ...(await bodyRepo.allBodyBlobRefs(req.userId!)),
  ];
  for (const ref of refs) {
    try {
      await shredBlob(ref);
    } catch (err) {
      log.error('privacy', 'blob shred failed', { error: (err as Error).message });
    }
  }
  await users.deleteUser(req.userId!);
  log.info('privacy', 'account and all data deleted', { blobs: refs.length });
  res.json({ ok: true, blobsShredded: refs.length });
});

// --- chat -------------------------------------------------------------------

apiRouter.get('/chat/history', async (req, res) => {
  const conversationId = await chat.currentConversation(req.userId!);
  res.json({ messages: await chat.recentMessages(conversationId, 60) });
});

apiRouter.post('/chat', chatLimiter, async (req, res) => {
  const message = String(req.body?.message ?? '').trim();
  if (!message) {
    res.status(400).json({ error: 'Empty message.' });
    return;
  }
  if (message.length > 4000) {
    res.status(413).json({ error: 'That message is too long.' });
    return;
  }
  try {
    const turn = await log.timed('chat', 'turn', () => handleTurn(req.userId!, message));
    res.json({ turn });
  } catch (err) {
    log.error('chat', 'turn failed', { error: (err as Error).message });
    res.status(500).json({ error: 'Something went wrong on my side.' });
  }
});

/**
 * Turns produced by app events rather than by a typed message — opening the app,
 * a scan finishing. Only Elohim's side is written to the transcript.
 */
apiRouter.post('/chat/event', chatLimiter, async (req, res) => {
  const event = req.body?.event;
  if (event !== 'opened' && event !== 'scan_complete' && event !== 'body_scan_complete') {
    res.status(400).json({ error: 'Unknown event.' });
    return;
  }
  /*
   * Body readings ride along with the event instead of being read from a table.
   *
   * There is no body table — the two pipelines measure different things against
   * different model versions and nothing may compare one to the other, so these
   * live for the length of this request. Rebuilt field by field rather than
   * trusted: this is browser-supplied JSON on its way into a model prompt.
   */
  const body = event === 'body_scan_complete' ? sanitiseBodySnapshot(req.body?.body) : undefined;
  /*
   * Extras travel with the event and are rebuilt field by field, like the
   * snapshot: browser-supplied JSON on its way toward a model prompt.
   * `spokenNarration` is what she already said aloud about the scan, so the
   * reply can build on it rather than read the same numbers back; the
   * orchestrator clamps its length again on its own side.
   */
  const rawExtras = req.body?.extras;
  const spokenNarration =
    rawExtras && typeof rawExtras === 'object' && typeof rawExtras.spokenNarration === 'string'
      ? rawExtras.spokenNarration.slice(0, 600)
      : undefined;
  try {
    const turn = await log.timed('chat', `event:${event}`, () =>
      handleEvent(
        req.userId!,
        event as ConversationEvent,
        body,
        spokenNarration ? { spokenNarration } : undefined,
      ),
    );
    res.json({ turn });
  } catch (err) {
    log.error('chat', 'event failed', { error: (err as Error).message });
    res.status(500).json({ error: 'Something went wrong on my side.' });
  }
});

apiRouter.get('/memories', async (req, res) => {
  res.json({ memories: await chat.listMemories(req.userId!) });
});

apiRouter.delete('/memories/:id', async (req, res) => {
  await chat.forgetMemory(req.userId!, req.params.id);
  res.json({ ok: true });
});

// --- scans ------------------------------------------------------------------

apiRouter.get('/scans', async (req, res) => {
  res.json({ scans: await scansRepo.listScans(req.userId!, 50) });
});

// --- body scans -------------------------------------------------------------
//
// A separate endpoint against a separate table, for the same reason they are
// separate everywhere else: nothing may compare a shoulder ratio to a hydration
// score, and the cheapest way to guarantee that is to give them no shared path.

apiRouter.get('/body-scans', async (req, res) => {
  res.json({ scans: await bodyRepo.listBodyScans(req.userId!, 50) });
});

apiRouter.delete('/body-scans/:id', async (req, res) => {
  const refs = await bodyRepo.deleteBodyScan(req.userId!, req.params.id);
  for (const ref of refs) await shredBlob(ref);
  res.json({ ok: true });
});

apiRouter.post('/body-scans', scanLimiter, async (req, res) => {
  const analysis = req.body?.analysis as BodyAnalysisRecord | undefined;
  if (!analysis?.metrics) {
    res.status(400).json({ error: 'An analysis is required.' });
    return;
  }
  for (const key of BODY_METRIC_KEYS) {
    const v = analysis.metrics[key];
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 100) {
      res.status(400).json({ error: `Metric ${key} is missing or out of range.` });
      return;
    }
  }
  /*
   * The profile is optional but, when present, must be complete.
   *
   * A half-stored abdominal reading is worse than none: the trend engine would
   * treat it as a measurement and compare next month's against it.
   */
  if (analysis.profile !== null && analysis.profile !== undefined) {
    for (const key of PROFILE_METRIC_KEYS) {
      const v = analysis.profile[key];
      if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 100) {
        res.status(400).json({ error: `Profile reading ${key} is out of range.` });
        return;
      }
    }
  }
  if (analysis.waistSource !== 'silhouette' && analysis.waistSource !== 'joints') {
    res.status(400).json({ error: 'waistSource must be "silhouette" or "joints".' });
    return;
  }

  const consents = await users.getConsents(req.userId!);
  const refs: { imageRef?: string; profileImageRef?: string } = {};

  // Both frames are gated behind the same consent as a face capture. No vision
  // pass: there is no second opinion to ask for on a set of joint ratios.
  if (consents.image_storage && blobStorageAvailable()) {
    for (const [field, ref] of [
      ['imageBase64', 'imageRef'],
      ['profileImageBase64', 'profileImageRef'],
    ] as const) {
      const base64: string | undefined = req.body?.[field];
      if (!base64) continue;
      try {
        refs[ref] = await putBlob(Buffer.from(base64, 'base64'), `${newId()}.bin`);
      } catch (err) {
        if (!(err instanceof BlobStorageUnavailable)) throw err;
      }
    }
  } else if (req.body?.imageBase64 && consents.image_storage) {
    log.warn('body-scans', 'image supplied but ELOHIM_BLOB_KEY is unset; not storing it');
  }

  const stored = await bodyRepo.insertBodyScan(
    req.userId!,
    { ...analysis, profile: analysis.profile ?? null },
    refs,
  );
  res.json({ scan: stored, previous: await bodyRepo.previousBodyScan(req.userId!) });
});

/**
 * What to actually do about the latest scan. Ingredients and steps, never
 * brands — there is no catalogue behind this.
 */
apiRouter.get('/routine/plan', async (req, res) => {
  const latest = await scansRepo.latestScan(req.userId!);
  if (!latest) {
    res.json({ plan: null });
    return;
  }
  const plan = buildRoutinePlan(
    latest.metrics,
    await users.getProfile(req.userId!),
    (await productsRepo.listUsage(req.userId!)).filter((u) => !u.endedAt),
    latest.confidence,
  );
  res.json({ plan });
});

/**
 * What to buy for the latest scan: the plan's suggestions matched to the
 * shelf, with prices, links and whatever the web could add. Empty when there
 * is no scan, or when neither the shelf nor the web had anything to say.
 */
apiRouter.get('/routine/picks', async (req, res) => {
  const latest = await scansRepo.latestScan(req.userId!);
  if (!latest) {
    res.json({ picks: [] });
    return;
  }
  const profile = await users.getProfile(req.userId!);
  const plan = buildRoutinePlan(
    latest.metrics,
    profile,
    (await productsRepo.listUsage(req.userId!)).filter((u) => !u.endedAt),
    latest.confidence,
  );
  res.json({ picks: await pickProducts(plan, profile, { web: true }) });
});

/**
 * Whether the routine is working.
 *
 * Separate from `/routine/plan` on purpose: the plan is what to do next, this
 * is what already happened, and conflating them is how an app ends up only
 * ever reporting its own successes.
 */
/**
 * Elohim's voice, synthesised.
 *
 * The key lives here and never reaches the browser. A 503 means no cloned voice
 * is configured, and the client falls back to the browser's own synthesis and
 * says which one it is using — it never quietly substitutes one voice for the
 * other, because a user who was told she has a human voice should be able to
 * tell when she does not.
 */
apiRouter.post('/voice/speak', voiceLimiter, async (req, res) => {
  const text = typeof req.body?.text === 'string' ? req.body.text : '';
  if (!text.trim()) {
    res.status(400).json({ error: 'Nothing to say.' });
    return;
  }

  /*
   * The cloned voice is a third party, and what gets sent to it is Elohim's
   * reply — which routinely quotes the user's readings and concerns back to
   * them. That is the user's data leaving this server, so it sits behind the
   * same consent as the model.
   *
   * A refusal here is not a dead end: the client treats any non-OK response as
   * a signal to use the browser's own speech synthesis, and says which voice it
   * is using. She still talks; she talks locally.
   */
  const consents = await users.getConsents(req.userId!);
  if (!consents.cloud_reasoning) {
    res.status(403).json({ error: 'Cloud reasoning is off, so the cloned voice is unavailable.' });
    return;
  }

  try {
    /*
     * The neighbours ride along for prosody: the client speaks sentence by
     * sentence and sends each one with the text either side of it, so a
     * sentence is read as part of its line rather than cold. Clamped - they
     * only steer delivery, and an unbounded string is an unbounded bill.
     */
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
      // The per-sentence pieces, so a single request can carry what the
      // client otherwise assembles from one request per sentence. Only when
      // there is more than one: a single chunk IS the flat audio, and
      // sending it twice doubles the latency-critical transfer.
      ...(line.chunks.length <= 1
        ? {}
        : {
            chunks: line.chunks.map((chunk) => ({
              text: chunk.text,
              audio: chunk.audio.toString('base64'),
              contentType: chunk.contentType,
              words: chunk.words,
              duration: chunk.duration,
              start: chunk.start,
              charOffset: chunk.charOffset,
              cached: chunk.cached,
            })),
          }),
    });
  } catch (err) {
    if (err instanceof VoiceUnavailable) {
      res.status(503).json({ error: err.message });
      return;
    }
    res.status(502).json({ error: (err as Error).message });
  }
});

apiRouter.get('/routine/outcomes', async (req, res) => {
  const history = await scansRepo.scanHistory(req.userId!, 60);
  const usage = await productsRepo.listUsage(req.userId!);
  res.json({ outcomes: evaluateRoutine(history, usage) });
});

apiRouter.get('/scans/summary', async (req, res) => {
  const history = await scansRepo.scanHistory(req.userId!, 60);
  const usage = await productsRepo.listUsage(req.userId!);
  res.json({ summary: summarise(history, usage) });
});

apiRouter.get('/scans/:id', async (req, res) => {
  const scan = await scansRepo.getScan(req.userId!, req.params.id);
  if (!scan) {
    res.status(404).json({ error: 'No such scan.' });
    return;
  }
  res.json({ scan });
});

/**
 * The image is only ever readable through here: authenticated, ownership
 * checked, decrypted on the way out. It is never a static file.
 */
apiRouter.get('/scans/:id/image', async (req, res) => {
  const ref = await scansRepo.getScanImageRef(req.userId!, req.params.id);
  if (!ref) {
    res.status(404).json({ error: 'No stored image for that scan.' });
    return;
  }
  const data = await getBlob(ref);
  if (!data) {
    res.status(410).json({ error: 'The stored image could not be read.' });
    return;
  }
  res.setHeader('Content-Type', 'image/jpeg');
  res.setHeader('Cache-Control', 'private, no-store');
  res.send(data);
});

apiRouter.delete('/scans/:id', async (req, res) => {
  const refs = await scansRepo.deleteScan(req.userId!, req.params.id);
  for (const ref of refs) await shredBlob(ref);
  res.json({ ok: true });
});

/**
 * Accepts an analysis computed on the device. The image is optional and is only
 * stored when the user has separately consented — ARCHITECTURE §10.
 */
apiRouter.post('/scans', scanLimiter, async (req, res) => {
  const analysis = req.body?.analysis as SkinAnalysis | undefined;
  if (!analysis?.metrics) {
    res.status(400).json({ error: 'An analysis is required.' });
    return;
  }
  for (const key of SKIN_METRIC_KEYS) {
    const v = analysis.metrics[key];
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 100) {
      res.status(400).json({ error: `Metric ${key} is missing or out of range.` });
      return;
    }
  }

  const consents = await users.getConsents(req.userId!);
  const imageBase64: string | undefined = req.body?.imageBase64;
  let imageRef: string | undefined;

  if (imageBase64 && consents.image_storage) {
    if (!blobStorageAvailable()) {
      log.warn('scans', 'image supplied but ELOHIM_BLOB_KEY is unset; not storing it');
    } else {
      try {
        imageRef = await putBlob(Buffer.from(imageBase64, 'base64'), `${newId()}.bin`);
      } catch (err) {
        if (!(err instanceof BlobStorageUnavailable)) throw err;
      }
    }
  }

  let observations = analysis.observations ?? [];
  if (imageBase64 && consents.cloud_reasoning && modelAvailable()) {
    try {
      observations = await describeSkinImage(imageBase64, 'image/jpeg', renderMetrics(analysis));
    } catch (err) {
      log.warn('scans', 'vision pass failed; keeping deterministic metrics only', {
        error: describeApiError(err),
      });
    }
  }

  const stored = await scansRepo.insertScan(
    req.userId!,
    {
      ...analysis,
      observations,
      landmarks: sanitiseLandmarks(analysis.landmarks),
      capturedAt: analysis.capturedAt || new Date().toISOString(),
      modelVersion: analysis.modelVersion || SKIN_MODEL_VERSION,
    },
    { imageRef },
  );

  const history = await scansRepo.scanHistory(req.userId!, 60);
  const summary = summarise(history, await productsRepo.listUsage(req.userId!));

  log.info('scans', 'scan stored', {
    confidence: stored.confidence,
    quality: stored.quality?.verdict,
    imageStored: Boolean(imageRef),
  });

  res.json({ scan: stored, summary });
});

/**
 * The mesh, rebuilt from untrusted JSON: a flat list of numbers, pairs, each
 * inside the crop. Anything else is dropped rather than stored, because a
 * malformed mesh would be drawn onto the wrong face later.
 */
function sanitiseLandmarks(raw: unknown): number[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length % 2 !== 0 || raw.length > 2 * 520) {
    return undefined;
  }
  const out: number[] = [];
  for (const v of raw) {
    if (typeof v !== 'number' || !Number.isFinite(v)) return undefined;
    out.push(Math.round(Math.max(-0.5, Math.min(1.5, v)) * 10_000) / 10_000);
  }
  return out;
}

// --- products ---------------------------------------------------------------

apiRouter.get('/products/search', async (req, res) => {
  res.json({ products: await productsRepo.searchProducts(String(req.query.q ?? ''), 20) });
});

apiRouter.post('/products', async (req, res) => {
  const { name, brand, category, ingredients } = req.body ?? {};
  if (typeof name !== 'string' || !name.trim()) {
    res.status(400).json({ error: 'A product name is required.' });
    return;
  }
  res.json({
    product: await productsRepo.upsertProduct({
      name,
      brand,
      category,
      ingredients: Array.isArray(ingredients) ? ingredients : [],
    }),
  });
});

apiRouter.post('/products/:id/assess', async (req, res) => {
  const product = await productsRepo.getProduct(req.params.id);
  if (!product) {
    res.status(404).json({ error: 'No such product.' });
    return;
  }
  res.json({
    assessment: assessProduct(
      product,
      await users.getProfile(req.userId!),
      (await productsRepo.listUsage(req.userId!)).filter((u) => !u.endedAt),
    ),
  });
});

/**
 * Vision label read. Gated on the same cloud-reasoning consent as the face
 * scan, because a label photo is still a photo the user took.
 */
apiRouter.post('/products/read-label', visionLimiter, async (req, res) => {
  const imageBase64 = req.body?.imageBase64;
  if (typeof imageBase64 !== 'string' || imageBase64.length < 100) {
    res.status(400).json({ error: 'An image is required.' });
    return;
  }
  if (!modelAvailable()) {
    res.status(503).json({ error: 'No model is configured; use the on-device reader.' });
    return;
  }
  if (!(await users.getConsents(req.userId!)).cloud_reasoning) {
    res.status(403).json({ error: 'Cloud reading is off. Turn it on in Privacy, or use on-device OCR.' });
    return;
  }
  try {
    const result = await log.timed('products', 'label read', () => readProductLabel(imageBase64));
    res.json(result);
  } catch (err) {
    log.error('products', 'label read failed', { error: describeApiError(err) });
    res.status(502).json({ error: 'I could not read that label.' });
  }
});

apiRouter.get('/routine', async (req, res) => {
  const usage = await productsRepo.listUsage(req.userId!);
  res.json({ usage, review: reviewRoutine(usage.filter((u) => !u.endedAt)) });
});

apiRouter.post('/routine', async (req, res) => {
  const { productId, frequency, startedAt, notes } = req.body ?? {};
  if (typeof productId !== 'string' || !await productsRepo.getProduct(productId)) {
    res.status(400).json({ error: 'A known productId is required.' });
    return;
  }
  const id = await productsRepo.startUsage(req.userId!, productId, { frequency, startedAt, notes });
  res.json({ id, usage: await productsRepo.listUsage(req.userId!) });
});

apiRouter.delete('/routine/:id', async (req, res) => {
  await productsRepo.endUsage(req.userId!, req.params.id);
  res.json({ usage: await productsRepo.listUsage(req.userId!) });
});
