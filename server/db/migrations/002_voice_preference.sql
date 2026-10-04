-- Which synthesised voice the user picked for Evia. Null means "let her choose",
-- which resolves to the best available feminine voice for the locale.
ALTER TABLE preferences ADD COLUMN voice_uri TEXT;
