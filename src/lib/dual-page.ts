import { newPageContent, pageParts, PAGE_TYPES, type PageBlock, type PageColumn, type PageContent, type PageRow, type PageTranslation, type PageType } from "./page-content";
import { pageRulesProblem } from "./page-rules";
import { localizePage, translationOf } from "./page-translation";
import { copyBlock, copyColumn, copyRow, findBlock, htmlIds } from "./page-rows";

/**
 * Dual page (D412, `docs/dual-page.md`): two of the builder's documents side by side, with drag and drop between them. What is pure
 * about it: which documents can be opened, the second one's address, whether a part may be dropped on a kind of page, and the copy a
 * drop across makes.
 */

/** The two halves of the frame. */
export type DualSide = "left" | "right";
export const otherSide = (side: DualSide): DualSide => (side === "left" ? "right" : "left");

/**
 * The kinds of page the builder edits that can be one of two: not an A/B test's version (D148), which is edited from its test. A saved
 * template is the other kind of document (`template`).
 */
export const DUAL_KINDS = ["page", "article", "product_layout", "header", "footer", "entry_layout"] as const satisfies readonly PageType[];
export type DualKind = (typeof DUAL_KINDS)[number];

/** What *Create new* offers (D412 question 7): a template is made with *Save as template*, an entry page from its content type. */
export const CREATE_KINDS = {
  store: ["page", "article", "product_layout", "header", "footer"],
  kaizen: ["page", "article", "header", "footer"],
} as const satisfies Record<"store" | "kaizen", readonly DualKind[]>;

/** A document a person may open beside another: its id and title (D412). */
export type DualChoice = { id: string; title: string };

/** The second document, as the address holds it (`?with=`): one of the owner's pages by kind and id, a new one of a kind, or a saved template. */
export type DualWith = { kind: DualKind; id: string } | { kind: DualKind; id: null } | { kind: "template"; id: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isDualKind = (value: unknown): value is DualKind => typeof value === "string" && (DUAL_KINDS as readonly string[]).includes(value);

/** The address's `with`, read: `article:{id}`, `new:article` or `template:{id}`; anything else is nothing. */
export function parseDualWith(value: string | string[] | undefined): DualWith | null {
  if (typeof value !== "string") return null;
  const [head, tail, ...rest] = value.split(":");
  if (rest.length > 0 || tail === undefined) return null;
  if (head === "new") return isDualKind(tail) && tail !== "entry_layout" ? { kind: tail, id: null } : null;
  if (!UUID.test(tail)) return null;
  if (head === "template") return { kind: "template", id: tail.toLowerCase() };
  return isDualKind(head) ? { kind: head, id: tail.toLowerCase() } : null;
}

/** The address's `with` for a second document. */
export function formatDualWith(doc: DualWith): string {
  return doc.id === null ? `new:${doc.kind}` : `${doc.kind}:${doc.id}`;
}

/** A row, column or component on its way to a page. */
export type DualPart = { kind: "row"; content: PageRow } | { kind: "column"; content: PageColumn } | { kind: "block"; content: PageBlock };

/** A part as the rows of a page holding only it, as a saved part is drawn. */
function partRows(part: DualPart): PageRow[] {
  if (part.kind === "row") return [part.content];
  const column: PageColumn = part.kind === "column" ? part.content : { id: "dual-column", blocks: [part.content] };
  return [{ id: "dual-row", type: "row", layout: "1", columns: [column] }];
}

/**
 * Why a part cannot be dropped on a page of this kind, or null where it can (D412 question 2): the question a save asks
 * (`pageRulesProblem()`), of a page holding only the part, so nothing is copied that the page could not then be saved with.
 */
export function dropProblem(owner: string | null, kind: PageType, part: DualPart, variantOf: PageType | null = null): string | null {
  if (!(PAGE_TYPES as readonly string[]).includes(kind)) return null;
  return pageRulesProblem(owner, kind, { ...newPageContent(), rows: partRows(part) }, variantOf);
}

/** The part with this id in the rows, as a row, column or component (nested ones too: D294, D208); null where it is not there. */
export function findDualPart(rows: PageRow[], kind: DualPart["kind"], id: string): DualPart | null {
  if (kind === "row") {
    const row = rows.find((r) => r.id === id);
    return row ? { kind, content: row } : null;
  }
  if (kind === "block") {
    const block = findBlock(rows, id)?.block;
    return block ? { kind, content: block } : null;
  }
  // A column is the part without a type of its own.
  const column = pageParts(rows).find((part): part is PageColumn => !("type" in part) && part.id === id);
  return column ? { kind, content: column } : null;
}

/** A part copied with the ids `ids` hands out, in the same order each time it is asked. */
function copyPart(part: DualPart, id: () => string, taken: Set<string>): DualPart {
  if (part.kind === "row") return { kind: "row", content: copyRow(part.content, id, taken) };
  if (part.kind === "column") return { kind: "column", content: copyColumn(part.content, id, taken) };
  return { kind: "block", content: copyBlock(part.content, id, taken) };
}

/**
 * The copy a drop on the other page makes (D412 question 3): new ids throughout, every setting kept; a use of a global (D98) stays a use
 * of it; custom ids the target page uses already are left out (D48). Its texts' translations come along under the copy's ids: the part
 * is copied once as written and once as it reads in each of the source page's other languages, with the same ids, and what differs is
 * that language's translation.
 */
export function copyAcross(
  part: DualPart,
  source: Pick<PageContent, "rows" | "translations">,
  targetRows: PageRow[],
  newId: () => string,
): { part: DualPart; translations: Record<string, PageTranslation> } {
  const ids: string[] = [];
  let used = 0;
  // The first copy draws new ids; each later one takes the same ids in the same order.
  const draw = () => {
    const id = newId();
    ids.push(id);
    return id;
  };
  const replay = () => ids[used++] ?? newId();
  const copy = copyPart(part, draw, htmlIds(targetRows));
  const translations: Record<string, PageTranslation> = {};
  for (const locale of Object.keys(source.translations ?? {})) {
    const read = localizePage({ ...newPageContent(), rows: source.rows, translations: source.translations }, locale);
    const localized = findDualPart(read.rows, part.kind, part.content.id);
    if (!localized) continue;
    used = 0;
    const copied = copyPart(localized, replay, htmlIds(targetRows));
    const translation = translationOf({ ...newPageContent(), rows: partRows(copy) }, { ...newPageContent(), rows: partRows(copied) });
    if (Object.keys(translation).length > 0) translations[locale] = translation;
  }
  return { part: copy, translations };
}

/** The page's translations with a copy's added (D412): each language's texts for the new ids put beside its own. */
export function withCopiedTranslations(
  current: Record<string, PageTranslation> | undefined,
  added: Record<string, PageTranslation>,
): Record<string, PageTranslation> | undefined {
  if (Object.keys(added).length === 0) return current;
  const next: Record<string, PageTranslation> = { ...current };
  for (const [locale, texts] of Object.entries(added)) next[locale] = { ...next[locale], ...texts };
  return next;
}

/** Where the other page scrolls to when they scroll together (D412): as far down as this one, by pixels from the top, or its end. */
export function followScroll(top: number, other: { scrollHeight: number; clientHeight: number }): number {
  return Math.max(0, Math.min(top, other.scrollHeight - other.clientHeight));
}
