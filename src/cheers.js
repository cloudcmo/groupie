// src/cheers.js — cheers on league scores (27 Oct 2026).
//
// Carl: players of the Guff games should feel part of a small, friendly,
// low-demand community. So anyone on the league can cheer anyone else's score
// (today's tables, the Hall of Fame, a player's page) with an emoji: a default
// set of positive ones, or any emoji they like. Who cheered is shown. No
// comments. Carl can delete a cheer or ban a set of initials from cheering.
//
// A score is named the way the league names it in public: game, date and the
// player's initials (never the anonymous id). A cheer comes from initials too,
// so it follows the player across their devices.
//
// Tables (created here on first use; see migrations/2026-10-27-league-cheers.sql):
//   league_cheers      one row per (score, cheerer, emoji)
//   league_cheer_seen  when a player last saw the "you've been cheered" news
//   league_banned      initials that may not cheer; their cheers are hidden
//
// GuffBot salutes every all-time record and every maximum score himself
// (from_ini GUFFBOT, emoji "guffbot"), so the feature is alive from day one.
// His salutes never count as "you've been cheered" news.

export const GUFFBOT = "GUFFBOT";
const MAX_EMOJI_PER_SCORE = 3;      // different emoji one player can put on one score
const MAX_CHEERS_PER_DAY = 300;     // per cheering player, a spam backstop
const NEWS_DAYS = 7;                // news goes stale after a week

let ready = false;
export async function ensureCheers(env) {
  if (ready) return;
  await env.DB.batch([
    env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS league_cheers (
         game TEXT NOT NULL, date TEXT NOT NULL, to_ini TEXT NOT NULL,
         from_ini TEXT NOT NULL, from_id TEXT, emoji TEXT NOT NULL, at TEXT NOT NULL,
         off INTEGER NOT NULL DEFAULT 0,
         PRIMARY KEY (game, date, to_ini, from_ini, emoji))`
    ),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_cheers_date ON league_cheers(date, game)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_cheers_to ON league_cheers(to_ini, at)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_cheers_from ON league_cheers(from_ini, at)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS league_cheer_seen (initials TEXT PRIMARY KEY, at TEXT NOT NULL)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS league_banned (initials TEXT PRIMARY KEY, at TEXT NOT NULL, note TEXT)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS league_banned_ids (id TEXT PRIMARY KEY, initials TEXT, at TEXT NOT NULL)"),
  ]);
  ready = true;
}

const iniOf = (v) => String(v || "").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 3);
// A cheer that was taken back keeps its row with off = 1 (so cheer, untick, cheer again
// can't spam the player with news or dodge the daily limit); every read skips it.
const NOT_BANNED = "off = 0 AND from_ini NOT IN (SELECT initials FROM league_banned)";

// One emoji, any emoji: a single grapheme that is a pictograph, a flag or a
// keycap, with no letters or digits of its own. "guffbot" is GuffBot's head.
export function cleanEmoji(raw) {
  const e = String(raw || "").trim();
  if (e === "guffbot") return e;
  if (!e || e.length > 32) return null;
  const bare = e.replace(/[0-9#*]️?⃣/gu, "");
  if (/[\p{L}\p{N}\s<>&"'`\\]/u.test(bare)) return null;
  // No stacked accent marks (they draw tall garbage); only the emoji variation selectors.
  if (/\p{M}/u.test(bare.replace(/[\uFE0E\uFE0F]/g, ""))) return null;
  if (!/\p{Extended_Pictographic}|\p{Regional_Indicator}|⃣/u.test(e)) return null;
  try {
    const n = [...new Intl.Segmenter("en", { granularity: "grapheme" }).segment(e)].length;
    if (n !== 1) return null;
  } catch (err) { /* no Segmenter: the checks above will do */ }
  return e;
}

