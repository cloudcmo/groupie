-- When each league score was filed (UTC, "YYYY-MM-DD HH:MM:SS"), shown on
-- today's boards as the time of play plus a time-of-day emoji. NULL for
-- every score filed before this column existed.
-- Applied to live D1 on 30 Sept 2026 via the Cloudflare connector.
ALTER TABLE league_scores ADD COLUMN at TEXT;
