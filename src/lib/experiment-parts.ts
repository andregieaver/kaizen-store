import { blockText, type PageBlock, type PageColumn, type PageContent, type PageRow, type PageTranslation } from "./page-content";

/**
 * Tests of a part of a page (D148, phase 2): a row, a column or a block, chosen in the builder. A version of a part test is
 * a copy of the whole page that differs in that part only, so serving, counting and results are the page test's; what this
 * adds is the rule that keeps it so (nothing outside the part changed), the part's own words, and the one change that
 * applying it makes (only the part, with its translations, goes into the page as it is now). Pure and shared by the
 * browser (the builder's "Test this"), the server and the tests.
 */

export type PartKind = "row" | "column" | "block";
export type PartNode = PageRow | PageColumn | PageBlock;
export type PartTarget = { kind: PartKind; id: string };

/** A block's kind in the owner's words, as the builder names it. */
const BLOCK_WORDS: Record<string, string> = {
  faq: "FAQs",
  html: "HTML",
  storePart: "Shop page",
  dualButton: "Dual button",
  socialLinks: "Social media",
  customField: "Custom fields",
  contentGrid: "Content grid",
  fieldLoop: "Field loop",
  iconList: "Icon list",
  emailForm: "Email form",
  richText: "Rich text",
};
const blockWord = (type: string) => BLOCK_WORDS[type] ?? `${type[0].toUpperCase()}${type.slice(1)}`;

/** The part with this id, with its kind, or null. Ids are unique on a page. */
export function findPart(rows: readonly PageRow[], id: string): { kind: PartKind; node: PartNode } | null {
  for (const row of rows) {
    if (row.id === id) return { kind: "row", node: row };
    for (const column of row.columns) {
      if (column.id === id) return { kind: "column", node: column };
      const block = column.blocks.find((b) => b.id === id);
      if (block) return { kind: "block", node: block };
    }
  }
  return null;
}

/** The ids of a part and of everything inside it. */
export function idsWithin(kind: PartKind, node: PartNode): string[] {
  if (kind === "block") return [node.id];
  if (kind === "column") return [node.id, ...(node as PageColumn).blocks.map((b) => b.id)];
  const row = node as PageRow;
  return [row.id, ...row.columns.flatMap((c) => [c.id, ...c.blocks.map((b) => b.id)])];
}

const blocksWithin = (kind: PartKind, node: PartNode): PageBlock[] =>
  kind === "block" ? [node as PageBlock] : kind === "column" ? (node as PageColumn).blocks : (node as PageRow).columns.flatMap((c) => c.blocks);

/** The buttons inside a part, for a test that counts clicks on one: each block's id and its text. */
export function buttonsWithin(kind: PartKind, node: PartNode): { id: string; label: string }[] {
  return blocksWithin(kind, node).flatMap((b) => (b.type === "button" && b.label.trim() ? [{ id: b.id, label: b.label.trim() }] : []));
}

const clip = (text: string, max = 40) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

export type PartInfo = { kind: PartKind; id: string; label: string; buttons: { id: string; label: string }[] };

/** What to call a part in a sentence: "Row 2", "Column 1 of row 2" or "Heading “Welcome”", and the buttons inside it. Null when the page has no such part. */
export function describePart(content: Pick<PageContent, "rows">, target: PartTarget): PartInfo | null {
  const found = findPart(content.rows, target.id);
  if (!found || found.kind !== target.kind) return null;
  const rowIndex = content.rows.findIndex((r) => r.id === target.id || r.columns.some((c) => c.id === target.id || c.blocks.some((b) => b.id === target.id)));
  let label: string;
  if (found.kind === "row") label = `Row ${rowIndex + 1}`;
  else if (found.kind === "column") {
    const columnIndex = content.rows[rowIndex].columns.findIndex((c) => c.id === target.id);
    label = `Column ${columnIndex + 1} of row ${rowIndex + 1}`;
  } else {
    const text = blockText(found.node as PageBlock).replace(/\s+/g, " ").trim();
    label = `${blockWord((found.node as PageBlock).type)}${text ? ` “${clip(text)}”` : ""} in row ${rowIndex + 1}`;
  }
  return { kind: found.kind, id: target.id, label, buttons: buttonsWithin(found.kind, found.node) };
}

