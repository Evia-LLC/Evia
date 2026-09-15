-- Model spend, per user per day.
--
-- Cloud reasoning is billed per token, and an app with a public entry screen
-- and no ledger is an open tab. One row per (day, user) is enough to answer
-- the two questions the budget asks: how many turns has this person had today,
-- and how much has everyone had today.
CREATE TABLE usage_ledger (
  day           TEXT NOT NULL,
  user_id       TEXT NOT NULL,
  turns         INTEGER NOT NULL DEFAULT 0,
  input_tokens  BIGINT NOT NULL DEFAULT 0,
  output_tokens BIGINT NOT NULL DEFAULT 0,
  updated_at    TEXT NOT NULL,
  PRIMARY KEY (day, user_id)
);
CREATE INDEX idx_usage_day ON usage_ledger(day);
