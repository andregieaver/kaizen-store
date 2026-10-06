/**
 * The words of the order list's search (wave 3, run 2, D173, `docs/wave-3-orders.md` 2.2.1 and 4.4). Pure: it turns what was typed into at most five words,
 * each ready to be a BOUND parameter of the one SQL builder (`orderListWhere()`); nothing a person typed is ever a column, an operator or a keyword.
 *
 * The text is normalised (Unicode NFC, whitespace collapsed, trimmed), cut to 100 characters and split into words; a word shorter than 2 characters is ignored
 * unless it is all digits; more than 5 words are ignored (`truncated` says so). Every word must match an order (AND); a word matches when any of these holds: its
 * order number (the word without a leading `#`, upper-cased, is the number or the start of it; only a word with a digit), its email contains it, a name on it contains it,
 * a line's title or SKU contains it, one of its tags is or starts with it, or a shipment's tracking number equals it. Phone numbers, street addresses and postal
 * codes are not searchable. `%`, `_` and `\` in a word are literals: `escapeLike()` puts a backslash before each, and the SQL says `ESCAPE '\'`.
 */
import { SEARCH_MAX_LENGTH, SEARCH_MAX_WORDS, SEARCH_MIN_WORD } from "./order-limits";

export { SEARCH_MAX_LENGTH, SEARCH_MAX_WORDS, SEARCH_MIN_WORD };

/** A word for a `LIKE` pattern: `\`, `%` and `_` are literal characters (the query says `ESCAPE '\'`). */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export type SearchWord = {
  /** The word as typed (NFC). */
  raw: string;
  /** The word for `lower(column) LIKE '%' || lower($n) || '%'`: escaped, not lower-cased (Postgres folds both sides the same way). */
  like: string;
  /** The word as a tag key: NFC and lower-cased by `toLowerCase()`, as `normaliseTag()` makes a key. */
  key: string;
  /** The word as the start of an order number (leading `#` removed, upper-cased, escaped for `LIKE`), or null when the word has no digit and is no number. */
  numberLike: string | null;
};

export type SearchWords = {
  /** The text after normalisation and the cut: what the box shows again. */
  text: string;
  words: SearchWord[];
  /** More words were typed than are used. */
  truncated: boolean;
};

const codePoints = (value: string): string[] => [...value];

/** Normalises what was typed in the search box: NFC, whitespace collapsed, trimmed, cut to `SEARCH_MAX_LENGTH` code points. Control characters become spaces. */
export function normaliseSearch(value: unknown): string {
  if (typeof value !== "string") return "";
  const text = value.normalize("NFC").replace(/[\s\u0000-\u001f\u007f-\u009f]+/g, " ").trim();
  const cut = codePoints(text).slice(0, SEARCH_MAX_LENGTH).join("").trim();
  return cut;
}

/** The words of a search, as the module comment says. */
export function searchWords(value: unknown): SearchWords {
  const text = normaliseSearch(value);
  if (text === "") return { text: "", words: [], truncated: false };
  const usable = text.split(" ").filter((word) => codePoints(word).length >= SEARCH_MIN_WORD || /^[0-9]$/.test(word));
  const words: SearchWord[] = usable.slice(0, SEARCH_MAX_WORDS).map((raw) => {
    const number = raw.replace(/^#/, "");
    return {
      raw,
      like: escapeLike(raw),
      key: raw.toLowerCase(),
      numberLike: /[0-9]/.test(number) && number !== "" ? escapeLike(number.toUpperCase()) : null,
    };
  });
  return { text, words, truncated: usable.length > SEARCH_MAX_WORDS };
}

/** The search as the box should show it: the usable words only (what was ignored is gone), joined by one space. */
export const searchText = (value: unknown): string => searchWords(value).words.map((w) => w.raw).join(" ");
