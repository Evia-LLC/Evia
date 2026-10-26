import { database, result, allPages } from '../lib/data-api.ts';
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
    notes: row.notes ?? undefined,
  };
}

export async function insertScan(
  userId: string,
  analysis: SkinAnalysis,
  _refs: { imageRef?: string; thumbRef?: string } = {},
): Promise<SkinAnalysis> {
  const id = newId();
  await result(database().rpc('evia_insert_skin_scan', { p_row: {
    id, user_id: userId, captured_at: analysis.capturedAt || nowIso(), image_ref: null, thumb_ref: null,
    metrics_json: JSON.stringify(analysis.metrics), regions_json: JSON.stringify(analysis.regions ?? {}),
    capture_quality_json: JSON.stringify(analysis.quality ?? {}), observations_json: JSON.stringify(analysis.observations ?? []),
    confidence: analysis.confidence ?? 0, model_version: analysis.modelVersion, notes: analysis.notes ?? null,
  } }));
  return { ...analysis, id };
}

/** Newest first. */
export async function listScans(userId: string, limit = 50): Promise<SkinAnalysis[]> {
  return (await result<ScanRow[]>(database().from('skin_scans').select('id,user_id,captured_at,image_ref,thumb_ref,metrics_json,regions_json,capture_quality_json,observations_json,confidence,model_version,notes').eq('user_id', userId).order('captured_at', { ascending: false }).limit(limit))).map(hydrate);
}

/** Oldest first — the shape the longitudinal engine wants. */
export async function scanHistory(userId: string, limit = 100): Promise<SkinAnalysis[]> {
  return (await listScans(userId, limit)).reverse();
}

/** Complete export list. Deliberately separate from UI pagination. */
export async function exportScans(userId: string): Promise<SkinAnalysis[]> {
  return (await allPages<ScanRow>((from, to) => database().from('skin_scans').select('id,user_id,captured_at,image_ref,thumb_ref,metrics_json,regions_json,capture_quality_json,observations_json,confidence,model_version,notes').eq('user_id', userId).order('captured_at').order('id').range(from, to))).map(hydrate);
}

export async function latestScan(userId: string): Promise<SkinAnalysis | null> {
  return (await listScans(userId, 1))[0] ?? null;
}

export async function getScan(userId: string, scanId: string): Promise<SkinAnalysis | null> {
  const found = await result<ScanRow | null>(database().from('skin_scans').select('id,user_id,captured_at,image_ref,thumb_ref,metrics_json,regions_json,capture_quality_json,observations_json,confidence,model_version,notes').eq('id', scanId).eq('user_id', userId).maybeSingle());
  return found ? hydrate(found) : null;
}

export async function getScanImageRef(userId: string, scanId: string): Promise<string | null> {
  const found = await result<{ image_ref: string | null } | null>(database().from('skin_scans').select('image_ref').eq('id', scanId).eq('user_id', userId).maybeSingle());
  return found?.image_ref ?? null;
}

/** Every blob ref this user owns — used by account deletion to shred them. */
export async function allBlobRefs(userId: string): Promise<string[]> {
  const all = await allPages<{ image_ref: string | null; thumb_ref: string | null }>((from, to) => database().from('skin_scans').select('image_ref,thumb_ref').eq('user_id', userId).order('id').range(from, to));
  const refs: string[] = [];
  for (const r of all) {
    if (r.image_ref) refs.push(r.image_ref);
    if (r.thumb_ref) refs.push(r.thumb_ref);
  }
  return refs;
}

export async function deleteScan(userId: string, scanId: string): Promise<string[]> {
  return result<string[]>(database().rpc('evia_delete_skin_scan', { p_user_id: userId, p_id: scanId }));
}
