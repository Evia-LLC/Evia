/**
 * P1-T11 — the voice cache persists stock lines only.
 *
 * `voice_lines` used to store every synthesised sentence (text, audio and
 * timings) with no owner and no expiry — including personalised replies and
 * guest input. After the fix the persistent cache admits only exact
 * server-allowlist stock sentences; everything else synthesises fresh per
 * request and is never written. This file pins that contract with synthetic
 * data only: a stubbed provider TTS endpoint with a call counter (same shape
 * as `test/ownership-boundaries.test.ts`), and the real disposable database
 * from `npm run test:local`.
 *
 * Like the ownership-boundaries suite, this file only runs under
 * `npm run test:local` (which injects a disposable PGlite URL). A bare
 * `vitest run` skips loudly instead of failing opaquely.
 */
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const configured = (process.env.NETLIFY_DATABASE_URL ?? "").length > 0;
if (!configured) {
  console.warn(
    "[voice-cache-privacy] NETLIFY_DATABASE_URL is not set — database tests did not run (use `npm run test:local`).",
  );
}

const providerCalls = vi.hoisted(() => ({ count: 0 }));
const seenLogs = vi.hoisted(() => ({
  error: [] as string[],
  warn: [] as string[],
  info: [] as string[],
}));
const fetchMode = vi.hoisted(() => ({ mode: "ok" as "ok" | "fail-echo" }));

// Budget reservations pass straight through: this suite measures cache
// admission, not quota, and every synthesis here is "admitted".
vi.mock("../server/ai/budget.ts", () => ({
  withReservation: async (
    _input: unknown,
    provider: (reservation: unknown) => Promise<{ result: unknown }>,
  ) => provider({}),
  BudgetDispatchError: class BudgetDispatchError extends Error {
    dispatched: boolean;
    constructor(message: string, dispatched: boolean) {
      super(message);
      this.dispatched = dispatched;
    }
  },
}));

// Capture every log call so the suite can prove sentence text and provider
// bodies never reach the logs on any path (success, cache write, failure).
vi.mock("../server/lib/log.ts", () => ({
  redact: (value: unknown) => value,
  log: {
    error: (_scope: string, _msg: string, extra?: unknown) => {
      seenLogs.error.push(JSON.stringify(extra ?? null));
    },
    warn: (_scope: string, _msg: string, extra?: unknown) => {
      seenLogs.warn.push(JSON.stringify(extra ?? null));
    },
    info: (_scope: string, _msg: string, extra?: unknown) => {
      seenLogs.info.push(JSON.stringify(extra ?? null));
    },
    debug: () => {},
    timed: async <T>(
      _scope: string,
      _label: string,
      fn: () => Promise<T>,
    ): Promise<T> => fn(),
  },
}));

const FAKE_AUDIO = Buffer.from("fake-mp3-bytes-for-voice-cache-privacy-tests");

function alignmentFor(text: string) {
  const characters = text.split("");
  return {
    characters,
    character_start_times_seconds: characters.map((_, i) => i * 0.05),
    character_end_times_seconds: characters.map((_, i) => (i + 1) * 0.05),
  };
}

vi.stubGlobal("fetch", (async (_url: unknown, init?: { body?: unknown }) => {
  providerCalls.count += 1;
  const body = JSON.parse(
    String((init as { body?: unknown } | undefined)?.body ?? "{}"),
  ) as {
    text?: string;
  };
  if (fetchMode.mode === "fail-echo") {
    // A hostile provider error body that echoes the sentence back — the
    // failure log must still carry status/size only, never this text.
    return {
      ok: false as const,
      status: 500,
      text: async () =>
        `upstream exploded while synthesising: ${body.text ?? ""}`,
      json: async () => ({}),
    };
  }
  return {
    ok: true as const,
    status: 200,
    text: async () => "",
    json: async () => ({
      audio_base64: FAKE_AUDIO.toString("base64"),
      alignment: alignmentFor(body.text ?? ""),
    }),
  };
}) as unknown as typeof fetch);

const { migrate, rows, row, run, closePool } =
  await import("../server/db/index.ts");
const {
  speakLine,
  speakableOf,
  splitSentences,
  isStockSentence,
  stockSentences,
  normalizeStockLine,
  cacheKey,
  voiceConfig,
} = await import("../server/voice/tts.ts");
const { STOCK_LINES, STOCK_CACHE_MAX_ROWS } =
  await import("../server/voice/stock-lines.ts");
const { allShippedLines } = await import("../src/lib/lines.ts");

const stamp = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const personalLine = (tag: string) =>
  `Ada, your redness reading is 78 and your private note ${tag} mentions a chin flare-up.`;

