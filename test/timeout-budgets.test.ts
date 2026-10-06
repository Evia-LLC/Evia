/**
 * P1-T12 — provider deadlines align with hosting limits.
 *
 * Host bounds (established by inspection): Vercel `maxDuration: 30` → 30 s;
 * Netlify sets no function timeout in repo config (platform default 10 s
 * synchronous, raisable to 26 s — an operator action). Design host = 26 s
 * (Netlify raised) / 30 s (Vercel).
 *
 * Budget under test: face provider 18 s < client 24 s < host;
 * label/chat provider 18 s (classifier 8 s) < response 24 s < host;
 * TTS sentence 10 s < line 20 s < host;
 * marketplace token 5 s / search 8 s < webOffers 12 s (picks fan-out 10 s per
 * pick, concurrency 2, ≤4 picks → ≤20 s) < host.
 *
 * Method: injected-clock seams (per-call timeoutMs / pollMs /
 * retryDelaysMs / offersTimeoutMs options) with short REAL durations — no
 * tens-of-seconds sleeps, no network. Hung stubs respect AbortSignal exactly
 * like the real transports, so an abort that frees a stub proves the wiring
 * frees the real call. Synthetic data only.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const settled = vi.hoisted(() => ({
  calls: [] as Array<{ op: string; actual: unknown }>,
}));
const failed = vi.hoisted(() => ({
  calls: [] as Array<{ op: string; reason: unknown }>,
}));
const sdkCreate = vi.hoisted(() => ({
  fn: null as null | ((...args: unknown[]) => Promise<never>),
}));

class BudgetDispatchError extends Error {
  readonly dispatched: boolean;
  constructor(message: string, dispatched: boolean) {
    super(message);
    this.name = "BudgetDispatchError";
    this.dispatched = dispatched;
  }
}

vi.mock("../server/ai/budget.ts", () => ({
  BudgetDispatchError,
  // Emulates the real P1-T07 semantics: success settles once, a known
  // pre-dispatch failure fails once, anything else stays pending (rethrow).
  withReservation: async (
    input: { operationId: string },
    provider: (r: unknown) => Promise<{ result: unknown }>,
  ) => {
    try {
      const { result } = await provider({});
      settled.calls.push({ op: input.operationId, actual: {} });
      return {
        result,
        reservation: { operationId: input.operationId, status: "settled" },
      };
    } catch (err) {
      if (err instanceof BudgetDispatchError && err.dispatched === false) {
        failed.calls.push({ op: input.operationId, reason: err.message });
      }
      throw err;
    }
  },
  settleReservation: vi.fn(async (operationId: string, actual: unknown) => {
    settled.calls.push({ op: operationId, actual });
    return {
      ok: true,
      reservation: { operationId, status: "settled" },
      duplicate: false,
    };
  }),
  failReservation: vi.fn(async (operationId: string, reason: unknown) => {
    failed.calls.push({ op: operationId, reason });
    return {
      ok: true,
      reservation: { operationId, status: "failed" },
      duplicate: false,
    };
  }),
  refundReservation: vi.fn(async () => ({
    ok: false,
    reason: "unknown_operation",
  })),
}));

vi.mock("../server/db/index.ts", () => ({
  row: vi.fn(async () => undefined),
  rows: vi.fn(async () => []),
  run: vi.fn(async () => 0),
  transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
    fn({
      rows: async () => [],
      row: async () => undefined,
      run: async () => 0,
    }),
  ),
}));

vi.mock("@anthropic-ai/sdk", () => {
  class AuthenticationError extends Error {}
  class RateLimitError extends Error {}
  class BadRequestError extends Error {}
  class APIConnectionError extends Error {}
  class APIConnectionTimeoutError extends Error {}
  class APIError extends Error {
    status?: number;
    constructor(message?: string, status?: number) {
      super(message);
      this.status = status;
    }
  }
  return {
    default: class Anthropic {
      messages = { create: (...args: unknown[]) => sdkCreate.fn?.(...args) };
    },
    AuthenticationError,
    RateLimitError,
    BadRequestError,
    APIConnectionError,
    APIConnectionTimeoutError,
    APIError,
  };
});

vi.mock("../server/catalogue/store.ts", async (importOriginal) => {
  const actual = await importOriginal<object>();
  return { ...actual, listCatalogue: vi.fn(async () => []) };
});

const {
  analyseWithPerfectCorp,
  vendorCleanupPending,
  resetVendorCleanupQueue,
} = await import("../server/ai/perfectcorp.ts");
const { structuredTurn, classifyTurn, readProductLabel } =
  await import("../server/ai/claude.ts");
const { speakLine } = await import("../server/voice/tts.ts");
const { webOffers } = await import("../server/catalogue/offers.ts");
const { pickProducts } = await import("../server/catalogue/picks.ts");

const jpeg = new Uint8Array([255, 216, 255, 217]);
const UPLOAD_URL =
  "https://yce-us.s3-accelerate.amazonaws.com/demo/upload?signature=test";
const filePayload = {
  status: 200,
  data: {
    files: [
      {
        file_id: "file-id",
        requests: [{ method: "PUT", url: UPLOAD_URL, headers: {} }],
      },
    ],
  },
};
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status });

function abortError(): Error {
  const err = new Error("This operation was aborted.");
  err.name = "AbortError";
  return err;
}

/** A hung transport that frees exactly like the real one on abort. */
function hung(signal?: AbortSignal | null): Promise<never> {
  if (signal?.aborted) return Promise.reject(abortError());
  return new Promise<never>((_, reject) => {
    signal?.addEventListener("abort", () => reject(abortError()), {
      once: true,
    });
  });
}

