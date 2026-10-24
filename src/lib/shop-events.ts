/**
 * What a shopper does that the store's ad and analytics tags hear about (wave 5 unit I1, D303, `docs/wave-5-marketing.md` 12.2). Components
 * call `trackShop()` without knowing which tools exist; `ConsentManager` hears the event and passes it to the tools the visitor allowed and
 * that are loaded, each in its own words (`mapEvent()`). Nothing is queued before consent, and nothing personal is ever in an event. Checkout
 * and purchases are not here: they happen on pay routes, which load no tags (D158), and the server sends them (I2). No zod: product pages
 * import this.
 */

import { minorUnitDigits } from "./money";

/** One product line as an event carries it: the variant's SKU (else its id), the product's title, the price as shown, the quantity. */
export type ShopItem = { id: string; name: string; price: number; quantity: number; variant?: string };

export type ShopEvent =
  /** A product page shows a variant (once per variant shown). */
  | { kind: "view_item"; currency: string; items: ShopItem[] }
  /** A listing's first page: products, a category, a tag or search results. */
  | { kind: "view_item_list"; list: string; currency: string; items: ShopItem[] }
  /** A search, with its words only when `searchWordsSendable()`. */
  | { kind: "search"; words: string }
  /** The server accepted an add to the cart. */
  | { kind: "add_to_cart"; currency: string; items: ShopItem[] };

/** The window event `trackShop()` dispatches and `ConsentManager` listens for. */
export const SHOP_EVENT = "kaizen:shop-event";

/** Prices are minor units in code; the tags want major units, by the same digits money is stored in (`minorUnitDigits()`). */
export const majorAmount = (minor: number, currency: string) => minor / 10 ** minorUnitDigits(currency);

/** Listings send at most this many items, as the platforms read no more. */
export const LIST_ITEMS_MAX = 20;

/**
 * Whether a search's words may go to a tag: longer than two characters and without six or more digits in a row (spaced, dotted or dashed
 * too), which could be a person's phone, order or account number. A search that fails is sent without its words.
 */
export function searchWordsSendable(words: string): boolean {
  const trimmed = words.trim();
  if (trimmed.length <= 2 || trimmed.length > 100) return false;
  return !/\d(?:[\s.\-/]?\d){5,}/.test(trimmed);
}

/**
 * This page view's events, in memory only, so a view that happens before the consent manager listens is not lost; the manager replays them
 * once its tags are loaded (`takeRecentShopEvents()`), and they go with the page. Never stored.
 */
const recent: ShopEvent[] = [];
const RECENT_MAX = 10;

/** Tells the store's tags what happened; nothing happens when no tag listens (no consent, or none set up). */
export function trackShop(event: ShopEvent): void {
  if (typeof window === "undefined") return;
  const safe = event.kind === "search" && !searchWordsSendable(event.words) ? { ...event, words: "" } : event;
  const items = "items" in safe ? safe.items.slice(0, LIST_ITEMS_MAX) : undefined;
  const detail = (items ? { ...safe, items } : safe) as ShopEvent;
  recent.push(detail);
  if (recent.length > RECENT_MAX) recent.shift();
  window.dispatchEvent(new CustomEvent(SHOP_EVENT, { detail }));
}

/** The events of this page view not yet heard, emptied as it is read (the consent manager's, once its tags are loaded). */
export function takeRecentShopEvents(): ShopEvent[] {
  return recent.splice(0);
}

