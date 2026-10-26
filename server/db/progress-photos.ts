import { database, result, allPages } from '../lib/data-api.ts';
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
  const id = newId();
  const createdAt = nowIso();
  const stored = await result<{ photo: PhotoRow; created: boolean }>(database().rpc('evia_create_progress_photo', {
    p_row: { id, user_id: userId, skin_scan_id: input.skinScanId, blob_ref: input.blobRef,
      created_at: createdAt, captured_at: input.capturedAt, consent_event_id: input.consentEventId,
      presentation_json: input.presentation ? JSON.stringify(input.presentation) : null },
  }));
  return { photo: hydrate(stored.photo), created: stored.created };
}

export async function listProgressPhotos(userId: string): Promise<ProgressPhoto[]> {
  return (await allPages<PhotoRow>((from, to) => database().from('progress_photos').select('id,skin_scan_id,created_at,captured_at,consent_event_id,presentation_json').eq('user_id', userId).order('captured_at', { ascending: false }).order('id').range(from, to))).map(hydrate);
}

export async function getProgressPhotoRef(userId: string, id: string): Promise<string | null> {
  return (await result<{ blob_ref: string } | null>(database().from('progress_photos').select('blob_ref').eq('id', id).eq('user_id', userId).maybeSingle()))?.blob_ref ?? null;
}

export async function getProgressPhotoForScan(userId: string, scanId: string): Promise<ProgressPhoto | null> {
  const found = await result<PhotoRow | null>(database().from('progress_photos').select('id,skin_scan_id,created_at,captured_at,consent_event_id,presentation_json').eq('user_id', userId).eq('skin_scan_id', scanId).maybeSingle());
  return found ? hydrate(found) : null;
}

export async function allProgressPhotoRefs(userId: string): Promise<string[]> {
  return (await allPages<{ blob_ref: string }>((from, to) => database().from('progress_photos').select('blob_ref').eq('user_id', userId).order('id').range(from, to))).map((r) => r.blob_ref);
}

export async function deleteProgressPhoto(userId: string, id: string): Promise<string | null> {
  return result<string | null>(database().rpc('evia_delete_progress_photo', { p_user_id: userId, p_id: id }));
}
