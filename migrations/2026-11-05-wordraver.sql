-- Word Raver (was Guff3000) is Guff game twelve. One more column on the docket.
--
-- Must be on the LIVE D1 before this Worker is deployed: the docket SELECTs name the
-- column, so without it every game's ticks would fail. Applied live on 5 Nov 2026.
--   cd ~/code/groupie
--   npx wrangler d1 execute groupie --remote --command "ALTER TABLE docket ADD COLUMN wordraver INTEGER NOT NULL DEFAULT 0;"
ALTER TABLE docket ADD COLUMN wordraver INTEGER NOT NULL DEFAULT 0;
