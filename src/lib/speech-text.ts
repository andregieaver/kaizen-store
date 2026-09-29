/**
 * Text for the AI manager's voice mode (D104), pure so it is tested and
 * shared by the browser and the server: answers are cut into sentences as
 * they stream in, so the first is spoken while the rest is still written;
 * what cannot be said (links, ids, list marks) is left out; transcripts that
 * are only noise are dropped; and a spoken yes or no is recognised.
 */

/** A piece is spoken once it ends a sentence and is at least this long (short ones wait for the next). */
const MIN_PIECE = 28;
/** A piece longer than this is cut at a comma or a space, so speech never waits for a very long sentence. */
const MAX_PIECE = 280;

/**
 * The sentences ready to be spoken from text that is still arriving, and
 * what is left to wait for. With `final`, everything left is ready.
 */
export function takeSentences(buffer: string, final = false): { ready: string[]; rest: string } {
  const ready: string[] = [];
  let rest = buffer;
  for (;;) {
    const end = sentenceEnd(rest);
    if (end === -1) break;
    ready.push(rest.slice(0, end).trim());
    rest = rest.slice(end);
  }
  while (rest.length > MAX_PIECE) {
    const window = rest.slice(0, MAX_PIECE);
    const cut = Math.max(window.lastIndexOf(", "), window.lastIndexOf(" "));
    const at = cut > MIN_PIECE ? cut + 1 : MAX_PIECE;
    ready.push(rest.slice(0, at).trim());
    rest = rest.slice(at);
  }
  if (final && rest.trim()) {
    ready.push(rest.trim());
    rest = "";
  }
  return { ready: ready.filter(Boolean), rest };
}

/** Where the first sentence long enough to speak ends, or -1. */
function sentenceEnd(text: string): number {
  const pattern = /[.!?…](?=[\s"')\]]+\S|[\s"')\]]*\n)|\n+/g;
  for (const match of text.matchAll(pattern)) {
    const end = (match.index ?? 0) + match[0].length;
    // "12.5" and "kr. 20" are not sentence ends: only a mark followed by space or a line break.
    if (text.slice(0, end).trim().length >= MIN_PIECE) return end;
  }
  return -1;
}

/**
 * What is said aloud: the words, without Markdown marks, list bullets,
 * links, admin addresses or ids (the screen shows those).
 */
export function speakable(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/\[([^\]]+)\]\((?:[^)]+)\)/g, "$1")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/(?:^|\s)\/admin\/\S*/g, " ")
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, " ")
    .replace(/^\s*(?:[-*•]|\d+[.)])\s+/gm, "")
    .replace(/[*_`#>|]+/g, "")
    .replace(/\s*\n+\s*/g, ". ")
    .replace(/\s{2,}/g, " ")
    .replace(/(?:\.\s*){2,}/g, ". ")
    .replace(/^[\s.]+/, "")
    .trim();
}

/** What speech-to-text makes of silence and noise, which is never a message. */
const NOISE = [
  "thank you",
  "thanks",
  "thank you for watching",
  "thanks for watching",
  "please subscribe",
  "subscribe",
  "you",
  "bye",
  "takk",
  "takk for meg",
  "tack",
  "tak",
  "danke",
  "amara.org",
  "undertekster",
  "subtitles",
  "music",
  "musikk",
];

/** A transcript that is only filler or a stuck loop: dropped, and listening goes on. */
export function isNoiseTranscript(text: string): boolean {
  const clean = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s.]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.\s]+$/, "");
  if (clean.length < 2) return true;
  if (NOISE.includes(clean) || /amara\.org|undertekst|subtitles by/.test(clean)) return true;
  // The same word over and over ("you you you you").
  const words = clean.split(" ");
  return words.length >= 4 && new Set(words).size === 1;
}

const NO = /\b(no|nope|don'?t|do not|cancel|stop|wait|nei|ikke|nej|inte|inga?|nein|nicht|älä|ei)\b/i;
const YES =
  /\b(yes|yeah|yep|yup|sure|ok(?:ay)?|go ahead|do it|approved?|confirm(?:ed)?|please do|ja|jo|jepp|japp|gjør det|kjør|kör|godkjenn(?:er)?|godkänn(?:er)?|gör det|gjer det|godkend|gør det|doch|mach(?:e)? es|kyllä|joo)\b/i;

/**
 * Whether a message says yes to what is waiting, plainly: a yes word and no
 * no word. Only then may a kept change be approved from speech or text.
 */
export function saysYes(text: string): boolean {
  return YES.test(text) && !NO.test(text);
}

/** A live voice model (D105) takes at most this much text appended at once (about 500 tokens). */
export const LIVE_APPEND_MAX = 1800;

/** Text for a live voice model to say, cut at a sentence end to what it takes at once. */
export function clipForLive(text: string): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= LIVE_APPEND_MAX) return t;
  const cut = t.slice(0, LIVE_APPEND_MAX);
  const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("? "), cut.lastIndexOf("! "));
  return (end > 600 ? cut.slice(0, end + 1) : cut).trim();
}

export type LiveTurn = { role: "user" | "assistant"; text: string };

/** Turns of a live call sent by the page, checked: shape, size, and nothing empty; a segment's leading ">" is dropped. */
export function readLiveTurns(raw: unknown): LiveTurn[] {
  if (!Array.isArray(raw)) return [];
  const out: LiveTurn[] = [];
  for (const t of raw.slice(-60)) {
    if (!t || typeof t !== "object") continue;
    const { role, text } = t as { role?: unknown; text?: unknown };
    if ((role !== "user" && role !== "assistant") || typeof text !== "string") continue;
    const clean = text.replace(/\s+/g, " ").replace(/^[>\s]+/, "").trim().slice(0, 4000);
    if (clean) out.push({ role, text: clean });
  }
  return out;
}
