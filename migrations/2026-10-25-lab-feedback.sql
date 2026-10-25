-- Guff Lab feedback: thumbs up/down and optional comments from sneak-preview games (25 Oct 2026).
-- First game: This Way Up. The Worker also creates this itself on first use (ensureLabTable),
-- so no manual step is needed. Adds one table; nothing else in the database is touched.
CREATE TABLE IF NOT EXISTS lab_feedback (
  game    TEXT NOT NULL,      -- e.g. "thiswayup"
  id      TEXT NOT NULL,      -- the player's random browser id for that game
  date    TEXT NOT NULL,      -- UK date of the flight
  vote    INTEGER NOT NULL,   -- 1 thumbs up, -1 thumbs down
  comment TEXT,               -- optional free text, up to 1000 characters
  ctx     TEXT,               -- JSON from the game: score, outcome, first ever flight, tortoise, device
  at      TEXT NOT NULL,      -- ISO time of the latest vote or comment
  PRIMARY KEY (game, id, date)
);
