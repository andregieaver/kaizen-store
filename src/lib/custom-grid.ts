import type { GridData, GridItem } from "./content-grid";
import { menuHref, type MenuLink } from "./navigation";
import {
  GRID_LIMIT_MAX,
  PRICE_SORTS,
  CUSTOM_ITEMS_MAX,
  CUSTOM_TEXT_MAX,
  CUSTOM_TITLE_MAX,
  TILE_FIELDS_MAX,
  customItemShows,
  type ContentGridBlock,
  type CustomGridItem,
  type GridSource,
} from "./page-content";
import { isCustomPicture } from "./custom-picture";
import { isSafeAddress } from "./field-parts";
import { findClaims, type ClaimFinding } from "./claims";
import { summarize } from "./seo";

/**
 * Custom grid items (D155), pure: what the grid draws from the items the owner wrote, and the snapshot that turns
 * what a grid of pages, articles or products shows now into such items. A custom item is never a product: its
 * `priceText` is plain words, and nothing here reaches structured data, feeds, search, recommendations or the chat
 * agent (`custom-grid-isolation.test.ts` scans for it).
 */

/** Where a link in a custom item goes. */
export type ResolvedLink = { href: string; external: boolean };

/**
 * An item's link as an address. `base` is the market's front page on a store's page (`marketPath(store, market)`), or
 * null on Kaizen's own, which has no products, account or cart to link to. A web address is drawn only if it is safe.
 */
export function itemLinkHref(link: MenuLink | null, base: string | null): ResolvedLink | null {
  if (!link) return null;
  if (link.kind === "url" && !isSafeAddress(link.url)) return null;
  if (base === null) {
    // Kaizen's pages: no products, account or cart (they are a store's).
    if (link.kind === "products" || link.kind === "account" || link.kind === "cart" || link.kind === "product") return null;
    const resolved = menuHref(link, "");
    return { href: resolved.href === "" ? "/" : resolved.href, external: resolved.external };
  }
  const resolved = menuHref(link, base);
  // The site's `base` is never empty; the builder's canvas has no market and passes "", where a link to the front page
  // would come out as no link at all (an empty address means an item without one). It goes to the root there.
  return resolved.href === "" ? { ...resolved, href: "/" } : resolved;
}

/** The items a grid draws: those with something to show, in the owner's order, at most `limit`. */
export function shownCustomItems(block: Pick<ContentGridBlock, "items" | "limit">): CustomGridItem[] {
  return (block.items ?? []).filter(customItemShows).slice(0, Math.max(1, block.limit));
}

/**
 * A grid of custom items as grid data, from the block itself (no query): the block is already in the shopper's
 * language (`localizePage()`), so the words are the item's own.
 */
export function customGridData(
  block: Pick<ContentGridBlock, "items" | "limit">,
  where: { base: string | null; lang: string; locale: string },
): GridData {
  const items = shownCustomItems(block).map((item): GridItem => {
    const link = itemLinkHref(item.link, where.base);
    return {
      id: item.id,
      href: link?.href ?? "",
      ...(link?.external && { external: true }),
      title: item.title,
      excerpt: item.text,
      // Checked again where it is drawn: only the library's or the site's own pictures (`custom-picture.ts`).
      image: item.picture && isCustomPicture(item.picture.url) ? { url: item.picture.url, alt: item.picture.alt, width: item.picture.width, height: item.picture.height } : null,
      price: null,
      ...(item.date && { date: item.date }),
      ...(item.badge && { badge: item.badge }),
      ...(item.priceText && { priceText: item.priceText }),
      ...(item.buttonLabel && { buttonLabel: item.buttonLabel }),
      ...(item.details.some((line) => line.text.trim() !== "") && {
        fields: item.details.filter((line) => line.text.trim() !== "").slice(0, TILE_FIELDS_MAX).map(({ label, text }) => ({ label, text })),
      }),
    };
  });
  return { items, lang: where.lang, locale: where.locale };
}

// ---------------------------------------------------------------------------
// Choosing what a grid shows
// ---------------------------------------------------------------------------

/**
 * What changes in a grid when the owner chooses another kind of content (D155). Custom items are the block's own and show
 * all of them (the limit goes as high as a grid does); choosing Pages, Articles or Products keeps the items in the editor
 * (choosing Custom items again brings them back, there is no undo in the builder) with a limit a lookup allows; saving
 * drops them (`withoutStrandedItems()`). `products` is the source a grid of products starts with.
 */
export function sourceChoice(
  block: Pick<ContentGridBlock, "source" | "items" | "limit" | "sort">,
  type: GridSource["type"],
  products: GridSource,
): Partial<ContentGridBlock> {
  if (type === "custom") {
    return { source: { type: "custom" }, categories: [], tags: [], filters: undefined, tileFields: undefined, sort: "newest", limit: CUSTOM_ITEMS_MAX, items: block.items ?? [] };
  }
  // Leaving custom items keeps a limit a lookup allows; the items themselves stay for now.
  const leaving = block.source.type === "custom" ? { limit: Math.min(block.limit, GRID_LIMIT_MAX) } : {};
  if (type === "pages" || type === "articles") {
    return { source: { type }, categories: [], tags: [], sort: PRICE_SORTS.includes(block.sort) ? "newest" : block.sort, ...leaving };
  }
  return { source: products, categories: [], tags: [], ...leaving };
}

