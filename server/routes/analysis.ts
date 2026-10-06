import {
  AGE_FLOW_VERSION,
  AGE_REVIEW_ACTIONS,
  REGISTRATION_DOCUMENT_VERSIONS,
  guardianReviewRecord,
} from "../../shared/age-flow.ts";
import {
  REVIEW_VERSIONS,
  REVIEW_CHOICES,
  REVIEW_ACTIONS,
  HEALTH_REGIONS,
  type ReviewSurface,
} from "../../shared/legal-review.ts";
import { asyncRouter } from "../lib/async-router.ts";
import { requireAuth } from "./auth.ts";
import { scanLimiter } from "../lib/rate-limit.ts";
import { ImageInputError, validateImageInput } from "../lib/image-input.ts";
import { currentConsent, recordConsentDecision } from "../db/consents.ts";
import { CONSENT_KEYS } from "../../shared/consent-keys.ts";
import { LEGAL_CONTENT, approvedConsent } from "../../shared/legal-content.ts";
import {
  analyseWithPerfectCorp,
  analysisProvider,
  perfectCorpAvailable,
  sampleDemoEnabled,
  PERFECTCORP_MODEL_VERSION,
  PERFECTCORP_NOTE,
  PERFECTCORP_PROVIDER_TIMEOUT_MS,
  PerfectCorpUnavailable,
} from "../ai/perfectcorp.ts";

export const analysisRouter = asyncRouter();
analysisRouter.use(requireAuth);
const wording = LEGAL_CONTENT["facial-scan-consent"];

/** Review evidence cannot become a production processing grant. */
analysisRouter.post("/legal-review", async (req, res) => {
  if (!sampleDemoEnabled()) {
    res.status(403).json({ error: "Sample-data review is disabled." });
    return;
  }
  const {
    surface,
    choice,
    wordingVersionId,
    idempotencyKey,
    action = "review",
    jurisdiction,
    preferences,
    targetId,
  } = req.body ?? {};
  if (
    typeof surface !== "string" ||
    !Object.hasOwn(REVIEW_VERSIONS, surface) ||
    wordingVersionId !== REVIEW_VERSIONS[surface as ReviewSurface] ||
    !REVIEW_CHOICES.includes(choice) ||
    !REVIEW_ACTIONS.includes(action) ||
    (jurisdiction !== undefined && !HEALTH_REGIONS.includes(jurisdiction)) ||
    typeof idempotencyKey !== "string" ||
    !idempotencyKey.trim() ||
    idempotencyKey.length > 100
  ) {
    res
      .status(400)
      .json({ error: "A current, versioned review choice is required." });
    return;
  }
  const decision = await recordConsentDecision(
    req.userId!,
    `demo_review:${surface}`,
    wordingVersionId,
    choice === "accepted" ? "granted" : "withdrawn",
    {
      idempotencyKey,
      actorType: "account_review",
      actorId: req.userId!,
      source: surface,
      action,
      choice,
      jurisdiction,
      demoOnly: true,
      approved: false,
      ip: req.ip,
      ...(typeof targetId === "string" && { targetId: targetId.slice(0, 100) }),
      ...(surface === "cookie-preferences" && {
        preferences: {
          necessary: true,
          functional: preferences?.functional === true,
          analytics: preferences?.analytics === true,
          marketing: false,
        },
      }),
    },
  );
  res.status(201).json({ decision, approved: false });
});

analysisRouter.post("/consent", async (req, res) => {
  const { choice, wordingVersionId, idempotencyKey } = req.body ?? {};
  if (
    !["accepted", "declined"].includes(choice) ||
    wordingVersionId !== wording.wordingVersionId ||
    typeof idempotencyKey !== "string" ||
    !idempotencyKey ||
    idempotencyKey.length > 100
  ) {
    res.status(400).json({
      error:
        "A choice, current wording version and idempotency key are required.",
    });
    return;
  }
  if (
    choice === "accepted" &&
    !sampleDemoEnabled() &&
    wording.status !== "approved"
  ) {
    res.status(403).json({
      error: "This wording is awaiting approval. Sample demo mode is required.",
    });
    return;
  }
  const decision = await recordConsentDecision(
    req.userId!,
    CONSENT_KEYS.FACIAL_SCAN,
    wordingVersionId,
    choice === "accepted" ? "granted" : "withdrawn",
    {
      idempotencyKey,
      actorType: "account",
      actorId: req.userId!,
      source: "facial-scan-screen",
      choice,
      demoOnly: wording.status !== "approved",
      wordingStatus: wording.status,
      ip: req.ip,
    },
  );
  res.status(201).json({
    decision,
    productionApproved: approvedConsent({
      ...decision,
      decisionId: decision.id,
    }),
  });
});

