import { pageParts, richTextPlain, type PageBlock, type PageColumn, type PageContent, type PageRow, type PageText } from "./page-content";
import { mapTexts, pageTextLabels } from "./page-translation";
import type { StoreTheme, ThemeSettings } from "./theme";

/**
 * Two versions compared in words (wave 9 unit E, D358, `docs/wave-9-platform.md` section 3, E): what a page's texts, rows and settings are
 * in one version and not the other, and which areas of a look differ. Pure and free of the database, so the versions dialogs compare in the
 * browser what they already read. Every difference is a fact the dialog words; nothing here judges a change.
 */

export type PageDifference =
  | { kind: "field"; field: "title" | "slug" | "excerpt" | "seo" | "thumbnail" | "css" | "terms" | "markets" | "search" }
  | { kind: "text"; key: string; label: string; before: string; after: string }
  | { kind: "row_added" | "row_removed"; row: number }
  | { kind: "row_moved"; from: number; to: number }
  | { kind: "block_added" | "block_removed"; block: string; row: number }
  | { kind: "settings"; part: "row" | "column" | "block"; block: string | null; row: number };

const TEXT_SHOWN = 160;

/** A text's words for a person: rich text as its plain words, cut where it is long. */
function words(value: PageText | undefined): string {
  const plain = value === undefined ? "" : typeof value === "string" ? value : richTextPlain(value);
  return plain.length > TEXT_SHOWN ? `${plain.slice(0, TEXT_SHOWN - 1)}…` : plain;
}

/** Every text of a page by its place (`block.{id}.text`, `title`, …). */
function textsOf(content: PageContent): Map<string, PageText> {
  const out = new Map<string, PageText>();
  mapTexts(content, (key, value) => {
    out.set(key, value);
    return value;
  });
  return out;
}

/** The id a text's place names (`block.{id}.…`, `column.{id}.…`), or null for the page's own (title, search texts). */
const partOfKey = (key: string): string | null => /^(?:block|column)\.([^.]+)\./.exec(key)?.[1] ?? null;

/** Which row each row, column and block is in, by id. */
function rowsOfParts(rows: PageRow[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const row of rows) for (const part of pageParts([row])) out.set(part.id, row.id);
  return out;
}

/** A part's own settings, without what it holds and without its words, to tell a change of settings from one of words or contents. */
function ownSettings(part: PageRow | PageColumn | PageBlock): string {
  const { columns: _c, blocks: _b, ...rest } = part as Record<string, unknown>;
  const items = Array.isArray(rest.items) ? (rest.items as Record<string, unknown>[]).map(({ blocks: _x, ...item }) => item) : rest.items;
  return JSON.stringify({ ...rest, ...(items !== undefined && { items }) });
}

/** The ids of the longest run kept in the same order (the rest moved), by patience sorting over their places in `after`. */
function keptInOrder(ids: string[], placeAfter: Map<string, number>): Set<string> {
  const seq = ids.map((id) => placeAfter.get(id)!);
  const tails: number[] = [];
  const tailAt: number[] = [];
  const prev: number[] = new Array(seq.length).fill(-1);
  seq.forEach((value, i) => {
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (tails[mid] < value) lo = mid + 1;
      else hi = mid;
    }
    tails[lo] = value;
    tailAt[lo] = i;
    prev[i] = lo > 0 ? tailAt[lo - 1] : -1;
  });
  const kept = new Set<string>();
  let at = tails.length > 0 ? tailAt[tails.length - 1] : -1;
  while (at >= 0) {
    kept.add(ids[at]);
    at = prev[at];
  }
  return kept;
}

/**
 * What differs between two versions of a page, `before` the older: the page's own fields, each text that changed (labelled as the translator
 * names it), rows added, removed or moved, components added or removed in a row both have, and rows, columns and components whose settings
 * changed. A text inside a row that only one version has is said by the row, not again by its words.
 */