/** What a grid becomes when Copy current items has turned what it showed into custom items. */
export const copiedItems = (items: CustomGridItem[]): Partial<ContentGridBlock> => ({
  source: { type: "custom" },
  items,
  categories: [],
  tags: [],
  filters: undefined,
  tileFields: undefined,
  sort: "newest",
  limit: CUSTOM_ITEMS_MAX,
});

// ---------------------------------------------------------------------------
// Copy current items
// ---------------------------------------------------------------------------

/** What a grid's source and a tile's address say about the link: a link by slug, never an address with a market in it. */
export function linkFromHref(source: ContentGridBlock["source"]["type"], href: string): MenuLink | null {
  const path = href.split(/[?#]/)[0];
  const last = path.split("/").filter(Boolean).pop();
  if (!last) return null;
  let slug: string;
  try {
    slug = decodeURIComponent(last);
  } catch {
    return null;
  }
  if (source === "products") return /\/p\/[^/]+$/.test(path) ? { kind: "product", handle: slug } : null;
  if (source === "articles") return /\/blog\/[^/]+$/.test(path) ? { kind: "article", slug } : null;
  if (source === "pages") return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) ? { kind: "page", slug } : null;
  return null;
}

/** Whether a tile of a grid is for one kind of buyer only (a product in a store selling to both, D63): a custom item has no audience. */
const restricted = (item: GridItem): boolean => item.audience !== undefined && item.audience !== "all";

/**
 * What a snapshot leaves out, so the editor can say so: items for one kind of buyer only (a custom item is shown to everyone,
 * so a business-only product's name, picture and text must not become public), and pictures a custom item may not use (another
 * site's).
 */
export function copyLeftOut(items: readonly GridItem[]): { restricted: number; pictures: number } {
  const shown = items.slice(0, CUSTOM_ITEMS_MAX).filter((item) => !restricted(item));
  return {
    restricted: items.slice(0, CUSTOM_ITEMS_MAX).length - shown.length,
    pictures: shown.filter((item) => item.image && !isCustomPicture(item.image.url)).length,
  };
}

/**
 * The items a grid shows now as custom items (D155): a snapshot with titles, excerpts, pictures and links by slug.
 * A product's price is dropped, never turned into text. `pictureSize` is what the browser measured (or null: a
 * default shape); `newId` gives each its own id. Items beyond `CUSTOM_ITEMS_MAX` are left, and so are those for one
 * kind of buyer only; a picture a custom item may not use (not the library's or the site's own) is left without one
 * (`copyLeftOut()` counts both).
 */
export function itemsFromGrid(
  source: ContentGridBlock["source"]["type"],
  items: readonly GridItem[],
  options: { newId: () => string; pictureSize?: (url: string) => { width: number; height: number } | null; platform?: boolean },
): CustomGridItem[] {
  return items
    .slice(0, CUSTOM_ITEMS_MAX)
    .filter((item) => !restricted(item))
    .map((item) => {
      const image = item.image && isCustomPicture(item.image.url) ? item.image : null;
      const size = image ? (options.pictureSize?.(image.url) ?? { width: image.width ?? 800, height: image.height ?? 600 }) : null;
      let link = linkFromHref(source, item.href);
      // Kaizen's own pages have no products to link to.
      if (options.platform && link?.kind === "product") link = null;
      return {
        id: options.newId(),
        title: item.title.trim().slice(0, CUSTOM_TITLE_MAX),
        text: summarize(item.excerpt, CUSTOM_TEXT_MAX),
        picture: image && size ? { url: image.url, width: size.width, height: size.height, alt: image.alt.slice(0, 200) } : null,
        link,
        buttonLabel: "",
        date: item.date && /^\d{4}-\d{2}-\d{2}/.test(item.date) ? item.date.slice(0, 10) : null,
        badge: "",
        // Never a price: a product's is live and has its VAT label, a custom item's is the owner's own words.
        priceText: "",
        details: (item.fields ?? []).slice(0, TILE_FIELDS_MAX).map((line) => ({ id: options.newId(), label: line.label.slice(0, 60), text: line.text.slice(0, 120) })),
      };
    });
}

/** An item with nothing in it, to start from. */
export const newCustomItem = (id: string): CustomGridItem => ({
  id,
  title: "",
  text: "",
  picture: null,
  link: null,
  buttonLabel: "",
  date: null,
  badge: "",
  priceText: "",
  details: [],
});

/** A detail line with nothing in it and an id of its own. */
export const newDetailLine = (id: string): CustomGridItem["details"][number] => ({ id, label: "", text: "" });

// ---------------------------------------------------------------------------
// Words written by AI
// ---------------------------------------------------------------------------

/**
 * What the claims filter finds in an item's words (D155): generic green claims, urgency, best-price claims, money and stock
 * levels. The owner's own words are not checked; every item text an AI wrote (the page studio, the replicator's describe step)
 * passes this before it is used, and one with findings is not used. A picture's description may name colours.
 */
export function claimsInItem(item: CustomGridItem): { field: string; finding: ClaimFinding }[] {
  const texts: [string, string, boolean][] = [
    ["title", item.title, true],
    ["text", item.text, true],
    ["badge", item.badge, true],
    ["priceText", item.priceText, true],
    ["buttonLabel", item.buttonLabel, true],
    ["alt", item.picture?.alt ?? "", false],
    ...item.details.flatMap((line, n): [string, string, boolean][] => [
      [`details.${n}.label`, line.label, true],
      [`details.${n}.text`, line.text, true],
    ]),
  ];
  return texts.flatMap(([field, text, colours]) => (text ? findClaims(text, { colours }).map((finding) => ({ field, finding })) : []));
}
