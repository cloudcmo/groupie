-- Whenly Football joins the daily games (15 Nov 2026). One more column on the docket,
-- then today's and yesterday's ticks backfilled from the league (its scores were already there).
--
-- Run on the LIVE D1 BEFORE deploying this Worker (the Worker copes if you forget, but
-- Whenly Football would not tick off in the guff bar or hub until the column exists).
--   cd ~/code/groupie
--   npx wrangler d1 execute groupie --remote --file=migrations/2026-11-15-whenlyfootball.sql
ALTER TABLE docket ADD COLUMN whenlyfootball INTEGER NOT NULL DEFAULT 0;
INSERT INTO docket (id, date, whenlyfootball)
  SELECT id, date, 1 FROM league_scores WHERE game = 'whenlyfootball' AND date >= date('now', '-1 day')
  ON CONFLICT(id, date) DO UPDATE SET whenlyfootball = 1;
