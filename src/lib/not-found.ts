/**
 * The 404 report's rules (wave 2, second run, D168, `docs/wave-2-redirects.md` 2.3, 4.5, 4.6), pure: which addresses are ever recorded as missing (and which
 * never are, because they are noise or could hold a person's data), and which live address to suggest for a missing one. Nothing here reads a request: the
 * server gives it the path already put in the normal form (`normalisePath()`: the query string, fragment, headers, IP address, user agent text, cookies and
 * referrer are never read into a record), and a flag for whether the visitor is a robot.
 *
 * `recordablePath()` is the privacy rule: an address that looks like a token, an email, an id or a probe for a weak spot is not recorded at all, and neither
 * is a working page's or the platform's. `suggestTargets()` is code, never a model: the same input gives the same answer.
 */
import { NOT_FOUND_SUGGESTIONS } from "./data-limits";
import { PLATFORM_SEGMENTS, firstSegment, isWorkingPath } from "./redirect-path";

/** The longest address recorded (the table's check), the most parts, and the longest part. */
export const RECORD_PATH_MAX = 200;
export const RECORD_SEGMENTS_MAX = 8;
export const RECORD_SEGMENT_MAX = 100;

const HEX_TOKEN = /^[0-9a-f]{24,}$/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A long run of digits is an id, an order number, a national identity number (11 digits in Norway, 10 in Sweden and Denmark, 8 in a Norwegian phone number) or a phone number, not a page. */
const LONG_NUMBER = /^\+?\d{8,}$/;
/** The same digits with the breaks a person writes them with (`12 34 56 78`, `+47-123-45-678`): 8 or more digits once spaces, dots, hyphens and plus signs are gone. A plain date (`2026-10-05`) is a page. */
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const spelledNumber = (part: string): boolean => !DATE.test(part) && /^[\d .+-]+$/.test(part) && part.replace(/[ .+-]/g, "").length >= 8;
/** A long part with no word breaks is a token (a signed address, a session), not a page: pages' words are joined with hyphens. */
const TOKEN_LIKE = /^[a-z0-9_]{32,}$/i;
const ENCODED_CONTROL = /%(?:[01][0-9a-f]|7f)/i;

/**
 * Files and folders robots probe for, whatever the store sells (`PROBES`, tested): they are noise in a report of what shoppers could not find. `last` is the
 * ending of the last part; `starts` the beginning of the whole path; `contains` a folder anywhere in it.
 */
export const PROBES = {
  starts: ["/wp-", "/cgi-bin", "/phpmyadmin", "/xmlrpc", "/vendor/", "/node_modules/"],
  contains: ["/vendor/", "/node_modules/"],
  last: [".env", ".git", ".sql", ".bak", ".zip", ".php"],
} as const;

/**
 * Whether a missing address may be written down: `path` is in the normal form of `normalisePath()` (a path with no query or fragment). Refused: a working page
 * or the platform's own routes, more than 8 parts or 200 characters, a part of 24 or more hexadecimal characters, a UUID, 8 or more digits (also with spaces, dots or hyphens between them, except a date), a long part with
 * no word breaks, or longer than 100 characters, an `@` (also one encoded again), an encoded control character, and the probes of `PROBES` (any folder that starts with a dot too).
 * A legacy shop's addresses (`/collections/shoes`, `/pages/om-oss.html`) are accepted.
 */
export function recordablePath(path: string): boolean {
  if (!path.startsWith("/") || path === "/" || path.length > RECORD_PATH_MAX) return false;
  const parts = path.split("/").filter(Boolean);
  if (parts.length > RECORD_SEGMENTS_MAX) return false;
  if (isWorkingPath(path) || PLATFORM_SEGMENTS.includes(firstSegment(path))) return false;
  // What a person's data hides in is looked for in the address as it is and in what a mail client or a person's own link may have encoded again (`%2540` is
  // `%40` is `@`): every form of it up to four decodings, so a double-encoded email is no more recorded than a plain one.
  for (const form of decodedForms(path)) {
    if (form.includes("@") || ENCODED_CONTROL.test(form)) return false;
    for (const part of form.split("/").filter(Boolean)) if (HEX_TOKEN.test(part) || UUID.test(part) || LONG_NUMBER.test(part) || spelledNumber(part) || TOKEN_LIKE.test(part)) return false;
  }
  for (const part of parts) {
    if (part.length > RECORD_SEGMENT_MAX) return false;
    if (part.startsWith(".")) return false;
  }
  const lower = path.toLowerCase();
  if (PROBES.starts.some((p) => lower.startsWith(p)) || PROBES.contains.some((p) => lower.includes(p))) return false;
  const last = parts[parts.length - 1].toLowerCase();
  return !PROBES.last.some((ending) => last.endsWith(ending));
}

/** The address and what percent-decoding it once to four times gives, while it changes and can be decoded. */
function decodedForms(path: string): string[] {
  const forms = [path];
  let current = path;
  for (let i = 0; i < 4; i += 1) {
    let next: string;
    try {
      next = decodeURIComponent(current);
    } catch {
      break;
    }
    if (next === current) break;
    forms.push(next);
    current = next;
  }
  return forms;
}

