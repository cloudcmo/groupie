-- 14 Nov 2026: what happens between opening a Guff game and finishing it.
-- The Worker creates this itself with the first event (ensureEvents in src/index.js),
-- so this file is a record rather than a step anyone has to run.
CREATE TABLE IF NOT EXISTS guff_events (
  id TEXT NOT NULL, date TEXT NOT NULL, game TEXT NOT NULL, ev TEXT NOT NULL, detail TEXT,
  at TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY (id, date, game, ev));
CREATE INDEX IF NOT EXISTS idx_guff_events_date ON guff_events(date, game, ev);