/** Replaces the part with this id by another of the same kind, or returns null when the page has none. */
export function replacePart(rows: readonly PageRow[], target: PartTarget, replacement: PartNode): PageRow[] | null {
  if (findPart(rows, target.id)?.kind !== target.kind || replacement.id !== target.id) return null;
  return rows.map((row) => {
    if (target.kind === "row") return row.id === target.id ? (replacement as PageRow) : row;
    return {
      ...row,
      columns: row.columns.map((column) => {
        if (target.kind === "column") return column.id === target.id ? (replacement as PageColumn) : column;
        return { ...column, blocks: column.blocks.map((b) => (b.id === target.id ? (replacement as PageBlock) : b)) };
      }),
    };
  });
}

/** JSON with its keys in order, so two equal pages compare equal whichever way they were built. */
function canon(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canon).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined).sort(([a], [b]) => (a < b ? -1 : 1));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canon(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** The keys of a page's translations that belong to a part: `block.{id}.…` and `column.{id}.…` of anything inside it. */
const ownsKey = (ids: ReadonlySet<string>, key: string) => {
  const match = /^(?:block|column|row)\.([^.]+)\./.exec(key);
  return match !== null && ids.has(match[1]);
};

function translationsOutside(translations: PageContent["translations"], ids: ReadonlySet<string>) {
  return Object.fromEntries(
    Object.entries(translations ?? {}).map(([locale, texts]) => [locale, Object.fromEntries(Object.entries(texts).filter(([key]) => !ownsKey(ids, key)))] as const),
  ) as Record<string, PageTranslation>;
}

/**
 * Whether a version differs from the original in the part only. `missing` when either has lost the part (or it changed
 * kind), `outside` when anything else on the page is different (other rows, columns or blocks, or their texts in
 * other languages), `ok` otherwise. The page's own title, address and search texts are not compared: a version's
 * differ by design.
 */
export function partChanges(original: PageContent, version: PageContent, target: PartTarget): "ok" | "missing" | "outside" {
  const a = findPart(original.rows, target.id);
  const b = findPart(version.rows, target.id);
  if (!a || !b || a.kind !== target.kind || b.kind !== target.kind) return "missing";
  const merged = replacePart(version.rows, target, a.node);
  if (!merged || canon(merged) !== canon(original.rows)) return "outside";
  const ids = new Set([...idsWithin(a.kind, a.node), ...idsWithin(b.kind, b.node)]);
  return canon(translationsOutside(original.translations, ids)) === canon(translationsOutside(version.translations, ids)) ? "ok" : "outside";
}

/**
 * The page as it is now with the version's part in it, and the part's texts in other languages taken from the version:
 * what applying a part test publishes. Null when the page no longer has the part.
 */
export function applyPart(current: PageContent, version: PageContent, target: PartTarget): PageContent | null {
  const mine = findPart(current.rows, target.id);
  const theirs = findPart(version.rows, target.id);
  if (!mine || !theirs || mine.kind !== target.kind || theirs.kind !== target.kind) return null;
  const rows = replacePart(current.rows, target, theirs.node);
  if (!rows) return null;
  const ids = new Set([...idsWithin(mine.kind, mine.node), ...idsWithin(theirs.kind, theirs.node)]);
  const kept = translationsOutside(current.translations, ids);
  const locales = new Set([...Object.keys(kept), ...Object.keys(version.translations ?? {})]);
  const translations = Object.fromEntries(
    [...locales].map((locale) => [
      locale,
      { ...(kept[locale] ?? {}), ...Object.fromEntries(Object.entries(version.translations?.[locale] ?? {}).filter(([key]) => ownsKey(ids, key))) },
    ]),
  );
  return { ...current, rows, ...(locales.size > 0 && { translations }) };
}

/** Whether a part can be tested: a row, column or block with something to see (a shop page's working components are not). */
export function testablePart(content: Pick<PageContent, "rows">, target: PartTarget): boolean {
  const found = findPart(content.rows, target.id);
  if (!found || found.kind !== target.kind) return false;
  const blocks = blocksWithin(found.kind, found.node);
  return blocks.length > 0 && !blocks.some((b) => b.type === "storePart" || b.type === "site" || b.type === "product");
}

