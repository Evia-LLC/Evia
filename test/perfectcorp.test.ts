import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fixture from './fixtures/perfectcorp-sd.json';
import { analyseWithPerfectCorp, mapPerfectCorpOutput, analysisProvider } from '../server/ai/perfectcorp.ts';
import { selectAnalysis } from '../src/skin-analysis/provider.ts';
import { SKIN_METRIC_KEYS, type SkinAnalysis } from '../shared/types.ts';
import { summarise } from '../server/skin/longitudinal.ts';

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
const file = { status: 200, data: { files: [{ file_id: 'file-id', requests: [{ method: 'PUT', url: 'https://yce-us.s3-accelerate.amazonaws.com/demo/upload?signature=test' }] }] } };
const jpeg = new Uint8Array([255, 216, 255, 217]);
const local: SkinAnalysis = { capturedAt: '2026-09-24T10:00:00Z', modelVersion: 'elohim-skin-1.0.0', confidence: .8,
  quality: { verdict: 'pass', score: .9, brightness: .5, sharpness: .8, centeringError: 0, faceHeightFraction: .6, issues: [] },
  regions: {}, metrics: Object.fromEntries(SKIN_METRIC_KEYS.map(k => [k, 50])) as SkinAnalysis['metrics'] };

beforeEach(() => vi.stubEnv('PERFECTCORP_API_KEY', 'server-test-key'));
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('Perfect Corp server adapter', () => {
  it('uploads bytes, submits one SD task, polls and maps ui scores without masks or age', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(json(file)).mockResolvedValueOnce(new Response(''))
      .mockResolvedValueOnce(json({ status: 200, data: { task_id: 'task-id' } }))
      .mockResolvedValueOnce(json({ status: 200, data: { task_status: 'running' } })).mockResolvedValueOnce(json(fixture));
    const result = await analyseWithPerfectCorp(jpeg, { fetch, pollMs: 0 });
    expect(result).toEqual({ hydration: 78, oiliness: 85, redness: 90, texture: 80, pores: 85, darkSpots: 95, evenness: 78, underEye: 72, acneIndicators: 92 });
    expect(fetch.mock.calls[0][0]).toMatch(/\/file$/);
    expect(fetch.mock.calls[1][1].headers).not.toHaveProperty('Authorization');
    expect(fetch.mock.calls[1][1].body).toEqual(jpeg);
    const task = JSON.parse(fetch.mock.calls[2][1].body);
    expect(task.src_file_id).toBe('file-id'); expect(task.format).toBe('json');
    expect(task.dst_actions).toHaveLength(9); expect(task.dst_actions).not.toContain('skin_age');
    expect(fetch.mock.calls[4][0]).toMatch(/task\/skin-analysis\/task-id$/);
    expect(fetch.mock.calls[5][0]).toMatch(/task\/delete$/);
  });
  it('defaults to Perfect Corp and supports local selection without requiring a key', async () => {
    vi.stubEnv('ANALYSIS_PROVIDER', ''); expect(analysisProvider()).toBe('perfectcorp');
    vi.stubEnv('ANALYSIS_PROVIDER', 'local'); expect(analysisProvider()).toBe('local');
    vi.stubEnv('PERFECTCORP_API_KEY', ''); const fetch = vi.fn();
    await expect(analyseWithPerfectCorp(jpeg, { fetch })).rejects.toThrow('not_configured');
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each([402, 429])('does not retry paid work on HTTP %s', async status => {
    const fetch = vi.fn().mockResolvedValue(json({}, status));
    await expect(analyseWithPerfectCorp(jpeg, { fetch })).rejects.toThrow('credits_or_rate_limit');
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('sanitises network errors instead of leaking vendor response or credentials', async () => {
    const fetch = vi.fn().mockRejectedValue(new Error('secret vendor body'));
    await expect(analyseWithPerfectCorp(jpeg, { fetch })).rejects.toThrow('network_error');
  });
  it('rejects unsafe upload URLs before sending any image', async () => {
    const bad = structuredClone(file); bad.data.files[0].requests[0].url = 'http://127.0.0.1/private';
    const fetch = vi.fn().mockResolvedValue(json(bad));
    await expect(analyseWithPerfectCorp(jpeg, { fetch })).rejects.toThrow('invalid_upload');
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('bounds polling and handles terminal task failure', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(json(file)).mockResolvedValueOnce(new Response(''))
      .mockResolvedValueOnce(json({ data: { task_id: 'task' } })).mockImplementation(async () => json({ data: { task_status: 'running' } }));
    await expect(analyseWithPerfectCorp(jpeg, { fetch, pollMs: 0 })).rejects.toThrow('timeout');
    expect(fetch).toHaveBeenCalledTimes(21);
    fetch.mockReset().mockResolvedValueOnce(json(file)).mockResolvedValueOnce(new Response(''))
      .mockResolvedValueOnce(json({ data: { task_id: 'task' } })).mockResolvedValue(json({ data: { task_status: 'error' } }));
    await expect(analyseWithPerfectCorp(jpeg, { fetch, pollMs: 0 })).rejects.toThrow('analysis_failed');
  });
  it('rejects missing, duplicate and out-of-range scores rather than fabricating metrics', () => {
    expect(() => mapPerfectCorpOutput([])).toThrow();
    const output = structuredClone(fixture.data.results.output); output[0].ui_score = 101;
    expect(() => mapPerfectCorpOutput(output)).toThrow();
    expect(() => mapPerfectCorpOutput([...fixture.data.results.output, fixture.data.results.output[0]])).toThrow();
  });
});

describe('provider selection and history', () => {
  it('keeps local selection entirely local and displays missing-key backup', async () => {
    const fetch = vi.fn().mockResolvedValue(json({ provider: 'local', available: false })); vi.stubGlobal('fetch', fetch);
    expect((await selectAnalysis(local, 'sample', true)).notice).toBe('Local analysis selected');
    expect(fetch).toHaveBeenCalledTimes(1);
    fetch.mockResolvedValue(json({ provider: 'perfectcorp', available: false }));
    expect((await selectAnalysis(local, 'sample', true)).notice).toContain('using backup analysis');
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('never uploads a guest capture', async () => {
    const fetch = vi.fn().mockResolvedValue(json({ provider: 'perfectcorp', available: true })); vi.stubGlobal('fetch', fetch);
    expect((await selectAnalysis(local, 'sample', false)).analysis).toBe(local); expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('does not turn a consent rejection into a saved local result', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(json({ provider: 'perfectcorp', available: true })).mockResolvedValueOnce(json({}, 403)));
    await expect(selectAnalysis(local, 'sample', true)).rejects.toThrow('consent');
  });
  it('shows backup after a provider outage', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(json({ provider: 'perfectcorp', available: true })).mockRejectedValueOnce(new Error('offline')));
    const result = await selectAnalysis(local, 'sample', true);
    expect(result.analysis).toBe(local); expect(result.notice).toContain('using backup analysis');
  });
  it('replaces all nine metrics together and excludes local/provider cross-version deltas', async () => {
    const metrics = mapPerfectCorpOutput(fixture.data.results.output);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(json({ provider: 'perfectcorp', available: true }))
      .mockResolvedValueOnce(json({ provider: 'perfectcorp', modelVersion: 'perfectcorp-v2.1', metrics, notes: 'proxy disclosure' })));
    const { analysis } = await selectAnalysis(local, 'sample', true);
    expect(analysis.metrics).toEqual(metrics); expect(analysis.modelVersion).toBe('perfectcorp-v2.1');
    const summary = summarise([local, { ...analysis, capturedAt: '2026-09-24T11:00:00Z' }]);
    expect(summary.mixedModelVersions).toBe(true);
    expect(summary.trends.every(t => t.previous === null && t.deltaFromPrevious === null)).toBe(true);
  });
});
