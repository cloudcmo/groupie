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
  spellbound INTEGER NOT NULL DEFAULT 0,
  guffinoes INTEGER NOT NULL DEFAULT 0,
  hexadec INTEGER NOT NULL DEFAULT 0,
  wagdaily INTEGER NOT NULL DEFAULT 0,   -- Words and Guff Daily, added 20 Sept 2026 (live: ALTER TABLE docket ADD COLUMN)
  wordminer INTEGER NOT NULL DEFAULT 0,  -- Wordminer, added 25 Sept 2026 (live: ALTER TABLE docket ADD COLUMN)
  guffitaire INTEGER NOT NULL DEFAULT 0, -- Guffitaire, added 25 Sept 2026 (live: ALTER TABLE docket ADD COLUMN)
  helmet INTEGER NOT NULL DEFAULT 0,     -- Helmet, added 16 Oct 2026 (live: ALTER TABLE docket ADD COLUMN)
  PRIMARY KEY (id, date)
);

-- Arrivals: one row per anonymous id per game per day, with the ?ref= the
-- page was opened with (the Friday email tags its links ref=friday). Written
-- by POST /api/visit from guff-bar.js on every page load; read back as
-- aggregates by GET /api/sources for the daily report. Pruned after 60 days.
CREATE TABLE IF NOT EXISTS visits (
  id TEXT NOT NULL,
  date TEXT NOT NULL,             -- YYYY-MM-DD (UK day)
  game TEXT NOT NULL,             -- pqd | whenly | whatword | groupie | twentee | spellbound | guffinoes
  ref TEXT,                       -- e.g. 'friday'; NULL when they just turned up
  PRIMARY KEY (id, date, game)
);
CREATE INDEX IF NOT EXISTS idx_visits_date ON visits(date);

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
  game TEXT NOT NULL,             -- pqd | whenly | whatword | groupie | twentee | spellbound | guffinoes
  score INTEGER NOT NULL,         -- higher is better, game-native scale
  max INTEGER NOT NULL DEFAULT 0,
  display TEXT NOT NULL DEFAULT '',  -- "9/10", "in 7" — as the game says it
  ms INTEGER,                     -- time taken in ms (tie-break; NULL = untimed), since 30 Sept 2026
  PRIMARY KEY (id, date, game)
);

CREATE INDEX IF NOT EXISTS idx_league_date ON league_scores(date, game, score);

-- One PIN per set of initials for every Guff game (6 Oct 2026; see migrations/2026-10-06-cabinet-pins.sql).
CREATE TABLE IF NOT EXISTS cabinet (
  initials TEXT PRIMARY KEY,      -- AAA
  pin_hash TEXT NOT NULL,         -- sha256(salt:initials:pin)
  salt     TEXT NOT NULL,
  created  TEXT NOT NULL,
  updated  TEXT NOT NULL
);
-- Wrong PIN attempts, so four digits can't be guessed: five an hour per initials.
CREATE TABLE IF NOT EXISTS pin_tries (
  initials TEXT NOT NULL,
  at       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pin_tries ON pin_tries(initials, at);

-- Replays (6 Oct 2026; see migrations/2026-10-06-league-replays.sql): the move
-- log a game sends with its league score, so the all-time greats can be watched
-- back. One per score row, kept only when the score itself is stored (first
-- score of the day counts). `data` is the game's own JSON, at most 32 KB.
CREATE TABLE IF NOT EXISTS league_replays (
  id   TEXT NOT NULL,
  date TEXT NOT NULL,
  game TEXT NOT NULL,
  data TEXT NOT NULL,
  at   TEXT NOT NULL,
  PRIMARY KEY (id, date, game)
);

-- Each player's chosen games and order (12 Oct 2026). See migrations/2026-10-12-guff-prefs.sql.
CREATE TABLE IF NOT EXISTS guff_prefs (
  k     TEXT PRIMARY KEY,
  prefs TEXT NOT NULL,
  at    TEXT NOT NULL
);

-- Claude-written candidate grids waiting to be filed by the morning cron
-- (added 23 Oct 2026, replacing the Anthropic API generator).
CREATE TABLE IF NOT EXISTS pending (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,             -- YYYY-MM-DD the candidate is for
  candidate TEXT NOT NULL,        -- JSON: { groups, wordplay, trap, verified: true }
  status TEXT NOT NULL DEFAULT 'new',  -- new | filed | rejected | skipped
  reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  filed_at TEXT
);

-- Cheers on league scores (27 Oct 2026; see migrations/2026-10-27-league-cheers.sql and
-- src/cheers.js, which creates these on first use).
CREATE TABLE IF NOT EXISTS league_cheers (
  game TEXT NOT NULL, date TEXT NOT NULL, to_ini TEXT NOT NULL,
  from_ini TEXT NOT NULL, from_id TEXT, emoji TEXT NOT NULL, at TEXT NOT NULL,
  off INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (game, date, to_ini, from_ini, emoji)
);
CREATE INDEX IF NOT EXISTS idx_cheers_date ON league_cheers(date, game);
CREATE INDEX IF NOT EXISTS idx_cheers_to   ON league_cheers(to_ini, at);
CREATE INDEX IF NOT EXISTS idx_cheers_from ON league_cheers(from_ini, at);
CREATE TABLE IF NOT EXISTS league_cheer_seen (initials TEXT PRIMARY KEY, at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS league_banned (initials TEXT PRIMARY KEY, at TEXT NOT NULL, note TEXT);
-- Browser ids that cheered under banned initials (banned with them, so new initials don't get round it).
CREATE TABLE IF NOT EXISTS league_banned_ids (id TEXT PRIMARY KEY, initials TEXT, at TEXT NOT NULL);
