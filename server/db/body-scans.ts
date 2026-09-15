/**
 * Stored body readings.
 *
 * Deliberately a parallel module to `scans.ts` rather than a branch inside it.
 * The two measure different things against different model versions, and the
 * one rule that must never be broken is that a body reading and a skin reading
 * are never compared — so they do not share a table, a repository, or a query.
 *
 * The cost of the duplication is a few dozen lines. The cost of the alternative
 * is a longitudinal engine that will one day chart a shoulder ratio against a
 * hydration score and present the result as progress.
 */
import { row, rows, run } from './index.ts';
import { newId, nowIso } from '../lib/ids.ts';
import type { BodyAnalysisRecord } from '../../shared/types.ts';

interface BodyScanRow {
  id: string;
  user_id: string;
  captured_at: string;
  image_ref: string | null;
  profile_image_ref: string | null;
  metrics_json: string;
  waist_source: string;
  profile_json: string | null;
  profile_detail_json: string | null;
  landmarks_json: string;
  confidence: number;
  model_version: string;
  profile_model_version: string | null;
}

function hydrate(row: BodyScanRow): BodyAnalysisRecord {
  return {
    id: row.id,
    capturedAt: row.captured_at,
    metrics: JSON.parse(row.metrics_json),
    waistSource: row.waist_source === 'silhouette' ? 'silhouette' : 'joints',
    // Absent, not zeroed: a front-only scan measured no abdomen, and a null is
    // the only honest way to say so.
    profile: row.profile_json ? JSON.parse(row.profile_json) : null,
    profileDetail: row.profile_detail_json ? JSON.parse(row.profile_detail_json) : null,
    landmarks: JSON.parse(row.landmarks_json),
    confidence: row.confidence,
    modelVersion: row.model_version,
    profileModelVersion: row.profile_model_version,
    hasImage: row.image_ref !== null,
    hasProfileImage: row.profile_image_ref !== null,
  };
}

export async function insertBodyScan(
  userId: string,
  analysis: BodyAnalysisRecord,
  refs: { imageRef?: string; profileImageRef?: string } = {},
): Promise<BodyAnalysisRecord> {
  const id = newId();
  await run(
    `INSERT INTO body_scans (id, user_id, captured_at, image_ref, profile_image_ref,
                             metrics_json, waist_source, profile_json, profile_detail_json,
                             landmarks_json, confidence, model_version, profile_model_version)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    userId,
    analysis.capturedAt || nowIso(),
    refs.imageRef ?? null,
    refs.profileImageRef ?? null,
    JSON.stringify(analysis.metrics),
    analysis.waistSource,
    analysis.profile ? JSON.stringify(analysis.profile) : null,
    analysis.profileDetail ? JSON.stringify(analysis.profileDetail) : null,
    JSON.stringify(analysis.landmarks ?? []),
    // See scans.ts: NOT NULL column, and `pg` maps undefined to NULL.
    analysis.confidence ?? 0,
    analysis.modelVersion,
    analysis.profileModelVersion ?? null,
  );
  return {
    ...analysis,
    id,
    hasImage: refs.imageRef !== undefined,
    hasProfileImage: refs.profileImageRef !== undefined,
  };
}

/** Newest first. */
export async function listBodyScans(userId: string, limit = 50): Promise<BodyAnalysisRecord[]> {
  return (await rows<BodyScanRow>(
    'SELECT * FROM body_scans WHERE user_id = ? ORDER BY captured_at DESC LIMIT ?',
    userId,
    limit,
  )).map(hydrate);
}

export async function latestBodyScan(userId: string): Promise<BodyAnalysisRecord | null> {
  return (await listBodyScans(userId, 1))[0] ?? null;
}

/**
 * The most recent scan that can be compared with this one.
 *
 * Not simply "the previous row". A waist traced from an outline and a waist
 * estimated from joints are different measurements, and a profile reading only
 * exists when a side view was taken — so the caller gets the newest earlier
 * scan and the findings layer decides, per metric, what may be compared.
 */
export async function previousBodyScan(userId: string): Promise<BodyAnalysisRecord | null> {
  return (await listBodyScans(userId, 2))[1] ?? null;
}

/** Every blob ref this user owns here — account deletion shreds them. */
export async function allBodyBlobRefs(userId: string): Promise<string[]> {
  const all = await rows<{ image_ref: string | null; profile_image_ref: string | null }>(
    'SELECT image_ref, profile_image_ref FROM body_scans WHERE user_id = ?',
    userId,
  );
  const refs: string[] = [];
  for (const r of all) {
    if (r.image_ref) refs.push(r.image_ref);
    if (r.profile_image_ref) refs.push(r.profile_image_ref);
  }
  return refs;
}

/**
 * Removes one reading and hands back the blobs it owned, for shredding.
 *
 * Returns the refs rather than deleting them itself so the caller owns the
 * order: the row goes first, and if blob storage then refuses, the record is
 * already gone. A picture with no row is an orphan; a row with no picture is
 * merely a scan whose image was dropped, and the reader is told which.
 */
export async function deleteBodyScan(userId: string, scanId: string): Promise<string[]> {
  const found = await row<{ image_ref: string | null; profile_image_ref: string | null }>(
    'SELECT image_ref, profile_image_ref FROM body_scans WHERE id = ? AND user_id = ?',
    scanId,
    userId,
  );
  if (!found) return [];
  await run('DELETE FROM body_scans WHERE id = ? AND user_id = ?', scanId, userId);
  return [found.image_ref, found.profile_image_ref].filter((r): r is string => Boolean(r));
}
