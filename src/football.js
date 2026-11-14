// ─── Whenly Football extras (14 Nov 2026) ──────────────────────────────────
// Whenly Football (football.carlosfandango.net) files its scores on the shared
// league like every Guff game. These two extras are its own:
//
//   Crowd dots: where everyone else guessed each question, as on Whenly.
//     POST /api/wf/guess   { id, date, qi, offset }  offset = guess - answer
//     GET  /api/wf/guesses?date=  → { date, q: { "0": { "-2": 3, "0": 5 }, ... } }
//     One guess per browser id, day and question counts. Only aggregates are kept
//     (wf_guesses); wf_guess_ids just stops one browser counting twice.
//
//   Club table: players pick the club they support; the table ranks clubs by
//   their fans' average score.
//     GET  /api/wf/club?id=          → { initials, club, clubs: [...] }
//     POST /api/wf/club { id, club } → { ok, club }   (needs initials; "" clears it)
//     GET  /api/wf/clubs?days=30     → { from, to, min, rows: [{ club, avg, scores, fans }] }
//     A club is filed under the player's initials, so it follows them across devices.
//
// Tables are created on first use. Nothing here touches any other game's data.

export const CLUBS = [
  "AFC Wimbledon", "Accrington Stanley", "Arsenal", "Aston Villa", "Barnet", "Barnsley", "Barrow",
  "Birmingham City", "Blackburn Rovers", "Blackpool", "Bolton Wanderers", "Bournemouth", "Bradford City",
  "Brentford", "Brighton & Hove Albion", "Bristol City", "Bristol Rovers", "Bromley", "Burnley",
  "Burton Albion", "Cambridge United", "Cardiff City", "Carlisle United", "Charlton Athletic", "Chelsea",
  "Cheltenham Town", "Chesterfield", "Colchester United", "Coventry City", "Crawley Town",
  "Crewe Alexandra", "Crystal Palace", "Derby County", "Doncaster Rovers", "Everton", "Exeter City",
  "Fleetwood Town", "Fulham", "Gillingham", "Grimsby Town", "Harrogate Town", "Huddersfield Town",
  "Hull City", "Ipswich Town", "Leeds United", "Leicester City", "Leyton Orient", "Lincoln City",
  "Liverpool", "Luton Town", "Manchester City", "Manchester United", "Mansfield Town", "Middlesbrough",
  "Millwall", "MK Dons", "Morecambe", "Newcastle United", "Newport County", "Northampton Town",
  "Norwich City", "Nottingham Forest", "Notts County", "Oldham Athletic", "Oxford United",
  "Peterborough United", "Plymouth Argyle", "Port Vale", "Portsmouth", "Preston North End",
  "Queens Park Rangers", "Reading", "Rotherham United", "Salford City", "Sheffield United",
  "Sheffield Wednesday", "Shrewsbury Town", "Southampton", "Southend United", "Stevenage",
  "Stockport County", "Stoke City", "Sunderland", "Sutton United", "Swansea City", "Swindon Town",
  "Tottenham Hotspur", "Tranmere Rovers", "Walsall", "Watford", "West Bromwich Albion", "West Ham United",
  "Wigan Athletic", "Wolverhampton Wanderers", "Wrexham", "Wycombe Wanderers", "York City",
  "Aberdeen", "Celtic", "Dundee", "Dundee United", "Heart of Midlothian", "Hibernian", "Kilmarnock",
  "Motherwell", "Rangers", "St Mirren",
  "Another club",
];
const CLUB_SET = new Set(CLUBS);
const GAME = "whenlyfootball";
// Clubs need at least this many scores to appear, but only once the game has more than
// CLUB_MIN_FROM players; until then every club with a fan shows (14 Nov 2026, Carl:
// a minimum left the table empty).
const CLUB_MIN_SCORES = 3, CLUB_MIN_FROM = 40;

