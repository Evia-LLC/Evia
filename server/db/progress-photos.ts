import { row, rows, run } from './index.ts';
import { newId, nowIso } from '../lib/ids.ts';
import type { ProgressPhoto } from '../../shared/types.ts';

interface PhotoRow {
  id: string;
  skin_scan_id: string | null;
  created_at: string;
  captured_at: string;
  consent_event_id: string;
  presentation_json: string | null;
}

const hydrate = (r: PhotoRow): ProgressPhoto => ({
  id: r.id,
  skinScanId: r.skin_scan_id,
  createdAt: r.created_at,
  capturedAt: r.captured_at,
  consentEventId: r.consent_event_id,
  presentation: r.presentation_json ? JSON.parse(r.presentation_json) : undefined,
});

export async function createProgressPhoto(
  userId: string,
  input: { skinScanId: string; blobRef: string; capturedAt: string; consentEventId: string; presentation?: Record<string, string> },
): Promise<{ photo: ProgressPhoto; created: boolean }> {
  const existing = await row<PhotoRow>(
    'SELECT * FROM progress_photos WHERE user_id = ? AND skin_scan_id = ?', userId, input.skinScanId,
  );
  if (existing) return { photo: hydrate(existing), created: false };
  const id = newId();
  const createdAt = nowIso();
  const inserted = await run(
    `INSERT INTO progress_photos
       (id, user_id, skin_scan_id, blob_ref, created_at, captured_at, consent_event_id, presentation_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (user_id, skin_scan_id) DO NOTHING`,
    id, userId, input.skinScanId, input.blobRef, createdAt, input.capturedAt,
    input.consentEventId, input.presentation ? JSON.stringify(input.presentation) : null,
  );
  if (!inserted) {
    const winner = await row<PhotoRow>(
      'SELECT * FROM progress_photos WHERE user_id = ? AND skin_scan_id = ?', userId, input.skinScanId,
    );
    if (!winner) throw new Error('progress photo idempotency conflict could not be resolved');
    return { photo: hydrate(winner), created: false };
  }
  return { photo: hydrate({ id, skin_scan_id: input.skinScanId, created_at: createdAt,
    captured_at: input.capturedAt, consent_event_id: input.consentEventId,
    presentation_json: input.presentation ? JSON.stringify(input.presentation) : null }), created: true };
}

export async function listProgressPhotos(userId: string): Promise<ProgressPhoto[]> {
  return (await rows<PhotoRow>(
    'SELECT id, skin_scan_id, created_at, captured_at, consent_event_id, presentation_json FROM progress_photos WHERE user_id = ? ORDER BY captured_at DESC',
    userId,
  )).map(hydrate);
}

export async function getProgressPhotoRef(userId: string, id: string): Promise<string | null> {
  return (await row<{ blob_ref: string }>(
    'SELECT blob_ref FROM progress_photos WHERE id = ? AND user_id = ?', id, userId,
  ))?.blob_ref ?? null;
}

export async function getProgressPhotoForScan(userId: string, scanId: string): Promise<ProgressPhoto | null> {
  const found = await row<PhotoRow>(
    'SELECT * FROM progress_photos WHERE user_id = ? AND skin_scan_id = ?', userId, scanId,
  );
  return found ? hydrate(found) : null;
}

export async function allProgressPhotoRefs(userId: string): Promise<string[]> {
  return (await rows<{ blob_ref: string }>(
    'SELECT blob_ref FROM progress_photos WHERE user_id = ?', userId,
  )).map((r) => r.blob_ref);
}

export async function deleteProgressPhoto(userId: string, id: string): Promise<string | null> {
  const ref = await getProgressPhotoRef(userId, id);
  if (!ref) return null;
  await run('DELETE FROM progress_photos WHERE id = ? AND user_id = ?', id, userId);
  return ref;
}
