import type { ProductAudience } from "./b2b";
import type { PriceView } from "./pricing";
import type { TileField } from "./tile-fields";

/**
 * What a content grid (D51) shows, as looked up on the server: its items,
 * and the language and locale they are in (a store's market's, or English
 * for Kaizen's pages).
 */
export type GridItem = {
  id: string;
  /** Where the tile goes. Empty: the item has no link (only a custom item, D155, can lack one). */
  href: string;
  /** The link leaves the site (a custom item's web address). */
  external?: boolean;
  title: string;
  /** Plain text: a page's description or the start of its text, a product's description. */
  excerpt: string;
  image: { url: string; alt: string; width?: number; height?: number } | null;
  /** Products only: the cheapest price in the market, and whether others cost more. */
  price: { view: PriceView; from: boolean } | null;
  /** Products only (B2B): who it is for, when the store sells to both. */
  audience?: ProductAudience;
  /** Articles only (D57): when it was first published, shown on its tile. */
  date?: string;
  /** The custom fields the grid's tiles show under the title (D120), as label and words. */
  fields?: TileField[];
  /** Custom items only (D155): the owner's words over the picture, a plain-text price ("From 199 kr", never a live price) and the item's own button text. */
  badge?: string;
  priceText?: string;
  buttonLabel?: string;
  /** A recommendation's reason (D139), in the shopper's language: "Pairs well with …", shown under the title. */
  note?: string;
};

export type GridData = { items: GridItem[]; lang: string; locale: string };

export const EMPTY_GRID: GridData = { items: [], lang: "en", locale: "en-GB" };
