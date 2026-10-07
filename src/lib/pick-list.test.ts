import { describe, expect, it } from "vitest";

import { PICK_SKIP_WORDS, PICK_SKIPS, parsePickParams, pickList, type PickInputLine, type PickInputOrder } from "./pick-list";

const line = (sku: string, quantity: number, over: Partial<PickInputLine> = {}): PickInputLine => ({
  lineId: `l-${sku}-${Math.random()}`,
  variantId: `v-${sku}`,
  sku,
  title: `Item ${sku}`,
  quantity,
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

describe("the pick list (2.3)", () => {
  const orders: PickInputOrder[] = [
    order("o1", "1002", [line("B-2", 2), line("A-1", 1), line("DL", 1, { physical: false, variantId: "v-dl" })]),
    order("o2", "1001", [line("A-1", 3, { shipped: 1 }), line("C-3", 2, { withdrawn: 2 })]),
    order("o3", "1003", [line("B-2", 1, { shipped: 1 })]),
    order("o4", "1004", [line("A-1", 1)], { copied: true }),
    order("o5", "1005", [line("A-1", 1)], { paid: false }),
    { id: "o6", found: false },
    order("o7", "1007", [line("C-3", 4)], { editPending: true }),
  ];

  it("sums the units still to send by variant, over the orders, leaving out downloads, sent and withdrawn units", () => {
    const list = pickList(orders);
    expect(list.products).toEqual([
      { variantId: "v-A-1", sku: "A-1", title: "Item A-1", units: 3, orders: 2 },
      { variantId: "v-B-2", sku: "B-2", title: "Item B-2", units: 2, orders: 1 },
      { variantId: "v-C-3", sku: "C-3", title: "Item C-3", units: 4, orders: 1 },
    ]);
    expect(list.totalUnits).toBe(9);
    expect(list.orderCount).toBe(3);
  });

  it("lists skipped orders with the reason, and warns of a change waiting for payment without skipping it", () => {
    const list = pickList(orders);
    expect(list.skipped).toEqual([
      { orderId: "o3", number: "1003", reason: "nothing_to_send" },
      { orderId: "o4", number: "1004", reason: "copied" },
      { orderId: "o5", number: "1005", reason: "unpaid" },
      { orderId: "o6", number: null, reason: "not_found" },
    ]);
    expect(list.warnings).toEqual([{ orderId: "o7", number: "1007", reason: "edit_pending" }]);
    for (const reason of PICK_SKIPS) expect(PICK_SKIP_WORDS[reason]).toMatch(/\w/);
  });

  it("sorts by SKU (the default), by title or by quantity high to low", () => {
    expect(pickList(orders, { sort: "quantity" }).products.map((r) => r.sku)).toEqual(["C-3", "A-1", "B-2"]);
    const titled = pickList([order("x", "1", [line("Z", 1, { title: "Apple" }), line("A", 1, { title: "Zebra" })])], { sort: "title" });
    expect(titled.products.map((r) => r.title)).toEqual(["Apple", "Zebra"]);
    expect(pickList([order("x", "1", [line("SKU-10", 1), line("SKU-9", 1)])]).products.map((r) => r.sku)).toEqual(["SKU-9", "SKU-10"]);
  });

  it("lists by order: each order's number with its units to send per line, by number", () => {
    const list = pickList(orders, { by: "order" });
    expect(list.by).toBe("order");
    expect(list.orders.map((o) => [o.number, o.units])).toEqual([["1001", 2], ["1002", 3], ["1007", 4]]);
    expect(list.orders[1].lines.map((l) => [l.sku, l.units])).toEqual([["A-1", 1], ["B-2", 2]]);
  });

  it("counts an order asked for twice once, and keys a line with no variant by its SKU and title", () => {
    const twice = pickList([orders[0], orders[0]]);
    expect(twice.totalUnits).toBe(3);
    const loose = pickList([order("x", "1", [line("S", 1, { variantId: null }), line("S", 2, { variantId: null })])]);
    expect(loose.products).toEqual([{ variantId: null, sku: "S", title: "Item S", units: 3, orders: 1 }]);
  });
});

describe("the address of a pick list", () => {
  const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  it("reads ids, by and sort, dropping what is not an id and duplicates", () => {
    expect(parsePickParams({ ids: `${id(1)}, ${id(2)},nope,${id(1).toUpperCase()}`, by: "order", sort: "quantity" })).toEqual({
      ok: true,
      ids: [id(1), id(2)],
      by: "order",
      sort: "quantity",
    });
    expect(parsePickParams({ ids: id(1), by: "bogus", sort: "bogus" })).toEqual({ ok: true, ids: [id(1)], by: "product", sort: "sku" });
  });
  it("refuses none and more than 100", () => {
    expect(parsePickParams({ ids: "" })).toEqual({ ok: false, problem: "none" });
    expect(parsePickParams({ ids: Array.from({ length: 101 }, (_, i) => id(i)).join(",") })).toEqual({ ok: false, problem: "too_many" });
    expect(parsePickParams({ ids: Array.from({ length: 100 }, (_, i) => id(i)).join(",") })).toMatchObject({ ok: true });
  });
});
