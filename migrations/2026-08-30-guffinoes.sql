-- Guffinoes joins the docket, and the visits table that never landed.
--
-- ✅ ALREADY APPLIED to the live groupie D1 (6cd5c1cc-…) on 2026-08-30 via the
-- Cloudflare connector. Kept here so the schema history is complete and so a
-- rebuilt database can be brought up the same way. Re-running is safe apart
-- from the ALTER, which errors if the column is already there.
--
-- From ~/code/groupie, if you ever do need it:
--   npx wrangler d1 execute groupie --remote --file=migrations/2026-08-30-guffinoes.sql

ALTER TABLE docket ADD COLUMN guffinoes INTEGER NOT NULL DEFAULT 0;

-- The 2026-08-29 migration's ALTER was run by hand; these two never were, so
-- every POST /api/visit from the deployed guff bar failed silently between the
-- 29th and the 30th. Created 2026-08-30.
CREATE TABLE IF NOT EXISTS visits (
  id TEXT NOT NULL,
  date TEXT NOT NULL,
  game TEXT NOT NULL,
  ref TEXT,
  PRIMARY KEY (id, date, game)
);
CREATE INDEX IF NOT EXISTS idx_visits_date ON visits(date);