interface VoiceRow {
  key: string;
  text: string;
  words_json: string;
  audio: Buffer;
  created_at: string;
}

async function rowCount(): Promise<number> {
  const found = await row<{ n: string }>(
    "SELECT COUNT(*)::text AS n FROM voice_lines",
  );
  return Number(found?.n ?? 0);
}

async function allVoiceRows(): Promise<VoiceRow[]> {
  return rows<VoiceRow>(
    "SELECT key, text, words_json, audio, created_at FROM voice_lines ORDER BY created_at",
  );
}

async function seedLegacyRow(
  key: string,
  text: string,
  createdAt: string,
): Promise<void> {
  await run(
    `INSERT INTO voice_lines (key, voice_id, model_id, text, audio, content_type, words_json, duration, hits, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
    key,
    "legacy-voice",
    "legacy-model",
    text,
    Buffer.from("legacy-audio-bytes"),
    "audio/mpeg",
    JSON.stringify([
      { word: "legacy", charIndex: 0, charLength: 6, start: 0, end: 0.3 },
    ]),
    0.3,
    createdAt,
  );
}

beforeAll(async () => {
  if (!configured) return;
  vi.stubEnv("ELOHIM_VOICE_API_KEY", "test-key");
  vi.stubEnv("ELOHIM_VOICE_ID", "test-voice");
  await migrate();
});

beforeEach(async () => {
  if (!configured) return;
  await run("DELETE FROM voice_lines");
  providerCalls.count = 0;
  fetchMode.mode = "ok";
  seenLogs.error.length = 0;
  seenLogs.warn.length = 0;
  seenLogs.info.length = 0;
});

afterAll(async () => {
  vi.unstubAllGlobals();
  if (configured) await closePool();
});

describe("non-stock synthesis persists nothing", () => {
  it("an account personalised line leaves no text, timings or audio row", async () => {
    if (!configured) return;
    const secret = personalLine(`personal-${stamp()}`);
    const line = await speakLine(secret, {}, "user:aaa");
    expect(line.cached).toBe(false);
    expect(providerCalls.count).toBe(1);
    expect(await rowCount()).toBe(0);

    // Belt and braces across every column that could carry content: no row
    // may hold any fragment of the personal text, its timings or its audio.
    const leaked = await rows<{ key: string }>(
      "SELECT key FROM voice_lines WHERE text LIKE '%Ada%' OR text LIKE '%flare-up%' OR words_json LIKE '%Ada%' OR words_json LIKE '%flare-up%'",
    );
    expect(leaked).toEqual([]);
  });

  it("a forged client stock/cached claim still synthesises fresh and writes nothing", async () => {
    if (!configured) return;
    // The voice routes (`server/routes/api.ts` POST /voice/speak and
    // `server/app.ts` POST /api/public/voice/speak) build the synthesis
    // context by picking only text/previous_text/next_text out of the
    // request body, so a client flag can only ever arrive here as an unknown
    // property — which admission never consults. Prove the sink ignores it.
    const forged = {
      stock: true,
      cached: true,
      allowlist: true,
    } as unknown as Parameters<typeof speakLine>[1];
    const secret = personalLine(`forged-${stamp()}`);
    const line = await speakLine(secret, forged, "user:aaa");
    expect(line.cached).toBe(false);
    expect(providerCalls.count).toBe(1);
    expect(await rowCount()).toBe(0);
  });

  it("normalisation trims, but case and punctuation variants miss", async () => {
    if (!configured) return;
    const stock = stockSentences()[0];
    expect(isStockSentence(stock)).toBe(true);

    // Documented normalisation (speakableOf) collapses whitespace and trims,
    // so padding is the same sentence: it hits and caches exactly once.
    const padded = await speakLine(`  ${stock}  `, {}, "user:aaa");
    expect(padded.cached).toBe(false);
    expect(await rowCount()).toBe(1);
    const paddedAgain = await speakLine(stock, {}, "user:aaa");
    expect(paddedAgain.cached).toBe(true);
    expect(providerCalls.count).toBe(1);

    // Case and punctuation are NOT normalised away: these miss and persist
    // nothing, even with a stock row for the twin already cached.
    for (const variant of [stock.toUpperCase(), `${stock}!`]) {
      expect(isStockSentence(variant)).toBe(false);
      const line = await speakLine(variant, {}, "user:aaa");
      expect(line.cached).toBe(false);
    }
    expect(providerCalls.count).toBe(3);
    expect(await rowCount()).toBe(1);
  });
});

describe("stock lines use the persistent cache", () => {
  it("a stock line is synthesised once, then served from cache", async () => {
    if (!configured) return;
    const stock = "Hey, it's Elohim. This is what I sound like.";
    const first = await speakLine(stock, {}, "user:aaa");
    expect(first.cached).toBe(false);
    expect(providerCalls.count).toBe(1);
    expect(await rowCount()).toBe(1);

    const second = await speakLine(stock, {}, "user:aaa");
    expect(second.cached).toBe(true);
    expect(providerCalls.count).toBe(1);
    expect(await rowCount()).toBe(1);
    expect(second.audio.equals(first.audio)).toBe(true);
  });

  it("stock sentences in a novel combination miss and persist nothing", async () => {
    if (!configured) return;
    // Each shipped line is a single cache unit (short heads/tails merge), so
    // two stock sentences stuck together form a unit the allowlist never
    // derived. Merging is context-sensitive by design: only the exact shipped
    // line hits, and the novel combination fails closed.
    expect(isStockSentence("Mind the coat.")).toBe(true);
    expect(isStockSentence("I felt that.")).toBe(true);
    const combo = "Mind the coat. I felt that.";
    expect(splitSentences(speakableOf(combo))).toHaveLength(1);
    expect(isStockSentence(combo)).toBe(false);

    const line = await speakLine(combo, {}, "user:aaa");
    expect(line.cached).toBe(false);
    expect(providerCalls.count).toBe(1);
    expect(await rowCount()).toBe(0);
  });

  it("an expired stock row is treated as a miss and refreshed", async () => {
    if (!configured) return;
    const sentence = stockSentences()[0];
    // Legacy rows share the (voice, model, sentence) key scheme, so seed the
    // exact key the reader will look up — the expiry path deletes by key.
    const config = voiceConfig();
    if (!config) throw new Error("voice config missing in test env");
    await seedLegacyRow(
      cacheKey(config, sentence),
      sentence,
      "2020-01-01T00:00:00.000Z",
    );

    const line = await speakLine(sentence, {}, "user:aaa");
    expect(line.cached).toBe(false);
    expect(providerCalls.count).toBe(1);

    const found = await allVoiceRows();
    expect(found).toHaveLength(1);
    expect(new Date(found[0].created_at).getTime()).toBeGreaterThan(
      Date.parse("2024-01-01T00:00:00.000Z"),
    );
    expect(
      Buffer.from(found[0].audio as unknown as Uint8Array).equals(FAKE_AUDIO),
    ).toBe(true);
  });

  it("cache writes evict the oldest rows past the bound", async () => {
    if (!configured) return;
    const sentences = stockSentences();
    const now = Date.now();
    for (let i = 0; i < STOCK_CACHE_MAX_ROWS + 5; i++) {
      await seedLegacyRow(
        `evict-${i}`,
        sentences[i % sentences.length],
        new Date(now - (STOCK_CACHE_MAX_ROWS + 5 - i) * 1000).toISOString(),
      );
    }
    expect(await rowCount()).toBe(STOCK_CACHE_MAX_ROWS + 5);

    const fresh = "Mind the coat.";
    expect(isStockSentence(fresh)).toBe(true);
    await speakLine(fresh, {}, "user:aaa");

    expect(await rowCount()).toBe(STOCK_CACHE_MAX_ROWS);
    const oldest = await row<{ key: string }>(
      "SELECT key FROM voice_lines WHERE key = 'evict-0'",
    );
    expect(oldest).toBeUndefined();
  });
});

describe("guest synthesis never writes", () => {
  it("a cold stock line synthesised as a guest leaves no row", async () => {
    if (!configured) return;
    const stock = "Hey, it's Elohim. This is what I sound like.";
    // Exactly the budget identity the public guest route passes.
    const line = await speakLine(stock, {}, "guest:voice");
    expect(line.cached).toBe(false);
    expect(providerCalls.count).toBe(1);
    expect(await rowCount()).toBe(0);
  });

  it("a guest is served a stock hit but still writes nothing", async () => {
    if (!configured) return;
    const stock = "Hey, it's Elohim. This is what I sound like.";
    await speakLine(stock, {}, "user:aaa");
    expect(await rowCount()).toBe(1);
    const afterAccount = providerCalls.count;

    const guest = await speakLine(stock, {}, "guest:voice");
    expect(guest.cached).toBe(true);
    expect(providerCalls.count).toBe(afterAccount);
    expect(await rowCount()).toBe(1);
  });

  it("guest input and explicit guest callers persist nothing", async () => {
    if (!configured) return;
    const secret = personalLine(`guest-${stamp()}`);
    await speakLine(secret, {}, "guest:voice");
    await speakLine(
      "Hey, it's Elohim. This is what I sound like.",
      {},
      "user:bbb",
      { guest: true },
    );
    expect(providerCalls.count).toBe(2);
    expect(await rowCount()).toBe(0);
  });
});

describe("purge script preserves only allowlisted entries", () => {
  const script = fileURLToPath(
    new URL("../scripts/purge-voice-cache.mjs", import.meta.url),
  );

  it("dry-runs by default and deletes exactly the non-allowlisted rows on --apply", async () => {
    if (!configured) return;
    const sentences = stockSentences();
    const now = new Date().toISOString();
    for (let i = 0; i < sentences.length; i++) {
      await seedLegacyRow(`keep-${i}`, sentences[i], now);
    }
    const personal = [
      personalLine(`purge-a-${stamp()}`),
      `Guest confession ${stamp()}: I came here about a personal concern nobody should keep.`,
      personalLine(`purge-b-${stamp()}`),
    ];
    for (let i = 0; i < personal.length; i++) {
      await seedLegacyRow(`drop-personal-${i}`, personal[i], now);
    }
    // Fail-closed variants: padding and case changes are NOT stock.
    await seedLegacyRow("drop-padded", `  ${sentences[0]}  `, now);
    await seedLegacyRow("drop-upper", sentences[0].toUpperCase(), now);
    const total = sentences.length + personal.length + 2;
    expect(await rowCount()).toBe(total);

    // The script opens its own connection; release the pool first so the
    // single-connection test database is never contended.
    await closePool();
    const dry = JSON.parse(
      execFileSync(process.execPath, [script, "--dry-run"], {
        encoding: "utf8",
        timeout: 60_000,
      }),
    ) as {
      dryRun: boolean;
      preserved: number;
      condemned: number;
      deleted: number;
    };
    expect(dry.dryRun).toBe(true);
    expect(dry.deleted).toBe(0);
    expect(dry.preserved).toBe(sentences.length);
    expect(dry.condemned).toBe(personal.length + 2);
    expect(JSON.stringify(dry)).not.toContain("Ada");
    expect(await rowCount()).toBe(total);

    await closePool();
    const applied = JSON.parse(
      execFileSync(process.execPath, [script, "--apply"], {
        encoding: "utf8",
        timeout: 60_000,
      }),
    ) as {
      dryRun: boolean;
      preserved: number;
      condemned: number;
      deleted: number;
    };
    expect(applied.dryRun).toBe(false);
    expect(applied.deleted).toBe(personal.length + 2);
    expect(applied.preserved).toBe(sentences.length);
    const remaining = (
      await rows<{ text: string }>("SELECT text FROM voice_lines")
    ).map((r) => r.text);
    expect([...remaining].sort()).toEqual([...sentences].sort());

    // Idempotent: a second run deletes nothing.
    await closePool();
    const again = JSON.parse(
      execFileSync(process.execPath, [script, "--apply"], {
        encoding: "utf8",
        timeout: 60_000,
      }),
    ) as { deleted: number };
    expect(again.deleted).toBe(0);
    expect(await rowCount()).toBe(sentences.length);
  });
});

describe("provider bodies and sentence text never reach the logs", () => {
  it("failure and success paths log codes and sizes only", async () => {
    if (!configured) return;
    const tag = `logprobe-${stamp()}`;
    fetchMode.mode = "fail-echo";
    await expect(
      speakLine(`Probe line carrying ${tag} symptoms for Ada.`, {}, "user:aaa"),
    ).rejects.toThrow();
    fetchMode.mode = "ok";
    await speakLine(
      `Second probe carrying ${tag} symptoms again for Ada.`,
      {},
      "user:aaa",
    );

    const all = [...seenLogs.error, ...seenLogs.warn, ...seenLogs.info].join(
      "\n",
    );
    expect(seenLogs.error.length).toBeGreaterThan(0);
    expect(seenLogs.info.length).toBeGreaterThan(0);
    expect(all).not.toContain(tag);
    expect(all).not.toContain("Ada");
    expect(all).not.toContain("upstream exploded");
  });
});

describe("allowlist design", () => {
  it("stock-lines.ts lists exactly the shipped scripted lines", () => {
    // No drift between the privacy allowlist and the shipped copy: the same
    // edit must touch both, and this fails otherwise. Compares as sets
    // because allShippedLines() itself dedupes.
    expect([...STOCK_LINES].sort()).toEqual([...allShippedLines()].sort());
    const expected = new Set(
      allShippedLines().flatMap((line) =>
        splitSentences(normalizeStockLine(line)),
      ),
    );
    expect(new Set(stockSentences())).toEqual(expected);
  });

  it("normalisation is the documented server-side cleaning", () => {
    expect(normalizeStockLine("  Hello *world* 👋 ")).toBe("Hello world");
    // The cache unit that admission tests is the post-split sentence.
    expect(isStockSentence("Whenever you're ready.")).toBe(true);
  });
});
