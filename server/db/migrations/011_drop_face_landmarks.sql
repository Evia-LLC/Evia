-- Facial geometry is presentation-only and must not survive an active scan.
-- Clear staged-deployment data before removing the persistence surface.
UPDATE skin_scans SET landmarks_json = NULL WHERE landmarks_json IS NOT NULL;
ALTER TABLE skin_scans DROP COLUMN landmarks_json;
