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
  score_sum INTEGER NOT NULL DEFAULT 0    -- solve-order scores (0–9 each), for the daily average
);

-- The cross-game docket: which of the four games an anonymous browser id
-- has played on a given day. Powers the "More daily guff" bar on all four
-- sites. Rows older than a fortnight are pruned by the daily cron.
CREATE TABLE IF NOT EXISTS docket (
  id TEXT NOT NULL,               -- anonymous random id from the player's browser
  date TEXT NOT NULL,             -- YYYY-MM-DD (UK day)
  pqd INTEGER NOT NULL DEFAULT 0,
  whenly INTEGER NOT NULL DEFAULT 0,
  whatword INTEGER NOT NULL DEFAULT 0,
  groupie INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (id, date)
);

-- Every group name ever published, so no category is served twice.
CREATE TABLE IF NOT EXISTS categories (
  name TEXT PRIMARY KEY,          -- lowercased group name
  date TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_categories_date ON categories(date);
