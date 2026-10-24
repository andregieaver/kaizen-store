/**
 * A shop event (D303 I1, `shop-events.ts`) in each tag's own words. Apart from the bus so the consent manager loads it only once a tag is on
 * and an event comes (a dynamic import): visitors of a store without tags never fetch it.
 */

import type { ShopEvent, ShopItem } from "./shop-events";

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
