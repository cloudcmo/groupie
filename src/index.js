// src/index.js — the Groupie API.
// Static assets in public/ are served by Cloudflare's asset handling;
// this Worker only sees /api/* (and anything assets don't match).

import { generateDay } from "./generate.js";
import { handleSubscribe } from "./subscribe.js";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    try {
      if (path === "/api/puzzle") return await servePuzzle(url, env, request);
      if (path === "/api/archive") return await serveArchive(env);
      if (path === "/api/health") return await serveHealth(env);
      if (path === "/api/played") return await servePlayed(request, env);
      if (path === "/api/stats") return await serveStats(url, env, request);
      if (path === "/api/docket") return await serveDocket(url, request, env);
      if (path === "/api/visit") return await serveVisit(request, env);
      if (path === "/api/sources") return await serveSources(url, request, env);
      if (path.startsWith("/api/league")) return await serveLeague(url, request, env, path);
      if (path === "/api/generate") return await serveGenerate(request, env);
      if (path === "/api/subscribe") return await handleSubscribe(request, env);
      // SEO files are generated here (not static) so they always reflect the
      // current host and the full list of published grids.
      if (path === "/robots.txt") return serveRobots(url);
      if (path === "/sitemap.xml") return await serveSitemap(url, env);
    } catch (err) {
      console.error(`${path} failed:`, err);
      return json({ error: "Internal error" }, 500);
    }

    return json({ error: "Not found" }, 404);
  },

  // Daily cron: top the queue back up to TOPUP_TARGET_DAYS, then check
  // the water level and email an alert if it's running low.
  async scheduled(event, env, ctx) {
    const target = parseInt(env.TOPUP_TARGET_DAYS || "45", 10);
    ctx.waitUntil(runScheduled(env, target));
  },
};

// ─── Routes ─────────────────────────────────────────────────────────────────

async function servePuzzle(url, env, request) {
  const today = todayISO();
  const date = url.searchParams.get("date") || today;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return json({ error: "Bad date" }, 400);
  // Future dates are refused — except with the admin token, so the Friday
  // newsletter builder can read ahead.
  const isAdmin =
    env.ADMIN_TOKEN &&
    request &&
    request.headers.get("Authorization") === `Bearer ${env.ADMIN_TOKEN}`;
  if (date > today && !isAdmin) return json({ error: "That grid hasn't come out yet" }, 403);
  if (date < env.EPOCH_DATE) return json({ error: "Before the first grid" }, 404);

  const row = await env.DB.prepare("SELECT payload FROM days WHERE date = ?")
    .bind(date)
    .first();
  if (!row) return json({ error: `No grid for ${date}` }, 404);

  const payload = JSON.parse(row.payload);
  return json(
    {
      date,
      number: gridNumber(env, date),
      isToday: date === today,
      groups: payload.groups,
    },
    200,
    date === today ? 300 : date > today ? 0 : 86400
  );
}

async function serveArchive(env) {
  const today = todayISO();
  const { results } = await env.DB.prepare(
    "SELECT date FROM days WHERE date <= ? ORDER BY date DESC LIMIT 120"
  )
    .bind(today)
    .all();
  const issues = (results || []).map((r) => ({
    date: r.date,
    number: gridNumber(env, r.date),
  }));
  return json({ issues }, 200, 3600);
}

async function serveHealth(env) {
  const today = todayISO();
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS queued, MAX(date) AS through FROM days WHERE date >= ?"
  )
    .bind(today)
    .first();
  return json({ today, queued: row?.queued || 0, through: row?.through || null }, 200, 0);
}

// ─── The cross-game docket ──────────────────────────────────────────────────
// Shared by all the games' "More daily guff" bars (guff-bar.js): an
// anonymous browser id reports which games it played today, and reads the
// merged state back. Cross-origin by design, so full CORS. No identifiers
// beyond the random id, no auth — the data is a handful of booleans a day.

