-- Each player's chosen games and order for the hub and guff bar (12 Oct 2026).
-- The Worker also creates this itself on first use (ensurePrefsTable), so no manual step is needed.
CREATE TABLE IF NOT EXISTS guff_prefs (
  k     TEXT PRIMARY KEY,   -- "id:<browser id>" or "ini:<initials>"
  prefs TEXT NOT NULL,      -- JSON {order, off, known}
  at    TEXT NOT NULL       -- ISO time saved; the newest of id/initials wins
);
