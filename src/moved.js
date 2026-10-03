/* Old-domain hand-off (domain consolidation, Oct 2026).
   The Worker answers on both the old domain and the new carlosfandango.net
   subdomain. On the OLD hostnames, page navigations get a hand-off page that
   copies localStorage (streaks, today's run, the guff bar's ticks) into the
   URL hash and sends the browser to the new address, where the inline import
   script in index.html writes it back. Assets and /api/* on the old host are
   left alone so tabs opened before the deploy keep working.

   PHASE: "silent" forwards at once. "notice" shows "this game has moved,
   update your bookmark" and forwards after a few seconds. Flip to "notice"
   on the date in the consolidation plan (Thu 12 Nov 2026), then redeploy. */

export const MOVE = {
  oldHosts: ["groupie.fun", "www.groupie.fun"],
  newOrigin: "https://groupie.carlosfandango.net",
  gameName: "Groupie",
  phase: "silent",
  noticeSeconds: 6,
};

const BOT_UA = /bot|crawl|spider|slurp|facebookexternalhit|whatsapp|telegram|discord|twitterbot|linkedin|preview|lighthouse|headless/i;

/* Returns a Response when the request is a page navigation on an old host,
   otherwise null (caller carries on as normal). */
export function movedResponse(request, url, move = MOVE) {
  if (!move.oldHosts.includes(url.hostname)) return null;
  if (request.method !== "GET" && request.method !== "HEAD") return null;
  const accept = request.headers.get("Accept") || "";
  const isPage = accept.includes("text/html") || url.pathname === "/" || url.pathname.endsWith(".html");
  if (!isPage) return null;
  const target = move.newOrigin + url.pathname + url.search;
  const ua = request.headers.get("User-Agent") || "";
  if (BOT_UA.test(ua)) {
    return new Response(null, { status: 301, headers: { Location: target, "Cache-Control": "no-store" } });
  }
  return new Response(handoffPage(target, move), {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex",
    },
  });
}

function handoffPage(target, move) {
  const notice = move.phase === "notice";
  const secs = notice ? move.noticeSeconds : 0;
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const newHost = new URL(move.newOrigin).host;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${esc(move.gameName)} has moved</title>
<noscript><meta http-equiv="refresh" content="0;url=${esc(target)}"></noscript>
<style>
  html,body{height:100%;margin:0}
  body{display:flex;align-items:center;justify-content:center;background:#10214A;color:#fff;
       font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;text-align:center;padding:24px}
  .box{max-width:460px}
  h1{font-size:26px;margin:0 0 12px}
  p{font-size:17px;line-height:1.5;margin:0 0 18px;opacity:.92}
  .addr{font-weight:700;color:#FFD400;word-break:break-all}
  a.btn{display:inline-block;background:#FFD400;color:#10214A;text-decoration:none;font-weight:800;
        padding:14px 26px;border-radius:10px;font-size:17px}
  .small{font-size:14px;opacity:.7;margin-top:18px}
</style>
</head>
<body>
<div class="box"${notice ? "" : ' style="visibility:hidden"'}>
  <h1>${esc(move.gameName)} has moved</h1>
  <p>It now lives at <span class="addr">${esc(newHost)}</span>.<br>Please update your bookmark. If you had it on your home screen, add it again from the new address.</p>
  <p><a class="btn" id="go" href="${esc(target)}">Take me there</a></p>
  <p class="small" id="count"></p>
</div>
<script>
(function(){
  var TARGET=${JSON.stringify(target)}, SECS=${secs};
  function b64url(s){ return btoa(unescape(encodeURIComponent(s))).replace(/\\+/g,"-").replace(/\\//g,"_").replace(/=+$/,""); }
  function build(){
    var bundle={}, id=null, m=(location.hash||"").match(/[#&]guff=([A-Za-z0-9-]{8,64})/);
    try{
      for(var i=0;i<localStorage.length;i++){ var k=localStorage.key(i); if(k==="guffbar_id") continue; bundle[k]=localStorage.getItem(k); }
      id = (m&&m[1]) || localStorage.getItem("guffbar_id");
    }catch(e){}
    var parts=[];
    if(id) parts.push("guff="+id);
    var json=JSON.stringify(bundle);
    if(json!=="{}") parts.push("guffmove="+b64url(json));
    return TARGET + (parts.length ? "#"+parts.join("&") : "");
  }
  var dest=build();
  var go=document.getElementById("go"); if(go) go.href=dest;
  if(SECS<=0){ location.replace(dest); return; }
  var left=SECS, el=document.getElementById("count");
  function tick(){ if(el) el.textContent="Taking you there in "+left+"\\u2026"; if(left--<=0){ location.replace(dest); return; } setTimeout(tick,1000); }
  tick();
})();
</script>
</body>
</html>`;
}