// wagdaily (Words and Guff Daily) took Twentee's place on 20 Sept 2026. twentee stays accepted
// so its column and old rows keep working; its page stops reporting once the bar drops it.
// wordminer and guffitaire joined the canon on 25 Sept 2026 (Guff games nine and ten).
const DOCKET_GAMES = new Set(["pqd", "whenly", "whatword", "groupie", "twentee", "spellbound", "guffinoes", "hexadec", "wagdaily", "wordminer", "guffitaire"]);

const DOCKET_CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};

async function serveDocket(url, request, env) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: DOCKET_CORS });

  const today = todayISO();

  if (request.method === "GET") {
    const id = url.searchParams.get("id") || "";
    const date = url.searchParams.get("date") || today;
    if (!validDocketId(id)) return docketJson({ error: "Bad id" }, 400);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return docketJson({ error: "Bad date" }, 400);

    const row = await env.DB.prepare(
      "SELECT pqd, whenly, whatword, groupie, twentee, spellbound, guffinoes, hexadec, wagdaily, wordminer, guffitaire FROM docket WHERE id = ? AND date = ?"
    ).bind(id, date).first();
    return docketJson({ date, played: docketPlayed(row) });
  }

  if (request.method === "POST") {
    let body = {};
    try { body = await request.json(); } catch { return docketJson({ error: "Invalid request" }, 400); }

    const id = typeof body.id === "string" ? body.id : "";
    const date = typeof body.date === "string" ? body.date : "";
    const game = typeof body.game === "string" ? body.game : "";
    if (!validDocketId(id)) return docketJson({ error: "Bad id" }, 400);
    if (!DOCKET_GAMES.has(game)) return docketJson({ error: "Unknown game" }, 400);
    // Accept today or yesterday (midnight-straddling finishes), nothing else.
    if (date !== today && date !== addDays(today, -1)) return docketJson({ error: "Bad date" }, 400);

    // `game` is allowlisted above, so it is safe to splice into the column list.
    await env.DB.prepare(
      `INSERT INTO docket (id, date, ${game}) VALUES (?, ?, 1)
       ON CONFLICT(id, date) DO UPDATE SET ${game} = 1`
    ).bind(id, date).run();

    const row = await env.DB.prepare(
      "SELECT pqd, whenly, whatword, groupie, twentee, spellbound, guffinoes, hexadec, wagdaily, wordminer, guffitaire FROM docket WHERE id = ? AND date = ?"
    ).bind(id, date).first();
    return docketJson({ date, played: docketPlayed(row) });
  }

  return docketJson({ error: "Method not allowed" }, 405);
}

// ─── Visits: who arrived, and from where ───────────────────────────────────
// guff-bar.js pings this once per page load with the bar's anonymous id and
// any ?ref= the page was opened with (the Friday email tags its links
// ref=friday). One row per (id, date, game); the ref sticks the first time it
// is seen. Joined with the docket, this answers "did the email bring anyone,
// and did they finish?" — the daily report reads it via /api/sources.
const VISIT_REF = /^[a-z0-9_-]{1,24}$/;

async function serveVisit(request, env) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: DOCKET_CORS });
  if (request.method !== "POST") return docketJson({ error: "POST only" }, 405);
  let body = {};
  try { body = await request.json(); } catch { return docketJson({ error: "Invalid request" }, 400); }

  const today = todayISO();
  const id = typeof body.id === "string" ? body.id : "";
  const date = typeof body.date === "string" ? body.date : today;
  const game = typeof body.game === "string" ? body.game : "";
  const rawRef = typeof body.ref === "string" ? body.ref.toLowerCase().trim() : "";
  const ref = VISIT_REF.test(rawRef) ? rawRef : null;
  if (!validDocketId(id)) return docketJson({ error: "Bad id" }, 400);
  if (!DOCKET_GAMES.has(game)) return docketJson({ error: "Unknown game" }, 400);
  if (date !== today && date !== addDays(today, -1)) return docketJson({ error: "Bad date" }, 400);

  await env.DB.prepare(
    "INSERT OR IGNORE INTO visits (id, date, game, ref) VALUES (?, ?, ?, ?)"
  ).bind(id, date, game, ref).run();
  if (ref) {
    await env.DB.prepare(
      "UPDATE visits SET ref = ? WHERE id = ? AND date = ? AND game = ? AND ref IS NULL"
    ).bind(ref, id, date, game).run();
  }
  return docketJson({ ok: true });
}

