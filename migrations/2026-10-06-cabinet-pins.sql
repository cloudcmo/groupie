-- 6 Oct 2026: one PIN per set of initials, shared by every Guff game (the bar,
-- the league page and Ducks). Signing locked initials on a new phone needs the
-- PIN; initials with no PIN work as before, and the first person to set a PIN
-- owns them. Forgotten PIN: DELETE FROM cabinet WHERE initials = 'ABC' (the
-- initials go back to unlocked; nothing else changes).
-- Only adds two tables. Nothing existing is altered. Applied to live D1 on 6 Oct 2026 via the Cloudflare connector.
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
