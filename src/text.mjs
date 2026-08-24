// Phrase mining, vocabulary and rage scoring over both corpora. EN + RU.
// Everything is regex-and-counting; no model, no network.

// JS \b is ASCII-only — it never fires between a space and "т", so every Cyrillic
// pattern in this file spells its boundaries out explicitly.
const W0 = "(?<![\\p{L}\\p{N}])";
const W1 = "(?![\\p{L}\\p{N}])";
/** Matches at a word start; the tail is free (stems, inflections). */
const stem = (body) => new RegExp(W0 + "(?:" + body + ")", "iu");
/** Matches a whole word. */
const word = (body) => new RegExp(W0 + "(?:" + body + ")" + W1, "iu");

// ---- Phrase patterns ------------------------------------------------------
// Each category is a list of markers; a message scores a category at most once.
export const PHRASE_PATTERNS = [
  ["Narrated an action", [
    word("i'?ll|let me|i'?m going to|now i|first,? i|next,? i"),
    stem("сейчас|дальше|начина|начну|делаю|сделаю|добавля|добавлю|пишу|напишу|правлю|поправлю"),
    stem("проверя|проверю|запуска|запущу|смотрю|посмотрю|собира|соберу|чиню|починю|иду "),
  ]],
  ["Declared victory", [
    word("done|fixed|works now|all set|that'?s it|shipped|green"),
    stem("готово|сделано|исправ|починил|работает|успешно|всё чисто|все чисто|прошло|собралось"),
  ]],
  ["Asked permission", [
    word("should i|want me to|shall i|ok(ay)? to (go|proceed)|let me know if"),
    stem("хочешь,? чтобы|подтверд|можно\\?|продолжа(ть|ем)\\?|го\\?|ок\\?|добро\\?"),
  ]],
  ["Corrected itself", [
    word("actually|correction|i was wrong|to be precise|my mistake"),
    stem("на самом деле|точнее|поправк|ошиб(ся|ка была)|был неправ|неверно сказал"),
  ]],
  ["Flattered you", [
    word("great (question|point|catch|idea)|good (catch|call|point)|you'?re right|fair enough"),
    stem("отличн(ый|ое) (вопрос|замечание)|хорошее замечание|ты прав|справедливо|верно подмечено"),
  ]],
  ["Apologised", [
    word("sorry|apologies|my apologies"),
    stem("извин|прошу прощения|виноват"),
  ]],
  ["Hedged", [
    word("probably|likely|might|may|perhaps|possibly|i think|not sure"),
    stem("возможно|скорее всего|кажется|вроде|наверн|похоже,? что|не уверен"),
  ]],
];

// A stated intention announces the *next* action, so it earns a follow-up check.
const INTENTION = [
  word("i'?ll|let me|i'?m going to|next,? i|now i'?ll"),
  stem("сейчас|сделаю|проверю|запущу|напишу|добавлю|посмотрю|начну|соберу|поправлю|дальше —|дальше:"),
  stem("делаю|начина|собира|пишу"),
];

export const isIntention = (text) => INTENTION.some((re) => re.test(text));