beforeEach(() => {
  vi.stubEnv("PERFECTCORP_API_KEY", "test-key");
  vi.stubEnv("ELOHIM_VOICE_API_KEY", "test-key");
  vi.stubEnv("ELOHIM_VOICE_ID", "voice-id");
  vi.stubEnv("EBAY_CLIENT_ID", "test-id");
  vi.stubEnv("EBAY_CLIENT_SECRET", "test-secret");
  settled.calls.length = 0;
  failed.calls.length = 0;
  resetVendorCleanupQueue();
  // Hung by default; individual tests resolve it when they need success.
  sdkCreate.fn = ((_params: unknown, reqOpts?: { signal?: AbortSignal }) =>
    hung(reqOpts?.signal ?? null)) as typeof sdkCreate.fn;
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("face scan: hung provider", () => {
  it("times out before the host deadline with exactly one billable submission, cleanup attempted, reservation settled once", async () => {
    const counts = { file: 0, put: 0, task: 0, status: 0, cleanup: 0 };
    const fetch = vi.fn(
      async (url: unknown, init?: { signal?: AbortSignal }) => {
        const target = String(url);
        if (target.includes("/s2s/v2.0/file")) {
          counts.file += 1;
          return json(filePayload);
        }
        if (target.includes("amazonaws.com")) {
          counts.put += 1;
          return new Response("");
        }
        if (target.endsWith("task/skin-analysis")) {
          counts.task += 1;
          return json({ status: 200, data: { task_id: "task-1" } });
        }
        if (target.includes("task/skin-analysis/task-1")) {
          counts.status += 1;
          return hung(init?.signal ?? null) as unknown as Response;
        }
        if (target.endsWith("task/delete")) {
          counts.cleanup += 1;
          return json({ status: 200, data: {} });
        }
        throw new Error(`unexpected fetch ${target}`);
      },
    );
    const started = Date.now();
    await expect(
      analyseWithPerfectCorp(jpeg, {
        userId: "u1",
        fetch: fetch as unknown as typeof globalThis.fetch,
        timeoutMs: 400,
        pollMs: 25,
      }),
    ).rejects.toThrow("timeout");
    const elapsed = Date.now() - started;
    // Billable-once: the hung poll never submits a second task.
    expect(counts.task).toBe(1);
    expect(counts.file).toBe(1);
    expect(counts.put).toBe(1);
    expect(counts.status).toBeGreaterThan(0);
    // Vendor-side cleanup was attempted on the timeout path.
    expect(counts.cleanup).toBe(1);
    // The timed-out dispatch settled exactly once, as consumed (it was billed).
    expect(
      settled.calls.filter(
        (c) => (c.actual as { units?: number })?.units === 1,
      ),
    ).toHaveLength(1);
    expect(failed.calls).toHaveLength(0);
    expect(vendorCleanupPending()).toBe(0);
    // Well inside any host deadline (400 ms provider budget + 3 s cleanup cap).
    expect(elapsed).toBeLessThan(5000);
  });

  it("client disconnect mid-poll stops polling with no second submission", async () => {
    const controller = new AbortController();
    const counts = { task: 0, status: 0, cleanup: 0 };
    const fetch = vi.fn(
      async (url: unknown, init?: { signal?: AbortSignal }) => {
        const target = String(url);
        if (target.includes("/s2s/v2.0/file")) return json(filePayload);
        if (target.includes("amazonaws.com")) return new Response("");
        if (target.endsWith("task/skin-analysis")) {
          counts.task += 1;
          return json({ status: 200, data: { task_id: "task-2" } });
        }
        if (target.includes("task/skin-analysis/task-2")) {
          counts.status += 1;
          // Disconnect while the second poll is in flight.
          if (counts.status === 2) controller.abort();
          return json({ status: 200, data: { task_status: "running" } });
        }
        if (target.endsWith("task/delete")) {
          counts.cleanup += 1;
          return json({ status: 200, data: {} });
        }
        throw new Error(`unexpected fetch ${target}`);
      },
    );
    await expect(
      analyseWithPerfectCorp(jpeg, {
        userId: "u1",
        fetch: fetch as unknown as typeof globalThis.fetch,
        timeoutMs: 5000,
        pollMs: 20,
        signal: controller.signal,
      }),
    ).rejects.toThrow("timeout");
    expect(counts.task).toBe(1);
    const frozen = counts.status;
    // Disconnect-mid-poll: no further status fetch ever starts.
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(counts.status).toBe(frozen);
    expect(counts.cleanup).toBeGreaterThanOrEqual(1);
    expect(
      settled.calls.filter(
        (c) => (c.actual as { units?: number })?.units === 1,
      ),
    ).toHaveLength(1);
  });

  it("failed vendor cleanup enters the bounded retry path and terminates", async () => {
    const counts = { cleanup: 0 };
    const fetch = vi.fn(
      async (url: unknown, init?: { signal?: AbortSignal }) => {
        const target = String(url);
        if (target.includes("/s2s/v2.0/file")) return json(filePayload);
        if (target.includes("amazonaws.com")) return new Response("");
        if (target.endsWith("task/skin-analysis")) {
          return json({ status: 200, data: { task_id: "task-3" } });
        }
        if (target.includes("task/skin-analysis/task-3")) {
          return hung(init?.signal ?? null) as unknown as Response;
        }
        if (target.endsWith("task/delete")) {
          counts.cleanup += 1;
          return new Response("refused", { status: 500 });
        }
        throw new Error(`unexpected fetch ${target}`);
      },
    );
    await expect(
      analyseWithPerfectCorp(jpeg, {
        userId: "u1",
        fetch: fetch as unknown as typeof globalThis.fetch,
        timeoutMs: 300,
        pollMs: 20,
        retryDelaysMs: [25, 25],
      }),
    ).rejects.toThrow("timeout");
    // The failed synchronous attempt entered the durable-in-request retry path.
    expect(counts.cleanup).toBe(1);
    expect(vendorCleanupPending()).toBe(1);
    // Bounded attempts (1 sync + 2 retries), then termination — never an
    // unbounded loop, never a silent drop (drops are error-logged by module).
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(counts.cleanup).toBe(3);
    expect(vendorCleanupPending()).toBe(0);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(counts.cleanup).toBe(3);
  });
});

describe("chat and label model calls", () => {
  it("hung label read resolves before the host with one SDK call and settles via the fail path once", async () => {
    const started = Date.now();
    await expect(
      readProductLabel(
        Buffer.from([1, 2, 3]).toString("base64"),
        "image/jpeg",
        "u1",
        { timeoutMs: 300 },
      ),
    ).rejects.toThrow("Model request timed out.");
    expect(Date.now() - started).toBeLessThan(3000);
    expect(failed.calls).toHaveLength(1);
    expect(settled.calls).toHaveLength(0);
  });

  it("hung chat turn resolves before the host with one SDK call", async () => {
    const started = Date.now();
    await expect(
      structuredTurn({
        userId: "u1",
        personaPrefix: "p",
        contextBlock: "c",
        messages: [],
        schema: {},
        timeoutMs: 300,
      }),
    ).rejects.toThrow("Model request timed out.");
    expect(Date.now() - started).toBeLessThan(3000);
    expect(failed.calls).toHaveLength(1);
  });

  it("classifier disconnect propagates the abort signal instead of dispatching blind", async () => {
    const seen: Array<AbortSignal | undefined> = [];
    sdkCreate.fn = ((_params: unknown, reqOpts?: { signal?: AbortSignal }) => {
      seen.push(reqOpts?.signal);
      return hung(reqOpts?.signal ?? null);
    }) as typeof sdkCreate.fn;
    const controller = new AbortController();
    controller.abort();
    await expect(
      classifyTurn("hello", {}, "u1", { signal: controller.signal }),
    ).rejects.toThrow("Model request timed out.");
    // The disconnect signal reached the transport: no orphan billable call.
    expect(seen).toHaveLength(1);
    expect(seen[0]?.aborted).toBe(true);
    expect(failed.calls).toHaveLength(1);
  });
});

describe("voice synthesis", () => {
  it("hung TTS resolves before the host with one provider call and fail-settles once", async () => {
    const counts = { tts: 0 };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: unknown, init?: { signal?: AbortSignal }) => {
        counts.tts += 1;
        return hung(init?.signal ?? null) as unknown as Response;
      }),
    );
    const started = Date.now();
    await expect(
      speakLine("A brand new sentence never seen anywhere before", {}, "u1", {
        timeoutMs: 400,
        sentenceTimeoutMs: 300,
      }),
    ).rejects.toThrow(/timed out/i);
    expect(Date.now() - started).toBeLessThan(3000);
    expect(counts.tts).toBe(1);
    expect(failed.calls).toHaveLength(1);
    expect(settled.calls).toHaveLength(0);
  });

  it("disconnect aborts TTS dispatch with no second submission", async () => {
    const counts = { tts: 0 };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: unknown, init?: { signal?: AbortSignal }) => {
        counts.tts += 1;
        return hung(init?.signal ?? null) as unknown as Response;
      }),
    );
    const controller = new AbortController();
    const pending = expect(
      speakLine("Another unheard sentence for the voice", {}, "u1", {
        signal: controller.signal,
      }),
    ).rejects.toThrow(/timed out/i);
    await new Promise((resolve) => setTimeout(resolve, 50));
    controller.abort();
    const started = Date.now();
    await pending;
    expect(Date.now() - started).toBeLessThan(2000);
    expect(counts.tts).toBe(1);
    expect(failed.calls).toHaveLength(1);
  });
});

