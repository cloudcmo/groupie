// src/index.js — the Groupie API.
// Static assets in public/ are served by Cloudflare's asset handling;
// this Worker only sees /api/* (and anything assets don't match).

import { validateDay } from "./generate.js";
import { handleSubscribe } from "./subscribe.js";

import { MOVE, movedResponse } from "./moved.js";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    // Old domain (groupie.fun): PAGE loads get the hand-off to the new address,
    // carrying localStorage with them. API calls (fetch, OPTIONS) are untouched,
    // so the docket/league/visit callers on groupie.fun keep working until they
    // are re-pointed. See src/moved.js.
    const moved = movedResponse(request, url, MOVE);
    if (moved) return moved;

    try {
      if (path === "/api/puzzle") return await servePuzzle(url, env, request);
      if (path === "/api/archive") return await serveArchive(env);
      if (path === "/api/health") return await serveHealth(env);
      if (path === "/api/played") return await servePlayed(request, env);
      if (path === "/api/stats") return await serveStats(url, env, request);
      if (path === "/api/docket") return await serveDocket(url, request, env);
      if (path === "/api/prefs") return await servePrefs(url, request, env);
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

    if (path.startsWith("/api/")) return json({ error: "Not found" }, 404);
    // run_worker_first is on (wrangler.toml), so static files come through here.
    return env.ASSETS.fetch(request);
  },

  // Daily cron: housekeeping, then file the Claude-written grids waiting in
  // `pending`; email only if the queue is low or candidates were turned away.
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runScheduled(env));
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
const DOCKET_GAMES = new Set(["pqd", "whenly", "whatword", "groupie", "twentee", "spellbound", "guffinoes", "hexadec", "wagdaily", "wordminer", "guffitaire", "helmet"]);

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
      "SELECT pqd, whenly, whatword, groupie, twentee, spellbound, guffinoes, hexadec, wagdaily, wordminer, guffitaire, helmet FROM docket WHERE id = ? AND date = ?"
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
      "SELECT pqd, whenly, whatword, groupie, twentee, spellbound, guffinoes, hexadec, wagdaily, wordminer, guffitaire, helmet FROM docket WHERE id = ? AND date = ?"
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