export function minePhrases(texts) {
  const counts = new Map(PHRASE_PATTERNS.map(([name]) => [name, 0]));
  for (const text of texts) {
    for (const [name, patterns] of PHRASE_PATTERNS) {
      if (patterns.some((re) => re.test(text))) counts.set(name, counts.get(name) + 1);
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

// ---- Language and surface features ---------------------------------------
const CYRILLIC = /[Ѐ-ӿ]/g;
const LATIN = /[A-Za-z]/g;
const EMOJI = /\p{Extended_Pictographic}/gu;

const count = (text, re) => (text.match(re) ?? []).length;

/** Share of characters that live in predominantly-Cyrillic messages. */
export function russianShare(texts) {
  let ru = 0;
  let all = 0;
  for (const text of texts) {
    all += text.length;
    if (count(text, CYRILLIC) > count(text, LATIN)) ru += text.length;
  }
  return all ? ru / all : 0;
}

export const emojiCount = (texts) => texts.reduce((sum, t) => sum + count(t, EMOJI), 0);

// ---- Vocabulary -----------------------------------------------------------
const WORD = /[\p{L}][\p{L}'’-]{2,}/gu;
const STOP = new Set(
  ("the and for that this with you your are not but from have has was were will can could would should " +
   "here there them then they what when which while yours about into just like more most only than " +
   "все если для что как это над под при так уже или его она они там тебя чтобы когда быть есть " +
   "надо буду было же ну да нет очень тоже даже ещё еще этот эта эти том тем чем нас вам мне меня")
    .split(/\s+/),
);
// Fenced code and inline code are the machine's vocabulary, not anyone's voice.
const stripCode = (text) => text.replace(/```[\s\S]*?```/g, " ").replace(/`[^`\n]*`/g, " ");

function frequencies(texts) {
  const freq = new Map();
  for (const text of texts) {
    for (const raw of stripCode(text).toLowerCase().match(WORD) ?? []) {
      const w = raw.replace(/[’]/g, "'");
      if (STOP.has(w) || /^\d/.test(w)) continue;
      freq.set(w, (freq.get(w) ?? 0) + 1);
    }
  }
  return freq;
}

/** Distinctive, not frequent: words one side uses and the other never does. */
export function vocabulary(userTexts, agentTexts, top = 6) {
  const mine = frequencies(userTexts);
  const theirs = frequencies(agentTexts);
  const only = (a, b) =>
    [...a.entries()]
      .filter(([w, n]) => n >= 2 && !b.has(w))
      .sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]));
  const userOnly = only(mine, theirs);
  const agentOnly = only(theirs, mine);
  return {
    userWords: userOnly.slice(0, top).map(([w]) => w),
    agentWords: agentOnly.slice(0, top).map(([w]) => w),
    userUnique: userOnly.length,
    agentUnique: agentOnly.length,
  };
}

// ---- Rage -----------------------------------------------------------------
// Obfuscation-tolerant: lookalike latin letters folded to Cyrillic, masking characters
// dropped, runs collapsed — so "б л я", "6ля", "бл*", "бляя" all land on the same stem.
const LOOKALIKE = { a: "а", e: "е", o: "о", p: "р", c: "с", x: "х", y: "у", k: "к", m: "м", t: "т", b: "в", h: "н", "3": "з", "6": "б", "0": "о", "4": "ч" };

export function normalizeForRage(text) {
  const plain = text
    .toLowerCase()
    .replace(/[^\p{L}\s]/gu, " ")
    .replace(/(\p{L})\1{2,}/gu, "$1$1")
    .replace(/\s+/g, " ");
  const folded = text
    .toLowerCase()
    .replace(/[a-z0-9]/g, (ch) => LOOKALIKE[ch] ?? ch)
    .replace(/[^\p{L}\s]/gu, " ")
    .replace(/(\p{L})\1{2,}/gu, "$1$1")
    .replace(/\s+/g, " ");
  // Letters spaced out to dodge a filter read as one word once the gaps are closed;
  // both readings are kept so a genuine one-letter word survives too.
  const closed = folded.replace(/(?<!\p{L})\p{L}(?: \p{L})+(?!\p{L})/gu, (m) => m.replace(/ /g, ""));
  // The unfolded reading has to survive too: folding turns "fuck" into "fuск"
  // with a Cyrillic с and к, which no English pattern can ever match.
  return closed + " " + folded + " " + plain;
}

const HAS_CYRILLIC = /[\u0400-\u04FF]/;

/** One word, reduced to the letters a pattern can see. Lookalikes only fold
    inside a word that is already Cyrillic — an English word is left alone. */
function foldToken(token) {
  const lower = token.toLowerCase();
  const folded = HAS_CYRILLIC.test(lower)
    ? lower.replace(/[a-z0-9]/g, (ch) => LOOKALIKE[ch] ?? ch)
    : lower;
  return folded.replace(/[^\p{L}]/gu, "").replace(/(\p{L})\1{2,}/gu, "$1$1");
}

const PROFANITY = [stem("бля"), word("сук[аиуоеи]?"), stem("ху[йеяю]"), stem("нахуй|похуй"), stem("пизд"), stem("[зндуп]?[аое]?еб[аеёуы]"), word("fuck\\w*"), word("shit"), word("bullshit"), word("damn")];
const INSULT = [stem("идиот"), stem("дебил"), stem("кретин"), stem("туп(ой|ая|ое|ица)"), stem("мраз"), stem("даун"), word("stupid"), word("idiot"), word("moron"), word("useless"), word("garbage"), word("trash")];
const ANNOYANCE = [stem("да ты"), stem("опять"), stem("снова не"), stem("сколько раз"), stem("блин"), stem("чёрт|черт"), word("wtf"), word("seriously"), word("come on"), stem("не работает"), stem("сломал"), stem("ты что"), stem("почему опять")];
const AT_AGENT = [word("ты"), word("тебя"), word("тебе"), stem("тво[йяие]"), word("you"), word("your")];

/** Only the words that would score as profanity or an insult; annoyance is
    mild enough to stand ("блин", "wtf") and masking it would read as a typo. */
const isRude = (folded) =>
  PROFANITY.some((re) => re.test(folded)) || INSULT.some((re) => re.test(folded));

const TOKEN = /[\p{L}\p{N}][\p{L}\p{N}*@#$&_'\u2019-]*/gu;
const LETTER = /[\p{L}\p{N}]/u;

/** The sentence stays readable; the swearing does not. Inside a rude word the
    first and last letters survive and everything between them becomes an
    asterisk, so the line still scans and the word is still unmistakably
    censored — the convention every reader already knows. */
export function maskProfanity(text, mark = "*") {
  const tokens = [...text.matchAll(TOKEN)].map((m) => ({ text: m[0], at: m.index }));
  const struck = new Set();

  const condemn = (group) => {
    const spots = [];
    for (const token of group) {
      for (let i = 0; i < token.text.length; i += 1) {
        if (LETTER.test(token.text[i])) spots.push(token.at + i);
      }
    }
    for (let i = 1; i < spots.length - 1; i += 1) struck.add(spots[i]);
  };

  for (let i = 0; i < tokens.length; i += 1) {
    if (isRude(foldToken(tokens[i].text))) {
      condemn([tokens[i]]);
      continue;
    }
    // Letters spaced out to dodge a filter are one word wearing gaps, and the
    // gaps are kept when it is struck out so the line does not change length.
    if (tokens[i].text.length !== 1) continue;
    let end = i;
    while (
      end + 1 < tokens.length &&
      tokens[end + 1].text.length === 1 &&
      tokens[end + 1].at === tokens[end].at + 2
    ) end += 1;
    if (end === i) continue;
    const run = tokens.slice(i, end + 1);
    if (isRude(foldToken(run.map((t) => t.text).join("")))) {
      condemn(run);
      i = end;
    }
  }

  if (!struck.size) return text;
  const out = text.split("");
  for (const at of struck) out[at] = mark;
  return out.join("");
}

const WEIGHT = { annoyance: 1, profanity: 3, insult: 6 };

/** Shouting, not acronyms: HTML/JSON/API in a normal sentence must not count. */
export function isShouting(text) {
  const letters = text.match(/\p{L}/gu) ?? [];
  if (letters.length < 8) return false;
  const upper = letters.filter((ch) => ch === ch.toUpperCase() && ch !== ch.toLowerCase()).length;
  const words = (text.match(/(?<![\p{L}\p{N}])\p{Lu}{4,}(?![\p{L}\p{N}])/gu) ?? []).length;
  return upper / letters.length > 0.5 && words >= 2;
}

/** Score one message; ×1.5 when the anger is pointed at the agent rather than the code. */
export function rageScore(text) {
  const norm = normalizeForRage(text);
  const hits = {
    annoyance: ANNOYANCE.filter((re) => re.test(norm)).length,
    profanity: PROFANITY.filter((re) => re.test(norm)).length,
    insult: INSULT.filter((re) => re.test(norm)).length,
  };
  let score = hits.annoyance * WEIGHT.annoyance + hits.profanity * WEIGHT.profanity + hits.insult * WEIGHT.insult;
  const atAgent = score > 0 && AT_AGENT.some((re) => re.test(norm));
  if (atAgent) score *= 1.5;
  const caps = isShouting(text);
  if (caps) score += 1;
  return { score, hits, atAgent, caps };
}

/** Meter saturates at a weighted score of 2 per instruction — sustained fury, not one bad day. */
export function rageMeter(totalScore, promptCount) {
  if (!promptCount) return 0;
  return Math.min(100, Math.round((100 * totalScore) / (promptCount * 2)));
}