// Aggregates only — no ids leave the server — so it is public, like the
// league table. Per game: unique visitors, how many finished, and both
// broken down by ref. A visitor counts as "from friday" for every game if
// ANY of their visits that day carried the ref (the bar unifies ids across
// the sites), which is what "did the email bring them" means.
async function serveSources(url, request, env) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: DOCKET_CORS });
  const date = url.searchParams.get("date") || todayISO();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return docketJson({ error: "Bad date" }, 400);

  const games = [...DOCKET_GAMES];
  const out = {};
  for (const g of games) out[g] = { visits: 0, completed: 0, refs: {} };

  // TOTALS come from a query with no ref join in it at all.
  //
  // Since 2026-09-17 the Friday email tags each LINK separately
  // (friday-hero, friday-card-whatword, …), so one person can now carry two or
  // three different refs in a day. The id→ref subquery below is therefore
  // one-to-MANY, and folding the totals out of that join would count such a
  // person once per ref — silently inflating the plain "visited" and
  // "finished" numbers, which have nothing to do with the email. Keep the two
  // apart.
  const { results: visitTotals } = await env.DB.prepare(
    `SELECT game, COUNT(DISTINCT id) AS n FROM visits WHERE date = ? GROUP BY game`
  ).bind(date).all();
  for (const r of visitTotals || []) {
    if (!out[r.game]) continue;
    out[r.game].visits += r.n;
  }

  const sums = games.map((g) => `SUM(d.${g}) AS ${g}`).join(", ");
  const doneTotals = await env.DB.prepare(
    `SELECT ${sums} FROM docket d WHERE d.date = ?`
  ).bind(date).first();
  for (const g of games) out[g].completed += (doneTotals && doneTotals[g]) || 0;

  // BREAKDOWN by ref. These may legitimately sum to more than the total above:
  // a person who pressed both the hero button and a game card appears under
  // both refs. Read each ref as "how many people arrived carrying this link",
  // not as a share of a whole.
  const { results: visitRows } = await env.DB.prepare(
    `SELECT v.game, r.ref, COUNT(DISTINCT v.id) AS n
       FROM visits v
       JOIN (SELECT DISTINCT id, ref FROM visits WHERE date = ? AND ref IS NOT NULL) r ON r.id = v.id
      WHERE v.date = ?
      GROUP BY v.game, r.ref`
  ).bind(date, date).all();
  for (const r of visitRows || []) {
    if (!out[r.game] || !r.ref) continue;
    out[r.game].refs[r.ref] = out[r.game].refs[r.ref] || { visits: 0, completed: 0 };
    out[r.game].refs[r.ref].visits += r.n;
  }

  const { results: doneRows } = await env.DB.prepare(
    `SELECT r.ref, ${sums}
       FROM docket d
       JOIN (SELECT DISTINCT id, ref FROM visits WHERE date = ? AND ref IS NOT NULL) r ON r.id = d.id
      WHERE d.date = ?
      GROUP BY r.ref`
  ).bind(date, date).all();
  for (const r of doneRows || []) {
    if (!r.ref) continue;
    for (const g of games) {
      const n = r[g] || 0;
      out[g].refs[r.ref] = out[g].refs[r.ref] || { visits: 0, completed: 0 };
      out[g].refs[r.ref].completed += n;
    }
  }

  return new Response(JSON.stringify({ date, games: out }), {
    status: 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=60", ...DOCKET_CORS },
  });
}

function validDocketId(id) {
  return /^[A-Za-z0-9-]{8,64}$/.test(id);
}

