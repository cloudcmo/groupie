/* Groupie: arcade visitors (7 Oct 2026). Pure whimsy. If you leave the board alone for 20 seconds, a little
   pixel creature crawls across the screen, sometimes stops to say something, and leaves. At most twice per
   grid, so it never gets annoying. All sprites are original to Groupie; GuffBot himself turns up now and then.
   Nothing here touches the game: it sits on top, ignores taps, and only runs while a grid is in play.
   Off for anyone who prefers reduced motion. Add ?arcadetest to the address to see one every few seconds. */
(() => {
  if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  const IDLE_MS = 20000;
  const MAX_PER_GAME = 2;
  const test = /[?&]arcadetest\b/.test(location.search);

  const R = (a, b) => a + Math.random() * (b - a);
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /* ---------- sprites: a = main colour, b = second colour, w = white, k = dark, y = yellow ---------- */
  const SPRITES = {
    cyclops: { lane: "ground", frames: [
      ["a.......a", "aa.....aa", ".aaaaaaa.", "aaawwwaaa", "aaawkwaaa", "aaawwwaaa", ".aaaaaaa.", ".aa...aa."],
      ["a.......a", "aa.....aa", ".aaaaaaa.", "aaawwwaaa", "aaawkwaaa", "aaawwwaaa", ".aaaaaaa.", "aa.....aa"],
    ] },
    robot: { lane: "ground", frames: [
      ["....y....", "..aaaaa..", "..awawa..", "..aaaaa..", ".bbbbbbb.", "bbbbybbbb", ".bbbbbbb.", ".bb...bb."],
      ["....y....", "..aaaaa..", "..awawa..", "..aaaaa..", ".bbbbbbb.", "bbbbybbbb", ".bbbbbbb.", "..bb.bb.."],
    ] },
    bug: { lane: "ground", frames: [
      ["k.......k", ".k.....k.", "..aaaaa..", ".aawawaa.", "aaaaaaaaa", "a.a...a.a"],
      ["k.......k", ".k.....k.", "..aaaaa..", ".aawawaa.", "aaaaaaaaa", ".a.a.a.a."],
    ] },
    ufo: { lane: "air", frames: [
      ["....bbb....", "...bwwwb...", ".aaaaaaaaa.", "aayaayaayaa", ".aaaaaaaaa.", "..a.....a.."],
      ["....bbb....", "...bwwwb...", ".aaaaaaaaa.", "ayaayaayaaa", ".aaaaaaaaa.", "..a.....a.."],
    ] },
  };
  const COLOURS = ["#ff9f1c", "#b6ff33", "#00ffd5", "#ff3b4e", "#ff2bd6", "#00f0ff"];
  const SECOND = { b: "#8fa3b0", y: "#ffe94d", w: "#ffffff", k: "#05060d" };

  const SAYS = [
    "INSERT COIN", "HI SCORE?", "READY PLAYER 1", "STILL THERE?", "FIRE AT WILL",
    "PLEASE INSERT BRAIN", "ONE MORE GO?", "TICK TOCK", "GAME ON", "BEEP BOOP",
  ];
  const BOT_SAYS = ["GUFFBOT WAS HERE", "PSST. TRY THE EASY ONE LAST", "CARRY ON", "I SEE EVERYTHING"];

  function spriteEl(def, colour, px) {
    const w = def.frames[0][0].length, h = def.frames[0].length;
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
    svg.setAttribute("width", w * px); svg.setAttribute("height", h * px);
    svg.setAttribute("shape-rendering", "crispEdges");
    const pal = { a: colour, ...SECOND };
    const groups = def.frames.map((rows) => {
      const g = document.createElementNS(ns, "g");
      rows.forEach((row, y) => [...row].forEach((ch, x) => {
        if (ch === ".") return;
        const r = document.createElementNS(ns, "rect");
        r.setAttribute("x", x); r.setAttribute("y", y); r.setAttribute("width", 1); r.setAttribute("height", 1);
        r.setAttribute("fill", pal[ch] || colour);
        g.append(r);
      }));
      svg.append(g); return g;
    });
    let f = 0;
    const show = () => groups.forEach((g, i) => (g.style.display = i === f ? "" : "none"));
    show();
    const timer = setInterval(() => { f = (f + 1) % groups.length; show(); }, 220);
    return { svg, w: w * px, h: h * px, stop: () => clearInterval(timer) };
  }

  /* ---------- styles ---------- */
  const css = document.createElement("style");
  css.textContent = `
    .arc{position:fixed;left:0;z-index:50;pointer-events:none;will-change:transform}
    .arc .flip{display:block}
    .arc .flip.l{transform:scaleX(-1)}
    .arc .bob{animation:arcbob .44s steps(2) infinite}
    @keyframes arcbob{0%{transform:translateY(0)}50%{transform:translateY(-3px)}100%{transform:translateY(0)}}
    .arc.air .bob{animation-duration:.9s}
    .arc .say{position:absolute;bottom:100%;left:50%;transform:translateX(-50%);margin-bottom:6px;white-space:nowrap;
      font:9px/1 "Press Start 2P",monospace;color:#020308;background:#d8f7ff;padding:6px 7px;border:2px solid #00f0ff;
      box-shadow:3px 3px 0 #ff2bd6}
    .arc .say::after{content:"";position:absolute;top:100%;left:50%;margin-left:-4px;border:4px solid transparent;border-top-color:#00f0ff}
    .arc img{display:block;image-rendering:auto}
  `;
  document.head.append(css);

  /* ---------- one visit ---------- */
  let busy = false;
  async function visit() {
    busy = true;
    const W = window.innerWidth, H = window.innerHeight;
    const px = W < 480 ? 4 : 5;
    const bot = Math.random() < 0.12;
    let key, built, lane;
    if (bot) {
      lane = "ground";
      const img = document.createElement("img");
      img.src = "guffbot.webp"; img.alt = ""; img.width = 44; img.height = 44;
      built = { svg: img, w: 44, h: 44, stop() {} };
    } else {
      key = pick(Object.keys(SPRITES)); lane = SPRITES[key].lane;
      built = spriteEl(SPRITES[key], pick(COLOURS), px);
    }
    const el = document.createElement("div");
    el.className = "arc " + lane;
    const flip = document.createElement("span"), bob = document.createElement("span");
    flip.className = "flip"; bob.className = "bob"; bob.style.display = "block";
    bob.append(built.svg); flip.append(bob); el.append(flip);
    el.style.top = lane === "air" ? `${Math.round(R(0.07, 0.22) * H)}px` : "";
    if (lane !== "air") el.style.bottom = `${Math.round(R(8, 26))}px`;
    document.body.append(el);

    const dir = Math.random() < 0.5 ? 1 : -1;           // 1 = left to right
    if (dir < 0) flip.classList.add("l");
    const startX = dir > 0 ? -built.w - 10 : W + 10;
    const endX = dir > 0 ? W + 10 : -built.w - 10;
    const step = px * 2;
    const stepped = (d) => `steps(${Math.max(4, Math.round(Math.abs(d) / step))})`;
    const slide = (a, b, ms) => el.animate(
      [{ transform: `translateX(${a}px)` }, { transform: `translateX(${b}px)` }],
      { duration: ms, easing: stepped(b - a), fill: "forwards" }).finished.catch(() => {});

    el.style.transform = `translateX(${startX}px)`;
    const speak = (t) => { const s = document.createElement("div"); s.className = "say"; s.textContent = t; el.append(s); return s; };
    try {
      if (Math.random() < 0.5) {
        // a peek: walk in a little way, say something, and go back out the way it came
        const stopX = dir > 0 ? R(0.1, 0.4) * W : W - built.w - R(0.1, 0.4) * W;
        await slide(startX, stopX, Math.abs(stopX - startX) * 14);
        const s = speak(bot ? pick(BOT_SAYS) : pick(SAYS));
        await sleep(2200); s.remove();
        flip.classList.toggle("l");
        await slide(stopX, startX, Math.abs(stopX - startX) * 11);
      } else {
        // a crossing: the whole width of the screen, no stopping
        await slide(startX, endX, (W + built.w) * R(9, 13));
      }
    } catch {}
    built.stop(); el.remove();
    busy = false;
  }

  /* ---------- when to turn up ---------- */
  const inPlay = () => !!document.getElementById("grid") && !!document.getElementById("submit-btn");
  const gameKey = () => {
    const issue = (document.getElementById("issue-line") || {}).textContent || "";
    return "groupie_arcade|" + issue + "|" + (location.hash || "");
  };
  const shown = (k) => { try { return parseInt(localStorage.getItem(k) || "0", 10) || 0; } catch { return 0; } };
  const bump = (k) => { try { localStorage.setItem(k, String(shown(k) + 1)); } catch {} };

  let last = Date.now();
  const touch = () => { last = Date.now(); };
  ["pointerdown", "keydown", "touchstart"].forEach((e) => document.addEventListener(e, touch, { capture: true, passive: true }));
  document.addEventListener("visibilitychange", () => { if (!document.hidden) touch(); });

  setInterval(() => {
    if (busy || document.hidden || !inPlay()) { if (!inPlay()) touch(); return; }
    if (Date.now() - last < (test ? 3000 : IDLE_MS)) return;
    const k = gameKey();
    if (!test && shown(k) >= MAX_PER_GAME) return;
    if (!test) bump(k);
    touch();
    visit().then(touch);
  }, 1000);
})();
