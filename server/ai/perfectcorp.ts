/** Server-only adapter. No images, signed URLs, or vendor error bodies enter logs/storage. */
import type { SkinAppearanceMetrics, SkinMetricKey } from '../../shared/types.ts';

const ORIGIN = 'https://yce-api-01.makeupar.com';
// Requested EVIA adapter version; transport is Perfect Corp's v2.0 SD API.
export const PERFECTCORP_MODEL_VERSION = 'perfectcorp-v2.1';
export const PERFECTCORP_MAPPING: Record<SkinMetricKey, string> = {
  hydration: 'moisture', oiliness: 'oiliness', redness: 'redness', texture: 'texture',
  pores: 'pore', darkSpots: 'age_spot', evenness: 'radiance',
  underEye: 'dark_circle_v2', acneIndicators: 'acne',
};
export const PERFECTCORP_NOTE = 'Perfect Corp SD appearance scores. Tone evenness uses radiance as a proxy; Under-eye uses dark circles only. These scores are not equivalent to local measurements. Evia renders the face mesh locally.';
export class PerfectCorpUnavailable extends Error {
  reason: string;
  constructor(reason: string) { super(reason); this.reason = reason; }
}
export function analysisProvider(): 'perfectcorp' | 'local' {
  return process.env.ANALYSIS_PROVIDER === 'local' ? 'local' : 'perfectcorp';
}
export function perfectCorpAvailable(): boolean { return Boolean(process.env.PERFECTCORP_API_KEY?.trim()); }
// Explicitly isolated sample demo; never mark draft wording approved.
export function sampleDemoEnabled(): boolean { return process.env.EVIA_SAMPLE_DEMO === '1'; }

/** Whitelist only the nine requested scores; discard age, geometry, masks and composite. */
export function mapPerfectCorpOutput(output: unknown): SkinAppearanceMetrics {
  if (!Array.isArray(output)) throw new PerfectCorpUnavailable('invalid_result');
  const result = {} as SkinAppearanceMetrics;
  for (const [key, concern] of Object.entries(PERFECTCORP_MAPPING) as [SkinMetricKey, string][]) {
    const entries = output.filter((item) => item && item.type === concern);
    const score = entries.length === 1 ? entries[0].ui_score : undefined;
    if (typeof score !== 'number' || !Number.isFinite(score) || score < 0 || score > 100) {
      throw new PerfectCorpUnavailable('incomplete_result');
    }
    // ui_score is the vendor-calibrated display value. raw_score is retained
    // only by provider analytics; do not invent polarity by inverting it.
    result[key] = Math.round(score * 10) / 10;
  }
  return result;
}

/** No automatic task retries: one task submission can consume trial units. */
export async function analyseWithPerfectCorp(
  image: Uint8Array,
  options: { fetch?: typeof fetch; pollMs?: number; timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<SkinAppearanceMetrics> {
  const key = process.env.PERFECTCORP_API_KEY?.trim();
  if (!key) throw new PerfectCorpUnavailable('not_configured');
  const request = options.fetch ?? fetch;
  const timeout = AbortSignal.timeout(options.timeoutMs ?? 180_000);
  const signal = options.signal ? AbortSignal.any([timeout, options.signal]) : timeout;
  const headers = { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
  async function api(path: string, body?: unknown) {
    const response = await request(`${ORIGIN}/s2s/v2.0/${path}`, {
      method: body ? 'POST' : 'GET', headers, signal, redirect: 'error',
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!response.ok) throw new PerfectCorpUnavailable(
      response.status === 402 || response.status === 429 ? 'credits_or_rate_limit' : 'provider_error',
    );
    const json = await response.json();
    if (!json?.data || (json.status !== undefined && json.status !== 200)) throw new PerfectCorpUnavailable('provider_error');
    return json.data;
  }
  try {
    const data = await api('file', {
      files: [{ content_type: 'image/jpeg', file_name: 'sample-scan.jpg', file_size: image.byteLength }],
    });
    const file = data.files?.[0];
    const upload = file?.requests?.[0];
    if (typeof file?.file_id !== 'string' || upload?.method !== 'PUT' || typeof upload.url !== 'string') {
      throw new PerfectCorpUnavailable('invalid_upload');
    }
    const url = new URL(upload.url);
    // Only vendor S3 upload destinations, never arbitrary URLs or redirects.
    if (url.protocol !== 'https:' || url.username || url.password || url.port ||
        !/^yce-[a-z0-9-]+\.s3(?:[.-][a-z0-9-]+)*\.amazonaws\.com$/.test(url.hostname)) {
      throw new PerfectCorpUnavailable('invalid_upload');
    }
    const uploadHeaders = Object.fromEntries(
      Object.entries(upload.headers ?? {}).filter(([name]) => /^(content-type|content-length)$/i.test(name)),
    );
    const uploaded = await request(url, {
      method: 'PUT', headers: {
        'Content-Type': 'image/jpeg',
        ...uploadHeaders,
        'Content-Length': String(image.byteLength),
      },
      body: new Uint8Array(image), signal, redirect: 'error',
    });
    if (!uploaded.ok) throw new PerfectCorpUnavailable('upload_failed');
    const task = await api('task/skin-analysis', {
      src_file_id: file.file_id, dst_actions: Object.values(PERFECTCORP_MAPPING), format: 'json',
    });
    if (typeof task.task_id !== 'string') throw new PerfectCorpUnavailable('invalid_task');
    for (let attempt = 0; attempt < 18; attempt++) {
      if (attempt === 0) {
        // The first status request is cheap and avoids adding ten seconds to
        // every fast provider response.
      } else {
      await new Promise<void>((resolve, reject) => {
        const abort = () => { clearTimeout(timer); reject(new PerfectCorpUnavailable('timeout')); };
        const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, options.pollMs ?? 10_000);
        signal.addEventListener('abort', abort, { once: true });
        if (signal.aborted) abort();
      });
      }
      const status = await api(`task/skin-analysis/${encodeURIComponent(task.task_id)}`);
      if (status.task_status === 'success') {
        const mapped = mapPerfectCorpOutput(status.results?.output);
        try {
          await request(`${ORIGIN}/s2s/v2.0/task/delete`, {
            method: 'POST', headers, body: JSON.stringify({ task_id: task.task_id }), signal,
          });
        } catch {
          // Result delivery must not fail because best-effort retention cleanup did.
        }
        return mapped;
      }
      if (status.task_status === 'error') throw new PerfectCorpUnavailable('analysis_failed');
      if (!['running', 'pending', 'queued'].includes(status.task_status)) throw new PerfectCorpUnavailable('invalid_task');
    }
    throw new PerfectCorpUnavailable('timeout');
  } catch (error) {
    if (error instanceof PerfectCorpUnavailable) throw error;
    throw new PerfectCorpUnavailable(signal.aborted ? 'timeout' : 'network_error');
  }
}
