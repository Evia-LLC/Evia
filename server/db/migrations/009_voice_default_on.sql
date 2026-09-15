-- Her voice is on unless someone turns it off.
--
-- It defaulted to off when the only voice was the browser's synthesiser, and
-- a robot reading a script is worse than text. With a licensed human voice
-- behind the same toggle the default flips: the product is a person who
-- talks, and the first thing a new account hears should be her.
ALTER TABLE preferences ALTER COLUMN voice_enabled SET DEFAULT 1;
UPDATE preferences SET voice_enabled = 1;
