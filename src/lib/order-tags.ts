/**
 * Order tags (wave 3, run 2, D173, `docs/wave-3-orders.md` 4.2): short staff labels on an order, per store, case-insensitive, at most 40 characters, at
 * most 250 on an order. Pure: the screens, the server (`src/server/order-tags.ts`) and the AI manager share these functions, and the database says the same
 * numbers (`order_tags` checks and the trigger `order_tags_limit()`).
 *
 * A tag is entered as text and normalised: Unicode NFC, trimmed, runs of whitespace made one space. Its key is that text lower-cased with
 * `toLowerCase()` (not locale dependent), so `VIP` and `vip` are one tag; the label kept on an order is the first spelling written there. Length counts code
 * points. Letters of every language are allowed (Shopify allows only letters, numbers and hyphens and warns that accents break its search; Kaizen's stores write
 * Norwegian, Swedish and Danish and the search compares lower-cased text in Postgres). Refused: nothing left, over 40 code points, a comma, a control
 * character, a bidirectional control or a zero-width character (they disguise text).
 *
 * Tag text is staff text: never sent to a shopper, never in a feed, a sitemap, structured data, the chat agent's answers or the WordPress API.
 */
import { TAGS_PER_ORDER, TAG_MAX_LENGTH } from "./order-limits";

export { TAGS_PER_ORDER, TAG_MAX_LENGTH };

/** A tag as kept: the key is the identity, the label the spelling shown. */
export type Tag = { key: string; label: string };

export type TagProblem = "empty" | "too_long" | "invalid_chars";

export type TagResult = { ok: true; tag: Tag } | { ok: false; problem: TagProblem };

/** What staff read when a tag is refused. */
export const TAG_PROBLEM_TEXT: Record<TagProblem, string> = {
  empty: "A tag cannot be empty.",
  too_long: `A tag is at most ${TAG_MAX_LENGTH} characters.`,
  invalid_chars: "A tag cannot hold a comma or a control character.",
};

/**
 * What a tag may not hold: a comma, a control character (C0, DEL and C1), the bidirectional controls (U+202A to U+202E, U+2066 to U+2069) and the zero-width
 * characters (U+200B to U+200D, U+FEFF). Written as escapes so this source holds none of them. (Whitespace, tabs and new lines included, is collapsed to one
 * space before this is asked, so it never reaches it.)
 */
const NOT_ALLOWED = /[,\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069\u200b-\u200d\ufeff]/;

const codePoints = (value: string): number => [...value].length;

/** Normalises a tag as typed. */
export function normaliseTag(input: unknown): TagResult {
  if (typeof input !== "string") return { ok: false, problem: "empty" };
  const label = input.normalize("NFC").replace(/\s+/g, " ").trim();
  if (label === "") return { ok: false, problem: "empty" };
  if (NOT_ALLOWED.test(label)) return { ok: false, problem: "invalid_chars" };
  const key = label.toLowerCase();
  // Lower-casing can lengthen a text ("İ" becomes two code points), and the database limits the key, so both are held to the limit.
  if (codePoints(label) > TAG_MAX_LENGTH || codePoints(key) > TAG_MAX_LENGTH) return { ok: false, problem: "too_long" };
  return { ok: true, tag: { key, label } };
}

/** The key of a tag as typed (null when it is not a valid tag): how a filter or a remove names one. */
export const tagKey = (input: unknown): string | null => {
  const result = normaliseTag(input);
  return result.ok ? result.tag.key : null;
};

export type TagList = {
  /** The valid tags, once each (the first spelling wins), in the order typed. */
  tags: Tag[];
  /** The fragments refused, with why. */
  problems: { input: string; problem: TagProblem }[];
};

