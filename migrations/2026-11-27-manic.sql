-- Manic Guffer joins the daily games (27 Nov 2026). One more column on the docket.
-- (Words and Guff Daily became a classic game the same day; its column stays.)
--
-- Run on the LIVE D1 BEFORE deploying this Worker (the Worker copes if you forget, but
-- Manic Guffer would not tick off in the guff bar or hub until the column exists).
--   cd ~/code/groupie
--   npx wrangler d1 execute groupie --remote --file=migrations/2026-11-27-manic.sql
ALTER TABLE docket ADD COLUMN manic INTEGER NOT NULL DEFAULT 0;
