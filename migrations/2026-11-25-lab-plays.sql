-- Manic Guffer (and later lab games) play counts. The Worker also creates this on first use.
CREATE TABLE IF NOT EXISTS lab_plays (game TEXT NOT NULL, id TEXT NOT NULL, date TEXT NOT NULL, ev TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 1, len INTEGER, secs REAL, tries INTEGER, at TEXT NOT NULL, PRIMARY KEY (game, id, date, ev));
CREATE INDEX IF NOT EXISTS idx_lab_plays_date ON lab_plays(game, date, ev);
