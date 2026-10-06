-- Replays for the league (6 Oct 2026, Carl: "how did NPT get 501?").
-- Applied to the live D1 through the Cloudflare connector the same day.
CREATE TABLE IF NOT EXISTS league_replays (
  id   TEXT NOT NULL,
  date TEXT NOT NULL,
  game TEXT NOT NULL,
  data TEXT NOT NULL,
  at   TEXT NOT NULL,
  PRIMARY KEY (id, date, game)
);