// ---------------------------------------------------------------------------
// Suggested targets
// ---------------------------------------------------------------------------

export type SuggestionKind = "product" | "category" | "tag" | "page" | "article";

/** One live address of the store a missing one may be sent to. `path` is market-less (`/p/lamp`); `slug` is its last part. */
export type Candidate = { kind: SuggestionKind; path: string; slug: string; title: string };

export type Suggestion = Candidate & { score: number };

/** The kind an old shop's address shape points at: `/collections/x` a category, `/products/x` a product, `/pages/x` a page, `/blogs/…/x` an article, and ours. */
const HINTS: Record<string, SuggestionKind> = {
  collections: "category",
  category: "category",
  tag: "tag",
  tags: "tag",
  products: "product",
  p: "product",
  pages: "page",
  blogs: "article",
  blog: "article",
  news: "article",
};
const KIND_RANK: Record<SuggestionKind, number> = { product: 0, category: 1, tag: 2, page: 3, article: 4 };

/** Letters that are not an accent on another letter, so Unicode's decomposition leaves them: written as the two a keyboard without them would type. */
const LETTERS: Record<string, string> = { ø: "o", æ: "ae", ß: "ss", đ: "d", ł: "l", þ: "th", œ: "oe" };
const fold = (text: string): string =>
  text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[øæßđłþœ]/g, (c) => LETTERS[c]);
const STOP = new Set(["the", "a", "an", "of", "and", "og", "i", "en", "et", "på", "for"]);

/** The words of a slug or a title: lower case, accents folded, split on anything that is not a letter or digit, one-letter words and a few stop words left out. */
export function wordsOf(text: string): string[] {
  return fold(text)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 1 && !STOP.has(w));
}

/** The last part of a missing address without its extension (`/pages/om-oss.html` is `om-oss`). */
export function lastPartOf(path: string): string {
  const last = path.split("/").filter(Boolean).pop() ?? "";
  return last.replace(/\.(?:html?|php|aspx?|jsp)$/i, "");
}

function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  const x = a.slice(0, 100);
  const y = b.slice(0, 100);
  let previous = Array.from({ length: y.length + 1 }, (_, i) => i);
  for (let i = 1; i <= x.length; i += 1) {
    const row = [i];
    for (let j = 1; j <= y.length; j += 1) row[j] = Math.min(previous[j] + 1, row[j - 1] + 1, previous[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
    previous = row;
  }
  return previous[y.length];
}

const share = (a: readonly string[], b: readonly string[]): { shared: number; ratio: number } => {
  const setB = new Set(b);
  const shared = new Set(a.filter((w) => setB.has(w))).size;
  const bigger = Math.max(new Set(a).size, setB.size);
  return { shared, ratio: bigger === 0 ? 0 : shared / bigger };
};

/** The least share of words a suggestion must have, and the score's weight of a hinted kind. */
export const SUGGEST_MIN_SHARE = 0.5;
const HINT_BONUS = 0.1;

/**
 * Up to three live addresses a missing one may be sent to (4.5): the last part's words are compared with each candidate's handle words and title words; a
 * candidate with the SAME last part ranks first, then the largest share of shared words (a kind the address's shape points at counts a little more), then the
 * shorter edit distance, then products and categories before pages. At least half the words must be shared and at least one whole word, else nothing is
 * suggested. `path` is the missing address in the normal form. Deterministic: a tie is broken by the address.
 */
export function suggestTargets(path: string, pool: readonly Candidate[], limit: number = NOT_FOUND_SUGGESTIONS): Suggestion[] {
  const last = fold(lastPartOf(path)).replace(/[^\p{L}\p{N}-]+/gu, "-");
  const wanted = wordsOf(lastPartOf(path));
  if (last === "" || wanted.length === 0) return [];
  const hint = HINTS[firstSegment(path)];
  const scored = pool.flatMap((candidate) => {
    const slugWords = wordsOf(candidate.slug);
    const same = fold(candidate.slug) === last;
    const bySlug = share(wanted, slugWords);
    const byTitle = share(wanted, wordsOf(candidate.title));
    const best = bySlug.ratio >= byTitle.ratio ? bySlug : byTitle;
    if (!same && (best.shared < 1 || best.ratio < SUGGEST_MIN_SHARE)) return [];
    const ratio = same ? 1 : best.ratio;
    return [{ candidate, same, ratio, bonus: hint === candidate.kind ? HINT_BONUS : 0, distance: editDistance(last, fold(candidate.slug)) }];
  });
  scored.sort(
    (a, b) =>
      Number(b.same) - Number(a.same) ||
      Math.min(1, b.ratio + b.bonus) - Math.min(1, a.ratio + a.bonus) ||
      a.distance - b.distance ||
      KIND_RANK[a.candidate.kind] - KIND_RANK[b.candidate.kind] ||
      a.candidate.path.localeCompare(b.candidate.path),
  );
  const seen = new Set<string>();
  const out: Suggestion[] = [];
  for (const s of scored) {
    if (seen.has(s.candidate.path)) continue;
    seen.add(s.candidate.path);
    out.push({ ...s.candidate, score: Math.round(Math.min(1, s.ratio + s.bonus) * 1000) / 1000 });
    if (out.length >= limit) break;
  }
  return out;
}
