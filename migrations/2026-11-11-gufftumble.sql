-- Guff Tumble joins the daily games (11 Nov 2026). One more column on the docket.
--
-- Must be on the LIVE D1 before this Worker is deployed: the docket SELECTs name the
-- column, so without it every game's ticks would fail.
--   cd ~/code/groupie
--   npx wrangler d1 execute groupie --remote --command "ALTER TABLE docket ADD COLUMN gufftumble INTEGER NOT NULL DEFAULT 0;"
ALTER TABLE docket ADD COLUMN gufftumble INTEGER NOT NULL DEFAULT 0;
