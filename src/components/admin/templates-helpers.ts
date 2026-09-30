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

/** Rows, then columns, then components, each in the order given; a kind with nothing in it is left out. */
export function groupTemplates(items: readonly TemplateItem[]): TemplateGroup[] {
  return KIND_ORDER.flatMap((kind) => {
    const own = items.filter((item) => item.kind === kind);
    return own.length > 0 ? [{ kind, label: KIND_LABELS[kind].many, items: own }] : [];
  });
}

/** The templates a store has switched on. */
export const activated = (items: readonly TemplateItem[]): TemplateItem[] => items.filter((item) => item.active);

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
        ? "Rows, columns and components you share from your other stores can be switched on here. Browse them to choose."
        : "Browse the marketplace and switch on the templates you want to build with. Kaizen's start out on.",
  };
}

/** What the modal says when a source has nothing to list at all. */
export function nothingShared(source: TemplateSource): { title: string; hint: string } {
  return source === "stores"
    ? {
        title: "Your other stores have not shared anything yet",
        hint: "Share a saved row, column or component with My stores (under Saved, or when you save it) and it appears here.",
      }
    : {
        title: "Nothing in the marketplace yet",
        hint: "Templates shared with the marketplace by Kaizen and other stores appear here.",
      };
}
