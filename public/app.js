/* Groupie — front end. One small state machine, no dependencies.
   Sixteen tiles, four groups of four, three lives, British red herrings. */

(() => {
  "use strict";

  const LIVES = 4;

  // Difficulty levels, easiest to hardest. Index = difficulty.
  // Colours run orange → lime → turquoise → red (deliberately not the
  // NYT sequence), and the share emojis match.
  const TIER = ["level 1", "level 2", "level 3", "level 4"];
  const EMOJI = ["🟧", "🟩", "🟦", "🟥"];

  // Arcade verdicts, indexed by mistakes made on a win.
  function verdictFor(won, mistakes) {
    if (!won) return "Game over";
    return ["Perfect run", "Sharp shooting", "Narrow escape", "Last life"][
      Math.min(mistakes, 3)
    ];
  }

  // ── Solve-order score ────────────────────────────────────────────────────
  // A correctly fired group banks its level (1–4) times a boldness weight:
  // your first fire ×3, second ×2, third ×1. The final fire is a freebie —
  // twelve tiles gone, the last four pick themselves — so it scores nothing.
  // Leaving LEVEL 1 as that freebie means you actively fired all three hard
  // groups: that's the clean sweep, worth a 4-point bonus. So the perfect
  // game — 4, 3, 2, then the easy one on the house — is 12 + 6 + 2 + 4 =
  // the full 24 (one point per possible firing order, pleasingly). The safe
  // easiest-first route banks 10. Lives punish wrong guesses; the score
  // only ever rewards boldness of order.

  const SCORE_MAX = 24;
  const WEIGHTS = [3, 2, 1];
  const SWEEP_BONUS = 4;

  function firedOrderFromRows(rows) {
    // A guess row where all four owners match was a correct fire.
    return (rows || [])
      .filter((r) => r.length === 4 && r.every((gi) => gi === r[0]))
      .map((r) => r[0]);
  }

  function scoreFromRows(rows) {
    const fired = firedOrderFromRows(rows);
    const base = fired
      .slice(0, 3)
      .reduce((s, gi, idx) => s + (day.groups[gi].difficulty + 1) * WEIGHTS[idx], 0);
    const sweep =
      fired.length === 4 && day.groups[fired[3]].difficulty === 0 ? SWEEP_BONUS : 0;
    return base + sweep;
  }

  function runningScore() {
    return solved
      .filter((gi) => !revealed.has(gi))
      .slice(0, 3)
      .reduce((s, gi, idx) => s + (day.groups[gi].difficulty + 1) * WEIGHTS[idx], 0);
  }

  // Built-in specimen grid, so the file plays when opened directly
  // (design work, or the API being unreachable). Never served as a real day.
  const BUILTIN_DAY = {
    date: "0000-00-00",
    number: 0,
    builtin: true,
    groups: [
      { name: "Ways to say tea", difficulty: 0, words: ["BREW", "CUPPA", "CHAR", "ROSIE LEE"] },
      { name: "Beatles", difficulty: 1, words: ["JOHN", "PAUL", "RINGO", "STUART"] },
      { name: "Kings of England", difficulty: 2, words: ["GEORGE", "HENRY", "EDWARD", "STEPHEN"] },
      { name: "___ DAY", difficulty: 3, words: ["BOXING", "PANCAKE", "SPORTS", "WEDDING"] },
    ],
    trap: "GEORGE reads as the fourth Beatle but is filed under kings — and JOHN was a king too.",
  };

  // ── State ────────────────────────────────────────────────────────────────

  const app = document.getElementById("app");
  const issueLine = document.getElementById("issue-line");
  const toastEl = document.getElementById("toast");

  let day = null;         // current puzzle payload
  let mode = "daily";     // daily | archive | builtin

  let tiles = [];         // words still on the grid, in display order
  let selected = new Set();
  let solved = [];        // group indices, in solve order
  let lives = LIVES;
  let guesses = [];       // arrays of group indices (one per word), for the share grid
  let guessKeys = new Set(); // to catch repeat guesses
  let finished = false;
  let revealed = new Set(); // groups shown after a loss, as opposed to earned
  let toastTimer = null;

  // ── Storage ──────────────────────────────────────────────────────────────

  const store = {
    read() {
      try { return JSON.parse(localStorage.getItem("groupie") || "{}"); }
      catch { return {}; }
    },
    write(data) {
      try { localStorage.setItem("groupie", JSON.stringify(data)); } catch {}
    },
  };

  function recordResult(date, won, mistakes, rows, score) {
    const data = store.read();
    data.results = data.results || {};
    if (data.results[date]) return data; // already recorded — don't double-count
    data.results[date] = { won, mistakes, rows, score };

    data.played = (data.played || 0) + 1;
    if (won) data.wins = (data.wins || 0) + 1;
    data.bestScore = Math.max(data.bestScore || 0, score || 0);

    if (mode === "daily") {
      // Streak: consecutive played days ending today. Missing a day breaks
      // it; back grids don't repair it.
      const yesterday = addDaysISO(date, -1);
      if (data.lastDaily === yesterday) data.streak = (data.streak || 0) + 1;
      else data.streak = 1;
      data.lastDaily = date;
      data.maxStreak = Math.max(data.maxStreak || 0, data.streak);
    }
    if (data.state) delete data.state[date];
    store.write(data);
    reportPlay(date, won, mistakes, score); // first completion of this grid only
    return data;
  }

  // Tell the server one more player finished this grid. Aggregate count only,
  // fire-and-forget: a failure must never affect the player.
  function reportPlay(date, won, mistakes, score) {
    if (mode === "builtin") return;
    try {
      fetch("/api/played", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date, won, mistakes, score }),
        keepalive: true,
      }).catch(() => {});
    } catch { /* ignore */ }
  }

  function saveProgress() {
    if (mode === "builtin" || finished || !day) return;
    const data = store.read();
    data.state = data.state || {};
    data.state[day.date] = { tiles, solved, lives, guesses };
    store.write(data);
  }

  function loadProgress(date) {
    const data = store.read();
    return (data.state && data.state[date]) || null;
  }

  // ── Fetch ────────────────────────────────────────────────────────────────

  async function fetchJSON(url) {
    const res = await fetch(url);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }

  async function loadDaily(date) {
    mode = date ? "archive" : "daily";
    try {
      const q = date ? `?date=${date}` : "";
      day = await fetchJSON(`/api/puzzle${q}`);
      if (mode === "archive" && day.isToday) mode = "daily";
    } catch (err) {
      // Opened as a plain file, or the API is unreachable: play the
      // built-in specimen grid. A real API error (e.g. missing date)
      // is shown as an error.
      const network = err instanceof TypeError;
      if (!date && (location.protocol === "file:" || network)) {
        day = BUILTIN_DAY;
        mode = "builtin";
      } else {
        return renderError(err.message);
      }
    }
    startRound();
  }

  // ── Round flow ───────────────────────────────────────────────────────────

  function startRound() {
    updateIssueLine();

    const prior = mode !== "builtin" ? (store.read().results || {})[day.date] : null;
    if (prior) {
      // Already played this grid — show the completed board and results,
      // with bands in the order they were actually fired (so the score
      // chips replay honestly). Groups never fired were revealed.
      const fired = firedOrderFromRows(prior.rows || []);
      const rest = allGroupIndicesInDifficultyOrder().filter((gi) => !fired.includes(gi));
      solved = [...fired, ...rest];
      revealed = new Set(prior.won ? [] : rest);
      tiles = [];
      selected = new Set();
      guesses = prior.rows || [];
      lives = LIVES - (prior.mistakes || 0);
      finished = true;
      renderBoard();
      renderResults(prior.won, prior.mistakes || 0, true);
      return;
    }

    const saved = mode !== "builtin" ? loadProgress(day.date) : null;
    if (saved && Array.isArray(saved.tiles)) {
      tiles = saved.tiles;
      solved = saved.solved || [];
      lives = typeof saved.lives === "number" ? saved.lives : LIVES;
      guesses = saved.guesses || [];
      guessKeys = new Set(guesses.map((g) => g.slice().sort().join("|")));
    } else {
      tiles = shuffle(day.groups.flatMap((g) => g.words));
      solved = [];
      lives = LIVES;
      guesses = [];
      guessKeys = new Set();
    }
    selected = new Set();
    finished = false;
    revealed = new Set();
    renderBoard();
  }

  function updateIssueLine() {
    if (mode === "builtin") issueLine.textContent = "specimen grid";
    else issueLine.textContent = `grid № ${day.number} · ${prettyDate(day.date)}`;
  }

  function groupOf(word) {
    return day.groups.findIndex((g) => g.words.includes(word));
  }

  function allGroupIndicesInDifficultyOrder() {
    return day.groups
      .map((g, i) => i)
      .sort((a, b) => day.groups[a].difficulty - day.groups[b].difficulty);
  }

  // ── Rendering ────────────────────────────────────────────────────────────

  function renderBoard() {
    const bands = solved
      .map((gi, idx) => {
        const isRevealed = revealed.has(gi);
        const chip = isRevealed
          ? ""
          : idx < 3
            ? ` · +${(day.groups[gi].difficulty + 1) * WEIGHTS[idx]}`
            : day.groups[gi].difficulty === 0
              ? ` · sweep +${SWEEP_BONUS}`
              : " · freebie";
        return bandHTML(day.groups[gi], isRevealed, chip);
      })
      .join("");

    app.innerHTML = `
      ${mode === "archive" ? `<div class="banner">back grid — doesn't touch your streak</div>` : ""}
      ${solved.length === 0 && !finished ? `<p class="brief">Sixteen words. Four hidden groups. Lock four, then fire. Hard groups early score big — save the easiest for last.</p>` : ""}
      <div class="board" id="board">
        ${bands}
        ${tiles.length ? `<div class="grid" id="grid">${tiles.map(tileHTML).join("")}</div>` : ""}
      </div>
      ${finished ? "" : dockHTML()}
      <div id="final-slot"></div>
    `;

    app.querySelectorAll("button.tile").forEach((btn) => {
      btn.addEventListener("click", () => toggle(btn.dataset.w));
    });
    const shuffleBtn = document.getElementById("shuffle-btn");
    const deselectBtn = document.getElementById("deselect-btn");
    const submitBtn = document.getElementById("submit-btn");
    if (shuffleBtn) shuffleBtn.addEventListener("click", () => { tiles = shuffle(tiles); saveProgress(); renderBoard(); });
    if (deselectBtn) deselectBtn.addEventListener("click", () => { selected.clear(); syncTiles(); });
    if (submitBtn) submitBtn.addEventListener("click", submit);
    syncTiles();
    fitTiles();
  }

  // Shrink any tile whose longest word still overflows, instead of letting
  // it break mid-word (BLACKADDER must never become BLACKADDE-R).
  function fitTiles() {
    app.querySelectorAll("button.tile").forEach((btn) => {
      btn.style.fontSize = "";
      let size = parseFloat(getComputedStyle(btn).fontSize);
      let guard = 20;
      while (btn.scrollWidth > btn.clientWidth && size > 7 && guard--) {
        size -= 0.5;
        btn.style.fontSize = size + "px";
      }
    });
  }

  function bandHTML(group, revealed, chip = "") {
    return `
      <div class="solved-band d${group.difficulty} ${revealed ? "revealed" : ""}">
        <div class="tier">${TIER[group.difficulty]}${revealed ? " · revealed" : chip}</div>
        <div class="gname">${esc(group.name)}</div>
        <div class="gwords">${group.words.map(esc).join(" · ")}</div>
      </div>
    `;
  }

  function tileHTML(word) {
    const len = word.length;
    const sizeClass = len > 12 ? "len-l" : len > 8 ? "len-m" : "";
    return `<button class="tile ${sizeClass}" data-w="${esc(word)}">${esc(word)}</button>`;
  }

  function dockHTML() {
    return `
      <div class="dock">
        <div class="meters">
          <div class="lives">Lives ${Array.from({ length: LIVES }, (_, i) =>
            `<span class="life ${i < LIVES - lives ? "spent" : ""}"></span>`).join("")}
          </div>
          <div class="scorebox">Score <span class="n">${runningScore()}</span></div>
        </div>
        <div class="controls">
          <button class="pill" id="shuffle-btn">Scramble</button>
          <button class="pill" id="deselect-btn">Clear</button>
          <button class="pill loud" id="submit-btn" disabled>Fire</button>
        </div>
      </div>
    `;
  }

  function syncTiles() {
    app.querySelectorAll("button.tile").forEach((btn) => {
      btn.classList.toggle("selected", selected.has(btn.dataset.w));
    });
    const submitBtn = document.getElementById("submit-btn");
    if (submitBtn) submitBtn.disabled = selected.size !== 4;
    const deselectBtn = document.getElementById("deselect-btn");
    if (deselectBtn) deselectBtn.disabled = selected.size === 0;
  }

  // ── Play ─────────────────────────────────────────────────────────────────

  function toggle(word) {
    if (finished) return;
    if (selected.has(word)) selected.delete(word);
    else if (selected.size < 4) selected.add(word);
    syncTiles();
  }

  function submit() {
    if (selected.size !== 4 || finished) return;
    const picked = [...selected];
    const key = picked.slice().sort().join("|");

    if (guessKeys.has(key)) {
      toast("Already fired that");
      return;
    }

    const owners = picked.map(groupOf);
    guessKeys.add(key);
    guesses.push(owners.slice().sort((a, b) => a - b));

    const counts = {};
    for (const gi of owners) counts[gi] = (counts[gi] || 0) + 1;
    const best = Math.max(...Object.values(counts));

    if (best === 4) {
      const gi = owners[0];
      solved.push(gi);
      selected.clear();

      // Pop the four tiles, then land the band.
      app.querySelectorAll("button.tile").forEach((btn) => {
        if (day.groups[gi].words.includes(btn.dataset.w)) btn.classList.add("pop");
      });
      setTimeout(() => {
        tiles = tiles.filter((w) => !day.groups[gi].words.includes(w));
        if (solved.length === 4) {
          finished = true;
          renderBoard();
          finish(true);
        } else {
          saveProgress();
          renderBoard();
        }
      }, 320);
      return;
    }

    // Wrong.
    lives -= 1;
    app.querySelectorAll("button.tile").forEach((btn) => {
      if (selected.has(btn.dataset.w)) btn.classList.add("shake");
    });
    setTimeout(() => {
      app.querySelectorAll("button.tile.shake").forEach((b) => b.classList.remove("shake"));
    }, 450);

    if (lives <= 0) {
      finished = true;
      toast("Game over");
      setTimeout(() => revealRemaining(), 700);
      return;
    }

    toast(best === 3 ? "Missed by one" : "Miss");
    saveProgress();
    // Refresh the lives dots without a full re-render.
    const dock = app.querySelector(".lives");
    if (dock) {
      dock.innerHTML = `Lives ${Array.from({ length: LIVES }, (_, i) =>
        `<span class="life ${i < LIVES - lives ? "spent" : ""}"></span>`).join("")}`;
    }
  }

  function revealRemaining() {
    // Reveal the unsolved groups one by one, easiest first.
    const remaining = allGroupIndicesInDifficultyOrder().filter((gi) => !solved.includes(gi));
    selected.clear();

    const step = () => {
      if (!remaining.length) {
        renderBoard();
        finish(false);
        return;
      }
      const gi = remaining.shift();
      solved.push(gi);
      revealed.add(gi);
      tiles = tiles.filter((w) => !day.groups[gi].words.includes(w));
      renderBoard();
      setTimeout(step, 600);
    };
    step();
  }

  // ── Results ──────────────────────────────────────────────────────────────

  function finish(won) {
    const mistakes = LIVES - Math.max(lives, 0);
    const score = scoreFromRows(guesses);
    let data = null;
    if (mode !== "builtin") data = recordResult(day.date, won, mistakes, guesses, score);
    renderResults(won, mistakes, false, data);
  }

  function renderResults(won, mistakes, replay, dataArg) {
    const verdict = verdictFor(won, mistakes);
    const score = scoreFromRows(guesses);
    // The verdict handles survival (lives); this line coaches the score.
    // Completion always reads as a win — the order is the second-order game.
    const subline = won
      ? score === SCORE_MAX
        ? "The full twenty-four — a cold open on level 4, straight down the ladder, sweep and all."
        : score >= 20
          ? "A whisker off the full 24 — the purists fire 4, 3, 2 and take the easy one on the house."
          : score >= 14
            ? "Grid cleared. Bigger scores go to the bold: hardest groups first, easiest saved for last."
            : "Cleared it the sensible way. The high scores open on level 4 — if you dare."
      : "The grid got you today. Insert coin tomorrow.";

    const data = dataArg || store.read();
    const streak = data.streak || 0;
    const played = data.played || 0;
    const winRate = played ? Math.round(((data.wins || 0) / played) * 100) : 0;

    const streakLine =
      mode === "daily"
        ? `<div class="streak">streak: ${streak} day${streak === 1 ? "" : "s"}</div>`
        : "";

    const slot = document.getElementById("final-slot");
    if (!slot) return;
    slot.innerHTML = `
      <div class="results">
        <div class="verdict ${won ? "" : "lost"}">${verdict}</div>
        <div class="scoreline ${score === SCORE_MAX ? "full" : ""}">score ${score}<span class="of">/${SCORE_MAX}</span></div>
        <div class="subline">${replay ? "You've already played this grid." : esc(subline)}</div>
        ${streakLine}
        <div class="stats">
          <div class="stat"><div class="n">${played}</div><div class="l">played</div></div>
          <div class="stat"><div class="n">${winRate}%</div><div class="l">solved</div></div>
          <div class="stat"><div class="n">${data.maxStreak || 0}</div><div class="l">best streak</div></div>
          <div class="stat"><div class="n">${data.bestScore || 0}</div><div class="l">best score</div></div>
        </div>
        <div class="controls">
          ${mode !== "builtin" ? `<button class="pill loud" id="share-btn">Share</button>` : ""}
          <a class="ghost" href="add-to-home.html">Add to Home Screen</a>
        </div>
        ${subscribeBlockHTML()}
      </div>
    `;

    const shareBtn = document.getElementById("share-btn");
    if (shareBtn) shareBtn.addEventListener("click", () => share(won, mistakes, shareBtn));
    wireSubscribeForm();

    // "More daily guff" — the cross-sell bar shared by all four games
    const resultsEl = slot.querySelector(".results");
    if (window.GuffBar && resultsEl) {
      if (mode === "daily") GuffBar.completedToday(resultsEl);
      else if (mode === "archive") GuffBar.show(resultsEl);
    }

    slot.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function share(won, mistakes, btn) {
    const rows = guesses
      .map((row) => row.map((gi) => EMOJI[day.groups[gi].difficulty]).join(""))
      .join("\n");
    const verdict = verdictFor(won, mistakes).toUpperCase();
    const score = scoreFromRows(guesses);
    const text = `Groupie № ${day.number} — ${verdict} — ${score}/${SCORE_MAX}\n${rows}\nyour daily four play\n${location.origin.replace(/^https?:\/\//, "")}`;
    if (navigator.share) {
      navigator.share({ text }).catch(() => {});
    } else {
      navigator.clipboard.writeText(text).then(() => {
        btn.textContent = "Copied";
        setTimeout(() => (btn.textContent = "Share"), 1600);
      });
    }
  }

  // ── Newsletter ───────────────────────────────────────────────────────────

  function subscribeBlockHTML() {
    return `
      <div class="subscribe" id="newsletter-block">
        <span class="label">the newsletter</span>
        <p>The week's best grids, every Friday.</p>
        <form id="subscribe-form">
          <input type="email" name="email" placeholder="your@email.com" required autocomplete="email" />
          <button class="go" type="submit" aria-label="Sign up">→</button>
        </form>
        <div class="msg" id="subscribe-msg"></div>
      </div>
    `;
  }

  function wireSubscribeForm() {
    const form = document.getElementById("subscribe-form");
    if (!form) return;
    // The arrow only appears once there's something to send.
    form.email.addEventListener("input", () => {
      form.classList.toggle("filled", form.email.value.trim().length > 0);
    });
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const msg = document.getElementById("subscribe-msg");
      const email = form.email.value.trim();
      msg.textContent = "…";
      try {
        const res = await fetch("/api/subscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email }),
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.success) {
          form.classList.add("hidden");
          msg.textContent = "You're on the list. See you Friday.";
        } else {
          msg.textContent = data.error || "That didn't work — try again?";
        }
      } catch {
        msg.textContent = "That didn't work — try again?";
      }
    });
  }

  function renderNewsletter() {
    issueLine.textContent = "the newsletter";
    app.innerHTML = subscribeBlockHTML() + `
      <div class="controls" style="margin-top:16px; justify-content:center; display:flex;">
        <button class="ghost" id="back-btn">Back to today</button>
      </div>
    `;
    wireSubscribeForm();
    document.getElementById("back-btn").addEventListener("click", () => {
      history.pushState(null, "", location.pathname);
      route();
    });
  }

  // ── Archive ──────────────────────────────────────────────────────────────

  async function renderArchive() {
    issueLine.textContent = "back grids";
    app.innerHTML = `<p class="loading-note">Fetching the back grids…</p>`;
    try {
      const data = await fetchJSON("/api/archive");
      const played = store.read().results || {};
      app.innerHTML = `
        <ul class="archive-list">
          ${data.issues.map((it) => {
            const r = played[it.date];
            const sc = r && typeof r.score === "number" ? ` · ${r.score}/24` : "";
            const res = r ? (r.won ? `solved${sc} · ${r.mistakes} slip${r.mistakes === 1 ? "" : "s"}` : `game over${sc}`) : "—";
            return `<li><a href="?date=${it.date}">
              <span>№ ${it.number} · ${prettyDate(it.date)}</span>
              <span class="res">${res}</span>
            </a></li>`;
          }).join("")}
        </ul>
      `;
    } catch (err) {
      renderError(err.message);
    }
  }

  // ── Odds and ends ────────────────────────────────────────────────────────

  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove("show"), 1800);
  }

  function renderError(msg) {
    app.innerHTML = `<p class="error-note">${esc(msg)}</p>
      <div class="controls" style="display:flex;justify-content:center;margin-top:14px;">
        <button class="ghost" id="retry-btn">Try again</button>
      </div>`;
    document.getElementById("retry-btn").addEventListener("click", () => route());
  }

  function esc(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );
  }

  function prettyDate(iso) {
    const d = new Date(iso + "T12:00:00Z");
    if (isNaN(d)) return iso;
    return d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  }

  function addDaysISO(iso, n) {
    const d = new Date(iso + "T12:00:00Z");
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }

  function shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // ── Routing ──────────────────────────────────────────────────────────────

  function route() {
    const params = new URLSearchParams(location.search);
    if (location.hash === "#archive") return renderArchive();
    if (location.hash === "#newsletter") return renderNewsletter();
    return loadDaily(params.get("date"));
  }

  document.getElementById("nav-today").addEventListener("click", (e) => {
    e.preventDefault();
    history.pushState(null, "", location.pathname);
    route();
  });
  document.getElementById("nav-archive").addEventListener("click", (e) => {
    e.preventDefault();
    location.hash = "#archive";
  });
  document.getElementById("nav-newsletter").addEventListener("click", (e) => {
    e.preventDefault();
    location.hash = "#newsletter";
  });
  window.addEventListener("hashchange", route);

  route();
})();
