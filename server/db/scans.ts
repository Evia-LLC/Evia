import { row, rows, run } from './index.ts';
import { newId, nowIso } from '../lib/ids.ts';
import type { SkinAnalysis } from '../../shared/types.ts';

interface ScanRow {
  id: string;
  user_id: string;
  captured_at: string;
  image_ref: string | null;
  thumb_ref: string | null;
  metrics_json: string;
  regions_json: string;
  capture_quality_json: string;
  observations_json: string;
  confidence: number;
  model_version: string;
  notes: string | null;
}

function hydrate(row: ScanRow): SkinAnalysis {
  return {
    id: row.id,
    capturedAt: row.captured_at,
    metrics: JSON.parse(row.metrics_json),
    regions: JSON.parse(row.regions_json),
    quality: JSON.parse(row.capture_quality_json),
    observations: JSON.parse(row.observations_json),
    confidence: row.confidence,
    modelVersion: row.model_version,
    hasImage: row.image_ref !== null,
    notes: row.notes ?? undefined,
  };
}

export async function insertScan(
  userId: string,
  analysis: SkinAnalysis,
  refs: { imageRef?: string; thumbRef?: string } = {},
): Promise<SkinAnalysis> {
  const id = newId();
  await run(
    `INSERT INTO skin_scans (id, user_id, captured_at, image_ref, thumb_ref, metrics_json,
                             regions_json, capture_quality_json, observations_json,
                             confidence, model_version, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    userId,
    analysis.capturedAt || nowIso(),
    refs.imageRef ?? null,
    refs.thumbRef ?? null,
    JSON.stringify(analysis.metrics),
    JSON.stringify(analysis.regions ?? {}),
    JSON.stringify(analysis.quality ?? {}),
    JSON.stringify(analysis.observations ?? []),
    // Coalesced because the column is NOT NULL and `pg` sends `undefined` as
    // NULL. The column default cannot save us — it is named in the INSERT, so
    // a missing field is a constraint violation rather than a zero.
    analysis.confidence ?? 0,
    analysis.modelVersion,
    analysis.notes ?? null,
  );
  return { ...analysis, id };
}

/** Newest first. */
export async function listScans(userId: string, limit = 50): Promise<SkinAnalysis[]> {
  return (await rows<ScanRow>(
    'SELECT * FROM skin_scans WHERE user_id = ? ORDER BY captured_at DESC LIMIT ?',
    userId,
    limit,
  )).map(hydrate);
}

/** Oldest first — the shape the longitudinal engine wants. */
export async function scanHistory(userId: string, limit = 100): Promise<SkinAnalysis[]> {
  return (await listScans(userId, limit)).reverse();
}

export async function latestScan(userId: string): Promise<SkinAnalysis | null> {
  return (await listScans(userId, 1))[0] ?? null;
}

export async function getScan(userId: string, scanId: string): Promise<SkinAnalysis | null> {
  const found = await row<ScanRow>(
    'SELECT * FROM skin_scans WHERE id = ? AND user_id = ?',
    scanId,
    userId,
  );
  return found ? hydrate(found) : null;
}

export async function getScanImageRef(userId: string, scanId: string): Promise<string | null> {
  const found = await row<{ image_ref: string | null }>(
    'SELECT image_ref FROM skin_scans WHERE id = ? AND user_id = ?',
    scanId,
    userId,
  );
  return found?.image_ref ?? null;
}

/** Every blob ref this user owns — used by account deletion to shred them. */
export async function allBlobRefs(userId: string): Promise<string[]> {
  const all = await rows<{ image_ref: string | null; thumb_ref: string | null }>(
    'SELECT image_ref, thumb_ref FROM skin_scans WHERE user_id = ?',
    userId,
  );
  const refs: string[] = [];
  for (const r of all) {
    if (r.image_ref) refs.push(r.image_ref);
    if (r.thumb_ref) refs.push(r.thumb_ref);
  }
  return refs;
}

export async function deleteScan(userId: string, scanId: string): Promise<string[]> {
  const found = await row<{ image_ref: string | null; thumb_ref: string | null }>(
    'SELECT image_ref, thumb_ref FROM skin_scans WHERE id = ? AND user_id = ?',
    scanId,
    userId,
  );
  if (!found) return [];
  await run('DELETE FROM skin_scans WHERE id = ? AND user_id = ?', scanId, userId);
  return [found.image_ref, found.thumb_ref].filter((r): r is string => Boolean(r));
}
