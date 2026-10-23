-- Helmet is Guff game seven. One more column on the docket.
--
-- Until this is applied to the LIVE D1, every docket tick and league score
-- from Helmet is dropped with a 400, and the bar shows nothing.
--   cd ~/code/groupie
--   npx wrangler d1 execute groupie --remote --command "ALTER TABLE docket ADD COLUMN helmet INTEGER NOT NULL DEFAULT 0;"
--   npx wrangler deploy
ALTER TABLE docket ADD COLUMN helmet INTEGER NOT NULL DEFAULT 0;
