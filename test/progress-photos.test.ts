/** Privacy invariants for the progress-photo boundary. */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';

const api = fs.readFileSync(new URL('../server/routes/api.ts', import.meta.url), 'utf8');
const scans = fs.readFileSync(new URL('../server/db/scans.ts', import.meta.url), 'utf8');
const photos = fs.readFileSync(new URL('../server/db/progress-photos.ts', import.meta.url), 'utf8');
const migration = fs.readFileSync(new URL('../server/db/migrations/014_progress_photos.sql', import.meta.url), 'utf8');
const controller = fs.readFileSync(new URL('../src/state/controller.ts', import.meta.url), 'utf8');

const scanSubmit = api.slice(api.indexOf("apiRouter.post('/scans',"), api.indexOf('function sanitiseLandmarks'));
const photoSave = api.slice(api.indexOf("apiRouter.post('/scans/:id/progress-photo'"), api.indexOf('function sanitisePresentation'));

describe('progress-photo privacy boundary', () => {
  it('stores structured analysis without writing a scan image ref', () => {
    expect(scans).toContain('    null,\n    null,');
    expect(scans).not.toContain('refs.imageRef ?? null');
  });

  it('does not use feature consent as an automatic save trigger', () => {
    expect(scanSubmit).not.toContain("consents.progress_photos");
    expect(scanSubmit).not.toContain('putBlob(');
    expect(controller).toContain('saveProgressPhoto(pending.scanId, pending.imageBase64)');
  });

  it('requires an active consent event at the explicit save boundary', () => {
    expect(photoSave).toContain('consentsRepo.currentConsent(req.userId!, CONSENT_KEYS.PROGRESS_PHOTOS)');
    expect(photoSave).toContain("consent?.state !== 'granted'");
    expect(photoSave).toContain("status !== 'approved'");
    expect(photoSave).toContain("res.status(403)");
    expect(photoSave).toContain('consentEventId: consent.decisionId');
  });

  it('makes a retry idempotent per account and scan', () => {
    expect(migration).toContain('UNIQUE (user_id, skin_scan_id)');
    expect(photos).toContain('ON CONFLICT (user_id, skin_scan_id) DO NOTHING');
  });

  it('keeps raw bytes out of scan and blob records unless explicitly saved', () => {
    expect(scanSubmit).toContain('imageStored: false');
    expect(scanSubmit).not.toContain('putBlob(');
    expect(photoSave).toContain('putBlob(');
  });

  it('shreds a selected progress photo on deletion and account deletion', () => {
    expect(api).toContain("apiRouter.delete('/progress-photos/:id'");
    const deleteService = fs.readFileSync(new URL('../server/privacy/delete-account.ts', import.meta.url), 'utf8');
    expect(deleteService).toContain('progressPhotos.allProgressPhotoRefs');
    expect(api).toContain('await shredBlob(ref)');
  });

  it('scopes reads and deletes to the authenticated owner', () => {
    expect(photos).toContain('WHERE id = ? AND user_id = ?');
    expect(photos).toContain("DELETE FROM progress_photos WHERE id = ? AND user_id = ?");
  });

  it('does not define biometric columns on progress photos', () => {
    const table = migration.slice(migration.indexOf('CREATE TABLE progress_photos'), migration.indexOf('CREATE INDEX idx_progress'));
    expect(table).not.toMatch(/landmark|geometry|embedding/i);
  });
});
