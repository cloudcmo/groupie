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

  await env.DB.prepare(
    `INSERT INTO plays (date, total, wins, mistakes_sum) VALUES (?, 1, ?, ?)
     ON CONFLICT(date) DO UPDATE SET
       total = total + 1,
       wins = wins + excluded.wins,
       mistakes_sum = mistakes_sum + excluded.mistakes_sum`
  ).bind(date, won, mistakes).run();

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
    "SELECT total, wins, mistakes_sum FROM plays WHERE date = ?"
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

  const report = await fillRange(env, todayISO(), days);
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

// ─── Generation plumbing ────────────────────────────────────────────────────

// Fill every missing date in [start, start + days). Rejected days are
// skipped, not retried — run again to fill the gaps.
async function fillRange(env, start, days) {
  const written = [];
  const rejected = [];

  const usedCategories = await loadUsedCategories(env);

  for (let i = 0; i < days; i++) {
    const date = addDays(start, i);
    const exists = await env.DB.prepare("SELECT 1 FROM days WHERE date = ?")
      .bind(date)
      .first();
    if (exists) continue;

    const result = await generateDay(env, date, usedCategories);
    if (!result.ok) {
      rejected.push({ date, reason: result.reason });
      continue;
    }

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
    written.push(date);
  }

  return { written, rejected };
}

// Cron entry: make sure there are `target` days queued from today,
// then email an alert if the queue is still worryingly low.
const LOW_WATER = 7;

async function runScheduled(env, target) {
  const report = await fillRange(env, todayISO(), target);
  console.log(
    `Top-up: wrote ${report.written.length}, rejected ${report.rejected.length}`,
    report.rejected
  );

  const today = todayISO();
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS queued, MAX(date) AS through FROM days WHERE date >= ?"
  )
    .bind(today)
    .first();
  const queued = row?.queued || 0;

  if (queued < LOW_WATER) {
    await sendLowQueueAlert(env, queued, row?.through, report.rejected).catch((err) =>
      console.error("Low-queue alert failed:", err)
    );
  }
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
  const { results } = await env.DB.prepare("SELECT name FROM categories").all();
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
