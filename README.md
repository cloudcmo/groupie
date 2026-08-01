# Groupie

Your daily four play. Sixteen words on a grid; sort them into four groups of
four before four lives run out. The UK's answer to Connections: UK English,
UK cultural furniture, and proper red herrings (three Spice Girls on the
board and GINGER filed under hair colours).

Runs entirely on Cloudflare: Worker for the API, D1 for the puzzle store,
static assets for the front end. Grids are set by Claude via the Anthropic API
and topped up by a daily cron, so once it's running it needs no attention.
Same architecture as What Word; the games share the Friday newsletter segment
in Resend.

Live at: https://groupie.fun (after first deploy)

---

## How to play

- Lock on four tiles, press **Fire**. (**Scramble** reshuffles the board,
  **Clear** drops your selection.)
- Hit: the group lands at the top of the board in its colour.
- Miss: you lose one of **four lives**. If three of your four belonged
  together you're told you "missed by one".
- Difficulty runs level 1 (orange) → level 2 (lime) → level 3 (turquoise) →
  level 4 (red, the wordplay one) — deliberately not the NYT colour order.
- Streak, stats and a share grid (🟧🟩🟦🟥 rows) at the end. Streak lives in
  `localStorage` — no accounts, nothing to log into, breaks if you miss a day.

---

## Setup

First deploy is automated — run `bash setup-deploy.sh` and paste the API keys
when prompted. The manual steps it performs:

```bash
npm install

# 1. Database
npx wrangler d1 create groupie
#    → paste the returned database_id into wrangler.toml
npm run db:remote
npm run seed:remote      # five hand-set launch grids (1–5 Aug 2026)

# 2. Secrets
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put ADMIN_TOKEN        # any long random string you invent
npx wrangler secret put RESEND_API_KEY     # optional: newsletter + low-queue alerts

# 3. Set EPOCH_DATE in wrangler.toml to your launch date (that becomes grid #1)

# 4. Deploy
npm run deploy
```

### Fill the queue

```bash
bash topup.sh 30
```

Returns which dates were written and which were rejected, with reasons.
Rejected days are simply skipped — run it again to fill the gaps. After that
the daily cron in `wrangler.toml` tops the queue back up to
`TOPUP_TARGET_DAYS` (45 by default), and emails `ALERT_EMAIL` if the queue
ever runs low.

### Check on it

```bash
curl https://groupie.fun/api/health
# {"today":"2026-08-01","queued":41,"through":"2026-09-10"}
```

---

## What's in the game

| Route | What it does |
|---|---|
| `GET /api/puzzle?date=` | Today's grid, or a back grid. Won't serve future dates. |
| `GET /api/archive` | List of past grids. |
| `GET /api/health` | How many days are queued and how far ahead. |
| `POST /api/generate` | Writes new days. Needs the admin token. |
| `POST /api/subscribe` | Newsletter signup via Resend (shared Friday segment). |

Installable to a home screen via `manifest.webmanifest` (`add-to-home.html`
walks players through it).

---

## How generation works

`src/generate.js` holds the whole editorial brief in one system prompt — the
British rule (no American cultural material, UK spellings), the four
difficulty tiers, and the red-herring doctrine: at least three answers must
plausibly belong to a different group, and the model must describe the trap
it built or the day is rejected. That file is the thing to edit when you want
to change the game's character.

Everything the model returns is validated before it's stored:

- exactly 4 groups × 4 answers, difficulties 0–3 each used once
- 16 answers, all distinct, none longer than 18 characters (they must fit a tile)
- no category that has ever been used before (checked against `categories`)
- a described trap — a grid without red herrings is a sort, not a puzzle

Tiles are shuffled client-side per player, so there's no positional tell.

---

## Design

1980s vector arcade — Battlezone, Tron, the Star Wars cabinet. Black phosphor
screen, faint wireframe grid and scanlines, neon-glow outlines in the four
level colours (orange, lime, turquoise, red), lives shown as little vector
ships. Press Start 2P for the raster display type, VT323 for body copy and
tiles. Verdicts keep the arcade register: a clean solve is PERFECT RUN; a
loss is GAME OVER.

---

## Playing offline

Open `public/index.html` directly and it plays a built-in specimen grid
(featuring the John–Paul–Ringo–and-no-George trap). Useful for design work
without touching the API.
