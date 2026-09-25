-- Wordminer and Guffitaire are Guff games nine and ten. Two columns on the docket.
--
-- Until this is applied to the LIVE D1, every docket tick and league score
-- from either game is dropped with a 400 for everyone, and the bar shows nothing.
--
-- Apply with the Cloudflare connector, or from the Mac:
--   cd ~/code/groupie
--   npx wrangler d1 execute groupie --remote --command "ALTER TABLE docket ADD COLUMN wordminer INTEGER NOT NULL DEFAULT 0;"
--   npx wrangler d1 execute groupie --remote --command "ALTER TABLE docket ADD COLUMN guffitaire INTEGER NOT NULL DEFAULT 0;"
--
-- Then redeploy groupie, or src/index.js still will not know the games exist:
--   cd ~/code/groupie
--   npx wrangler deploy
ALTER TABLE docket ADD COLUMN wordminer INTEGER NOT NULL DEFAULT 0;
ALTER TABLE docket ADD COLUMN guffitaire INTEGER NOT NULL DEFAULT 0;