function docketPlayed(row) {
  return {
    pqd: !!row?.pqd,
    whenly: !!row?.whenly,
    whatword: !!row?.whatword,
    groupie: !!row?.groupie,
    twentee: !!row?.twentee,
    spellbound: !!row?.spellbound,
    guffinoes: !!row?.guffinoes,
    hexadec: !!row?.hexadec,
    wagdaily: !!row?.wagdaily,
    wordminer: !!row?.wordminer,
    guffitaire: !!row?.guffitaire,
  };
}

function docketJson(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...DOCKET_CORS },
  });
}

// The front end pings this once per player when a grid is finished.
// Aggregate counts only — no identifiers, nothing personal.
async function servePlayed(request, env) {
  if (request.method !== "POST") return json({ error: "POST only" }, 405);

  let body = {};
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid request" }, 400);
  }

  const today = todayISO();
  const date = typeof body.date === "string" ? body.date : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return json({ error: "Bad date" }, 400);
  if (date > today || date < env.EPOCH_DATE) return json({ error: "Bad date" }, 400);

  const won = body.won ? 1 : 0;
  const mistakes = Math.min(Math.max(parseInt(body.mistakes ?? 0, 10) || 0, 0), 4);
  // Solve-order score: 0–24 — each fired level × a boldness weight
  // (first fire ×3, second ×2, third ×1, forced last fire ×0), plus a
  // 4-point clean-sweep bonus for leaving level 1 as the freebie.
  const score = Math.min(Math.max(parseInt(body.score ?? 0, 10) || 0, 0), 24);

  await env.DB.prepare(
    `INSERT INTO plays (date, total, wins, mistakes_sum, score_sum) VALUES (?, 1, ?, ?, ?)
     ON CONFLICT(date) DO UPDATE SET
       total = total + 1,
       wins = wins + excluded.wins,
       mistakes_sum = mistakes_sum + excluded.mistakes_sum,
       score_sum = score_sum + excluded.score_sum`
  ).bind(date, won, mistakes, score).run();

  return json({ ok: true }, 200, 0);
}

// Play counts for the daily report email. Admin-gated like /api/generate.
async function serveStats(url, env, request) {
  const auth = request.headers.get("Authorization") || "";
  if (!env.ADMIN_TOKEN || auth !== `Bearer ${env.ADMIN_TOKEN}`)
    return json({ error: "Unauthorized" }, 401);

  const date = url.searchParams.get("date") || todayISO();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return json({ error: "Bad date" }, 400);

  const day = await env.DB.prepare(
    "SELECT total, wins, mistakes_sum, score_sum FROM plays WHERE date = ?"
  ).bind(date).first();

  const all = await env.DB.prepare(
    "SELECT COALESCE(SUM(total),0) AS players, COALESCE(SUM(wins),0) AS wins, COUNT(*) AS days FROM plays"
  ).first();

  const players = day?.total || 0;
  return json({
    date,
    players,
    wins: day?.wins || 0,
    solveRate: players ? Math.round(((day?.wins || 0) / players) * 100) : null,
    avgMistakes: players ? Math.round(((day?.mistakes_sum || 0) / players) * 10) / 10 : null,
    avgScore: players ? Math.round(((day?.score_sum || 0) / players) * 10) / 10 : null,
    allTime: { players: all?.players || 0, wins: all?.wins || 0, days: all?.days || 0 },
  }, 200, 0);
}

async function serveGenerate(request, env) {
  if (request.method !== "POST") return json({ error: "POST only" }, 405);
  const auth = request.headers.get("Authorization") || "";
  if (!env.ADMIN_TOKEN || auth !== `Bearer ${env.ADMIN_TOKEN}`)
    return json({ error: "Unauthorized" }, 401);

  let body = {};
  try {
    body = await request.json();
  } catch {}
  const days = Math.min(Math.max(parseInt(body.days || "7", 10), 1), 60);

  // One generation per HTTP request: a day now costs two model calls, and
  // Cloudflare's edge cuts long requests off. The topup script loops instead.
  const report = await fillRange(env, todayISO(), days, 1);
  return json(report, 200, 0);
}

