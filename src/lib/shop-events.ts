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

/** The tools an event can go to. */
export type ShopTool = "ga4" | "dataLayer" | "meta" | "tiktok" | "pinterest" | "googleAds";

/** One call to a tool: its function's arguments, as the tool's snippet takes them. */
export type ToolCall = unknown[];

const value = (items: ShopItem[]) => Math.round(items.reduce((sum, i) => sum + i.price * i.quantity, 0) * 100) / 100;

const gaItems = (items: ShopItem[]) =>
  items.map((i) => ({ item_id: i.id, item_name: i.name, price: i.price, quantity: i.quantity, ...(i.variant ? { item_variant: i.variant } : {}) }));

/** An event in a tool's own words, or null where the tool has no such event. */
export function mapEvent(tool: ShopTool, event: ShopEvent): ToolCall | null {
  switch (tool) {
    case "ga4":
    case "googleAds": {
      // Google Ads reads the same gtag events (its remarketing), so both are one call; `googleAds` adds nothing of its own here.
      if (tool === "googleAds") return null;
      if (event.kind === "search") return ["event", "search", event.words ? { search_term: event.words } : {}];
      if (event.kind === "view_item_list") return ["event", "view_item_list", { item_list_name: event.list, items: gaItems(event.items) }];
      return ["event", event.kind, { currency: event.currency, value: value(event.items), items: gaItems(event.items) }];
    }
    case "dataLayer": {
      // GTM's data layer: GA4's ecommerce object, cleared first as Google advises.
      if (event.kind === "search") return [{ event: "search", search_term: event.words || undefined }];
      const ecommerce =
        event.kind === "view_item_list"
          ? { item_list_name: event.list, items: gaItems(event.items) }
          : { currency: event.currency, value: value(event.items), items: gaItems(event.items) };
      return [{ ecommerce: null }, { event: event.kind, ecommerce }];
    }
    case "meta": {
      const ids = (items: ShopItem[]) => items.map((i) => i.id);
      if (event.kind === "search") return ["track", "Search", event.words ? { search_string: event.words } : {}];
      if (event.kind === "view_item_list") return ["trackCustom", "ViewCategory", { content_name: event.list, content_ids: ids(event.items), content_type: "product" }];
      const name = event.kind === "view_item" ? "ViewContent" : "AddToCart";
      return [
        "track",
        name,
        {
          content_ids: ids(event.items),
          content_type: "product",
          contents: event.items.map((i) => ({ id: i.id, quantity: i.quantity, item_price: i.price })),
          currency: event.currency,
          value: value(event.items),
        },
      ];
    }
    case "tiktok": {
      if (event.kind === "view_item_list") return null;
      if (event.kind === "search") return ["track", "Search", event.words ? { query: event.words } : {}];
      return [
        "track",
        event.kind === "view_item" ? "ViewContent" : "AddToCart",
        {
          contents: event.items.map((i) => ({ content_id: i.id, content_name: i.name, quantity: i.quantity, price: i.price })),
          content_type: "product",
          currency: event.currency,
          value: value(event.items),
        },
      ];
    }
    case "pinterest": {
      if (event.kind === "search") return ["track", "search", event.words ? { search_query: event.words } : {}];
      if (event.kind === "view_item_list") return ["track", "viewcategory", { line_items: event.items.map((i) => ({ product_id: i.id })) }];
      const lines = event.items.map((i) => ({ product_id: i.id, product_name: i.name, product_price: i.price, product_quantity: i.quantity }));
      if (event.kind === "view_item") return ["track", "pagevisit", { line_items: lines, currency: event.currency }];
      return [
        "track",
        "addtocart",
        { value: value(event.items), order_quantity: event.items.reduce((n, i) => n + i.quantity, 0), currency: event.currency, line_items: lines },
      ];
    }
  }
}
