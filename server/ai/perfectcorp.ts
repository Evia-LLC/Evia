/** Server-only adapter. No images, signed URLs, or vendor error bodies enter logs/storage. */
import {
  withReservation,
  settleReservation,
  BudgetDispatchError,
} from "./budget.ts";
import { log } from "../lib/log.ts";
import { newId } from "../lib/ids.ts";
import type {
  SkinAppearanceMetrics,
  SkinMetricKey,
} from "../../shared/types.ts";

const ORIGIN = "https://yce-api-01.makeupar.com";
// Requested EVIA adapter version; transport is Perfect Corp's v2.0 SD API.
export const PERFECTCORP_MODEL_VERSION = "perfectcorp-v2.1";
export const PERFECTCORP_MAPPING: Record<SkinMetricKey, string> = {
  hydration: "moisture",
  oiliness: "oiliness",
  redness: "redness",
  texture: "texture",
  pores: "pore",
  darkSpots: "age_spot",
  evenness: "radiance",
  underEye: "dark_circle_v2",
  acneIndicators: "acne",
};
export const PERFECTCORP_NOTE =
  "Perfect Corp SD appearance scores. Tone evenness uses radiance as a proxy; Under-eye uses dark circles only. These scores are not equivalent to local measurements. Evia renders the face mesh locally.";
export class PerfectCorpUnavailable extends Error {
  reason: string;
  constructor(reason: string) {
    super(reason);
    this.reason = reason;
  }
}
export function analysisProvider(): "perfectcorp" | "local" {
  return process.env.ANALYSIS_PROVIDER === "local" ? "local" : "perfectcorp";
}
export function perfectCorpAvailable(): boolean {
  return Boolean(process.env.PERFECTCORP_API_KEY?.trim());
}
// Explicitly isolated sample demo; never mark draft wording approved.
export function sampleDemoEnabled(): boolean {
  return process.env.EVIA_SAMPLE_DEMO === "1";
}

/**
 * P1-T12 — face-scan request budget.
 *
 * Host bounds (established by inspection, never assumed):
 * - Vercel: `maxDuration: 30` on api/index.js → 30 s hard termination.
 * - Netlify: netlify.toml sets no function timeout and
 *   netlify/functions/api.mts exports only a path config → the platform
 *   default applies (10 s synchronous, raisable to 26 s via dashboard/API —
 *   not config-file-settable). The design host below is 26 s (Netlify raised)
 *   / 30 s (Vercel); a stock-10 s Netlify deployment must be raised by the
 *   operator, and until then this path times out honestly to local fallback.
 *
 * Face-scan budget: provider 18 s < client 24 s
 * (FACE_CLIENT_TIMEOUT_MS in src/skin-analysis/provider.ts) < host 26/30 s.
 * Arithmetic: 18 s provider work + ≤3 s vendor-cleanup attempt + budget
 * settle/serialization ≈ 21–22 s < 24 s client (≥2 s slack); the 24 s client
 * leaves 2 s (Netlify raised) to 6 s (Vercel) for response transfer.
 */
export const PERFECTCORP_PROVIDER_TIMEOUT_MS = 18_000;
export const PERFECTCORP_POLL_INTERVAL_MS = 2_000;
/**
 * Poll-count backstop only: 18 polls × 2 s = 36 s > 18 s deadline, so the
 * deadline signal always fires first in production; the cap exists for clock
 * anomalies, not pacing. (It also keeps the pre-existing
 * `test/perfectcorp.test.ts` bound — 18 status polls — intact.)
 */
export const PERFECTCORP_POLL_ATTEMPTS = 18;
/**
 * Vendor-cleanup attempt budget: fits inside provider→client headroom
 * (18 s + 3 s = 21 s < 24 s client). A failed attempt enters the bounded
 * retry queue below instead of a second synchronous wait.
 */
export const PERFECTCORP_CLEANUP_TIMEOUT_MS = 3_000;
/**
 * Bounded vendor-cleanup retry: at most 3 attempts per task, at most 100
 * tracked tasks, then a logged drop (never silent, never unbounded).
 * Retry state lives in module memory (`pendingVendorCleanups`), so it
 * survives request completion but NOT process death — a durable
 * cross-restart queue belongs to the future async-job design, not to this
 * request budget. Counts are logged on every attempt and on the final drop.
 */
export const VENDOR_CLEANUP_MAX_ATTEMPTS = 3;
export const VENDOR_CLEANUP_MAX_TRACKED = 100;
export const VENDOR_CLEANUP_RETRY_DELAYS_MS = [1_000, 5_000, 25_000];