// ─── Each player's games and order (12 Oct 2026) ────────────────────────────
// Which of the daily games a player wants suggested, and in what order. Set on
// the hub (hub.carlosfandango.net, "Edit my games"), read by the hub and every
// game's guff bar, so it has to live here rather than in one site's storage.
// Saved against the browser's id, and also against the player's initials when
// they have signed, so it follows them to a new phone. Nothing else is stored.
//   order: every game key the player has seen, in their order
//   off:   the ones they switched off (not suggested; still playable)
//   known: the games that existed when they saved, so a game launched later
//          can switch itself on for everyone once
// GET  /api/prefs?id=           → { prefs: {order, off, known, at} | null }
// POST /api/prefs {id, order, off, known} → { ok: true }
let prefsTableReady = false;
async function ensurePrefsTable(env) {
  if (prefsTableReady) return;
  await env.DB.prepare(
    "CREATE TABLE IF NOT EXISTS guff_prefs (k TEXT PRIMARY KEY, prefs TEXT NOT NULL, at TEXT NOT NULL)"
  ).run();
  prefsTableReady = true;
}
function cleanKeys(list, max) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const k of list) {
    if (typeof k === "string" && DOCKET_GAMES.has(k) && k !== "twentee" && !out.includes(k)) out.push(k);
    if (out.length >= max) break;
  }
  return out;
}
async function servePrefs(url, request, env) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: DOCKET_CORS });
  await ensurePrefsTable(env);

  if (request.method === "GET") {
    const id = url.searchParams.get("id") || "";
    if (!validDocketId(id)) return docketJson({ error: "Bad id" }, 400);
    const p = await env.DB.prepare("SELECT initials FROM players WHERE id = ?").bind(id).first();
    const keys = ["id:" + id];
    if (p && p.initials) keys.push("ini:" + p.initials);
    const { results } = await env.DB.prepare(
      "SELECT prefs, at FROM guff_prefs WHERE k IN (" + keys.map(() => "?").join(",") + ") ORDER BY at DESC LIMIT 1"
    ).bind(...keys).all();
    const row = results && results[0];
    if (!row) return docketJson({ prefs: null });
    let prefs = null;
    try { prefs = JSON.parse(row.prefs); } catch { prefs = null; }
    if (prefs) prefs.at = row.at;
    return docketJson({ prefs });
  }

  if (request.method === "POST") {
    let body = {};
    try { body = await request.json(); } catch { return docketJson({ error: "Invalid request" }, 400); }
    const id = typeof body.id === "string" ? body.id : "";
    if (!validDocketId(id)) return docketJson({ error: "Bad id" }, 400);
    const prefs = { order: cleanKeys(body.order, 30), off: cleanKeys(body.off, 30), known: cleanKeys(body.known, 30) };
    const at = new Date().toISOString();
    const text = JSON.stringify(prefs);
    const p = await env.DB.prepare("SELECT initials FROM players WHERE id = ?").bind(id).first();
    const stmts = [env.DB.prepare(
      "INSERT INTO guff_prefs (k, prefs, at) VALUES (?, ?, ?) ON CONFLICT(k) DO UPDATE SET prefs = excluded.prefs, at = excluded.at"
    ).bind("id:" + id, text, at)];
    if (p && p.initials) stmts.push(env.DB.prepare(
      "INSERT INTO guff_prefs (k, prefs, at) VALUES (?, ?, ?) ON CONFLICT(k) DO UPDATE SET prefs = excluded.prefs, at = excluded.at"
    ).bind("ini:" + p.initials, text, at));
    await env.DB.batch(stmts);
    return docketJson({ ok: true, at });
  }

  return docketJson({ error: "Not found" }, 404);
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
    helmet: !!row?.helmet,
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

