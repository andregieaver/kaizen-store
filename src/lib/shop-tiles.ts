/**
 * What a product's tile in a content grid shows besides its picture, title and price (D540): the stock left and a quantity chooser with
 * Add to cart. The store decides for every grid (Settings, Products: `commerce.product_settings`) and a grid may say otherwise for itself
 * (`ContentGridBlock.shopTiles`). Pure.
 *
 * The tiles are prerendered with the catalogue, and stock is never cached, so neither is drawn on the server: a small island in each
 * product tile (`TileShop`) asks `/api/shop/tiles` once for all the tiles of the page, and that answer carries the store's settings
 * with the facts. A grid that hides both draws no island and asks nothing.
 */

import type { Messages } from "./i18n";
import { releaseDate } from "./stock-words";

export type ProductSettings = {
  /** The stock left on a product's tile: "In stock", "Only 3 left", "Sold out". */
  tileStock: boolean;
  /** A quantity chooser and Add to cart on a product's tile, for a product that can be bought from there. */
  tileQuantity: boolean;
};

export const DEFAULT_PRODUCT_SETTINGS: ProductSettings = { tileStock: false, tileQuantity: false };

/** A grid's own choice for one of the two: absent follows the store. */
export type TileChoice = "show" | "hide";
export const TILE_CHOICES: readonly TileChoice[] = ["show", "hide"];
export const isTileChoice = (value: unknown): value is TileChoice => value === "show" || value === "hide";

/** A grid's overrides (`ContentGridBlock.shopTiles`). */
export type ShopTiles = { stock?: TileChoice; quantity?: TileChoice };

/** What a grid asks the island to consider: `store` follows the store's setting, `show` always; a hidden one is not asked about. */
export type TileAsk = { stock: "show" | "store" | null; quantity: "show" | "store" | null };

/** What a grid's tiles may show, before the store's settings are known: null for a grid that hides both (no island). */
export function tileAsk(own: ShopTiles | undefined): TileAsk | null {
  const one = (choice: TileChoice | undefined): TileAsk["stock"] => (choice === "hide" ? null : choice === "show" ? "show" : "store");
  const ask = { stock: one(own?.stock), quantity: one(own?.quantity) };
  return ask.stock === null && ask.quantity === null ? null : ask;
}

/** Whether each is shown, once the store's settings are known. */
export function tileShows(ask: TileAsk, store: ProductSettings): { stock: boolean; quantity: boolean } {
  return {
    stock: ask.stock === "show" || (ask.stock === "store" && store.tileStock),
    quantity: ask.quantity === "show" || (ask.quantity === "store" && store.tileQuantity),
  };
}

/** Cleans a grid's overrides as saved: only `show` and `hide` are kept; nothing left is undefined. */
export function cleanShopTiles(value: unknown): ShopTiles | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  const out: ShopTiles = {};
  if (isTileChoice(raw.stock)) out.stock = raw.stock;
  if (isTileChoice(raw.quantity)) out.quantity = raw.quantity;
  return Object.keys(out).length > 0 ? out : undefined;
}

/** The most products one ask may name: a listing's longest page. */
export const TILE_FACTS_MAX = 96;

/**
 * One product's facts for its tile, from `/api/shop/tiles`: what its stock says (`stock`, a sentence key and its number) and, when it can be
 * bought from the tile (one variant, goods, no subscription it must have, a price shown, not a gift card), the variant to add and its
 * quantity rule. Never a price: the tile's price is the catalogue's.
 */
export type TileStock = { kind: "in_stock" } | { kind: "low"; left: number } | { kind: "out" } | { kind: "backorder"; days: number } | { kind: "preorder"; until: string };

export type TileFact = {
  /** The stock in the shopper's language (the product page's own sentences, `tileStockText()`), with its kind; null when there is none to tell. */
  stock: { kind: TileStock["kind"]; text: string } | null;
  buy: { variantId: string; rule: { min: number; max: number | null; step: number }; canBuy: boolean } | null;
};

export type TileFactsAnswer = {
  settings: ProductSettings;
  facts: Record<string, TileFact>;
  /** The quantity chooser has − and + beside the number, as the store's product pages do (Settings, Prices and quantity); false for the number alone. */
  buttons: boolean;
};

/** One variant's stock as `tileStockFact()` reads it (`getVariantStock()`'s figures). */
export type TileVariant = {
  /** Units a shopper can buy now. */
  inStock: number;
  canOffer: boolean;
  /** `continue` with nothing in stock: the days it states. */
  backorderDays: number | null;
  preorderUntil: string | null;
  /** A download or a service: no stock to tell. */
  unlimited: boolean;
};

/**
 * What a tile says about a product's stock, from its variants (D540): the one variant's own words, or for several, in stock while any can be
 * offered (with the count when the sum is low), a pre-order or backorder when only those remain, sold out when none. Null for a product whose
 * variants all have no stock to tell (downloads, services): nothing is said.
 */
export function tileStockFact(variants: readonly TileVariant[], lowAt: number): TileStock | null {
  if (variants.length === 0 || variants.every((v) => v.unlimited)) return null;
  const offered = variants.filter((v) => v.canOffer);
  if (offered.length === 0) return { kind: "out" };
  if (offered.some((v) => v.unlimited)) return { kind: "in_stock" };
  const onShelf = offered.filter((v) => v.inStock > 0 && !v.preorderUntil);
  if (onShelf.length > 0) {
    const left = onShelf.reduce((sum, v) => sum + v.inStock, 0);
    return left <= lowAt ? { kind: "low", left } : { kind: "in_stock" };
  }
  const preorder = offered.find((v) => v.preorderUntil);
  if (preorder?.preorderUntil) return { kind: "preorder", until: preorder.preorderUntil };
  const days = offered.find((v) => v.backorderDays !== null)?.backorderDays;
  return days != null ? { kind: "backorder", days } : { kind: "out" };
}

/** A tile's stock in words: the product page's sentences (`m.inStock`, `m.lowStock()`, the backorder's and pre-order's with their days and date). */
export function tileStockText(
  stock: TileStock,
  m: Pick<Messages, "inStock" | "lowStock" | "outOfStock" | "backorder" | "preorder">,
  locale: string,
): string {
  switch (stock.kind) {
    case "in_stock":
      return m.inStock;
    case "low":
      return m.lowStock(stock.left);
    case "out":
      return m.outOfStock;
    case "backorder":
      return m.backorder.page(stock.days);
    case "preorder":
      return m.preorder.page(releaseDate(stock.until, locale));
  }
}
