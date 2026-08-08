// src/generate.js
// The whole editorial operation lives in this file: the brief the model is
// given, the shape it must return, and the checks its work must pass before
// a day is allowed into the store. Edit the system prompt below to change
// the character of the game.

const ANTHROPIC_MODEL = "claude-sonnet-4-5";

// Difficulty bands, easiest to hardest. The front end shows these as
// arcade levels 1–4.
export const DIFFICULTIES = [0, 1, 2, 3];

// ─── The editorial brief ────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are the setter of Groupie, a daily British puzzle:
sixteen words on a grid, and the player must sort them into four groups of
four. Strapline: "Your daily four play". It is the UK's answer to the NYT's Connections —
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
  0 (level 1) — most players get it. Either a warmly familiar category
                ("biscuits for dunking") or a tight synonym cluster
                ("ways to say drunk": SOZZLED, BLOTTO, LEGLESS, TROLLEYED).
  1 (level 2) — general knowledge with a British accent, or a
                physical-property group: things united by how they look or
                what they do, not what they're called ("things that are
                tartan", "V-shaped things", "things you shake").
  2 (level 3) — knowledge plus a sideways step; things people know but
                haven't filed together. Polysemy shines here: "what BOOT
                might refer to" (CAR, WELLINGTON, PUSS IN, TO BOOT — four
                phrases or things that are all a "boot" in some sense).
  3 (level 4) — wordplay, drawn from this toolkit (vary the tool daily):
      · blanks: "___ PUDDING", "words before CASTLE"
      · hidden word at the START: "starting with a fish" (CODDLE, EELY...)
      · hidden word at the END: "ending in a river" (OVERSEVERN-style —
        craft real words/phrases whose tails hide the theme)
      · homophones: "homophones of famous Daves"
      · CHANGE the FIRST or LAST letter: "the full English, first letter
        changed" (JEANS→beans, KEGS→eggs, BOAST→toast, CASH→hash)
      · ADD a letter at the START or END: "booze, one letter added at the
        start" (DALE→ale, DRUM→rum, SWINE→wine, SPORT→port)
      · REMOVE the FIRST or LAST letter: "chocolate bars missing their
        last letter" (WISP→Wispa, FLAK→Flake, BOOS→Boost)
      · themed anagrams: "anagrams of British rivers" — each tile must
        itself be a real word (NERVES→Severn), never a scramble
      · spelling patterns: "Y is the only vowel" (MYRRH, RHYTHM),
        "silent W" (SWORD, WREATH), and kin
      · truncations: "starts of London boroughs" (HACK, CAM, BARK)
      The groan and the grin. For letter-surgery groups the tile shows the
      TRANSFORMED form (the player works backwards), and the group name
      must state the rule plainly so the reveal is fair.

LETTER-SURGERY RULES (non-negotiable — one sloppy tile ruins the day)
- Surgery may ONLY touch the FIRST or the LAST letter of a word. Mid-word
  operations ("middle letter removed", "second letter changed") are BANNED
  outright — counting positions inside a word is where these groups die.
- Letter surgery is the highest-failure tool in the kit. Reach for blanks,
  homophones and hidden words more often; attempt surgery only when four
  flawless first-or-last-letter tiles come to you easily.
- The stated operation must hold EXACTLY, letter by letter, for every tile.
  "First letter changed" means: same length, every letter identical except
  position one. "First letter removed" means: the base minus exactly its
  first letter, nothing else. "One letter added" means: the base with
  exactly one letter inserted. No looser interpretation is ever acceptable.
- The operation must act at the SAME position in every tile, and the group
  name must say which position: "first letter changed", "one letter added
  at the start", "last letter removed". Three tiles transformed at the
  front and one in the middle is unfair — the player learns the rule from
  three tiles and is betrayed by the fourth.
- NEVER include an untransformed member of the base set as a tile. If the
  group is "football clubs, first letter changed", FULHAM cannot appear.
- Before committing to a letter-surgery group, spell out each base and each
  tile letter by letter and compare them. If any pair fails the stated rule,
  change the base, the tile, or the whole mechanism.
- Every transformed tile must be a REAL WORD, real name, or real phrase in
  its own right — something a dictionary or a well-read person would
  recognise. Gibberish tiles are BANNED outright: MAJOP and CAMEROS are not
  words, and four non-words cluster visually and solve the group by their
  ugliness alone. BLAIN for Blair works because blain is a real word;
  that standard applies to all four tiles, no exceptions.
