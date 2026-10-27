-- Cheers on league scores (27 Oct 2026). Carl approved adding these to the groupie database.
-- The Worker also creates them itself on first use (ensureCheers in src/cheers.js), so no
-- manual step is needed. Adds four tables; nothing else in the database is touched.
-- Losing them would lose only cheers, the "seen" marks and the ban list.
CREATE TABLE IF NOT EXISTS league_cheers (
  game     TEXT NOT NULL,      -- league game key, e.g. "pqd"
  date     TEXT NOT NULL,      -- the score's UK date
  to_ini   TEXT NOT NULL,      -- whose score (initials, as the league shows it)
  from_ini TEXT NOT NULL,      -- who cheered (initials), or GUFFBOT for his automatic salute
  from_id  TEXT,               -- the cheerer's browser id at the time (for Carl's admin page)
  emoji    TEXT NOT NULL,      -- one emoji, or "guffbot" for GuffBot's head
  at       TEXT NOT NULL,      -- ISO time of the first cheer (a re-cheer keeps it, so it isn't news twice)
  off      INTEGER NOT NULL DEFAULT 0,  -- 1 when taken back (kept so toggling can't spam)
  PRIMARY KEY (game, date, to_ini, from_ini, emoji)
);
CREATE INDEX IF NOT EXISTS idx_cheers_date ON league_cheers(date, game);
CREATE INDEX IF NOT EXISTS idx_cheers_to   ON league_cheers(to_ini, at);
CREATE INDEX IF NOT EXISTS idx_cheers_from ON league_cheers(from_ini, at);
-- When each player last saw "you've been cheered" (so the news shows once).
CREATE TABLE IF NOT EXISTS league_cheer_seen (initials TEXT PRIMARY KEY, at TEXT NOT NULL);
-- Initials Carl has stopped from cheering. Their cheers are hidden everywhere.
CREATE TABLE IF NOT EXISTS league_banned (initials TEXT PRIMARY KEY, at TEXT NOT NULL, note TEXT);
-- Browser ids that cheered under banned initials (banned with them, so new initials don't get round it).
CREATE TABLE IF NOT EXISTS league_banned_ids (id TEXT PRIMARY KEY, initials TEXT, at TEXT NOT NULL);
