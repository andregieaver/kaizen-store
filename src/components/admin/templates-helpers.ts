import type { PageType } from "@/lib/page-content";
import { LAYOUT_TYPE_LABELS, layoutFits } from "@/lib/page-layout";
import type { SavedPartKind } from "@/lib/saved-parts";
import { KIND_LABELS, KIND_ORDER, type TemplateItem, type TemplateSource } from "@/lib/templates";

/**
 * The pure parts of the builder's Templates tab and its modal (D125): grouping by kind, filtering in the browser, and the
 * words for the states a list can be in. Kept apart from the components so they are tested without drawing anything.
 */

export type KindFilter = "all" | SavedPartKind;

export type TemplateFilters = { kind: KindFilter; activeOnly: boolean; query: string };

export const NO_FILTERS: TemplateFilters = { kind: "all", activeOnly: false, query: "" };

/** The kind chips of the modal, in the order of the groups. */
export const KIND_FILTERS: readonly { value: KindFilter; label: string }[] = [
  { value: "all", label: "All" },
  ...KIND_ORDER.map((kind) => ({ value: kind, label: KIND_LABELS[kind].many })),
];

/** How a source is named in a sentence ("No templates activated from …"). */
export const SOURCE_PHRASES: Record<TemplateSource, string> = {
  stores: "your other stores",
  marketplace: "the marketplace",
};

export type TemplateGroup = { kind: SavedPartKind; label: string; items: TemplateItem[] };

/** Page layouts, then rows, columns and components, each in the order given; a kind with nothing in it is left out. */
export function groupTemplates(items: readonly TemplateItem[]): TemplateGroup[] {
  return KIND_ORDER.flatMap((kind) => {
    const own = items.filter((item) => item.kind === kind);
    return own.length > 0 ? [{ kind, label: KIND_LABELS[kind].many, items: own }] : [];
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
export const forLabel = (item: Pick<TemplateItem, "kind" | "pageType">): string | null =>
  item.kind === "page" && item.pageType !== null ? `For ${LAYOUT_TYPE_LABELS[item.pageType].many}` : null;

/** What the page has room for, so a template that would not fit is not offered. */
export type PageRoom = { pageType: PageType; rowsFull: boolean; blocksFull: boolean };

/**
 * Why a template cannot be used on this page, in words for the person; null when it can. A page layout is for one kind
 * of page only (and always fits by replacing the rows, so a full page does not stop it); the rest need room.
 */
export function blockedReason(item: Pick<TemplateItem, "kind" | "pageType">, room: PageRoom): string | null {
  if (item.kind === "page") {
    if (fitsPage(item, room.pageType)) return null;
    const own = item.pageType === null ? null : LAYOUT_TYPE_LABELS[item.pageType].many;
    return own
      ? `Made for ${own}, so it cannot be used on ${LAYOUT_TYPE_LABELS[room.pageType].many}.`
      : "It does not say which kind of page it is for.";
  }
  if (item.kind === "block") return room.blocksFull ? "This page has no room for more blocks." : null;
  return room.rowsFull ? "This page has no room for more rows." : null;
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

/** What the tab says when nothing from a source is switched on. */
export function noneActivated(source: TemplateSource): { title: string; hint: string } {
  return {
    title: `No templates activated from ${SOURCE_PHRASES[source]}`,
    hint:
      source === "stores"
        ? "Page layouts, rows, columns and components you share from your other stores can be switched on here. Browse them to choose."
        : "Browse the marketplace and switch on the templates you want to build with. Kaizen's start out on.",
  };
}

/** What the modal says when a source has nothing to list at all. */
export function nothingShared(source: TemplateSource): { title: string; hint: string } {
  return source === "stores"
    ? {
        title: "Your other stores have not shared anything yet",
        hint: "Share a saved page layout, row, column or component with My stores (under Saved, or when you save it) and it appears here.",
      }
    : {
        title: "Nothing in the marketplace yet",
        hint: "Templates shared with the marketplace by Kaizen and other stores appear here.",
      };
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