- If you cannot build four flawless REAL-WORD tiles, use a different level
  4 tool. A blank or homophone group done perfectly beats letter surgery
  done badly — and letter surgery that needs gibberish was never good
  enough to set.
- ROTATE the level 4 mechanism: the "categories already used" list below is
  ordered oldest to newest, so its final entries are the most recent days.
  Never use the same level 4 tool two days running, and don't let any one
  tool dominate a week.
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
  "wordplay": {
    "tool": "one of: change-letter, add-letter, remove-letter, anagram, hidden-start, hidden-end, truncation, blank, homophone, spelling, other",
    "position": "first or last — required for change-letter / add-letter / remove-letter",
    "pairs": [
      { "tile": "DALE", "base": "ALE" },
      { "tile": "...", "base": "..." },
      { "tile": "...", "base": "..." },
      { "tile": "...", "base": "..." }
    ]
  },
  "trap": "one or two sentences describing the red herrings you set"
}
"wordplay" is your proof of work for the level 4 group and it is checked BY
MACHINE, letter by letter. "tile" is the word exactly as it appears on the
grid; "base" is the word it derives from (for blanks, the completed phrase;
for homophones, the word it sounds like; for hidden words, the word hidden;
for truncations, the full word). Exactly 4 pairs, one per level-4 tile. If
any pair fails the exact letter check, the whole day is rejected — so spell
each pair out and verify it yourself before answering. Never shown to
players.`;

// ─── Machine check: the letter arithmetic ───────────────────────────────────
// Letter operations are string arithmetic, and string arithmetic belongs to
// code, not to a language model. The setter declares its mechanism and its
// tile←base pairs; these checks are exact and free, and they run BEFORE the
// paid verifier call, so a grid with broken letters costs one API call, not
// two. Tools that need judgment rather than counting (blanks, homophones,
// spelling patterns) pass through to the verifier untouched.

const WORDPLAY_TOOLS = [
  "change-letter", "add-letter", "remove-letter", "anagram",
  "hidden-start", "hidden-end", "truncation",
  "blank", "homophone", "spelling", "other",
];
const SURGERY_TOOLS = new Set(["change-letter", "add-letter", "remove-letter"]);

export function checkWordplay(wp, level4Words) {
  if (!wp || typeof wp !== "object")
    return "Missing wordplay object — the level 4 group must declare its mechanism";
  if (!WORDPLAY_TOOLS.includes(wp.tool))
    return `wordplay.tool must be one of: ${WORDPLAY_TOOLS.join(", ")}`;
  if (SURGERY_TOOLS.has(wp.tool) && wp.position !== "first" && wp.position !== "last")
    return 'wordplay.position must be "first" or "last" for letter surgery';
  if (!Array.isArray(wp.pairs) || wp.pairs.length !== 4)
    return "wordplay.pairs must contain exactly 4 entries, one per level-4 tile";

  const tilesSeen = new Set();
  for (const p of wp.pairs) {
    if (!p || typeof p.tile !== "string" || typeof p.base !== "string")
      return "each wordplay pair needs a tile and a base, both strings";
    const tile = p.tile.trim().toUpperCase();
    const base = p.base.trim().toUpperCase();
    if (!level4Words.has(tile))
      return `wordplay pair tile "${tile}" is not a word in the level 4 group`;
    if (tilesSeen.has(tile)) return `wordplay pair tile "${tile}" listed twice`;
    tilesSeen.add(tile);
    if (!base) return `wordplay pair for "${tile}" has an empty base`;
    const problem = checkPair(wp.tool, wp.position, tile, base);
    if (problem) return problem;
  }
  return null;
}

function checkPair(tool, pos, tile, base) {
  const fail = (why) => `letter check failed for ${tile} ← ${base}: ${why}`;
  switch (tool) {
    case "change-letter": {
      if (tile === base) return fail("tile is identical to its base — nothing changed");
      if (tile.length !== base.length)
        return fail(`lengths differ (${tile.length} vs ${base.length})`);
      if (pos === "first") {
        if (tile.slice(1) !== base.slice(1))
          return fail("letters after position one are not identical");
      } else if (tile.slice(0, -1) !== base.slice(0, -1)) {
        return fail("letters before the last are not identical");
      }
      return null;
    }
    case "add-letter": {
      if (tile.length !== base.length + 1)
        return fail("tile must be exactly one letter longer than its base");
      if (pos === "first" ? tile.slice(1) !== base : tile.slice(0, -1) !== base)
        return fail(`tile is not its base with one letter added at the ${pos}`);
      return null;
    }
    case "remove-letter": {
      if (tile.length !== base.length - 1)
        return fail("tile must be exactly one letter shorter than its base");
      if (pos === "first" ? tile !== base.slice(1) : tile !== base.slice(0, -1))
        return fail(`tile is not its base minus the ${pos} letter`);
      return null;
    }
    case "anagram": {
      const letters = (w) => w.replace(/[^A-Z]/g, "").split("").sort().join("");
      if (tile === base) return fail("tile is identical to its base");
      if (letters(tile) !== letters(base)) return fail("tile is not an anagram of its base");
      return null;
    }
    case "hidden-start":
      return tile.startsWith(base) ? null : fail("tile does not start with its base word");
    case "hidden-end":
      return tile.endsWith(base) ? null : fail("tile does not end with its base word");
    case "truncation":
      return base.startsWith(tile) && tile.length < base.length
        ? null
        : fail("tile is not the start of its base word");
    default:
      return null; // blank / homophone / spelling / other — the verifier judges these
  }
}

// ─── Second pass: adversarial verification ──────────────────────────────────
// The generator is imaginative; this pass is ruthless. The letter arithmetic
// has already been machine-checked by the time a grid reaches here, so this
// call spends its attention purely on knowledge and fairness — the things
// only a well-read checker can judge.

const VERIFY_PROMPT = `You are the fact-checker for Groupie, a British
word-grouping puzzle. You are given one day's puzzle plus the setter's
declared wordplay mechanism and tile←base pairs for the level 4 group.
The letter arithmetic has ALREADY been verified by machine — do not
re-count letters. Your job is knowledge and fairness. REJECT anything
unsound.

