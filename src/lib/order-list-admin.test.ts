import { describe, expect, it } from "vitest";

import { BULK_MAX } from "./order-bulk";
import { builtInHref, chipChange, clearHref, matchingText, pageHref, plainState, printHref, selectionBanner, stateQuery, viewHref } from "./order-list-admin";
import { DEFAULT_ORDER_LIST, parseOrderListParams } from "./order-list";

const base = "/admin/s/orders";
const parse = (query: string) => parseOrderListParams(new URLSearchParams(query));

describe("the links of the orders list", () => {
  it("writes a built-in view as its own address, keeping the columns and the sort", () => {
    const params = parse("pay=paid&cols=placed,total&sort=total_desc&q=vip");
    expect(builtInHref(base, params, null)).toBe(`${base}?sort=total_desc&cols=placed%2Ctotal`);
    expect(builtInHref(base, params, "to-send")).toBe(`${base}?show=to-send&sort=total_desc&cols=placed%2Ctotal`);
    expect(builtInHref(base, DEFAULT_ORDER_LIST, null)).toBe(base);
  });

  it("opens a saved view by its id", () => {
    expect(viewHref(base, "11111111-1111-4111-8111-111111111111")).toBe(`${base}?view=11111111-1111-4111-8111-111111111111`);
  });

  it("takes the saved view and the cursor out of every link, so a cleared filter stays cleared", () => {
    const params = { ...parse("pay=paid&tag=vip&q=anna"), view: "11111111-1111-4111-8111-111111111111" };
    expect(plainState(params)).toMatchObject({ view: null, after: null, pay: ["paid"] });
    expect(clearHref(base, params, "pay")).toBe(`${base}?q=anna&tag=vip`);
    expect(clearHref(base, params, "q")).toBe(`${base}?pay=paid&tag=vip`);
    expect(pageHref(base, params, "abc")).toBe(`${base}?q=anna&pay=paid&tag=vip&after=abc`);
    expect(pageHref(base, params, null)).toBe(`${base}?q=anna&pay=paid&tag=vip`);
  });

  it("writes a built-in view out before a filter it stands for is cleared", () => {
    // `show=to-send` is `ship=to_send`; clearing the fulfilment chip must not leave the view's own filter behind.
    expect(clearHref(base, parse("show=to-send&q=anna"), "ship")).toBe(`${base}?q=anna`);
    expect(clearHref(base, parse("show=unpaid"), "pay")).toBe(base);
    expect(clearHref(base, parse("show=archived"), "archived")).toBe(base);
    // A built-in view's other filters stay.
    expect(clearHref(base, parse("show=to-send&pay=paid"), "pay")).toBe(`${base}?ship=to_send`);
  });

  it("clears dates as a pair, and a relative range alone", () => {
    expect(chipChange("from")).toEqual({ from: null, to: null, range: null });
    expect(chipChange("to")).toEqual(chipChange("from"));
    expect(clearHref(base, parse("from=2026-09-01&to=2026-09-30"), "from")).toBe(base);
    expect(clearHref(base, parse("range=30d&q=x"), "range")).toBe(`${base}?q=x`);
  });

  it("keeps the state of a saved view's query for the server to read again", () => {
    const params = { ...parse("q=anna&pay=paid&after=zzz"), view: "11111111-1111-4111-8111-111111111111" };
    expect(stateQuery(params)).toBe("q=anna&pay=paid");
    expect(parse(stateQuery(params))).toMatchObject({ q: "anna", pay: ["paid"], after: null, view: null });
  });

  it("makes the print link from the ticked ids", () => {
    expect(printHref("shop", ["a", "b"])).toBe("/admin/shop/orders/packing-slips?ids=a,b");
  });
});

describe("selecting orders", () => {
  const pick = (over: Partial<Parameters<typeof selectionBanner>[0]>) => selectionBanner({ pageRows: 50, ticked: 50, matching: 120, capped: false, allMatching: false, ...over });

  it("offers every matching order when the page is ticked and the batch can take them all", () => {
    expect(pick({})).toEqual({ kind: "offer", matching: 120 });
    expect(pick({ matching: BULK_MAX })).toEqual({ kind: "offer", matching: BULK_MAX });
  });

  it("says so when more orders match than one batch takes", () => {
    expect(pick({ matching: BULK_MAX + 1 })).toEqual({ kind: "too_many", matching: BULK_MAX + 1 });
    expect(pick({ matching: 10000, capped: true })).toEqual({ kind: "too_many", matching: 10000 });
  });

  it("says nothing when the page is the whole list or not all of it is ticked", () => {
    expect(pick({ matching: 50 })).toEqual({ kind: "none" });
    expect(pick({ ticked: 12 })).toEqual({ kind: "none" });
    expect(pick({ pageRows: 0, ticked: 0, matching: 0 })).toEqual({ kind: "none" });
  });

  it("keeps the all-matching choice until it is cleared", () => {
    expect(pick({ allMatching: true, ticked: 3 })).toEqual({ kind: "all_matching", matching: 120 });
  });

  it("counts the way the list does", () => {
    expect(matchingText(1, false)).toBe("1 order");
    expect(matchingText(37, false)).toBe("37 orders");
    expect(matchingText(10000, true)).toBe("10,000+ orders");
  });
});