/** Splits typed text on commas into tags (an empty fragment, as after a trailing comma, is ignored). */
export function parseTagList(text: unknown): TagList {
  const out: TagList = { tags: [], problems: [] };
  if (typeof text !== "string") return out;
  const seen = new Set<string>();
  for (const fragment of text.split(",")) {
    if (fragment.trim() === "") continue;
    const result = normaliseTag(fragment);
    if (!result.ok) out.problems.push({ input: fragment.trim(), problem: result.problem });
    else if (!seen.has(result.tag.key)) {
      seen.add(result.tag.key);
      out.tags.push(result.tag);
    }
  }
  return out;
}

/** Tags from a list of strings (an AI tool's or a form's arguments), as `parseTagList()` does for text; the strings are not split on commas. */
export function tagsOf(values: readonly unknown[]): TagList {
  const out: TagList = { tags: [], problems: [] };
  const seen = new Set<string>();
  for (const value of values) {
    const result = normaliseTag(value);
    if (!result.ok) out.problems.push({ input: typeof value === "string" ? value : "", problem: result.problem });
    else if (!seen.has(result.tag.key)) {
      seen.add(result.tag.key);
      out.tags.push(result.tag);
    }
  }
  return out;
}

export type TagChange = {
  /** Tags the order did not have and now has (the first spelling written). */
  added: Tag[];
  /** Tags the order had and no longer has (as spelled on the order). */
  removed: Tag[];
  /** Tags asked for that the order already had; asked to remove that it did not have. Neither is an error. */
  alreadyHad: Tag[];
  didNotHave: Tag[];
  /** Tags that did not fit under the limit of 250 and were not added (the order was full). */
  refused: Tag[];
  /** The tags the order has after the change. */
  next: Tag[];
  /** Whether anything changed (nothing to write, nothing to log, when not). */
  changed: boolean;
};

/**
 * What adding and removing tags does to the tags an order has. Removes happen first, then adds in the order given; an add beyond `TAGS_PER_ORDER` is refused
 * for that tag (the order is full) and does not stop the others. Adding a tag that is there, and removing one that is not, change nothing and are not errors.
 */
export function tagChange(current: readonly Tag[], change: { add?: readonly Tag[]; remove?: readonly Tag[] }): TagChange {
  const next = new Map<string, Tag>(current.map((t) => [t.key, t]));
  const out: TagChange = { added: [], removed: [], alreadyHad: [], didNotHave: [], refused: [], next: [], changed: false };
  const seenRemove = new Set<string>();
  for (const tag of change.remove ?? []) {
    if (seenRemove.has(tag.key)) continue;
    seenRemove.add(tag.key);
    const have = next.get(tag.key);
    if (have) {
      next.delete(tag.key);
      out.removed.push(have);
    } else out.didNotHave.push(tag);
  }
  const seenAdd = new Set<string>();
  for (const tag of change.add ?? []) {
    if (seenAdd.has(tag.key)) continue;
    seenAdd.add(tag.key);
    if (next.has(tag.key)) out.alreadyHad.push(next.get(tag.key)!);
    else if (next.size >= TAGS_PER_ORDER) out.refused.push(tag);
    else {
      next.set(tag.key, tag);
      out.added.push(tag);
    }
  }
  out.next = [...next.values()];
  out.changed = out.added.length > 0 || out.removed.length > 0;
  return out;
}

/**
 * The words of the history event `order.tags_changed`, kept in `data.note` (the one free-text key of an event the erasure removes with the order's
 * personal data, D162): `Added: vip, late. Removed: test`. Empty when nothing changed.
 */
export function tagChangeNote(change: Pick<TagChange, "added" | "removed">): string {
  const parts: string[] = [];
  if (change.added.length > 0) parts.push(`Added: ${change.added.map((t) => t.label).join(", ")}`);
  if (change.removed.length > 0) parts.push(`Removed: ${change.removed.map((t) => t.label).join(", ")}`);
  return parts.join(". ");
}

/** What a bulk add or remove says about one order when it changed nothing, or refused something. */
export const TAG_CHANGE_TEXT = {
  alreadyHad: "already had",
  didNotHave: "did not have",
  limit: `already has ${TAGS_PER_ORDER} tags`,
} as const;