CHECK, in order:
1. Real bases. Every "base" must be a real, well-known member of the set
   the group name claims — a real football club, a real river, a real
   cheese. An invented, obscure or wrong-set base is a fail.
2. Real tiles. Every TILE in the wordplay group must be a real English
   word, real name, or real phrase in its own right — recognisable to a
   dictionary or a well-read UK adult. Gibberish (MAJOP, CAMEROS,
   ATTLEN) is an automatic fail even when the letter derivation is
   exact: non-words cluster visually and give the group away.
3. No untransformed members. If any TILE is itself a genuine member of
   the base set (WELLS appearing in "cities, first letter changed" —
   Wells is a real city), automatic fail.
4. Name honesty. The group name must state the declared tool and position
   plainly enough that the reveal is fair, and must match the declared
   mechanism — "first letter changed" must not be sold as anagrams.
   Mid-word operations are banned by house rules; fail them.
5. Membership truth. Every word in every group must genuinely belong to
   the group as named, in a UK frame. One wrong member is a fail.
Do NOT fail a puzzle for being easy, hard, or stylistically dull — soundness
only.

Do your letter-by-letter working in plain text first — you cannot check
spelling without writing the words out. Then, as the FINAL thing you write,
give your verdict as a single JSON object on its own line, no fences:
{"verdict":"pass"} or {"verdict":"fail","problems":["specific problem", "..."]}
When in doubt, fail — a skipped day is recoverable, a nonsense day is not.`;

async function verifyGrid(env, parsed) {
  const puzzle = JSON.stringify({ groups: parsed.groups, wordplay: parsed.wordplay });
  let raw;
  try {
    // Roomy token budget: the checker writes its working out in prose
    // before the verdict, and a truncated reply would read as a parse
    // failure and cost us the day.
    raw = await callAnthropic(env, VERIFY_PROMPT, `Verify this puzzle:\n${puzzle}`, 0, 4000);
  } catch (err) {
    // If the checker itself is unreachable, fail closed: better to write
    // nothing than to write unverified wordplay.
    return { ok: false, reason: `verifier unavailable: ${err.message}` };
  }
  // The verdict is the LAST JSON object in the reply — everything before
  // it is the checker's letter-by-letter working.
  const verdict = extractJson(raw);
  if (!verdict || typeof verdict.verdict !== "string")
    return { ok: false, reason: "verifier returned invalid JSON" };
  if (verdict.verdict === "pass") return { ok: true };
  const problems = Array.isArray(verdict.problems) ? verdict.problems.join("; ") : "unspecified";
  return { ok: false, reason: `verifier: ${problems}` };
}

// ─── Generation ─────────────────────────────────────────────────────────────

/**
 * Generate, validate and return one day's puzzle.
 * Returns { ok: true, payload, categories } or { ok: false, reason }.
 * Does not write to the database — the caller owns storage.
 */
export async function generateDay(env, date, usedCategories, recentGroups = []) {
  const recentUsed = [...usedCategories].slice(-400); // keep the prompt bounded

  // Show the setter the WORDS of recent grids, not just the category names.
  // Without this it cannot know a crowd-pleaser idea ("things that can be
  // golden") is already banked, and it re-proposes the same group over and
  // over — each attempt a paid API call the repeat-blocker then throws away.
  // Newest sets come first from the loader; sets written this run are
  // appended at the end, so keep both ends when trimming.
  const promptSets =
    recentGroups.length <= 60
      ? recentGroups
      : [...recentGroups.slice(0, 48), ...recentGroups.slice(-12)];
  const takenSets = promptSets.map((s) => `[${[...s].join(", ")}]`).join(" ");

  const userPrompt =
    `Set the Groupie grid for ${date}.\n\n` +
    `Categories already used, oldest to newest (never reuse these, or near-rewordings of them): ` +
    (recentUsed.length ? recentUsed.join(" | ") : "none yet") +
    `\n\nGroups already published or banked, as word-sets. NEVER rebuild one of ` +
    `these sets under any name — a new group may share at most TWO words with ` +
    `any one set below. Fresh material beats familiar material: ` +
    (takenSets || "none yet") +
    `\n\nReturn the JSON object only.`;

  let raw;
  try {
    raw = await callAnthropic(env, SYSTEM_PROMPT, userPrompt);
  } catch (err) {
    return { ok: false, reason: `API error: ${err.message}` };
  }

  const parsed = extractJson(raw);
  if (!parsed) return { ok: false, reason: "Model did not return valid JSON" };

  const problem = validateDay(parsed, usedCategories, recentGroups);
  if (problem) return { ok: false, reason: problem };

  // Adversarial second pass: a fresh call fact-checks membership and
  // letter-surgery exactness. Days that don't survive are rejected.
  const verified = await verifyGrid(env, parsed);
  if (!verified.ok) return { ok: false, reason: verified.reason };

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

export function validateDay(parsed, usedCategories, recentGroups = []) {
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

  // Proof of work for the wordplay group: a declared mechanism plus
  // tile←base pairs, checked by machine. This is the deterministic gate —
  // broken letter arithmetic cannot pass it, whatever the model claims.
  const level4 = parsed.groups.find((g) => g && g.difficulty === 3);
  const level4Words = new Set(
    ((level4 && level4.words) || []).map((w) => String(w).trim().toUpperCase())
  );
  const wordplayProblem = checkWordplay(parsed.wordplay, level4Words);
  if (wordplayProblem) return wordplayProblem;

  if (typeof parsed.trap !== "string" || parsed.trap.trim().length < 20)
    return "No trap described — a grid without red herrings is a sort, not a puzzle";
  if (/no,? wait|let me reconsider|actually,? (no|wrong)/i.test(parsed.trap))
    return "Trap contains hedging — the setter is unsure of its own grid";

  // No re-serving old material under a reworded name: if any new group
  // shares 3+ words with a previously published group, it's a repeat.
  for (const g of parsed.groups) {
    const words = new Set(g.words.map((w) => String(w).trim().toUpperCase()));
    for (const old of recentGroups) {
      let overlap = 0;
      for (const w of old) if (words.has(w)) overlap++;
      if (overlap >= 3)
        return `Group "${g.name}" repeats ${overlap} words from a previously published group`;
    }
  }

  return null; // all good
}

// ─── Anthropic ──────────────────────────────────────────────────────────────

async function callAnthropic(env, system, user, temperature = 1, maxTokens = 3000) {
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
      max_tokens: maxTokens,
      temperature,
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

// Pull a JSON object out of a completion that may wrap it in prose or
// fences. Models asked for "JSON only" still narrate sometimes — and the
// verifier is explicitly invited to show its working before the verdict —
// so scan for balanced top-level {...} spans and return the LAST one that
// parses (the final answer, not a worked example along the way).
function extractJson(text) {
  const cleaned = stripFences(text);
  try {
    return JSON.parse(cleaned);
  } catch {
    /* fall through to the scan */
  }
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  let found = null;
  for (let i = 0; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (escaped) { escaped = false; continue; }
    if (ch === "\\") { escaped = inString; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === "}" && depth > 0) {
      depth--;
      if (depth === 0 && start >= 0) {
        try {
          found = JSON.parse(cleaned.slice(start, i + 1));
        } catch {
          /* not valid JSON — keep scanning */
        }
        start = -1;
      }
    }
  }
  return found;
}
