// src/subscribe.js
// Newsletter signup — same Resend model as Whenly, Pub Quiz Daily and
// What Word: one account-level Audience, the Friday games newsletter is a
// Segment. New signups become contacts and join that segment.
//
// Config:
//   RESEND_API_KEY     — secret
//   RESEND_SEGMENT_ID  — var in wrangler.toml (the shared Friday segment)
//
// A Groupie-branded welcome email goes to genuinely new contacts.
const SEND_WELCOME = true;

export async function handleSubscribe(request, env) {
  if (request.method !== "POST") return json({ error: "POST only" }, 405);

  if (!env.RESEND_API_KEY || !env.RESEND_SEGMENT_ID) {
    console.error("Missing RESEND_API_KEY or RESEND_SEGMENT_ID");
    return json({ error: "Server configuration error" }, 500);
  }

  let email;
  try {
    email = (await request.json()).email;
  } catch {
    return json({ error: "Invalid request" }, 400);
  }
  if (!email || !email.includes("@")) return json({ error: "Invalid email address" }, 400);

  const cleanEmail = email.toLowerCase().trim();
  const auth = {
    Authorization: `Bearer ${env.RESEND_API_KEY}`,
    "Content-Type": "application/json",
  };

  try {
    // 1. Create the contact (account-level). An existing contact is fine.
    const createRes = await fetch("https://api.resend.com/contacts", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ email: cleanEmail, unsubscribed: false }),
    });
    const createData = await createRes.json().catch(() => ({}));

    const alreadyExists =
      createRes.status === 409 ||
      (createData && typeof createData.message === "string" && /already/i.test(createData.message));

    if (!createRes.ok && !alreadyExists) {
      console.error("Resend contact error:", createData);
      return json({ error: "Could not subscribe" }, 400);
    }

    // 2. Ensure they're in the newsletter segment (idempotent).
    const segRes = await fetch(
      `https://api.resend.com/contacts/${encodeURIComponent(cleanEmail)}/segments/${env.RESEND_SEGMENT_ID}`,
      { method: "POST", headers: auth }
    );
    if (!segRes.ok) console.error("Add-to-segment failed:", await segRes.text());

    // 3. Welcome email for genuinely new contacts. Never fail the signup on this.
    if (SEND_WELCOME && createRes.ok && !alreadyExists) {
      await sendWelcome(env.RESEND_API_KEY, cleanEmail).catch((err) =>
        console.error("Welcome email failed (subscription still succeeded):", err)
      );
    }

    return json({ success: true });
  } catch (err) {
    console.error("Subscribe error:", err);
    return json({ error: "Server error" }, 500);
  }
}

async function sendWelcome(apiKey, email) {
  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="background:#020308;font-family:'Courier New',Courier,monospace;margin:0;padding:40px 24px;color:#d8f7ff;">
  <div style="max-width:520px;margin:0 auto;border:2px solid #00f0ff;padding:28px 24px;">
    <div style="text-align:center;border-bottom:1px solid #0a4a55;padding-bottom:16px;margin-bottom:24px;">
      <div style="font-size:26px;font-weight:bold;letter-spacing:0.14em;color:#00f0ff;">GROUPIE</div>
      <div style="font-size:12px;letter-spacing:0.18em;text-transform:uppercase;color:#ff2bd6;margin-top:6px;">your daily four play</div>
    </div>

    <div style="font-size:18px;margin-bottom:12px;color:#46ff5e;">PLAYER READY.</div>
    <p style="font-size:14px;line-height:1.7;margin:0 0 14px;color:#9fc3d0;">
      Every Friday we send one free games email — the week's best grids from
      Groupie, plus the pub quiz, Whenly and What Word. One email a week, never more.
    </p>
    <p style="font-size:14px;line-height:1.7;margin:0 0 22px;color:#9fc3d0;">
      Can't wait until Friday? Today's sixteen are on the board now.
    </p>
    <div style="text-align:center;">
      <a href="https://groupie.carl-b82.workers.dev/"
         style="display:inline-block;border:2px solid #ffe14d;color:#ffe14d;text-decoration:none;font-size:12px;letter-spacing:0.14em;text-transform:uppercase;padding:12px 26px;font-weight:bold;">
        Play today's grid &rarr;
      </a>
    </div>

    <div style="margin-top:28px;border-top:1px solid #0a4a55;padding-top:12px;font-size:11px;color:#6e93a3;text-align:center;letter-spacing:0.08em;">
      GROUPIE &middot; four groups of four &middot; four lives &middot; British red herrings
    </div>
  </div>
</body>
</html>`;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "Groupie <hello@pubquizdaily.com>",
      to: [email],
      subject: "You're in — your daily four play begins",
      html,
    }),
  });
  if (!res.ok) throw new Error(`Resend welcome send failed: ${await res.text()}`);
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