// ─── SEO ────────────────────────────────────────────────────────────────────

function serveRobots(url) {
  const body = `User-agent: *\nAllow: /\nDisallow: /api/\n\nSitemap: ${url.origin}/sitemap.xml\n`;
  return new Response(body, {
    headers: { "Content-Type": "text/plain", "Cache-Control": "public, max-age=86400" },
  });
}

async function serveSitemap(url, env) {
  const today = todayISO();
  const { results } = await env.DB.prepare(
    "SELECT date FROM days WHERE date <= ? ORDER BY date DESC"
  )
    .bind(today)
    .all();

  const urls = [
    `  <url><loc>${url.origin}/</loc><changefreq>daily</changefreq><priority>1.0</priority></url>`,
    ...(results || []).map(
      (r) =>
        `  <url><loc>${url.origin}/?date=${r.date}</loc><lastmod>${r.date}</lastmod><changefreq>never</changefreq><priority>0.4</priority></url>`
    ),
  ].join("\n");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
  return new Response(xml, {
    headers: { "Content-Type": "application/xml", "Cache-Control": "public, max-age=3600" },
  });
}


// ─── The Guff games league ──────────────────────────────────────────────────
// Three initials, entered once, attached to the same anonymous cross-site id
// the docket uses. Every game reports its daily score here; the league page
// on the guff hub reads the tables. Cross-origin by design, same as the
// docket. No accounts — three letters and glory.

const INITIALS_BLOCKLIST = new Set([
  "ASS", "FUK", "FUC", "FCK", "SHT", "CNT", "DIK", "COK", "FAG", "NIG",
]);