// Retired 23 Oct 2026: the site no longer calls the Anthropic API. Grids
// are written weekly by a Claude scheduled task (on Carl's subscription),
// put into the `pending` table, and filed by the morning cron below.
async function serveGenerate(request, env) {
  return json({ error: "Generation moved to the weekly Claude top-up. See README." }, 410);
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
//
// PINs (6 Oct 2026): one four-digit PIN per set of initials, shared by every
// Guff game, Ducks included. Initials with no PIN behave exactly as before.
// Once someone locks them (POST /api/league/lock, from a browser that holds
// them), signing them on any other browser needs the PIN. Five wrong PINs an
// hour per initials, then a wait. Forgotten PIN: delete the cabinet row.

const PIN_TRIES_PER_HOUR = 5;
async function sha256hex(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
const validPin = (pin) => /^\d{4}$/.test(pin);
async function cabinetRow(env, initials) {
  return env.DB.prepare("SELECT initials, pin_hash, salt FROM cabinet WHERE initials = ?").bind(initials).first();
}
/** Check a PIN against locked initials: "ok", "wrong" or "wait" (too many wrong ones this hour). */
async function checkPin(env, row, pin) {
  const since = new Date(Date.now() - 3600e3).toISOString();
  const t = await env.DB.prepare("SELECT COUNT(*) AS n FROM pin_tries WHERE initials = ? AND at > ?").bind(row.initials, since).first();
  if ((t?.n || 0) >= PIN_TRIES_PER_HOUR) return "wait";
  if (validPin(pin) && (await sha256hex(`${row.salt}:${row.initials}:${pin}`)) === row.pin_hash) return "ok";
  await env.DB.prepare("INSERT INTO pin_tries (initials, at) VALUES (?, ?)").bind(row.initials, new Date().toISOString()).run();
  return "wrong";
}
const PIN_SAYS = {
  need: (ini) => `${ini} is locked with a PIN. What's yours?`,
  wrong: () => "That's not the PIN. Try again.",
  wait: () => "Too many wrong PINs. Try again in an hour.",
};

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
    if (!row) return docketJson({});
    const lock = await cabinetRow(env, row.initials);
    return docketJson({ initials: row.initials, locked: !!lock });
  }

  // POST /api/league/lock { id, pin, old? } → lock the initials this id holds with a PIN,
  // or change the PIN (old needed). The first browser to lock a set of initials owns them.
  if (path === "/api/league/lock" && request.method === "POST") {
    let body = {};
    try { body = await request.json(); } catch { return docketJson({ error: "Invalid request" }, 400); }
    const id = String(body.id || ""), pin = String(body.pin || "");
    if (!validDocketId(id)) return docketJson({ error: "Bad id" }, 400);
    if (!validPin(pin)) return docketJson({ error: "Four numbers, please." }, 400);
    const p = await env.DB.prepare("SELECT initials FROM players WHERE id = ?").bind(id).first();
    if (!p) return docketJson({ error: "Sign your initials first." }, 400);
    const lock = await cabinetRow(env, p.initials);
    const now = new Date().toISOString();
    const salt = crypto.randomUUID();
    const hash = await sha256hex(`${salt}:${p.initials}:${pin}`);
    if (lock) {
      if (body.old === undefined) return docketJson({ error: `${p.initials} already has a PIN.`, locked: true }, 409);
      const c = await checkPin(env, lock, String(body.old));
      if (c !== "ok") return docketJson({ error: PIN_SAYS[c](), wrong: c === "wrong" }, c === "wait" ? 429 : 403);
      await env.DB.prepare("UPDATE cabinet SET pin_hash = ?, salt = ?, updated = ? WHERE initials = ?").bind(hash, salt, now, p.initials).run();
      return docketJson({ ok: true, initials: p.initials, locked: true, changed: true });
    }
    // INSERT OR IGNORE: two browsers locking the same initials at once, the first one wins
    const ins = await env.DB.prepare("INSERT OR IGNORE INTO cabinet (initials, pin_hash, salt, created, updated) VALUES (?, ?, ?, ?, ?)").bind(p.initials, hash, salt, now, now).run();
    if (!ins.meta?.changes) return docketJson({ error: `${p.initials} already has a PIN.`, locked: true }, 409);
    return docketJson({ ok: true, initials: p.initials, locked: true });
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
    // Locked initials need the PIN, unless this browser already holds them.
    const lock = await cabinetRow(env, initials);
    if (lock) {
      const held = await env.DB.prepare("SELECT initials FROM players WHERE id = ?").bind(id).first();
      if (!held || held.initials !== initials) {
        if (body.pin === undefined || body.pin === null || body.pin === "")
          return docketJson({ error: PIN_SAYS.need(initials), needPin: true, initials }, 403);
        const c = await checkPin(env, lock, String(body.pin));
        if (c !== "ok") return docketJson({ error: PIN_SAYS[c](), needPin: true, wrong: c === "wrong", initials }, c === "wait" ? 429 : 403);
      }
    }
    await env.DB.prepare(
      `INSERT INTO players (id, initials, created) VALUES (?, ?, datetime('now'))
       ON CONFLICT(id) DO UPDATE SET initials = excluded.initials`
    ).bind(id, initials).run();
    return docketJson({ ok: true, initials, locked: !!lock });
  }

  // POST /api/league/score { id, date, game, score, max, display, ms? }
  // ms: time taken, the tie-break (30 Sept 2026). Equal scores rank timed above
  // untimed, then fastest first, then whoever got there first.
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
    // A time is a real number of milliseconds under a day, or nothing.
    const msRaw = parseInt(body.ms, 10);
    const ms = Number.isFinite(msRaw) && msRaw > 0 && msRaw < 86400000 ? msRaw : null;
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
    // Equalling the best score can still be a record now: the fastest time at
    // that score, or the first time at all if nobody at that score was timed.
    let fastestAtBest = null;
    if (ms !== null && prior && prior.best !== null && score === prior.best) {
      const f = await env.DB.prepare(
        `SELECT MIN(s.ms) AS fastest
         FROM league_scores s JOIN players p ON p.id = s.id
         WHERE s.game = ? AND s.score = ? AND NOT (s.id = ? AND s.date = ?)`
      ).bind(game, score, id, date).first();
      fastestAtBest = f ? f.fastest : null;
    }
    const ins = await env.DB.prepare(
      `INSERT OR IGNORE INTO league_scores (id, date, game, score, max, display, ms, at)
       VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`
    ).bind(id, date, game, score, max, display, ms).run();
    const stored = !!(ins && ins.meta && ins.meta.changes);
    // The replay rides along with the score (6 Oct 2026) and is kept only when
    // the score is: the first score of the day is the one that can be watched.
    // A game's own JSON, opaque here, 32 KB at most. Never fails the score.
    if (stored && body.replay && typeof body.replay === "object") {
      try {
        const data = JSON.stringify(body.replay);
        if (data.length <= 32768)
          await env.DB.prepare(
            "INSERT OR IGNORE INTO league_replays (id, date, game, data, at) VALUES (?, ?, ?, ?, datetime('now'))"
          ).bind(id, date, game, data).run();
      } catch (e) {}
    }
    const beats = score > (prior?.best || 0) ||
      (ms !== null && score === prior?.best && (fastestAtBest === null || ms < fastestAtBest));
    const record = stored && score > 0 && (prior?.n || 0) >= RECORD_MIN_SCORES && beats;
    const p = await env.DB.prepare("SELECT initials FROM players WHERE id = ?").bind(id).first();
    // Not stored means an earlier score already holds this day: hand it back
    // so the bar can say which score counts (30 Sept 2026).
    let existing = null;
    if (!stored) {
      existing = await env.DB.prepare(
        "SELECT score, max, display FROM league_scores WHERE id = ? AND date = ? AND game = ?"
      ).bind(id, date, game).first();
    }
    return docketJson({ ok: true, initials: p ? p.initials : null, stored, record, existing });
  }

  // GET /api/league/me?id= → everything the "My stats" page needs (5 Oct 2026).
  // The player is whoever holds this id's initials: a person on two devices, or
  // before and after clearing a browser, ends up with several ids under the same
  // three letters, and their history should follow them. Each row carries the
  // day's position (same order as the today table) and how many were on it.
  // The page does the sums; this just hands over the rows.
  if (path === "/api/league/me" && request.method === "GET") {
    const id = url.searchParams.get("id") || "";
    if (!validDocketId(id)) return docketJson({ error: "Bad id" }, 400);
    const p = await env.DB.prepare("SELECT initials FROM players WHERE id = ?").bind(id).first();
    if (!p) return docketJson({ initials: null, rows: [], avg: {} });
    const { results: raw } = await env.DB.prepare(
      `WITH r AS (
         SELECT s.date AS d, s.game AS g, s.score AS s, s.max AS m, s.display AS disp,
                s.ms, s.at, s.rowid AS rid, pl.initials AS ini,
                ROW_NUMBER() OVER (PARTITION BY s.date, s.game
                  ORDER BY s.score DESC, (s.ms IS NULL) ASC, s.ms ASC, s.rowid ASC) AS rk,
                COUNT(*) OVER (PARTITION BY s.date, s.game) AS n
         FROM league_scores s JOIN players pl ON pl.id = s.id
       )
       SELECT d, g, s, m, disp, ms, at, rk, n, rid FROM r WHERE ini = ? ORDER BY d ASC, rid ASC`
    ).bind(p.initials).all();
    // Two of your ids on the same game on the same day: the first one filed counts.
    const seen = new Set();
    const rows = [];
    for (const r of raw || []) {
      const k = r.d + "|" + r.g;
      if (seen.has(k)) continue;
      seen.add(k);
      delete r.rid;
      rows.push(r);
    }
    const { results: av } = await env.DB.prepare(
      `SELECT s.game AS g, AVG(s.score) AS a, COUNT(*) AS n
       FROM league_scores s JOIN players pl ON pl.id = s.id GROUP BY s.game`
    ).all();
    const avg = {};
    for (const a of av || []) avg[a.g] = { a: Math.round(a.a * 10) / 10, n: a.n };
    return docketJson({ initials: p.initials, today, rows, avg });
  }

  // GET /api/league/replay?game=&date=&ini= → a score's replay, for the game's
  // watch mode (6 Oct 2026). The league names a score by its initials and day,
  // never by the anonymous id. Two ids under the same initials on the same day:
  // the higher score, which is the one the table shows.
  if (path === "/api/league/replay" && request.method === "GET") {
    const game = url.searchParams.get("game") || "";
    const date = url.searchParams.get("date") || "";
    const ini = String(url.searchParams.get("ini") || "").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 3);
    if (!DOCKET_GAMES.has(game)) return docketJson({ error: "Unknown game" }, 400);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return docketJson({ error: "Bad date" }, 400);
    if (ini.length !== 3) return docketJson({ error: "Bad initials" }, 400);
    const row = await env.DB.prepare(
      `SELECT s.score, s.display, s.ms, r.data
       FROM league_scores s JOIN players p ON p.id = s.id
       JOIN league_replays r ON r.id = s.id AND r.date = s.date AND r.game = s.game
       WHERE s.game = ? AND s.date = ? AND p.initials = ?
       ORDER BY s.score DESC, (s.ms IS NULL) ASC, s.ms ASC, s.rowid ASC LIMIT 1`
    ).bind(game, date, ini).first();
    if (!row) return docketJson({ error: "No replay for that score" }, 404);
    let replay = null;
    try { replay = JSON.parse(row.data); } catch (e) {}
    return docketJson({ game, date, initials: ini, score: row.score, display: row.display, ms: row.ms, replay });
  }

  // GET /api/league?date=&mode=today|all → the tables
  if (path === "/api/league" && request.method === "GET") {
    const mode = url.searchParams.get("mode") === "all" ? "all" : "today";
    const date = url.searchParams.get("date") || today;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return docketJson({ error: "Bad date" }, 400);

    let rows;
    if (mode === "today") {
      ({ results: rows } = await env.DB.prepare(
        `SELECT s.id, s.game, s.score, s.max, s.display, s.ms, s.at, p.initials,
                EXISTS (SELECT 1 FROM league_replays r
                        WHERE r.id = s.id AND r.date = s.date AND r.game = s.game) AS rp
         FROM league_scores s JOIN players p ON p.id = s.id
         WHERE s.date = ? ORDER BY s.score DESC, (s.ms IS NULL) ASC, s.ms ASC, s.rowid ASC`
      ).bind(date).all());
    } else {
      // All-time: the best scores ever per game, whoever set them. One person on a
      // roll can hold every row, and a tie goes to whoever got there first (29 Sept
      // 2026; was one row per player). Ten per game is all the table shows.
      // Since 30 Sept 2026 time breaks a tie before the date does: timed above
      // untimed, fastest first (so 24/24 with no time sits below 24/24 with one).
      ({ results: rows } = await env.DB.prepare(
        `SELECT s.game, s.score, s.max, s.display, s.ms, p.initials, s.date,
                EXISTS (SELECT 1 FROM league_replays r
                        WHERE r.id = s.id AND r.date = s.date AND r.game = s.game) AS rp
         FROM league_scores s JOIN players p ON p.id = s.id
         WHERE s.score > 0 AND s.rowid IN (
           SELECT rowid FROM (
             SELECT rowid, ROW_NUMBER() OVER (
               PARTITION BY game ORDER BY score DESC, (ms IS NULL) ASC, ms ASC, date ASC, rowid ASC
             ) AS rn
             FROM league_scores
           ) WHERE rn <= 10
         )
         ORDER BY s.score DESC, (s.ms IS NULL) ASC, s.ms ASC, s.date ASC, s.rowid ASC`
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
          score: r.score, max: r.max, display: r.display, ms: r.ms, rank: ranks[r.game],
        };
      if (games[r.game].length < 10)
        games[r.game].push({
          initials: r.initials,
          score: r.score,
          max: r.max,
          display: r.display,
          ms: r.ms,
          // a replay to watch (6 Oct 2026): ?watch= on the game, see /api/league/replay
          ...(r.rp ? { replay: 1 } : {}),
          ...(mode === "all" ? { date: r.date } : { at: r.at || null }),
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

// ─── Filing Claude-written grids ────────────────────────────────────────────
// Since 23 Oct 2026 nothing here calls the Anthropic API. Today the Claude
// scheduled task "Groupie weekly grids" (Wednesdays, Carl's subscription)
// writes finished grids straight into `days`, so this path is idle. It is
// kept so a task CAN hand grids in for machine-checking instead: it sets
// candidate grids, has each one
// fact-checked by a separate pass (the old VERIFY_PROMPT in generate.js),
// and writes the survivors into the `pending` table:
//   pending(id, date, candidate JSON, status new|filed|rejected|skipped,
//           reason, created_at, filed_at)
// `candidate` has the same shape the old setter call returned, plus
// "verified": true once the fact-check passed:
//   { "groups": [...4...], "wordplay": {...}, "trap": "...", "verified": true }
// Every morning the cron files them, running EXACTLY the same machine checks
// the old generator ran (validateDay in generate.js) against the live
// category list and recent grids. The first candidate for a date that passes
// is published; later ones for that date are marked skipped.

const MAX_FILE_PER_RUN = 12;

async function filePending(env, today) {
  const filed = [];
  const rejected = [];

  const { results } = await env.DB.prepare(
    "SELECT id, date, candidate FROM pending WHERE status = 'new' ORDER BY date, id"
  ).all();
  if (!results || !results.length) return { filed, rejected };

  const usedCategories = await loadUsedCategories(env);
  const recentGroups = await loadRecentGroups(env);
  const { results: dayRows } = await env.DB.prepare("SELECT date FROM days WHERE date >= ?")
    .bind(today)
    .all();
  const existing = new Set((dayRows || []).map((r) => r.date));

  const mark = (id, status, reason = null) =>
    env.DB.prepare(
      "UPDATE pending SET status = ?, reason = ?, filed_at = datetime('now') WHERE id = ?"
    ).bind(status, reason, id).run();

  for (const row of results) {
    if (row.date < today) {
      await mark(row.id, "skipped", "date already passed");
      continue;
    }
    if (existing.has(row.date)) {
      await mark(row.id, "skipped", "date already has a grid");
      continue;
    }
    if (filed.length >= MAX_FILE_PER_RUN) break; // next morning picks up the rest

    let parsed;
    try {
      parsed = JSON.parse(row.candidate);
    } catch {
      rejected.push({ date: row.date, reason: "candidate is not valid JSON" });
      await mark(row.id, "rejected", "candidate is not valid JSON");
      continue;
    }

    let problem = parsed && parsed.verified === true ? null : "not marked as fact-checked (verified: true)";
    if (!problem) problem = validateDay(parsed, usedCategories, recentGroups);
    if (problem) {
      rejected.push({ date: row.date, reason: problem });
      await mark(row.id, "rejected", problem);
      continue;
    }

    // Normalise exactly as the old generator did: order by difficulty, tidy
    // whitespace, uppercase tiles.
    const groups = [...parsed.groups]
      .sort((a, b) => a.difficulty - b.difficulty)
      .map((g) => ({
        name: g.name.trim(),
        difficulty: g.difficulty,
        words: g.words.map((w) => w.trim().toUpperCase()),
      }));
    const payload = { groups, trap: (parsed.trap || "").trim() };
    const categories = groups.map((g) => g.name.toLowerCase());

    try {
      await env.DB.batch([
        env.DB.prepare("INSERT INTO days (date, payload) VALUES (?, ?)").bind(
          row.date,
          JSON.stringify(payload)
        ),
        ...categories.map((c) =>
          env.DB.prepare("INSERT OR IGNORE INTO categories (name, date) VALUES (?, ?)").bind(c, row.date)
        ),
        env.DB.prepare(
          "UPDATE pending SET status = 'filed', reason = NULL, filed_at = datetime('now') WHERE id = ?"
        ).bind(row.id),
      ]);
    } catch (err) {
      rejected.push({ date: row.date, reason: `DB write failed: ${err.message}` });
      await mark(row.id, "rejected", `DB write failed: ${err.message}`);
      continue;
    }
    for (const c of categories) usedCategories.add(c);
    for (const g of groups) {
      const set = new Set(g.words);
      set.fresh = true; // filed this run: checkLabels treats it as recent
      recentGroups.push(set);
    }
    existing.add(row.date);
    filed.push(row.date);
  }

  return { filed, rejected };
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

// Cron entry: housekeeping, then file whatever the weekly top-up left in
// `pending`. Email only when the queue is low or candidates were turned away.
const LOW_WATER = 7;

async function queueDepth(env) {
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS queued, MAX(date) AS through FROM days WHERE date >= ?"
  )
    .bind(todayISO())
    .first();
  return { queued: row?.queued || 0, through: row?.through || null };
}

async function runScheduled(env) {
  // Prune docket rows older than a fortnight — the bar only ever asks about
  // today, so old rows are pure dead weight.
  await env.DB.prepare("DELETE FROM docket WHERE date < ?")
    .bind(addDays(todayISO(), -14)).run()
    .catch((err) => console.error("Docket prune failed:", err));
  // Visits keep two months, so a Friday can be compared with the ones before.
  await env.DB.prepare("DELETE FROM visits WHERE date < ?")
    .bind(addDays(todayISO(), -60)).run()
    .catch((err) => console.error("Visits prune failed:", err));

  const report = await filePending(env, todayISO());
  const after = await queueDepth(env);
  console.log(
    `Filing: filed ${report.filed.length}, rejected ${report.rejected.length}, queue now ${after.queued}`,
    report.rejected
  );

  if (after.queued < LOW_WATER) {
    await sendLowQueueAlert(env, after.queued, after.through, report.rejected).catch((err) =>
      console.error("Low-queue alert failed:", err)
    );
  } else if (report.rejected.length) {
    await sendRejectedNote(env, report.filed.length, after.queued, after.through, report.rejected).catch((err) =>
      console.error("Rejected note failed:", err)
    );
  }
}

async function sendRejectedNote(env, filed, queued, through, rejected) {
  if (!env.RESEND_API_KEY || !env.ALERT_EMAIL) return;
  const reasons = rejected.slice(0, 8).map((r) => `${r.date}: ${r.reason}`).join("<br>");
  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "Groupie <hello@pubquizdaily.com>",
      to: [env.ALERT_EMAIL],
      subject: `Groupie turned away ${rejected.length} grid${rejected.length === 1 ? "" : "s"} from the weekly top-up`,
      html: `<p>No urgent action: this morning filed ${filed} grid${filed === 1 ? "" : "s"} and the
        queue holds <strong>${queued} day${queued === 1 ? "" : "s"}</strong> (through ${through || "—"}).
        Some candidates failed the machine checks and were skipped; the next weekly top-up fills the gaps.</p>
        <p>Rejected:<br>${reasons}</p>`,
    }),
  });
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
      html: `<p>The grid queue is down to <strong>${queued} day${
        queued === 1 ? "" : "s"
      }</strong> (through ${through || "—"}).</p>
        <p>Grids are written by the Claude scheduled task "Groupie weekly grids" (Wednesdays),
        so it has probably not run: check it ran, or run it by hand.</p>
        <p>Rejected candidates this morning:<br>${reasons}</p>`,
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