export function compareVersions(before: PageContent, after: PageContent): PageDifference[] {
  const out: PageDifference[] = [];
  const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  if (before.title !== after.title) out.push({ kind: "field", field: "title" });
  if (before.slug !== after.slug) out.push({ kind: "field", field: "slug" });
  if ((before.excerpt ?? "") !== (after.excerpt ?? "")) out.push({ kind: "field", field: "excerpt" });
  if (!same(before.seo, after.seo)) out.push({ kind: "field", field: "seo" });
  if (!same(before.thumbnail?.url, after.thumbnail?.url)) out.push({ kind: "field", field: "thumbnail" });
  if ((before.css ?? "") !== (after.css ?? "")) out.push({ kind: "field", field: "css" });
  if (!same([before.categories, before.tags], [after.categories, after.tags])) out.push({ kind: "field", field: "terms" });
  if (!same(before.markets ?? [], after.markets ?? [])) out.push({ kind: "field", field: "markets" });
  if (before.searchEngines !== after.searchEngines || before.aiAssistants !== after.aiAssistants) out.push({ kind: "field", field: "search" });

  const beforeRows = new Map(before.rows.map((r, i) => [r.id, i]));
  const afterRows = new Map(after.rows.map((r, i) => [r.id, i]));
  for (const [id, i] of beforeRows) if (!afterRows.has(id)) out.push({ kind: "row_removed", row: i + 1 });
  for (const [id, i] of afterRows) if (!beforeRows.has(id)) out.push({ kind: "row_added", row: i + 1 });
  const common = before.rows.map((r) => r.id).filter((id) => afterRows.has(id));
  const kept = keptInOrder(common, afterRows);
  for (const id of common) if (!kept.has(id)) out.push({ kind: "row_moved", from: beforeRows.get(id)! + 1, to: afterRows.get(id)! + 1 });

  // Words: texts of the page and of rows both versions have.
  const rowOfBefore = rowsOfParts(before.rows);
  const rowOfAfter = rowsOfParts(after.rows);
  const labels = new Map([...pageTextLabels(before), ...pageTextLabels(after)]);
  const textsBefore = textsOf(before);
  const textsAfter = textsOf(after);
  for (const key of new Set([...textsBefore.keys(), ...textsAfter.keys()])) {
    if (key === "title" || key === "excerpt" || key.startsWith("seo.")) continue;
    const part = partOfKey(key);
    const row = part ? (rowOfAfter.get(part) ?? rowOfBefore.get(part)) : null;
    if (row && !(beforeRows.has(row) && afterRows.has(row))) continue;
    const a = words(textsBefore.get(key));
    const b = words(textsAfter.get(key));
    if (a === b) continue;
    out.push({ kind: "text", key, label: labels.get(key) ?? key, before: a, after: b });
  }

  // Contents and settings of rows both versions have, with the words left out.
  const blank = (c: PageContent) => mapTexts(c, (_k, value) => (typeof value === "string" ? "" : { type: "doc", content: [] }));
  const plainBefore = blank(before);
  const plainAfter = blank(after);
  const partsBefore = new Map(pageParts(plainBefore.rows).map((p) => [p.id, p]));
  const partsAfter = new Map(pageParts(plainAfter.rows).map((p) => [p.id, p]));
  for (const row of plainAfter.rows) {
    if (!beforeRows.has(row.id)) continue;
    const place = afterRows.get(row.id)! + 1;
    const mine = pageParts([row]);
    const was = pageParts(plainBefore.rows.filter((r) => r.id === row.id));
    for (const part of was) {
      if (!partsAfter.has(part.id) && "type" in part) out.push({ kind: "block_removed", block: (part as PageBlock).type, row: place });
    }
    for (const part of mine) {
      const old = partsBefore.get(part.id);
      const kind = part.id === row.id ? "row" : "type" in part ? "block" : "column";
      if (!old) {
        if (kind === "block") out.push({ kind: "block_added", block: (part as PageBlock).type, row: place });
        continue;
      }
      if (ownSettings(old) !== ownSettings(part)) out.push({ kind: "settings", part: kind, block: kind === "block" ? (part as PageBlock).type : null, row: place });
    }
  }
  return out;
}

/** The areas of a look a person knows, each the settings it holds. */
export const LOOK_AREAS = ["base", "colours", "fonts", "headings", "buttons", "corners", "layout", "productCards", "elements", "sectionStyles", "hover", "checkout", "breakpoints", "library"] as const;
export type LookArea = (typeof LOOK_AREAS)[number];

const AREA_KEYS: Record<Exclude<LookArea, "base">, (keyof ThemeSettings)[]> = {
  colours: ["mode", "visitorSwitch", "light", "dark"],
  fonts: ["fonts"],
  headings: ["headings"],
  buttons: ["buttons"],
  corners: ["corners"],
  layout: ["layout"],
  productCards: ["productCards"],
  elements: ["elements"],
  sectionStyles: ["sectionStyles"],
  hover: ["hover"],
  checkout: ["checkout"],
  breakpoints: ["breakpoints"],
  library: ["library"],
};

/** Which areas of a look differ between two versions of it (the theme it is built on, its colours, fonts, …), in `LOOK_AREAS`' order. */
export function compareLooks(before: StoreTheme, after: StoreTheme): LookArea[] {
  const out: LookArea[] = [];
  if (before.base !== after.base) out.push("base");
  for (const area of LOOK_AREAS) {
    if (area === "base") continue;
    const keys = AREA_KEYS[area];
    const a = JSON.stringify(keys.map((k) => before.settings[k] ?? null));
    const b = JSON.stringify(keys.map((k) => after.settings[k] ?? null));
    if (a !== b) out.push(area);
  }
  return out;
}