async function serveLeague(url, request, env, path) {
  if (request.method === "OPTIONS")
    return new Response(null, { status: 204, headers: DOCKET_CORS });

  const today = todayISO();

  // GET /api/league/player?id= → { initials } (or {})
  if (path === "/api/league/player" && request.method === "GET") {
    const id = url.searchParams.get("id") || "";
    if (!validDocketId(id)) return docketJson({ error: "Bad id" }, 400);
    const row = await env.DB.prepare("SELECT initials FROM players WHERE id = ?").bind(id).first();
    return docketJson(row ? { initials: row.initials } : {});
  }

  // POST /api/league/initials { id, initials }
  if (path === "/api/league/initials" && request.method === "POST") {
    let body = {};
    try { body = await request.json(); } catch { return docketJson({ error: "Invalid request" }, 400); }
    const id = String(body.id || "");
    const initials = String(body.initials || "").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 3);
    if (!validDocketId(id)) return docketJson({ error: "Bad id" }, 400);
    if (initials.length !== 3)
      return docketJson({ error: "Three letters. It is the arcade way." }, 400);
    if (INITIALS_BLOCKLIST.has(initials))
      return docketJson({ error: "The arcade cabinet refuses those letters." }, 400);
    await env.DB.prepare(
      `INSERT INTO players (id, initials, created) VALUES (?, ?, datetime('now'))
       ON CONFLICT(id) DO UPDATE SET initials = excluded.initials`
    ).bind(id, initials).run();
    return docketJson({ ok: true, initials });
  }

  // POST /api/league/score { id, date, game, score, max, display }
  // Scores are stored even before initials exist — the join hides them
  // until the player signs the cabinet.
  if (path === "/api/league/score" && request.method === "POST") {
    let body = {};
    try { body = await request.json(); } catch { return docketJson({ error: "Invalid request" }, 400); }
    const id = String(body.id || "");
    const date = String(body.date || today);
    const game = String(body.game || "");
    const score = Math.max(0, Math.min(9999, parseInt(body.score, 10) || 0));
    const max = Math.max(0, Math.min(9999, parseInt(body.max, 10) || 0));
    const display = String(body.display || "").slice(0, 24);
    if (!validDocketId(id)) return docketJson({ error: "Bad id" }, 400);
    if (!DOCKET_GAMES.has(game)) return docketJson({ error: "Unknown game" }, 400);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return docketJson({ error: "Bad date" }, 400);
    // Today or yesterday only, and never twice: first score of the day stands.
    if (date !== today && date !== addDays(today, -1))
      return docketJson({ error: "Bad date" }, 400);
    // All-time record? Judged against what the all-time table shows (signed
    // players only), before this score goes in, and only once a game has a
    // history worth beating: the first fortnight of a new game is not a
    // record every morning. Feeds the bar's celebration line (26 Sept 2026).
    const RECORD_MIN_SCORES = 20;
    const prior = await env.DB.prepare(
      `SELECT MAX(s.score) AS best, COUNT(*) AS n
       FROM league_scores s JOIN players p ON p.id = s.id
       WHERE s.game = ? AND NOT (s.id = ? AND s.date = ?)`
    ).bind(game, id, date).first();
    const ins = await env.DB.prepare(
      `INSERT OR IGNORE INTO league_scores (id, date, game, score, max, display)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(id, date, game, score, max, display).run();
    const stored = !!(ins && ins.meta && ins.meta.changes);
    const record = stored && score > 0 && (prior?.n || 0) >= RECORD_MIN_SCORES && score > (prior?.best || 0);
    const p = await env.DB.prepare("SELECT initials FROM players WHERE id = ?").bind(id).first();
    return docketJson({ ok: true, initials: p ? p.initials : null, stored, record });
  }

  // GET /api/league?date=&mode=today|all → the tables
  if (path === "/api/league" && request.method === "GET") {
    const mode = url.searchParams.get("mode") === "all" ? "all" : "today";
    const date = url.searchParams.get("date") || today;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return docketJson({ error: "Bad date" }, 400);

    let rows;
    if (mode === "today") {
      ({ results: rows } = await env.DB.prepare(
        `SELECT s.id, s.game, s.score, s.max, s.display, p.initials
         FROM league_scores s JOIN players p ON p.id = s.id
         WHERE s.date = ? ORDER BY s.score DESC, s.rowid ASC`
      ).bind(date).all());
    } else {
      // All-time: each player's best per game, newest date wins ties.
      ({ results: rows } = await env.DB.prepare(
        `SELECT s.game, MAX(s.score) AS score, s.max, s.display, p.initials, s.date
         FROM league_scores s JOIN players p ON p.id = s.id
         GROUP BY s.id, s.game ORDER BY score DESC`
      ).all());
    }

    const games = {};
    const ranks = {}; // running position per game as we walk the ordered rows
    const meId = url.searchParams.get("id") || "";
    const askMe = mode === "today" && validDocketId(meId);
    const meGames = {};
    for (const r of rows || []) {
      if (!games[r.game]) games[r.game] = [];
      ranks[r.game] = (ranks[r.game] || 0) + 1;
      if (askMe && r.id === meId)
        meGames[r.game] = {
          score: r.score, max: r.max, display: r.display, rank: ranks[r.game],
        };
      if (games[r.game].length < 10)
        games[r.game].push({
          initials: r.initials,
          score: r.score,
          max: r.max,
          display: r.display,
          ...(mode === "all" ? { date: r.date } : {}),
        });
    }
    if (askMe) for (const g in meGames) meGames[g].total = ranks[g] || 0;
    const payload = { mode, date: mode === "today" ? date : null, games };
    // The asker's own day: score, display and rank per game — the share
    // card's raw material. Only for today mode, only when an id is sent.
    if (askMe) payload.me = { games: meGames };
    return docketJson(payload, 200);
  }

  return docketJson({ error: "Not found" }, 404);
}

// ─── Generation plumbing ────────────────────────────────────────────────────

// Fill every missing date in [start, start + days). Rejected days are
// skipped, not retried — run again to fill the gaps.
// Scans `days` dates from `start` and fills the missing ones, attempting at
// most `maxAttempts` generations (each = 2 model calls) per invocation so no
// single request outstays Cloudflare's welcome. Skipped dates are simply
// picked up by the next call.
async function fillRange(env, start, days, maxAttempts = 1) {
  const written = [];
  const rejected = [];
  let attempts = 0;

  const usedCategories = await loadUsedCategories(env);
  const recentGroups = await loadRecentGroups(env);
  // Within a run, a retried date carries its last rejection back into the
  // prompt so the setter changes course instead of repeating the mistake.
  const lastRejection = new Map();

  for (let i = 0; i < days; i++) {
    if (attempts >= maxAttempts) break;
    const date = addDays(start, i);
    const exists = await env.DB.prepare("SELECT 1 FROM days WHERE date = ?")
      .bind(date)
      .first();
    if (exists) continue;

    // Up to two goes per date per run: the second attempt is told exactly
    // why the first was rejected, so it changes course instead of walking
    // back into the same collision. A stubborn date then yields to the next
    // rather than eating the whole run.
    let result = null;
    while (attempts < maxAttempts) {
      attempts++;
      result = await generateDay(env, date, usedCategories, recentGroups, lastRejection.get(date) || null);
      if (result.ok) break;
      rejected.push({ date, reason: result.reason });
      const firstFailureThisRun = !lastRejection.has(date);
      lastRejection.set(date, result.reason);
      if (!firstFailureThisRun) break; // second strike — move to the next date
    }
    if (!result || !result.ok) continue;

    // One batched write per day — day row plus its categories in a single trip.
    await env.DB.batch([
      env.DB.prepare("INSERT INTO days (date, payload) VALUES (?, ?)").bind(
        date,
        JSON.stringify(result.payload)
      ),
      ...result.categories.map((c) =>
        env.DB.prepare("INSERT OR IGNORE INTO categories (name, date) VALUES (?, ?)").bind(c, date)
      ),
    ]);
    for (const c of result.categories) usedCategories.add(c);
    for (const g of result.payload.groups) {
      const set = new Set(g.words);
      set.fresh = true; // written this run — checkLabels treats it as recent
      recentGroups.push(set);
    }
    written.push(date);
  }

  return { written, rejected };
}

// Word-sets of every published group, so a new day can't re-serve an old
// group under a reworded name (3+ shared words = a repeat).
async function loadRecentGroups(env) {
  const { results } = await env.DB.prepare(
    "SELECT payload FROM days ORDER BY date DESC LIMIT 120"
  ).all();
  const sets = [];
  for (const row of results || []) {
    try {
      for (const g of JSON.parse(row.payload).groups || []) {
        sets.push(new Set((g.words || []).map((w) => String(w).trim().toUpperCase())));
      }
    } catch { /* ignore malformed rows */ }
  }
  return sets;
}

// Cron entry: make sure there are `target` days queued from today. The
// posture is self-healing, not alarm-raising: a low queue makes the run
// work HARDER (more attempts) rather than emailing Carl homework. He gets
// a receipt when the run recovered a low queue by itself, and an alarm
// only when the run tried hard and the queue is STILL short — which means
// something no retry can fix (a dead API key, exhausted credit).
const LOW_WATER = 7;

async function queueDepth(env) {
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS queued, MAX(date) AS through FROM days WHERE date >= ?"
  )
    .bind(todayISO())
    .first();
  return { queued: row?.queued || 0, through: row?.through || null };
}

async function runScheduled(env, target) {
  // Prune docket rows older than a fortnight — the bar only ever asks about
  // today, so old rows are pure dead weight.
  await env.DB.prepare("DELETE FROM docket WHERE date < ?")
    .bind(addDays(todayISO(), -14)).run()
    .catch((err) => console.error("Docket prune failed:", err));
  // Visits keep two months, so a Friday can be compared with the ones before.
  await env.DB.prepare("DELETE FROM visits WHERE date < ?")
    .bind(addDays(todayISO(), -60)).run()
    .catch((err) => console.error("Visits prune failed:", err));

  const before = await queueDepth(env);

  // The scheduled context has far roomier limits than an HTTP request, so
  // the cron may attempt several days per run — and twice as many when the
  // queue has actually run low.
  const report = await fillRange(env, todayISO(), target, before.queued < LOW_WATER ? 12 : 6);
  console.log(
    `Top-up: wrote ${report.written.length}, rejected ${report.rejected.length}`,
    report.rejected
  );

  const after = await queueDepth(env);

  if (after.queued < LOW_WATER) {
    // Tried hard, still short: a human is genuinely needed.
    await sendLowQueueAlert(env, after.queued, after.through, report.rejected).catch((err) =>
      console.error("Low-queue alert failed:", err)
    );
  } else if (before.queued < LOW_WATER && report.written.length) {
    // The queue was low and this run fixed it unaided — send the receipt.
    await sendTopupReceipt(env, report.written.length, after.queued, after.through).catch((err) =>
      console.error("Top-up receipt failed:", err)
    );
  }
}

async function sendTopupReceipt(env, wrote, queued, through) {
  if (!env.RESEND_API_KEY || !env.ALERT_EMAIL) return;
  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "Groupie <hello@pubquizdaily.com>",
      to: [env.ALERT_EMAIL],
      subject: `Groupie topped itself up: wrote ${wrote} day${wrote === 1 ? "" : "s"}, queue at ${queued}`,
      html: `<p>The grid queue had run low, so the top-up worked harder and wrote
        <strong>${wrote} day${wrote === 1 ? "" : "s"}</strong>. The queue now holds
        <strong>${queued} day${queued === 1 ? "" : "s"}</strong> (through ${through || "—"}).</p>
        <p>No action needed — this is a receipt, not an alarm. You'll only hear
        an alarm when a run tries hard and still can't refill the queue.</p>`,
    }),
  });
}

