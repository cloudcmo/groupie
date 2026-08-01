// src/generate.js
// The whole editorial operation lives in this file: the brief the model is
// given, the shape it must return, and the checks its work must pass before
// a day is allowed into the store. Edit the system prompt below to change
// the character of the game.

const ANTHROPIC_MODEL = "claude-sonnet-4-5";

// Difficulty bands, easiest to hardest. The front end shows these as
// gig-billing tiers: opener → support → headliner → encore.
export const DIFFICULTIES = [0, 1, 2, 3];

// ─── The editorial brief ────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are the setter of Groupie, a daily British puzzle:
sixteen words on a grid, and the player must sort them into four groups of
four. Strapline: "Four play". It is the UK's answer to the NYT's Connections —
same mechanics, but the cultural furniture is entirely British.

THE BRITISH RULE (the reason this game exists)
- UK English spellings throughout: colour, doughnut, tyre, kerb, plough.
- Cultural references must be ones a UK adult would meet in ordinary British
  life: British telly and radio (sitcoms, soaps, panel shows, Radio 4),
  British music, football and cricket as played here, seaside towns, motorway
  services, biscuits and crisps, chippy orders, the Royals, PMs, cockney and
  playground slang, Monopoly's London board, place names, British brands.
- NEVER build a group on American material: no NFL/NBA/MLB, no US-only
  brands, chains, slang, spellings or school-system references. If only an
  American would smile, it's out.
- Universal material (animals, colours, words-before-X wordplay, science,
  geography) is welcome — the flavour should simply be unmistakably British
  where flavour exists.

THE FOUR GROUPS
- Exactly 4 groups of exactly 4 answers; 16 answers, all distinct.
- Each answer is short: one word or a snappy phrase, 18 characters at most.
- Assign each group a difficulty 0–3, each used exactly once:
  0 (opener)   — most players get it: a plain category, warmly familiar.
  1 (support)  — general knowledge with a British accent.
  2 (headliner)— knowledge plus a sideways step; connections between things
                 people know but haven't filed together.
  3 (encore)   — wordplay: "___ pudding", "words before CASTLE", homophones
                 of famous Daves, words hiding a fish, and so on. The groan
                 and the grin.
- Group names are part of the entertainment: precise but with a wink.
  "Cockney for parts of the body", not "Slang terms".

RED HERRINGS ARE THE CRAFT (this is what separates a real puzzle from a sort)
- At least three answers must plausibly belong to a DIFFERENT group than the
  one that owns them. Example of the standard: the grid contains JOHN, PAUL,
  GEORGE and STEWART — the player reaches for Beatles and discovers too late
  that GEORGE is filed under kings of England, and the fourth Beatle isn't
  here at all.
- The best trap is a near-complete famous set: three Spice Girls and no
  fourth, three PMs where the fourth reads as a colour (BROWN), a MONKEY and
  a PONY that turn out to be cockney money, a DUCK that turns out to be
  cricket.
- Every word should look like it could go two ways for at least a moment;
  a grid that sorts itself on first reading is a failure.
- You must describe the trap you built in a "trap" field — if you cannot
  describe it, you haven't built one.

HOUSE RULES
- Never reuse a category in the "already used" list, or an obvious rewording
  of one. Fresh angles only.
- No group should require specialist knowledge (chemistry nomenclature,
  post-2020 reality TV casts). The test: would it get a table of four at a
  pub quiz nodding, not squinting?
- Nothing mean-spirited; no slurs; nothing whose interest is mainly shock.
- Answers in capitals, exactly as they should appear on the tiles.