interface VendorCleanupEntry {
  taskId: string;
  headers: Record<string, string>;
  fetchFn: typeof fetch;
  attempts: number;
  delaysMs: number[];
  timer: ReturnType<typeof setTimeout> | null;
}

/** In-process vendor-cleanup retry state. Bounded by VENDOR_CLEANUP_MAX_TRACKED. */
const pendingVendorCleanups = new Map<string, VendorCleanupEntry>();

/** How many vendor cleanups are awaiting retry. Operations/test hook. */
export function vendorCleanupPending(): number {
  return pendingVendorCleanups.size;
}

/** Drop all tracked cleanups and clear their timers. Test/ops hook. */
export function resetVendorCleanupQueue(): void {
  for (const entry of pendingVendorCleanups.values()) {
    if (entry.timer) clearTimeout(entry.timer);
  }
  pendingVendorCleanups.clear();
}

/** Short task handle for logs: an opaque vendor id, never image bytes or keys. */
function taskHandle(taskId: string): string {
  return taskId.slice(0, 8);
}

/**
 * One vendor-side cleanup attempt with its own short budget — never the
 * request's (possibly already aborted) signal, which would fail instantly on
 * the timeout path that needs cleanup most.
 */
async function attemptVendorCleanup(
  taskId: string,
  headers: Record<string, string>,
  fetchFn: typeof fetch,
  timeoutMs: number,
): Promise<boolean> {
  try {
    const response = await fetchFn(`${ORIGIN}/s2s/v2.0/task/delete`, {
      method: "POST",
      headers,
      body: JSON.stringify({ task_id: taskId }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    // Drain the body so the connection can be reused; the status is the signal.
    await response.text().catch(() => "");
    return response.ok;
  } catch {
    return false;
  }
}

function scheduleVendorCleanupRetry(entry: VendorCleanupEntry): void {
  const delay =
    entry.delaysMs[Math.min(entry.attempts - 1, entry.delaysMs.length - 1)] ??
    0;
  entry.timer = setTimeout(() => {
    entry.timer = null;
    void runVendorCleanupRetry(entry.taskId);
  }, delay);
  // A pending vendor cleanup must never hold the process open on its own.
  (entry.timer as unknown as { unref?: () => void }).unref?.();
}

async function runVendorCleanupRetry(taskId: string): Promise<void> {
  const entry = pendingVendorCleanups.get(taskId);
  if (!entry) return;
  entry.attempts += 1;
  const ok = await attemptVendorCleanup(
    entry.taskId,
    entry.headers,
    entry.fetchFn,
    PERFECTCORP_CLEANUP_TIMEOUT_MS,
  );
  if (ok) {
    pendingVendorCleanups.delete(taskId);
    log.info("perfectcorp", "vendor cleanup retry succeeded", {
      task: taskHandle(taskId),
      attempts: entry.attempts,
    });
    return;
  }
  if (entry.attempts >= VENDOR_CLEANUP_MAX_ATTEMPTS) {
    pendingVendorCleanups.delete(taskId);
    // Bounded drop, never silent: the task id prefix plus attempt count is
    // the reconciliation handle for the future async-job design.
    log.error("perfectcorp", "vendor cleanup retry exhausted", {
      task: taskHandle(taskId),
      attempts: entry.attempts,
    });
    return;
  }
  log.warn("perfectcorp", "vendor cleanup retry failed, will retry", {
    task: taskHandle(taskId),
    attempts: entry.attempts,
  });
  scheduleVendorCleanupRetry(entry);
}

/**
 * Track a vendor task whose synchronous cleanup failed. Exactly-once
 * tracking per task id; bounded size with a logged oldest-first eviction.
 */
export function enqueueVendorCleanup(
  taskId: string,
  headers: Record<string, string>,
  fetchFn: typeof fetch,
  delaysMs: number[] = VENDOR_CLEANUP_RETRY_DELAYS_MS,
): void {
  if (pendingVendorCleanups.has(taskId)) return;
  if (pendingVendorCleanups.size >= VENDOR_CLEANUP_MAX_TRACKED) {
    const oldest = pendingVendorCleanups.keys().next();
    if (!oldest.done) {
      const evicted = pendingVendorCleanups.get(oldest.value);
      if (evicted?.timer) clearTimeout(evicted.timer);
      pendingVendorCleanups.delete(oldest.value);
      // Eviction is a bounded drop, so it is logged with counts, never silent.
      log.error("perfectcorp", "vendor cleanup queue full, evicted oldest", {
        task: taskHandle(oldest.value),
        tracked: pendingVendorCleanups.size,
      });
    }
  }
  // The failed synchronous attempt counts as attempt 1; retries continue it.
  const entry: VendorCleanupEntry = {
    taskId,
    headers,
    fetchFn,
    attempts: 1,
    delaysMs,
    timer: null,
  };
  pendingVendorCleanups.set(taskId, entry);
  log.warn("perfectcorp", "vendor cleanup queued for retry", {
    task: taskHandle(taskId),
    attempts: entry.attempts,
  });
  scheduleVendorCleanupRetry(entry);
}

/** Whitelist only the nine requested scores; discard age, geometry, masks and composite. */
export function mapPerfectCorpOutput(output: unknown): SkinAppearanceMetrics {
  if (!Array.isArray(output))
    throw new PerfectCorpUnavailable("invalid_result");
  const result = {} as SkinAppearanceMetrics;
  for (const [key, concern] of Object.entries(PERFECTCORP_MAPPING) as [
    SkinMetricKey,
    string,
  ][]) {
    const entries = output.filter((item) => item && item.type === concern);
    const score = entries.length === 1 ? entries[0].ui_score : undefined;
    if (
      typeof score !== "number" ||
      !Number.isFinite(score) ||
      score < 0 ||
      score > 100
    ) {
      throw new PerfectCorpUnavailable("incomplete_result");
    }
    // ui_score is the vendor-calibrated display value. raw_score is retained
    // only by provider analytics; do not invent polarity by inverting it.
    result[key] = Math.round(score * 10) / 10;
  }
  return result;
}

/**
 * No automatic task retries: one task submission can consume trial units, so
 * a hung or failed poll never submits a second task. At most one billable
 * vendor task is created per call; a timed-out dispatch settles its budget
 * reservation exactly once (see catch below) and attempts vendor cleanup.
 */
export async function analyseWithPerfectCorp(
  image: Uint8Array,
  options: {
    userId: string;
    fetch?: typeof fetch;
    pollMs?: number;
    timeoutMs?: number;
    signal?: AbortSignal;
    /** Injectable backoff schedule for the cleanup retry queue (tests). */
    retryDelaysMs?: number[];
  },
): Promise<SkinAppearanceMetrics> {
  const key = process.env.PERFECTCORP_API_KEY?.trim();
  if (!key) throw new PerfectCorpUnavailable("not_configured");
  const request = options.fetch ?? fetch;
  const timeout = AbortSignal.timeout(
    options.timeoutMs ?? PERFECTCORP_PROVIDER_TIMEOUT_MS,
  );
  const signal = options.signal
    ? AbortSignal.any([timeout, options.signal])
    : timeout;
  const headers = {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  };
  async function api(path: string, body?: unknown) {
    const response = await request(`${ORIGIN}/s2s/v2.0/${path}`, {
      method: body ? "POST" : "GET",
      headers,
      signal,
      redirect: "error",
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!response.ok)
      throw new PerfectCorpUnavailable(
        response.status === 402 || response.status === 429
          ? "credits_or_rate_limit"
          : "provider_error",
      );
    const json = await response.json();
    if (!json?.data || (json.status !== undefined && json.status !== 200))
      throw new PerfectCorpUnavailable("provider_error");
    return json.data;
  }
  let submitted = false;
  let taskId: string | null = null;
  const operationId = `perfectcorp:${newId()}`;
  const { result } = await withReservation(
    {
      operationId,
      userId: options.userId,
      provider: "perfectcorp",
      unit: "vision-tasks",
      estimatedUnits: 1,
    },
    async () => {
      try {
        const data = await api("file", {
          files: [
            {
              content_type: "image/jpeg",
              file_name: "sample-scan.jpg",
              file_size: image.byteLength,
            },
          ],
        });
        const file = data.files?.[0];
        const upload = file?.requests?.[0];
        if (
          typeof file?.file_id !== "string" ||
          upload?.method !== "PUT" ||
          typeof upload.url !== "string"
        ) {
          throw new PerfectCorpUnavailable("invalid_upload");
        }
        const url = new URL(upload.url);
        // Only vendor S3 upload destinations, never arbitrary URLs or redirects.
        if (
          url.protocol !== "https:" ||
          url.username ||
          url.password ||
          url.port ||
          !/^yce-[a-z0-9-]+\.s3(?:[.-][a-z0-9-]+)*\.amazonaws\.com$/.test(
            url.hostname,
          )
        ) {
          throw new PerfectCorpUnavailable("invalid_upload");
        }
        const uploadHeaders = Object.fromEntries(
          Object.entries(upload.headers ?? {}).filter(([name]) =>
            /^(content-type|content-length)$/i.test(name),
          ),
        );
        const uploaded = await request(url, {
          method: "PUT",
          headers: {
            "Content-Type": "image/jpeg",
            ...uploadHeaders,
            "Content-Length": String(image.byteLength),
          },
          body: new Uint8Array(image),
          signal,
          redirect: "error",
        });
        if (!uploaded.ok) throw new PerfectCorpUnavailable("upload_failed");
        submitted = true;
        const task = await api("task/skin-analysis", {
          src_file_id: file.file_id,
          dst_actions: Object.values(PERFECTCORP_MAPPING),
          format: "json",
        });
        if (typeof task.task_id !== "string")
          throw new PerfectCorpUnavailable("invalid_task");
        taskId = task.task_id;
        const createdTaskId: string = task.task_id;
        for (let attempt = 0; attempt < PERFECTCORP_POLL_ATTEMPTS; attempt++) {
          if (attempt === 0) {
            // The first status request is cheap and avoids adding two seconds
            // to every fast provider response.
          } else {
            await new Promise<void>((resolve, reject) => {
              const abort = () => {
                clearTimeout(timer);
                reject(new PerfectCorpUnavailable("timeout"));
              };
              const timer = setTimeout(() => {
                signal.removeEventListener("abort", abort);
                resolve();
              }, options.pollMs ?? PERFECTCORP_POLL_INTERVAL_MS);
              signal.addEventListener("abort", abort, { once: true });
              if (signal.aborted) abort();
            });
          }
          const status = await api(
            `task/skin-analysis/${encodeURIComponent(createdTaskId)}`,
          );
          if (status.task_status === "success") {
            const mapped = mapPerfectCorpOutput(status.results?.output);
            const cleaned = await attemptVendorCleanup(
              createdTaskId,
              headers,
              request,
              PERFECTCORP_CLEANUP_TIMEOUT_MS,
            );
            if (!cleaned)
              enqueueVendorCleanup(
                createdTaskId,
                headers,
                request,
                options.retryDelaysMs,
              );
            return { result: mapped, actual: { units: 1 } };
          }
          if (status.task_status === "error")
            throw new PerfectCorpUnavailable("analysis_failed");
          if (!["running", "pending", "queued"].includes(status.task_status))
            throw new PerfectCorpUnavailable("invalid_task");
        }
        throw new PerfectCorpUnavailable("timeout");
      } catch (error) {
        if (taskId && signal.aborted) {
          // Deadline exceeded or client disconnected AFTER the vendor accepted
          // a billable task: attempt vendor-side cleanup on its own short
          // budget, then settle the reservation as consumed EXACTLY ONCE —
          // the call was billed, so failing it would wrongly re-admit spend.
          // withReservation rethrows below without settling again, so this is
          // the single terminal move for the timed-out dispatch.
          const cleaned = await attemptVendorCleanup(
            taskId,
            headers,
            request,
            PERFECTCORP_CLEANUP_TIMEOUT_MS,
          );
          if (!cleaned)
            enqueueVendorCleanup(
              taskId,
              headers,
              request,
              options.retryDelaysMs,
            );
          await settleReservation(operationId, { units: 1 }).catch(
            (settleErr: Error) =>
              log.error("perfectcorp", "timed-out dispatch could not settle", {
                error: settleErr.message,
              }),
          );
        } else if (taskId) {
          // Poll-count backstop hit without a deadline abort. Unreachable in
          // production (cap × interval > deadline by construction), so the
          // timer substrate itself is suspect — log loudly and skip cleanup,
          // which depends on that same substrate for its retry schedule.
          // withReservation leaves the reservation pending for reconciliation,
          // exactly as P1-T07 prescribes for ambiguous dispatches.
          log.error("perfectcorp", "poll backstop exhausted without abort", {
            task: taskHandle(taskId),
          });
        }
        if (!submitted) {
          const reason =
            error instanceof PerfectCorpUnavailable
              ? error.reason
              : "network_error";
          throw new BudgetDispatchError(reason, false);
        }
        if (error instanceof PerfectCorpUnavailable) throw error;
        throw new PerfectCorpUnavailable(
          signal.aborted ? "timeout" : "network_error",
        );
      }
    },
  );
  return result;
}