async function sendLowQueueAlert(env, queued, through, rejected) {
  if (!env.RESEND_API_KEY || !env.ALERT_EMAIL) return;
  const reasons = (rejected || [])
    .slice(0, 5)
    .map((r) => `${r.date}: ${r.reason}`)
    .join("<br>") || "none reported";
  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "Groupie <hello@pubquizdaily.com>",
      to: [env.ALERT_EMAIL],
      subject: `Groupie queue is low: ${queued} day${queued === 1 ? "" : "s"} left`,
      html: `<p>The daily top-up ran but the grid queue is at <strong>${queued} day${
        queued === 1 ? "" : "s"
      }</strong> (through ${through || "—"}).</p>
        <p>Recent generation rejections:<br>${reasons}</p>
        <p>Check /api/health — usually this means the Anthropic key or credit needs attention.</p>`,
    }),
  });
}

async function loadUsedCategories(env) {
  // Ordered by date so the generator can see which categories (and which
  // level-4 wordplay mechanisms) are most recent, and rotate away from them.
  const { results } = await env.DB.prepare(
    "SELECT name FROM categories ORDER BY date"
  ).all();
  return new Set((results || []).map((r) => r.name));
}

// ─── Helpers ────────────────────────────────────────────────────────────────

// The puzzle day rolls over at midnight in the UK, wherever the player is.
function todayISO() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function gridNumber(env, date) {
  const ms = Date.parse(date + "T00:00:00Z") - Date.parse(env.EPOCH_DATE + "T00:00:00Z");
  return Math.round(ms / 86400000) + 1;
}

function addDays(iso, n) {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function json(obj, status = 200, cacheSeconds = 0) {
  const headers = { "Content-Type": "application/json" };
  if (cacheSeconds > 0) headers["Cache-Control"] = `public, max-age=${cacheSeconds}`;
  else headers["Cache-Control"] = "no-store";
  return new Response(JSON.stringify(obj), { status, headers });
}
