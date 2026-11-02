import { newPageContent, pageParts, PAGE_TYPES, type PageBlock, type PageColumn, type PageContent, type PageRow, type PageTranslation, type PageType } from "./page-content";
import { pageRulesProblem } from "./page-rules";
import { localizePage, translationOf } from "./page-translation";
import { copyBlock, copyColumn, copyRow, findBlock, htmlIds } from "./page-rows";
import { partRows as savedPartRows } from "./saved-part-canvas";
import type { SavedPart } from "./saved-parts";

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

/**
 * What a dual page's second half holds (D424): a document, nothing (closed, waiting for one to be opened there), or `mirror`: the first
 * document again at another screen size, one document in one editor drawn on two canvases.
 */
export type DualSecond = DualWith | "empty" | "mirror";

/** The address's `with` as the second half: `empty`, `mirror` or a document (`parseDualWith()`); null where it is none of them. */
export function parseDualSecond(value: string | string[] | undefined): DualSecond | null {
  if (value === "empty" || value === "mirror") return value;
  return parseDualWith(value);
}

/** The address's `with` for the second half. */
export const formatDualSecond = (second: DualSecond): string => (typeof second === "string" ? second : formatDualWith(second));

/** The address's own document: the first half's, never a saved template, which has no address of its own. */
export type DualFirst = { kind: DualKind; id: string | null };

/**
 * What a dual page shows, as its address holds it (D412, D424): the address's own document in the first half unless it was closed
 * (`?first=empty`), the second half (`?with=`), and whether the halves are drawn swapped, the second on the left (`?swap=1`). A
 * `DualSide` names a half by its document, `left` the first and `right` the second; `shownAt()` says where it is drawn.
 */
export type DualLayout = { first: DualFirst; firstOpen: boolean; second: DualSecond; swap: boolean };

/** Where a half is drawn, and which half is drawn at a place: its own place, or the other once swapped. */
export const shownAt = (side: DualSide, swap: boolean): DualSide => (swap ? otherSide(side) : side);

/** The same document: by id, never a new one (two new pages are two pages) or a template (never the first). */
const sameDoc = (a: DualWith, b: DualFirst): boolean => a.kind !== "template" && a.id !== null && a.id === b.id;

/**
 * The address read (D424): null where it asks for no second half or one not understood. A second half naming the first document is the
 * same document again (`mirror`); the same document again while the first half is closed is that document alone.
 */
export function parseDualLayout(
  first: DualFirst,
  query: { with?: string | string[]; first?: string | string[]; swap?: string | string[] },
): DualLayout | null {
  const read = parseDualSecond(query.with);
  if (!read) return null;
  const second = typeof read === "object" && sameDoc(read, first) ? "mirror" : read;
  const firstOpen = query.first !== "empty";
  const swap = query.swap === "1";
  if (second === "mirror" && !firstOpen) return { first, firstOpen: true, second: "empty", swap };
  return { first, firstOpen, second, swap };
}

/** The address of what a dual page shows: the first document's editor, with the second half, a closed first half and a swap. */
export function dualHref(base: (kind: DualKind) => string, layout: DualLayout): string {
  const params = new URLSearchParams({ with: formatDualSecond(layout.second) });
  if (!layout.firstOpen) params.set("first", "empty");
  if (layout.swap) params.set("swap", "1");
  return `${base(layout.first.kind)}/${layout.first.id ?? "new"}?${params}`;
}

/**
 * A half closed (D424): it is empty, ready for another document. Closing either canvas of the same document twice leaves the document
 * once, where the other canvas was.
 */
export function closeHalf(layout: DualLayout, side: DualSide): DualLayout {
  if (layout.second === "mirror") return { ...layout, second: "empty", swap: side === "left" ? !layout.swap : layout.swap };
  return side === "left" ? { ...layout, firstOpen: false } : { ...layout, second: "empty" };
}