let ready = false;
async function ensure(env) {
  if (ready) return;
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS wf_guesses (date TEXT NOT NULL, qi INTEGER NOT NULL, offset INTEGER NOT NULL, n INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (date, qi, offset))`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS wf_guess_ids (id TEXT NOT NULL, date TEXT NOT NULL, qi INTEGER NOT NULL, PRIMARY KEY (id, date, qi))`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS wf_clubs (initials TEXT PRIMARY KEY, club TEXT NOT NULL, at TEXT NOT NULL)`),
  ]);
  ready = true;
}

export async function serveFootball(url, request, env, path, h) {
  const { json, validId, today, addDays } = h;
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: h.cors });
  await ensure(env);

  if (path === "/api/wf/guess" && request.method === "POST") {
    let b = {};
    try { b = await request.json(); } catch { return json({ error: "Invalid request" }, 400); }
    const id = String(b.id || ""), date = String(b.date || ""), qi = parseInt(b.qi, 10), offset = parseInt(b.offset, 10);
    if (!validId(id)) return json({ error: "Bad id" }, 400);
    if (date !== today && date !== addDays(today, -1)) return json({ error: "Bad date" }, 400);
    if (!(qi >= 0 && qi <= 2) || !Number.isFinite(offset) || Math.abs(offset) > 150) return json({ error: "Bad guess" }, 400);
    const first = await env.DB.prepare("INSERT OR IGNORE INTO wf_guess_ids (id, date, qi) VALUES (?, ?, ?)").bind(id, date, qi).run();
    if (first.meta && first.meta.changes)
      await env.DB.prepare(`INSERT INTO wf_guesses (date, qi, offset, n) VALUES (?, ?, ?, 1)
        ON CONFLICT(date, qi, offset) DO UPDATE SET n = n + 1`).bind(date, qi, offset).run();
    return json({ ok: true });
  }

  if (path === "/api/wf/guesses" && request.method === "GET") {
    const date = url.searchParams.get("date") || today;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return json({ error: "Bad date" }, 400);
    const { results } = await env.DB.prepare("SELECT qi, offset, n FROM wf_guesses WHERE date = ?").bind(date).all();
    const q = {};
    for (const r of results || []) (q[r.qi] = q[r.qi] || {})[r.offset] = r.n;
    return json({ date, q });
  }

  if (path === "/api/wf/club" && request.method === "GET") {
    const id = url.searchParams.get("id") || "";
    let initials = null, club = null;
    if (validId(id)) {
      const p = await env.DB.prepare("SELECT initials FROM players WHERE id = ?").bind(id).first();
      if (p) {
        initials = p.initials;
        const c = await env.DB.prepare("SELECT club FROM wf_clubs WHERE initials = ?").bind(initials).first();
        club = c ? c.club : null;
      }
    }
    return json({ initials, club, clubs: CLUBS });
  }

  if (path === "/api/wf/club" && request.method === "POST") {
    let b = {};
    try { b = await request.json(); } catch { return json({ error: "Invalid request" }, 400); }
    const id = String(b.id || ""), club = String(b.club || "");
    if (!validId(id)) return json({ error: "Bad id" }, 400);
    const p = await env.DB.prepare("SELECT initials FROM players WHERE id = ?").bind(id).first();
    if (!p) return json({ error: "Join the league first." }, 400);
    if (club === "") {
      await env.DB.prepare("DELETE FROM wf_clubs WHERE initials = ?").bind(p.initials).run();
      return json({ ok: true, club: null });
    }
    if (!CLUB_SET.has(club)) return json({ error: "Unknown club" }, 400);
    await env.DB.prepare(`INSERT INTO wf_clubs (initials, club, at) VALUES (?, ?, datetime('now'))
      ON CONFLICT(initials) DO UPDATE SET club = excluded.club, at = excluded.at`).bind(p.initials, club).run();
    return json({ ok: true, club });
  }

  if (path === "/api/wf/clubs" && request.method === "GET") {
    const days = Math.max(1, Math.min(365, parseInt(url.searchParams.get("days"), 10) || 30));
    const from = addDays(today, -(days - 1));
    const pc = await env.DB.prepare(
      "SELECT COUNT(DISTINCT p.initials) AS n FROM league_scores s JOIN players p ON p.id = s.id WHERE s.game = ?"
    ).bind(GAME).first();
    const min = (pc?.n || 0) > CLUB_MIN_FROM ? CLUB_MIN_SCORES : 1;
    const { results } = await env.DB.prepare(
      `WITH d AS (
         SELECT p.initials AS ini, s.date, MAX(s.score) AS score
         FROM league_scores s JOIN players p ON p.id = s.id
         WHERE s.game = ? AND s.date BETWEEN ? AND ?
         GROUP BY p.initials, s.date
       )
       SELECT c.club, AVG(d.score) AS avg, COUNT(*) AS scores, COUNT(DISTINCT d.ini) AS fans
       FROM d JOIN wf_clubs c ON c.initials = d.ini
       WHERE c.club <> 'Another club'
       GROUP BY c.club HAVING COUNT(*) >= ?
       ORDER BY avg DESC, scores DESC, c.club ASC`
    ).bind(GAME, from, today, min).all();
    const rows = (results || []).map((r, i) => ({ rank: i + 1, club: r.club, avg: Math.round(r.avg * 10) / 10, scores: r.scores, fans: r.fans }));
    return json({ from, to: today, days, min, players: pc?.n || 0, rows });
  }

  return json({ error: "Not found" }, 404);
}
