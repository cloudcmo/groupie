-- Run once against the live groupie D1, from ~/code/groupie:
--   npx wrangler d1 execute groupie --remote --file=migrations/2026-08-29-spellbound-and-visits.sql
-- (If the spellbound column already exists the first statement errors; drop it and re-run.)
ALTER TABLE docket ADD COLUMN spellbound INTEGER NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS visits (
  id TEXT NOT NULL,
  date TEXT NOT NULL,
  game TEXT NOT NULL,
  ref TEXT,
  PRIMARY KEY (id, date, game)
);
CREATE INDEX IF NOT EXISTS idx_visits_date ON visits(date);
