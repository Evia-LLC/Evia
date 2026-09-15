-- The face mesh at the moment of capture, per scan.
--
-- 478 landmarks as (x, y) pairs normalised to the stored crop. Small (a few
-- kilobytes) and what makes two scans comparable on the same face: with the
-- mesh, a later capture can be warped onto an earlier one and shown as a wipe,
-- rather than two photos taken at slightly different distances side by side.
ALTER TABLE skin_scans ADD COLUMN landmarks_json TEXT;
