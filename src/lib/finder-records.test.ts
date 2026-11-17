import { describe, expect, it } from "vitest";

import { RECORDS_PER_KIND, groupRecords, recordGroups, recordHref, recordKindsFor, recordQuery, type FoundRecord, type RecordKind } from "./finder-records";
import type { PermissionKey } from "./permissions";

/** Ecosystem plan E2.2 (D713): what the page finder looks for among a store's records, who is offered which kind, and how they are shown. */

const found = (kind: RecordKind, key: string, rank = 2, over: Partial<FoundRecord> = {}): FoundRecord => ({
  kind,
  storeId: "s1",
  key,
  title: key,
  detail: null,
  rank,
  minor: null,
  currency: null,
  ...over,
});

describe("what a search looks for", () => {
  it("looks for no records under two characters, and cuts and tidies what was typed", () => {
    expect(recordQuery("")).toBeNull();
    expect(recordQuery(" a ")).toBeNull();
    expect(recordQuery(42)).toBeNull();
    expect(recordQuery("  Kari   Nordmann ")!.text).toBe("Kari Nordmann");
    expect([...recordQuery("x".repeat(500))!.text]).toHaveLength(100);
  });

  it("makes what was typed literal in a LIKE pattern", () => {
    const q = recordQuery("50%_off\\")!;
    expect(q.contains).toBe("%50\\%\\_off\\\\%");
    expect(q.starts).toBe("50\\%\\_off\\\\%");
  });

  it("reads an order number's start as the number index keeps it, with a range that holds exactly the numbers that start so", () => {
    const q = recordQuery("#10 01")!;
    expect(q.number).toEqual({ exact: "1001", lo: "1001", hi: "1002", like: "1001%" });
    expect(recordQuery("kz-9")!.number).toEqual({ exact: "KZ-9", lo: "KZ-9", hi: "KZ-:", like: "KZ-9%" });
    // Words without a digit are no order number.
    expect(recordQuery("refund")!.number).toBeNull();
  });

  it("takes an email address only when it is one, for the exact matches the email indexes serve", () => {
    expect(recordQuery("Kari@Example.com")!.email).toBe("Kari@Example.com");
    expect(recordQuery("kari@")!.email).toBeNull();
    expect(recordQuery("kari nordmann@x.no")!.email).toBeNull();
  });
});

describe("who is offered which kind", () => {
  const only = (...keys: PermissionKey[]) => (key: PermissionKey) => keys.includes(key);

  it("offers a kind only for its read key", () => {
    expect(recordKindsFor(only("orders:read"), ["shop"])).toEqual(["order"]);
    expect(recordKindsFor(only("support:read", "products:read"), ["shop"])).toEqual(["conversation", "product"]);
    expect(recordKindsFor(only(), ["shop", "sales"])).toEqual([]);
  });

  it("offers deals only while Deals are on, and customers and products only where their pages are", () => {
    const all = () => true;
    expect(recordKindsFor(all, ["shop"])).toEqual(["order", "customer", "conversation", "product"]);
    expect(recordKindsFor(all, ["shop", "sales"])).toEqual(["order", "customer", "conversation", "deal", "product"]);
    // A website without the shop but with Deals keeps its customers (CUSTOMERS_FEATURE), never products.
    expect(recordKindsFor(all, ["sales"])).toEqual(["order", "customer", "conversation", "deal"]);
    expect(recordKindsFor(all, [])).toEqual(["order", "conversation"]);
  });
});

describe("where a record opens", () => {
  it("opens each kind's own admin page, a conversation in the inbox", () => {
    expect(recordHref("order", "shop", "o1")).toBe("/admin/shop/orders/o1");
    expect(recordHref("customer", "shop", "c1")).toBe("/admin/shop/customers/c1");
    expect(recordHref("conversation", "shop", "v1")).toBe("/admin/shop/support?c=v1");
    expect(recordHref("deal", "shop", "d1")).toBe("/admin/shop/deals/d1");
    expect(recordHref("product", "shop", "p1")).toBe("/admin/shop/products/p1");
  });
});

describe("the records by kind", () => {
  it("keeps at most five of a kind, best match first and the read's order within a match", () => {
    const many = Array.from({ length: 8 }, (_, i) => found("customer", `c${i}`, i === 6 ? 0 : 2));
    const [group] = groupRecords(many);
    expect(group.records).toHaveLength(RECORDS_PER_KIND);
    expect(group.records.map((r) => r.key)).toEqual(["c6", "c0", "c1", "c2", "c3"]);
  });

  it("shows the kinds in a fixed order, a kind with an exact match first", () => {
    expect(groupRecords([found("product", "p"), found("order", "o"), found("deal", "d")]).map((g) => g.kind)).toEqual(["order", "deal", "product"]);
    expect(groupRecords([found("customer", "c"), found("product", "p", 0), found("order", "o", 1)]).map((g) => g.kind)).toEqual(["product", "order", "customer"]);
    expect(groupRecords([])).toEqual([]);
  });

  it("names an order by its number with who bought and its total, a visitor by the inbox's label, and the store across stores", () => {
    const stores: Record<string, { slug: string; name: string }> = { s1: { slug: "one", name: "One" }, s2: { slug: "two", name: "Two" } };
    const groups = recordGroups(
      [
        found("order", "o1", 0, { title: "1001", detail: "Kari", minor: 12950, currency: "NOK" }),
        found("order", "o2", 1, { title: "10011", detail: null, minor: 100, currency: "NOK", storeId: "s2" }),
        found("conversation", "v1", 1, { title: null, detail: "Where is my parcel?" }),
        // A store that was not given is never linked.
        found("product", "p1", 0, { storeId: "elsewhere" }),
      ],
      { storeOf: (id) => stores[id], money: (minor, currency) => `${currency} ${minor / 100}`, visitor: (id) => `Visitor ${id}`, showStore: true },
    );
    expect(groups.map((g) => g.kind)).toEqual(["order", "conversation"]);
    expect(groups[0].items).toEqual([
      { title: "#1001", group: "One", what: "Kari · NOK 129.5", href: "/admin/one/orders/o1" },
      { title: "#10011", group: "Two", what: "NOK 1", href: "/admin/two/orders/o2" },
    ]);
    expect(groups[1].items[0]).toEqual({ title: "Visitor v1", group: "One", what: "Where is my parcel?", href: "/admin/one/support?c=v1" });
  });

  it("names no store inside the store itself", () => {
    const [group] = recordGroups([found("deal", "d1", 2, { title: "Spring order", detail: "Acme AS" })], {
      storeOf: () => ({ slug: "one", name: "One" }),
      money: () => "",
      visitor: () => "",
    });
    expect(group.items[0]).toEqual({ title: "Spring order", group: "", what: "Acme AS", href: "/admin/one/deals/d1" });
  });
});