// Group raw cheer rows into { "game|date|INI": [{ e, by: [INI, ...] }, ...] },
// each emoji in the order it first arrived, cheerers in the order they cheered.
function group(rows) {
  const out = {};
  for (const r of rows || []) {
    const k = r.game + "|" + r.date + "|" + r.to_ini;
    const list = (out[k] = out[k] || []);
    let slot = list.find((x) => x.e === r.emoji);
    if (!slot) list.push((slot = { e: r.emoji, by: [] }));
    if (!slot.by.includes(r.from_ini)) slot.by.push(r.from_ini);
  }
  return out;
}

// Cheers for the rows of a league response, folded in as `ch` on each row.
// Today: one day's cheers. All-time: every cheer since the oldest row shown.
export async function attachCheers(env, mode, date, games) {
  try {
    // No table yet (before the first cheer is ever given) just means no cheers.
    let rows;
    if (mode === "today") {
      ({ results: rows } = await env.DB.prepare(
        `SELECT game, date, to_ini, from_ini, emoji FROM league_cheers
         WHERE date = ? AND ${NOT_BANNED} ORDER BY at ASC`
      ).bind(date).all());
    } else {
      // Only the days on the boards, so the read stays the size of the Hall of Fame,
      // not the whole history (one bound parameter, whatever the number of days).
      const days = new Set();
      for (const g in games) for (const r of games[g]) if (r.date) days.add(r.date);
      if (!days.size) return;
      ({ results: rows } = await env.DB.prepare(
        `SELECT game, date, to_ini, from_ini, emoji FROM league_cheers
         WHERE date IN (SELECT value FROM json_each(?)) AND ${NOT_BANNED} ORDER BY at ASC`
      ).bind(JSON.stringify([...days])).all());
    }
    const map = group(rows);
    for (const g in games) {
      for (const r of games[g]) {
        const ch = map[g + "|" + (r.date || date) + "|" + r.initials];
        if (ch && ch.length) r.ch = ch;
      }
    }
  } catch (e) {
    // Cheers never cost the league its tables.
    console.error("attachCheers failed:", e);
  }
}

// Every cheer a player has been given, newest first (the player page).
export async function cheersReceived(env, ini) {
  try {
    const { results } = await env.DB.prepare(
      `SELECT game AS g, date AS d, from_ini AS f, emoji AS e, at FROM league_cheers
       WHERE to_ini = ? AND ${NOT_BANNED} ORDER BY at DESC LIMIT 1500`
    ).bind(ini).all();
    return results || [];
  } catch (e) {
    return [];
  }
}

// "You've been cheered": cheers since the player last saw the news (a week at most),
// GuffBot's own salutes left out, grouped per score.
export async function cheersNews(env, ini) {
  await ensureCheers(env);
  const seen = await env.DB.prepare("SELECT at FROM league_cheer_seen WHERE initials = ?").bind(ini).first();
  const floor = new Date(Date.now() - NEWS_DAYS * 864e5).toISOString();
  const since = seen && seen.at > floor ? seen.at : floor;
  const { results } = await env.DB.prepare(
    `SELECT c.game, c.date, c.to_ini, c.from_ini, c.emoji, c.at,
       (SELECT s.display FROM league_scores s JOIN players p ON p.id = s.id
        WHERE s.game = c.game AND s.date = c.date AND p.initials = c.to_ini
        ORDER BY s.score DESC LIMIT 1) AS disp
     FROM league_cheers c
     WHERE c.to_ini = ? AND c.from_ini <> ? AND c.at > ? AND c.${NOT_BANNED}
     ORDER BY c.at ASC LIMIT 60`
  ).bind(ini, GUFFBOT, since).all();
  const items = [];
  let upto = null;
  for (const r of results || []) {
    let it = items.find((x) => x.g === r.game && x.d === r.date);
    if (!it) items.push((it = { g: r.game, d: r.date, disp: r.disp || "", by: [], e: [] }));
    if (!it.by.includes(r.from_ini)) it.by.push(r.from_ini);
    if (!it.e.includes(r.emoji)) it.e.push(r.emoji);
    upto = r.at;
  }
  // Most recent score first: that's the one to talk about.
  items.reverse();
  return { initials: ini, items, upto };
}

