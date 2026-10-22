import { builderEn } from "@/lib/admin-messages/builder.en";
import type { BuilderMessages } from "@/lib/admin-messages/builder.en";
import { fillWords } from "@/lib/admin-fill";
import type { PageType } from "@/lib/page-content";
import { layoutFits } from "@/lib/page-layout";
import type { SavedPartKind } from "@/lib/saved-parts";
import { KIND_ORDER, type TemplateItem, type TemplateSource } from "@/lib/templates";

/**
 * The pure parts of the builder's Templates tab and its modal (D125): grouping by kind, filtering in the browser, and the
 * words for the states a list can be in. Kept apart from the components so they are tested without drawing anything.
 */

/** The templates' words (D312 A7): English unless the admin's language is given. */
export type TemplateWords = BuilderMessages["templates"];
const EN = builderEn.templates;

export type KindFilter = "all" | SavedPartKind;

export type TemplateFilters = { kind: KindFilter; activeOnly: boolean; query: string };

export const NO_FILTERS: TemplateFilters = { kind: "all", activeOnly: false, query: "" };

/** The kind chips of the modal, in the order of the groups. */
export const kindFilters = (words: TemplateWords = EN): readonly { value: KindFilter; label: string }[] => [
  { value: "all", label: words.all },
  ...KIND_ORDER.map((kind) => ({ value: kind, label: words.kinds[kind].many })),
];
export const KIND_FILTERS = kindFilters();

/** How a source is named in a sentence ("No templates activated from …"). */
export const SOURCE_PHRASES: Record<TemplateSource, string> = EN.sourcePhrases;

export type TemplateGroup = { kind: SavedPartKind; label: string; items: TemplateItem[] };

/** Page layouts, then rows, columns and components, each in the order given; a kind with nothing in it is left out. */
export function groupTemplates(items: readonly TemplateItem[], words: TemplateWords = EN): TemplateGroup[] {
  return KIND_ORDER.flatMap((kind) => {
    const own = items.filter((item) => item.kind === kind);
    return own.length > 0 ? [{ kind, label: words.kinds[kind].many, items: own }] : [];
  });
}

/** The templates a store has switched on. */
export const activated = (items: readonly TemplateItem[]): TemplateItem[] => items.filter((item) => item.active);

/** Whether a template can go on a page of this kind (D127): a page layout only on its own kind of page, the rest anywhere. */
export const fitsPage = (item: Pick<TemplateItem, "kind" | "pageType">, pageType: PageType): boolean =>
  item.kind !== "page" || (item.pageType !== null && layoutFits({ pageType: item.pageType }, pageType));

/** What the Templates tab offers for the page being edited: the templates switched on, and no page layout made for another kind of page. */
export const forPage = (items: readonly TemplateItem[], pageType: PageType): TemplateItem[] =>
  activated(items).filter((item) => fitsPage(item, pageType));

/** "For articles": the kind of page a page layout is made for; null for the other kinds. */
export const forLabel = (item: Pick<TemplateItem, "kind" | "pageType">, words: TemplateWords = EN): string | null =>
  item.kind === "page" && item.pageType !== null ? fillWords(words.forType, { many: words.layoutTypes[item.pageType].many }) : null;

/** What the page has room for, so a template that would not fit is not offered. */
export type PageRoom = { pageType: PageType; rowsFull: boolean; blocksFull: boolean };

/**
 * Why a template cannot be used on this page, in words for the person; null when it can. A page layout is for one kind
 * of page only (and always fits by replacing the rows, so a full page does not stop it); the rest need room.
 */
export function blockedReason(item: Pick<TemplateItem, "kind" | "pageType">, room: PageRoom, words: TemplateWords = EN): string | null {
  if (item.kind === "page") {
    if (fitsPage(item, room.pageType)) return null;
    const own = item.pageType === null ? null : words.layoutTypes[item.pageType].many;
    return own ? fillWords(words.madeFor, { own, here: words.layoutTypes[room.pageType].many }) : words.noType;
  }
  if (item.kind === "block") return room.blocksFull ? words.noBlocks : null;
  return room.rowsFull ? words.noRows : null;
}

/** Lower case without accents, so "kafé" is found by "cafe" and "Kaizen" by "kaizen". */
const plain = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** Whether a template answers a search: every word is somewhere in its name, publisher or summary. */
export function matchesQuery(item: TemplateItem, query: string): boolean {
  const words = plain(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const haystack = plain(`${item.name} ${item.publisher} ${item.summary}`);
  return words.every((word) => haystack.includes(word));
}

export function filterTemplates(items: readonly TemplateItem[], filters: TemplateFilters): TemplateItem[] {
  return items.filter(
    (item) =>
      (filters.kind === "all" || item.kind === filters.kind) &&
      (!filters.activeOnly || item.active) &&
      matchesQuery(item, filters.query),
  );
}

/** Whether any filter is narrowing the list. */
export const isFiltering = (filters: TemplateFilters): boolean =>
  filters.kind !== "all" || filters.activeOnly || filters.query.trim() !== "";

/** A copy of a list with one template changed. */
export const patchTemplate = (
  items: readonly TemplateItem[],
  id: string,
  patch: Partial<TemplateItem>,
): TemplateItem[] => items.map((item) => (item.id === id ? { ...item, ...patch } : item));

/** What the tab says when nothing from a source is switched on; Kaizen's own builder (D236) has its own saved parts, always on. */
export function noneActivated(source: TemplateSource, own = false, words: TemplateWords = EN): { title: string; hint: string } {
  if (own) return words.ownNone;
  return { title: fillWords(words.noneTitle, { source: words.sourcePhrases[source] }), hint: words.noneHint[source] };
}

/** What the modal says when a source has nothing to list at all. */
export function nothingShared(source: TemplateSource, own = false, words: TemplateWords = EN): { title: string; hint: string } {
  return own ? words.ownNone : words.nothing[source];
}

/** The widths a template can be previewed at (D127): the full width of the preview, a tablet's and a phone's. */
export const PREVIEW_DEVICES = [
  { key: "desktop", label: "Desktop", width: null },
  { key: "tablet", label: "Tablet", width: 768 },
  { key: "mobile", label: "Mobile", width: 390 },
] as const;
export type PreviewDevice = (typeof PREVIEW_DEVICES)[number]["key"];

/** The CSS width of the frame for a device: all of the room for Desktop, else its own width, never more than there is. */
export const deviceWidth = (device: PreviewDevice): string => {
  const width = PREVIEW_DEVICES.find((each) => each.key === device)?.width ?? null;
  return width === null ? "100%" : `${width}px`;
};

/** How long a preview may take to load before it is called failed. */
export const PREVIEW_TIMEOUT_MS = 20_000;