OUTPUT
Return ONLY a JSON object, no markdown fences, of this exact shape:
{
  "groups": [
    { "name": "the group name shown on solving", "difficulty": 0, "words": ["...", "...", "...", "..."] },
    { "name": "...", "difficulty": 1, "words": ["...", "...", "...", "..."] },
    { "name": "...", "difficulty": 2, "words": ["...", "...", "...", "..."] },
    { "name": "...", "difficulty": 3, "words": ["...", "...", "...", "..."] }
  ],
  "trap": "one or two sentences describing the red herrings you set"
}`;

// ─── Generation ─────────────────────────────────────────────────────────────

/**
 * Generate, validate and return one day's puzzle.
 * Returns { ok: true, payload, categories } or { ok: false, reason }.
 * Does not write to the database — the caller owns storage.
 */
export async function generateDay(env, date, usedCategories) {
  const recentUsed = [...usedCategories].slice(-400); // keep the prompt bounded
  const userPrompt =
    `Set the Groupie grid for ${date}.\n\n` +
    `Categories already used (never reuse these, or near-rewordings of them): ` +
    (recentUsed.length ? recentUsed.join(" | ") : "none yet") +
    `\n\nReturn the JSON object only.`;

  let raw;
  try {
    raw = await callAnthropic(env, SYSTEM_PROMPT, userPrompt);
  } catch (err) {
    return { ok: false, reason: `API error: ${err.message}` };
  }

  let parsed;
  try {
    parsed = JSON.parse(stripFences(raw));
  } catch {
    return { ok: false, reason: "Model did not return valid JSON" };
  }

  const problem = validateDay(parsed, usedCategories);
  if (problem) return { ok: false, reason: problem };

  // Normalise: order groups by difficulty, tidy whitespace, uppercase tiles.
  const groups = [...parsed.groups]
    .sort((a, b) => a.difficulty - b.difficulty)
    .map((g) => ({
      name: g.name.trim(),
      difficulty: g.difficulty,
      words: g.words.map((w) => w.trim().toUpperCase()),
    }));

  return {
    ok: true,
    payload: { groups, trap: (parsed.trap || "").trim() },
    categories: groups.map((g) => g.name.toLowerCase()),
  };
}

// ─── Validation — everything the model returns is checked before storage ────

export function validateDay(parsed, usedCategories) {
  if (!parsed || !Array.isArray(parsed.groups)) return "No groups array";
  if (parsed.groups.length !== 4) return "Need exactly 4 groups";

  const difficultiesSeen = new Set();
  const namesSeen = new Set();
  const wordsSeen = new Set();

  for (const [i, g] of parsed.groups.entries()) {
    const label = `Group ${i + 1}`;
    if (!g || typeof g !== "object") return `${label}: not an object`;

    if (!Number.isInteger(g.difficulty) || g.difficulty < 0 || g.difficulty > 3)
      return `${label}: bad difficulty`;
    if (difficultiesSeen.has(g.difficulty)) return `${label}: duplicate difficulty ${g.difficulty}`;
    difficultiesSeen.add(g.difficulty);

    if (typeof g.name !== "string" || g.name.trim().length < 3)
      return `${label}: missing name`;
    if (g.name.trim().length > 60) return `${label}: name too long`;
    const nameLower = g.name.trim().toLowerCase();
    if (namesSeen.has(nameLower)) return `${label}: duplicate name`;
    namesSeen.add(nameLower);
    if (usedCategories.has(nameLower)) return `${label}: category "${nameLower}" already used`;

    if (!Array.isArray(g.words) || g.words.length !== 4)
      return `${label}: need exactly 4 words`;
    for (const w of g.words) {
      if (typeof w !== "string" || !w.trim()) return `${label}: empty word`;
      const clean = w.trim().toUpperCase();
      if (clean.length > 18) return `${label}: "${clean}" longer than 18 characters`;
      if (wordsSeen.has(clean)) return `${label}: word "${clean}" appears twice in the grid`;
      wordsSeen.add(clean);
    }
  }

  if (typeof parsed.trap !== "string" || parsed.trap.trim().length < 20)
    return "No trap described — a grid without red herrings is a sort, not a puzzle";

  return null; // all good
}

// ─── Anthropic ──────────────────────────────────────────────────────────────

async function callAnthropic(env, system, user) {
  if (!env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY not set");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 2500,
      temperature: 1,
      system,
      messages: [{ role: "user", content: user }],
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Anthropic ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = await res.json();
  const text = (data.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("");
  if (!text) throw new Error("Empty completion");
  return text;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function stripFences(text) {
  return text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/, "")
    .trim();
}
