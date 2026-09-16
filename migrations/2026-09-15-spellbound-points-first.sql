-- Spellbound's league composite changes from words-first to POINTS-first
-- (Carl, 15 Sept). This migrates the 80 existing rows onto the new scale so the
-- all-time table is not a mix of two.
--
-- ⚠️ RUN THIS *AFTER* DEPLOYING SPELLBOUND, NOT BEFORE.
-- Until the new app.js is live, players still submit the old composite. If the
-- table were migrated first, every score submitted in the meantime would be on
-- the old (much smaller) scale and would rank below everything historic.
--
--   old = words*100 + round(points/100)
--   new = round(points/10)*10 + clamp(words - 6, 0, 9)
--
-- Points are only recoverable from the old rows to the nearest 100, which is
-- exactly the precision the new formula's tens place needs, so the conversion
-- is faithful rather than approximate:
--   1429 (14 words, ~2,900 pts) -> 2908
--   1517 (15 words, ~1,700 pts) -> 1709
-- and the second no longer outranks the first, which was the whole point.
--
-- `max` goes to 0 because a game ranked on points has no perfect score. Left at
-- 1000 these migrated rows would every one of them clear it and be counted as
-- perfects on the league share card.
--
-- ⚠️ NOT IDEMPOTENT. Running it twice would treat new-scale scores as old ones.
-- The guard below only touches rows that are still on the old scale; verify
-- with the SELECT in the project doc before and after.
--
-- Apply from the Mac:
--   cd ~/code/groupie
--   npx wrangler d1 execute groupie --remote --file=migrations/2026-09-15-spellbound-points-first.sql
UPDATE league_scores
SET score = (score % 100) * 100 + MAX(0, MIN(9, score / 100 - 6)),
    max = 0
WHERE game = 'spellbound' AND max = 1000;
