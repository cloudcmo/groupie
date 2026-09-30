-- 30 Sept 2026: time as the league tie-break for Groupie, Pub Quiz Daily,
-- Whenly and What Word. Milliseconds from first sight of the day's puzzle to
-- the finish. NULL = no time (every score before today, and any game that does
-- not send one). Equal scores: timed beats untimed, then faster beats slower.
-- Applied to live D1 on 30 Sept 2026 via the Cloudflare connector.
ALTER TABLE league_scores ADD COLUMN ms INTEGER;
