import type { ProductAudience } from "./b2b";
import type { PriceView } from "./pricing";

/**
 * What a content grid (D51) shows, as looked up on the server: its items,
 * and the language and locale they are in (a store's market's, or English
 * for Kaizen's pages).
 */
export type GridItem = {
  id: string;
  href: string;
  title: string;
  /** Plain text: a page's description or the start of its text, a product's description. */
  excerpt: string;
  image: { url: string; alt: string } | null;
  /** Products only: the cheapest price in the market, and whether others cost more. */
  price: { view: PriceView; from: boolean } | null;
  /** Products only (B2B): who it is for, when the store sells to both. */
  audience?: ProductAudience;
  /** Articles only (D57): when it was first published, shown on its tile. */
  date?: string;
};

export type GridData = { items: GridItem[]; lang: string; locale: string };

export const EMPTY_GRID: GridData = { items: [], lang: "en", locale: "en-GB" };
