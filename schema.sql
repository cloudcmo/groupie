-- Groupie puzzle store

CREATE TABLE IF NOT EXISTS days (
  date TEXT PRIMARY KEY,          -- YYYY-MM-DD
  payload TEXT NOT NULL,          -- JSON: { groups: [{name, difficulty, words[4]}, x4], trap }
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- One row per puzzle date: how many finished it, how it went.
-- Written by POST /api/played (fired once per player, from the front end).
CREATE TABLE IF NOT EXISTS plays (
  date TEXT PRIMARY KEY,          -- the puzzle's date (archive plays count against their grid)
  total INTEGER NOT NULL DEFAULT 0,
  wins INTEGER NOT NULL DEFAULT 0,
  mistakes_sum INTEGER NOT NULL DEFAULT 0,
  score_sum INTEGER NOT NULL DEFAULT 0    -- solve-order scores (0–24 each), for the daily average
);

-- The cross-game docket: which of the games an anonymous browser id
-- has played on a given day. Powers the "More daily guff" bar on all the
-- sites. Rows older than a fortnight are pruned by the daily cron.
CREATE TABLE IF NOT EXISTS docket (
  id TEXT NOT NULL,               -- anonymous random id from the player's browser
  date TEXT NOT NULL,             -- YYYY-MM-DD (UK day)
  pqd INTEGER NOT NULL DEFAULT 0,
  whenly INTEGER NOT NULL DEFAULT 0,
  whatword INTEGER NOT NULL DEFAULT 0,
  groupie INTEGER NOT NULL DEFAULT 0,
  twentee INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (id, date)
);

-- Every group name ever published, so no category is served twice.
CREATE TABLE IF NOT EXISTS categories (
  name TEXT PRIMARY KEY,          -- lowercased group name
  date TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_categories_date ON categories(date);

-- The Guff games league. Three initials, entered once, attached to the
-- same anonymous cross-site id the docket uses. Scores are stored even
-- before initials exist; the league join hides them until the player
-- signs the cabinet. (Both tables already created in the live D1.)
CREATE TABLE IF NOT EXISTS players (
  id TEXT PRIMARY KEY,            -- guff-bar anonymous id
  initials TEXT NOT NULL,         -- AAA
  created TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS league_scores (
  id TEXT NOT NULL,
  date TEXT NOT NULL,             -- YYYY-MM-DD (UK day)
  game TEXT NOT NULL,             -- pqd | whenly | whatword | groupie | twentee
  score INTEGER NOT NULL,         -- higher is better, game-native scale
  max INTEGER NOT NULL DEFAULT 0,
  display TEXT NOT NULL DEFAULT '',  -- "9/10", "in 7" — as the game says it
  PRIMARY KEY (id, date, game)
);

CREATE INDEX IF NOT EXISTS idx_league_date ON league_scores(date, game, score);