analysisRouter.post("/face", scanLimiter, async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const consent = await currentConsent(req.userId!, CONSENT_KEYS.FACIAL_SCAN);
  const demoAccepted =
    sampleDemoEnabled() &&
    consent?.state === "granted" &&
    consent.wordingVersionId === wording.wordingVersionId;
  if (!approvedConsent(consent) && !demoAccepted) {
    delete req.body?.imageBase64;
    res.status(403).json({ error: "Facial scan consent is required." });
    return;
  }
  if (analysisProvider() === "local" || !perfectCorpAvailable()) {
    delete req.body?.imageBase64;
    res.json({
      provider: "local",
      reason: analysisProvider() === "local" ? "selected" : "not_configured",
    });
    return;
  }
  // Transient request memory only: no blob, file, URL, landmarks or vendor response is persisted.
  // Consent stays first: a denial above returns before the payload is even decoded.
  let validated: { bytes: Buffer };
  try {
    validated = validateImageInput(req.body?.imageBase64, "face");
  } catch (err) {
    delete req.body?.imageBase64;
    const status = err instanceof ImageInputError ? err.status : 400;
    res.status(status).json({ error: "A JPEG capture is required." });
    return;
  }
  delete req.body?.imageBase64;
  const image = validated.bytes;
  // P1-T12 — disconnect cancels provider work: a client that goes away
  // aborts the vendor upload/task/poll chain via the combined signal inside
  // analyseWithPerfectCorp, so no orphan billable task outlives the request.
  // 'close' also fires after a completed response, so only abort while the
  // response is still open — a finished scan never cancels settled work.
  const controller = new AbortController();
  const abort = () => {
    if (!res.writableEnded) controller.abort();
  };
  res.once("close", abort);
  try {
    // Binding provider budget for this route: provider 18 s < client 24 s
    // (browser AbortSignal.timeout in src/skin-analysis/provider.ts) <
    // host 26 s (Netlify raised) / 30 s (Vercel maxDuration). The 6 s between
    // provider and client deadlines is vendor-cleanup + settle + serialize
    // headroom; the client timeout owns the rest.
    const metrics = await analyseWithPerfectCorp(image, {
      userId: req.userId!,
      timeoutMs: PERFECTCORP_PROVIDER_TIMEOUT_MS,
      signal: controller.signal,
    });
    res.json({
      provider: "perfectcorp",
      metrics,
      modelVersion: PERFECTCORP_MODEL_VERSION,
      notes: PERFECTCORP_NOTE,
    });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("over budget:")) {
      res.status(429).json({
        error: "The shared analysis allowance is exhausted. Try again later.",
      });
      return;
    }
    res.json({
      provider: "local",
      reason:
        error instanceof PerfectCorpUnavailable
          ? error.reason
          : "provider_error",
    });
  } finally {
    image.fill(0);
    res.removeListener("close", abort);
  }
});

/** Sample review evidence is separate from real guardian approval and never unlocks anything. */
analysisRouter.post("/onboarding-choice", async (req, res) => {
  if (!sampleDemoEnabled()) {
    res.status(403).json({ error: "Sample-data review is disabled." });
    return;
  }
  const { action, choice, wordingVersionId, idempotencyKey, guardian } =
    req.body ?? {};
  if (
    !AGE_REVIEW_ACTIONS.includes(action) ||
    !["accepted", "declined", "preview", "attempted"].includes(choice) ||
    wordingVersionId !== AGE_FLOW_VERSION ||
    typeof idempotencyKey !== "string" ||
    !idempotencyKey ||
    idempotencyKey.length > 100
  ) {
    res
      .status(400)
      .json({ error: "A current, versioned review choice is required." });
    return;
  }
  const record = guardianReviewRecord({
    accountId: req.userId!,
    guardianName:
      typeof guardian?.name === "string" ? guardian.name.slice(0, 120) : "",
    guardianEmail:
      typeof guardian?.email === "string" ? guardian.email.slice(0, 254) : "",
    relationship: guardian?.relationship === true,
    cardType: ["credit", "debit", "prepaid"].includes(guardian?.cardType)
      ? guardian.cardType
      : "credit",
    illinois: guardian?.illinois === true,
    wordingVersions: REGISTRATION_DOCUMENT_VERSIONS,
    ipAddress: req.ip,
  });
  const decision = await recordConsentDecision(
    req.userId!,
    "age_flow_review",
    AGE_FLOW_VERSION,
    choice === "accepted" ? "granted" : "withdrawn",
    {
      idempotencyKey,
      actorType: "account_review",
      actorId: req.userId!,
      source: "age-guardian-demo",
      action,
      choice,
      demoOnly: true,
      approved: false,
      record,
    },
  );
  res.status(201).json({ decision, record, approved: false });
});
