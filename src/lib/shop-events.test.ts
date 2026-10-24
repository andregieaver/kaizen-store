import { describe, expect, it } from "vitest";

import { mapEvent, type ShopTool } from "./shop-event-map";
import { majorAmount, searchWordsSendable, type ShopEvent } from "./shop-events";

const items = [
  { id: "SKU-1", name: "Mug", price: 199, quantity: 2 },
  { id: "SKU-2", name: "Plate", price: 50.5, quantity: 1 },
];
const add: ShopEvent = { kind: "add_to_cart", currency: "NOK", items };

describe("shop events (D303 I1)", () => {
  it("turns minor units into the currency's major units", () => {
    expect(majorAmount(19900, "NOK")).toBe(199);
    expect(majorAmount(1999, "EUR")).toBe(19.99);
  });

  it("never sends search words that could be a person's number, or a word too short", () => {
    expect(searchWordsSendable("blue mug")).toBe(true);
    expect(searchWordsSendable("ab")).toBe(false);
    expect(searchWordsSendable("order 123456")).toBe(false);
    expect(searchWordsSendable("+47 912 34 567")).toBe(false);
    expect(searchWordsSendable("size 42")).toBe(true);
  });

  it("writes each tool's own event with the value of the lines", () => {
    expect(mapEvent("ga4", add)).toEqual([
      "event",
      "add_to_cart",
      {
        currency: "NOK",
        value: 448.5,
        items: [
          { item_id: "SKU-1", item_name: "Mug", price: 199, quantity: 2 },
          { item_id: "SKU-2", item_name: "Plate", price: 50.5, quantity: 1 },
        ],
      },
    ]);
    expect(mapEvent("meta", add)).toMatchObject(["track", "AddToCart", { content_ids: ["SKU-1", "SKU-2"], currency: "NOK", value: 448.5 }]);
    expect(mapEvent("tiktok", add)).toMatchObject(["track", "AddToCart", { currency: "NOK", value: 448.5 }]);
    expect(mapEvent("pinterest", add)).toMatchObject(["track", "addtocart", { value: 448.5, order_quantity: 3, currency: "NOK" }]);
    expect(mapEvent("dataLayer", add)).toEqual([{ ecommerce: null }, { event: "add_to_cart", ecommerce: expect.objectContaining({ value: 448.5 }) }]);
  });

  it("has a view and a search for every tool, and lists where the tool has them", () => {
    const view: ShopEvent = { kind: "view_item", currency: "EUR", items: [items[0]] };
    const search: ShopEvent = { kind: "search", words: "mug" };
    const list: ShopEvent = { kind: "view_item_list", list: "/products", currency: "EUR", items };
    for (const tool of ["ga4", "dataLayer", "meta", "tiktok", "pinterest"] as ShopTool[]) {
      expect(mapEvent(tool, view)).not.toBeNull();
      expect(mapEvent(tool, search)).not.toBeNull();
    }
    expect(mapEvent("tiktok", list)).toBeNull();
    expect(mapEvent("meta", { kind: "search", words: "" })).toEqual(["track", "Search", {}]);
  });
});