/**
 * A document opened in a half, empty or replaced (D424), drawn where it was asked for: `mirror` (or the other half's own document) is
 * the other half's document again at another size; a saved template, which has no address of its own, is always the second half, drawn
 * on the side asked for. Null where it cannot be: the same document again with no document beside, or two saved templates.
 */
export function openIn(layout: DualLayout, side: DualSide, pick: DualWith | "mirror"): DualLayout | null {
  const { first, firstOpen, second, swap } = layout;
  if (side === "right") {
    if (pick === "mirror") return firstOpen ? { ...layout, second: "mirror" } : null;
    if (sameDoc(pick, first)) return firstOpen ? { ...layout, second: "mirror" } : { ...layout, firstOpen: true, second: "empty", swap: !swap };
    return { ...layout, second: pick };
  }
  // The first half. A document in the second half, which may become the address's own.
  const beside = typeof second === "object" ? second : null;
  if (pick === "mirror" || (beside && sameDoc(pick, beside as DualFirst))) {
    if (pick === "mirror" && second === "mirror") return layout;
    if (!beside || beside.kind === "template") return null;
    return { first: beside, firstOpen: true, second: "mirror", swap: !swap };
  }
  if (pick.kind === "template") {
    if (beside?.kind === "template") return null;
    if (beside) return { first: beside, firstOpen: true, second: pick, swap: !swap };
    return { ...layout, firstOpen: false, second: pick, swap: !swap };
  }
  return { ...layout, first: pick, firstOpen: true };
}

/** How the two halves share their width (D424): the first document's share, from a fifth to four fifths. */
export const SPLIT = { min: 0.2, max: 0.8, even: 0.5, step: 0.05 } as const;

/** A share within its limits, and half where it is not a number. */
export function splitShare(value: number): number {
  if (!Number.isFinite(value)) return SPLIT.even;
  return Math.round(Math.min(SPLIT.max, Math.max(SPLIT.min, value)) * 1000) / 1000;
}

/**
 * The first document's share once the edge between the halves is dragged `moved` pixels to the right over `total` pixels: the half drawn
 * on the left grows, which is the first document's unless the halves are swapped.
 */
export function draggedSplit(start: number, moved: number, total: number, swap: boolean): number {
  if (total <= 0) return splitShare(start);
  return splitShare(start + ((swap ? -1 : 1) * moved) / total);
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

type Scroller = { scrollTop: number; scrollHeight: number; clientHeight: number };

/**
 * Where the other canvas scrolls to when one document is drawn twice at two sizes (D424): as far through its page as this one is
 * through its own, the same part in view at either size.
 */
export function followScrollShare(from: Scroller, other: Omit<Scroller, "scrollTop">): number {
  const room = from.scrollHeight - from.clientHeight;
  const share = room > 0 ? Math.min(1, Math.max(0, from.scrollTop / room)) : 0;
  return Math.max(0, Math.round(share * (other.scrollHeight - other.clientHeight)));
}

/**
 * A saved template as one of a dual page's documents (D412 step 5): the kind of page it is edited as (a page layout's own kind; a row,
 * column or component as a page's), and the template as the editor holds a page: its name as the title, its content as the canvas's rows
 * (`partRows()`), a layout's CSS as the page's, a part's translations as the page's (read when a part of it is copied to the other page).
 */
export function templateAsPage(part: SavedPart): {
  shape: PageType;
  page: { id: string; slug: string; draft: PageContent; state: "draft"; published: false; publishedAt: null; updatedAt: string };
} {
  const translations = part.kind !== "page" && Object.keys(part.translations ?? {}).length > 0 ? (part.translations as Record<string, PageTranslation>) : undefined;
  return {
    shape: part.kind === "page" ? part.content.pageType : "page",
    page: {
      id: part.id,
      slug: "",
      draft: {
        ...newPageContent(),
        title: part.name,
        rows: savedPartRows(part),
        ...(part.kind === "page" && part.content.css ? { css: part.content.css } : {}),
        ...(translations ? { translations } : {}),
      },
      state: "draft",
      published: false,
      publishedAt: null,
      updatedAt: part.updatedAt,
    },
  };
}