// GuffBot's salute, when a score is filed that is an all-time record or a maximum.
export async function guffbotSalute(env, game, date, ini) {
  try {
    await ensureCheers(env);
    await env.DB.prepare(
      `INSERT OR IGNORE INTO league_cheers (game, date, to_ini, from_ini, from_id, emoji, at)
       VALUES (?, ?, ?, ?, NULL, 'guffbot', ?)`
    ).bind(game, date, ini, GUFFBOT, new Date().toISOString()).run();
  } catch (e) {
    console.error("guffbotSalute failed:", e);
  }
}

async function scoreCheers(env, game, date, to) {
  const { results } = await env.DB.prepare(
    `SELECT game, date, to_ini, from_ini, emoji FROM league_cheers
     WHERE game = ? AND date = ? AND to_ini = ? AND ${NOT_BANNED} ORDER BY at ASC`
  ).bind(game, date, to).all();
  return group(results)[game + "|" + date + "|" + to] || [];
}

function adminOk(request, env) {
  const auth = request.headers.get("Authorization") || "";
  return !!env.ADMIN_TOKEN && auth === `Bearer ${env.ADMIN_TOKEN}`;
}

// The routes. h: { json, validId, games, today } from index.js.
// Returns a Response, or null when the path isn't a cheers path.
export async function serveCheers(url, request, env, path, h) {
  const { json, validId, games } = h;

  // POST /api/league/cheer { id, game, date, to, emoji, on } → { ok, cheers }
  // on: true adds (the default), false takes it back.
  if (path === "/api/league/cheer" && request.method === "POST") {
    await ensureCheers(env);
    let body = {};
    try { body = await request.json(); } catch { return json({ error: "Invalid request" }, 400); }
    const id = String(body.id || "");
    const game = String(body.game || "");
    const date = String(body.date || "");
    const to = iniOf(body.to);
    const emoji = cleanEmoji(body.emoji);
    const on = body.on !== false;
    if (!validId(id)) return json({ error: "Bad id" }, 400);
    if (!games.has(game)) return json({ error: "Unknown game" }, 400);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return json({ error: "Bad date" }, 400);
    if (to.length !== 3) return json({ error: "Bad initials" }, 400);
    if (!emoji) return json({ error: "One emoji, please." }, 400);
    if (emoji === "guffbot" && on) return json({ error: "Only GuffBot can give a GuffBot salute." }, 400);
    const p = await env.DB.prepare("SELECT initials FROM players WHERE id = ?").bind(id).first();
    if (!p) return json({ error: "Add your initials to cheer.", needInitials: true }, 403);
    const from = p.initials;
    if (from === to) return json({ error: "That's your own score. GuffBot is cheering it for you." }, 400);
    const banned = await env.DB.prepare(
      "SELECT 1 AS b FROM league_banned WHERE initials = ? UNION ALL SELECT 1 FROM league_banned_ids WHERE id = ? LIMIT 1"
    ).bind(from, id).first();
    if (banned) return json({ error: "Cheering is switched off for " + from + "." }, 403);
    const target = await env.DB.prepare(
      `SELECT 1 AS k FROM league_scores s JOIN players pl ON pl.id = s.id
       WHERE s.game = ? AND s.date = ? AND pl.initials = ? LIMIT 1`
    ).bind(game, date, to).first();
    if (!target) return json({ error: "No such score." }, 404);
    if (!on) {
      await env.DB.prepare(
        "UPDATE league_cheers SET off = 1 WHERE game = ? AND date = ? AND to_ini = ? AND from_ini = ? AND emoji = ?"
      ).bind(game, date, to, from, emoji).run();
    } else {
      const { results: mine } = await env.DB.prepare(
        "SELECT emoji FROM league_cheers WHERE game = ? AND date = ? AND to_ini = ? AND from_ini = ? AND off = 0"
      ).bind(game, date, to, from).all();
      const have = (mine || []).map((r) => r.emoji);
      if (!have.includes(emoji)) {
        if (have.length >= MAX_EMOJI_PER_SCORE)
          return json({ error: "Three cheers per score is plenty.", cheers: await scoreCheers(env, game, date, to) }, 429);
        const dayAgo = new Date(Date.now() - 864e5).toISOString();
        const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM league_cheers WHERE from_ini = ? AND at > ?").bind(from, dayAgo).first();
        if ((n?.n || 0) >= MAX_CHEERS_PER_DAY) return json({ error: "That's a lot of cheering for one day. Back tomorrow." }, 429);
        // Back on after being taken back: same row, same time, so it isn't news twice.
        await env.DB.prepare(
          `INSERT INTO league_cheers (game, date, to_ini, from_ini, from_id, emoji, at, off)
           VALUES (?, ?, ?, ?, ?, ?, ?, 0)
           ON CONFLICT (game, date, to_ini, from_ini, emoji) DO UPDATE SET off = 0`
        ).bind(game, date, to, from, id, emoji, new Date().toISOString()).run();
      }
    }
    return json({ ok: true, from, cheers: await scoreCheers(env, game, date, to) });
  }

  // GET /api/league/cheers/news?id= → { initials, items: [{ g, d, disp, by, e }], upto }
  // Read-only: the page that shows the news says so with /cheers/seen.
  if (path === "/api/league/cheers/news" && request.method === "GET") {
    const id = url.searchParams.get("id") || "";
    if (!validId(id)) return json({ error: "Bad id" }, 400);
    const p = await env.DB.prepare("SELECT initials FROM players WHERE id = ?").bind(id).first();
    if (!p) return json({ initials: null, items: [], upto: null });
    return json(await cheersNews(env, p.initials));
  }

  // POST /api/league/cheers/seen { id, upto } → the news up to that moment has been shown
  if (path === "/api/league/cheers/seen" && request.method === "POST") {
    await ensureCheers(env);
    let body = {};
    try { body = await request.json(); } catch { return json({ error: "Invalid request" }, 400); }
    const id = String(body.id || "");
    const upto = String(body.upto || "");
    if (!validId(id)) return json({ error: "Bad id" }, 400);
    if (!/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(upto)) return json({ error: "Bad time" }, 400);
    const p = await env.DB.prepare("SELECT initials FROM players WHERE id = ?").bind(id).first();
    if (!p) return json({ ok: true });
    await env.DB.prepare(
      `INSERT INTO league_cheer_seen (initials, at) VALUES (?, ?)
       ON CONFLICT(initials) DO UPDATE SET at = MAX(league_cheer_seen.at, excluded.at)`
    ).bind(p.initials, upto).run();
    return json({ ok: true });
  }

  // GET /api/league/cheered?from=&to=&n=3 → the most cheered scores between two dates
  // (people first, then cheers), GuffBot's salutes not counted. For the Friday email.
  if (path === "/api/league/cheered" && request.method === "GET") {
    await ensureCheers(env);
    const from = url.searchParams.get("from") || "";
    const to = url.searchParams.get("to") || "";
    const n = Math.max(1, Math.min(10, parseInt(url.searchParams.get("n"), 10) || 3));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return json({ error: "Bad dates" }, 400);
    const { results } = await env.DB.prepare(
      `SELECT c.game AS g, c.date AS d, c.to_ini AS ini, COUNT(*) AS n, COUNT(DISTINCT c.from_ini) AS people,
         GROUP_CONCAT(DISTINCT c.emoji) AS emoji,
         (SELECT s.display FROM league_scores s JOIN players p ON p.id = s.id
          WHERE s.game = c.game AND s.date = c.date AND p.initials = c.to_ini
          ORDER BY s.score DESC LIMIT 1) AS disp
       FROM league_cheers c
       WHERE c.date >= ? AND c.date <= ? AND c.from_ini <> ? AND c.${NOT_BANNED}
       GROUP BY c.game, c.date, c.to_ini
       ORDER BY people DESC, n DESC, MIN(c.at) ASC LIMIT ?`
    ).bind(from, to, GUFFBOT, n).all();
    const top = (results || []).map((r) => ({ ...r, emoji: String(r.emoji || "").split(",").filter(Boolean) }));
    return new Response(JSON.stringify({ from, to, top }), {
      headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=300", "Access-Control-Allow-Origin": "*" },
    });
  }

  // Carl's controls (Authorization: Bearer ADMIN_TOKEN), used by league.carlosfandango.net/cheers-admin
  //   GET  /api/league/cheers/admin?days=14 → { cheers, banned }
  //   POST /api/league/cheers/admin { action: "delete", game, date, to, from, emoji? }
  //                                 { action: "ban", initials, note?, purge? }   purge: delete all their cheers too
  //                                 { action: "unban", initials }
  if (path === "/api/league/cheers/admin") {
    if (!adminOk(request, env)) return json({ error: "Unauthorized" }, 401);
    await ensureCheers(env);
    if (request.method === "GET") {
      const days = Math.max(1, Math.min(365, parseInt(url.searchParams.get("days"), 10) || 14));
      const since = new Date(Date.now() - days * 864e5).toISOString();
      const { results: cheers } = await env.DB.prepare(
        `SELECT game, date, to_ini, from_ini, emoji, at, substr(from_id, 1, 8) AS from_id FROM league_cheers
         WHERE at > ? AND from_ini <> ? AND off = 0 ORDER BY at DESC LIMIT 2000`
      ).bind(since, GUFFBOT).all();
      const { results: banned } = await env.DB.prepare("SELECT initials, at, note FROM league_banned ORDER BY at DESC").all();
      return json({ days, cheers: cheers || [], banned: banned || [] });
    }
    if (request.method === "POST") {
      let body = {};
      try { body = await request.json(); } catch { return json({ error: "Invalid request" }, 400); }
      const action = String(body.action || "");
      if (action === "delete") {
        const game = String(body.game || ""), date = String(body.date || "");
        const to = iniOf(body.to), from = String(body.from || "").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 7);
        if (!games.has(game) || !/^\d{4}-\d{2}-\d{2}$/.test(date) || to.length !== 3 || !from) return json({ error: "Bad cheer" }, 400);
        const r = body.emoji
          ? await env.DB.prepare("DELETE FROM league_cheers WHERE game = ? AND date = ? AND to_ini = ? AND from_ini = ? AND emoji = ?")
              .bind(game, date, to, from, String(body.emoji)).run()
          : await env.DB.prepare("DELETE FROM league_cheers WHERE game = ? AND date = ? AND to_ini = ? AND from_ini = ?")
              .bind(game, date, to, from).run();
        return json({ ok: true, deleted: r.meta?.changes || 0 });
      }
      if (action === "ban" || action === "unban") {
        const ini = iniOf(body.initials);
        if (ini.length !== 3) return json({ error: "Bad initials" }, 400);
        if (action === "unban") {
          await env.DB.batch([
            env.DB.prepare("DELETE FROM league_banned WHERE initials = ?").bind(ini),
            env.DB.prepare("DELETE FROM league_banned_ids WHERE initials = ?").bind(ini),
          ]);
          return json({ ok: true });
        }
        const now = new Date().toISOString();
        await env.DB.prepare(
          "INSERT INTO league_banned (initials, at, note) VALUES (?, ?, ?) ON CONFLICT(initials) DO UPDATE SET note = excluded.note"
        ).bind(ini, now, String(body.note || "").slice(0, 200)).run();
        // The browsers that cheered as them are banned too, so picking new initials doesn't get round it.
        await env.DB.prepare(
          `INSERT OR IGNORE INTO league_banned_ids (id, initials, at)
           SELECT DISTINCT from_id, ?, ? FROM league_cheers WHERE from_ini = ? AND from_id IS NOT NULL`
        ).bind(ini, now, ini).run();
        let purged = 0;
        if (body.purge) {
          const r = await env.DB.prepare("DELETE FROM league_cheers WHERE from_ini = ?").bind(ini).run();
          purged = r.meta?.changes || 0;
        }
        return json({ ok: true, purged });
      }
      return json({ error: "Unknown action" }, 400);
    }
  }

  return null;
}
