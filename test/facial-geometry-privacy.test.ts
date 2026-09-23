import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { api } from '../src/lib/api.ts';
import { session } from '../src/state/session.svelte.ts';
import type { SkinAnalysis } from '../shared/types.ts';

const root = join(import.meta.dirname, '..');
const source = (path: string) => readFileSync(join(root, path), 'utf8');

const analysis: SkinAnalysis = {
  capturedAt: '2026-09-23T12:00:00.000Z',
  metrics: {
    hydration: 50, oiliness: 50, redness: 50, texture: 50,
    darkSpots: 50, pores: 50, eyeArea: 50, firmness: 50, uniformity: 50,
  },
  regions: {},
  quality: { verdict: 'good', issues: [] },
  confidence: 0.9,
  modelVersion: 'test',
};

afterEach(() => vi.restoreAllMocks());

describe('facial geometry privacy boundary', () => {
  it('sends a scan request without face landmarks', async () => {
    let sent: unknown;
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      sent = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ scan: analysis, summary: {} }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }));

    await api.saveScan(analysis);
    expect(sent).toEqual({ analysis });
    expect(JSON.stringify(sent)).not.toContain('landmarks');
  });

  it('rejects unexpected facial geometry and never hydrates it into API responses', () => {
    const route = source('server/routes/api.ts');
    const repository = source('server/db/scans.ts');
    expect(route).toContain("hasOwnProperty.call(analysis, 'landmarks')");
    expect(route).toContain("error: 'Facial landmarks are not accepted.'");
    expect(repository).not.toContain('landmarks_json');
    expect(repository).not.toMatch(/\blandmarks\b/);
  });

  it('drops the facial landmark column in the migration', async () => {
    const db = new PGlite();
    await db.exec('CREATE TABLE skin_scans (id TEXT PRIMARY KEY, landmarks_json TEXT)');
    await db.exec("INSERT INTO skin_scans VALUES ('scan-1', '[0.1,0.2]')");
    await db.exec(source('server/db/migrations/011_drop_face_landmarks.sql'));
    const result = await db.query<{ column_name: string }>(
      "SELECT column_name FROM information_schema.columns WHERE table_name = 'skin_scans'",
    );
    expect(result.rows.map((row) => row.column_name)).toEqual(['id']);
    await db.close();
  }, 30_000);

  it('clears the in-memory mesh on reset', () => {
    session.lastMesh = {
      points: new Float32Array([0, 0, 0]), count: 1, aspect: 1,
      tessellation: new Uint16Array(), contours: [], oval: new Uint16Array(),
    };
    session.reset();
    expect(session.lastMesh).toBeNull();
  });

  it('covers cancellation, route departure, completion, failure and logout cleanup', () => {
    const controller = source('src/state/controller.ts');
    expect(controller.match(/session\.clearScanArtifacts\(\)/g)).toHaveLength(5);
    expect(controller).not.toContain('meshInCrop');
    expect(controller).not.toContain('analysis.landmarks');
    expect(source('src/history/CompareFaces.svelte')).not.toContain('.landmarks');
    expect(() => source('src/history/align.ts')).toThrow();
  });
});