describe("marketplace offers", () => {
  it("hung token fetch resolves to search links with exactly one token call and no search call", async () => {
    const counts = { token: 0, search: 0 };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: unknown, init?: { signal?: AbortSignal }) => {
        const target = String(url);
        if (target.includes("oauth2/token")) {
          counts.token += 1;
          return hung(init?.signal ?? null) as unknown as Response;
        }
        counts.search += 1;
        return hung(init?.signal ?? null) as unknown as Response;
      }),
    );
    const started = Date.now();
    const offers = await webOffers("centella serum", { timeoutMs: 300 });
    expect(Date.now() - started).toBeLessThan(2000);
    expect(counts.token).toBe(1);
    expect(counts.search).toBe(0);
    // Honest degradation: links only, nothing claimed as compared.
    expect(offers).toHaveLength(2);
    expect(offers.every((o) => o.compared === false)).toBe(true);
  });

  it("picks fan-out stays bounded with a hung marketplace", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: unknown, init?: { signal?: AbortSignal }) => {
        return hung(init?.signal ?? null) as unknown as Response;
      }),
    );
    const suggestion = (
      title: string,
      step: "treat" | "hydrate" | "cleanse" | "protect",
    ) => ({
      step,
      title,
      actives: ["Centella Asiatica"],
      family: "soothing",
      because: { key: "redness", value: 62, label: "Redness" },
      why: "Calms visible irritation.",
      cautions: [],
      alreadyCovered: false,
      coveredBy: [],
      priority: 0.6,
    });
    const plan = {
      suggestions: [
        suggestion("Calm serum one", "treat"),
        suggestion("Calm serum two", "treat"),
        suggestion("Calm cream three", "hydrate"),
        suggestion("Calm wash four", "cleanse"),
      ],
      gaps: [],
      caveat: "",
    };
    const profile = {
      skinType: "combination",
      fitzpatrick: null,
      concerns: [],
      sensitivities: [],
      pregnancyStatus: "unknown",
      updatedAt: "2026-09-05T00:00:00.000Z",
    };
    const started = Date.now();
    // 4 picks × 500 ms sequential would be ≥2000 ms; concurrency 2 finishes
    // in ~2 waves ≈ 1000 ms. The bound below proves the fan-out, not the sum.
    const picks = await pickProducts(plan as never, profile as never, {
      web: true,
      offersTimeoutMs: 500,
    });
    const elapsed = Date.now() - started;
    expect(elapsed).toBeLessThan(1700);
    expect(picks).toHaveLength(4);
    for (const pick of picks) {
      expect(pick.offers.length).toBeGreaterThan(0);
      expect(pick.offers.every((o) => o.compared === false)).toBe(true);
    }
  });
});
