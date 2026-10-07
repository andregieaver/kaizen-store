import { createElement as h } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { pickList, PICK_SKIP_WORDS, PICK_WARNING_WORDS, type PickInputLine, type PickInputOrder } from "@/lib/pick-list";

import { PickListView } from "./pick-list-view";

const BAD = /\bNaN\b|Infinity|undefined|\[object|\bnull\b/;
const plain = (html: string) => html.replace(/<!-- -->/g, "").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
// Money as any of the four languages would write it, and the words of a price, a person or an address: none may be on a pick list.
const MONEY = /\bkr\b|€|\bNOK\b|\bSEK\b|\bDKK\b|\bEUR\b|\d+[.,]\d{2}\b|price|VAT|total|moms|mva/i;

const line = (n: number, over: Partial<PickInputLine> = {}): PickInputLine => ({
  lineId: `00000000-0000-4000-8000-00000000000${n}`,
  variantId: `v${n}`,
  sku: `SKU-${n}`,
  title: `Item ${n}`,
  quantity: 1,
  physical: true,
  shipped: 0,
  withdrawn: 0,
  ...over,
});
const order = (id: string, number: string, lines: PickInputLine[], over: Partial<Extract<PickInputOrder, { found: true }>> = {}): PickInputOrder => ({
  id,
  found: true,
  number,
  copied: false,
  paid: true,
  editPending: false,
  lines,
  ...over,
});

const ORDERS: PickInputOrder[] = [
  order("o1", "1001", [line(1, { quantity: 3, shipped: 1 }), line(2, { quantity: 2, title: "Mug (White)" })]),
  order("o2", "1002", [line(1, { quantity: 2, withdrawn: 1 }), line(3, { physical: false, title: "E-book" })], { editPending: true }),
  order("o3", "1003", [line(4)], { copied: true }),
  order("o4", "1004", [line(5)], { paid: false }),
  { id: "o5", found: false },
];

describe("the pick list (D174 2.3)", () => {
  it("by product: one row per variant with its SKU, title, orders and the units still to send, summed over the orders", () => {
    const list = pickList(ORDERS, { by: "product", sort: "sku" });
    const html = renderToString(h(PickListView, { list }));
    const text = plain(html);
    expect(text).not.toMatch(BAD);
    // Item 1: 3 − 1 sent in #1001, 2 − 1 withdrawn in #1002 = 3 units over 2 orders.
    const item1 = list.products.find((p) => p.sku === "SKU-1")!;
    expect(item1).toMatchObject({ units: 3, orders: 2 });
    expect(text).toContain("SKU-1");
    expect(text).toContain("Mug (White)");
    expect(text).toContain(`${list.totalUnits} units for 2 orders`);
    expect(text).toContain("by product");
    // The download is not on it.
    expect(text).not.toContain("E-book");
  });

  it("by order: each order's number with its units to send per line", () => {
    const list = pickList(ORDERS, { by: "order" });
    const text = plain(renderToString(h(PickListView, { list })));
    expect(text).toContain("#1001");
    expect(text).toContain("#1002");
    expect(text).toContain("by order");
    expect(renderToString(h(PickListView, { list }))).toContain('aria-label="Order 1001"');
  });

  it("names the orders left out with the reason, and warns of a change waiting for payment without leaving the order out", () => {
    const list = pickList(ORDERS);
    const text = plain(renderToString(h(PickListView, { list })));
    expect(text).toContain(`#1003: ${PICK_SKIP_WORDS.copied}`);
    expect(text).toContain(`#1004: ${PICK_SKIP_WORDS.unpaid}`);
    expect(text).toContain(`An order that was not found: ${PICK_SKIP_WORDS.not_found}`);
    expect(text).toContain(`#1002: ${PICK_WARNING_WORDS.edit_pending}`);
    expect(text).toContain("3 orders were left out");
  });

  it("holds no price, amount, name or address in either layout", () => {
    for (const by of ["product", "order"] as const) {
      const text = plain(renderToString(h(PickListView, { list: pickList(ORDERS, { by }) })));
      expect(text, by).not.toMatch(MONEY);
    }
  });

  it("says when nothing is left to pick", () => {
    const list = pickList([order("o9", "1009", [line(1, { shipped: 1 })])]);
    const text = plain(renderToString(h(PickListView, { list })));
    expect(text).toContain("Nothing of these orders is left to pick.");
    expect(text).toContain(`#1009: ${PICK_SKIP_WORDS.nothing_to_send}`);
  });

  it("draws a title as text, never as markup", () => {
    const html = renderToString(h(PickListView, { list: pickList([order("o1", "1", [line(1, { title: "<b>Mug</b>" })])]) }));
    expect(html).not.toContain("<b>Mug</b>");
    expect(html).toContain("&lt;b&gt;Mug&lt;/b&gt;");
  });
});
