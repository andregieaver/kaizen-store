import { describe, expect, it } from "vitest";

import { HISTORY_LINES_MAX, historyNumber, isShopifyOrders, readShopifyOrders } from "./order-history";

/** Shopify's order export header, the columns the reader uses and some it never reads (payment, notes, phone). */
const HEADER = [
  "Name", "Email", "Financial Status", "Fulfillment Status", "Currency", "Subtotal", "Shipping", "Taxes", "Total", "Discount Code", "Discount Amount",
  "Created at", "Lineitem quantity", "Lineitem name", "Lineitem price", "Lineitem sku", "Billing Name", "Billing Street", "Billing Address1", "Billing Address2",
  "Billing City", "Billing Zip", "Billing Country", "Shipping Name", "Shipping Address1", "Shipping City", "Shipping Zip", "Shipping Country", "Notes",
  "Payment Method", "Phone", "Cancelled at",
];
const row = (values: Record<string, string>) => HEADER.map((h) => values[h] ?? "");

const FIRST = row({
  Name: "#1001", Email: "Buyer@Example.test", "Financial Status": "paid", "Fulfillment Status": "fulfilled", Currency: "nok", Subtotal: "450.00", Shipping: "49.00",
  Taxes: "99.80", Total: "499.00", "Discount Code": "WELCOME", "Discount Amount": "50.00", "Created at": "2025-03-01 10:15:00 +0100", "Lineitem quantity": "2",
  "Lineitem name": "Cup", "Lineitem price": "250.00", "Lineitem sku": "CUP-1", "Billing Name": "A Buyer", "Billing Address1": "Street 1", "Billing City": "Oslo",
  "Billing Zip": "0150", "Billing Country": "no", Notes: "leave at the door", "Payment Method": "card", Phone: "+47 000",
});
const SECOND_LINE = row({ Name: "#1001", "Lineitem quantity": "1", "Lineitem name": "Saucer", "Lineitem price": "0", "Lineitem sku": "" });
const CANCELLED = row({
  Name: "#1002", Email: "other@example.test", "Financial Status": "refunded", Currency: "EUR", Total: "10.00", "Created at": "2025-04-02T08:00:00Z",
  "Lineitem quantity": "1", "Lineitem name": "Tea", "Lineitem price": "10.00",
});

describe("an order history from Shopify (D384)", () => {
  it("is told by its own columns", () => {
    expect(isShopifyOrders(HEADER)).toBe(true);
    expect(isShopifyOrders(["Handle", "Title", "Variant SKU"])).toBe(false);
  });

  it("numbers an order C- and its old name, letters, digits and hyphens only", () => {
    expect(historyNumber("#1001")).toBe("C-1001");
    expect(historyNumber("#SE 1001/2")).toBe("C-SE-1001-2");
    expect(historyNumber("###")).toBe("C-order");
  });

  it("reads an order over its rows: the amounts in its currency, its status, its lines, and nothing of payment, notes or phone", () => {
    const { orders, problems } = readShopifyOrders([HEADER, FIRST, SECOND_LINE, CANCELLED]);
    expect(problems).toEqual([]);
    expect(orders).toHaveLength(2);
    const [first, second] = orders;
    expect(first).toMatchObject({
      name: "#1001", rows: [2, 3], email: "buyer@example.test", currency: "NOK", status: "fulfilled", subtotalMinor: 45_000, shippingMinor: 4_900, taxMinor: 9_980,
      discountMinor: 5_000, totalMinor: 49_900, discountCode: "WELCOME", placedAt: "2025-03-01T09:15:00.000Z",
    });
    expect(first.lines).toEqual([
      { sku: "CUP-1", title: "Cup", quantity: 2, unitPriceMinor: 25_000, totalMinor: 50_000 },
      { sku: "-", title: "Saucer", quantity: 1, unitPriceMinor: 0, totalMinor: 0 },
    ]);
    expect(first.billing).toEqual({ name: "A Buyer", line1: "Street 1", postalCode: "0150", city: "Oslo", country: "NO" });
    expect(first.shipping).toBeNull();
    expect(JSON.stringify(first)).not.toMatch(/door|card|\+47/);
    expect(second).toMatchObject({ status: "cancelled", currency: "EUR", totalMinor: 1_000 });
  });

  it("names what it cannot read by its rows and guesses nothing", () => {
    const noEmail = row({ Name: "#2001", "Financial Status": "paid", Currency: "NOK", Total: "1", "Created at": "2025-01-01", "Lineitem quantity": "1", "Lineitem name": "A", "Lineitem price": "1" });
    const badCurrency = row({ Name: "#2002", Email: "a@example.test", Currency: "kr", "Created at": "2025-01-01", "Lineitem quantity": "1", "Lineitem name": "A" });
    const badDate = row({ Name: "#2003", Email: "a@example.test", Currency: "NOK", "Created at": "soon", "Lineitem quantity": "1", "Lineitem name": "A", "Lineitem price": "1" });
    const noLines = row({ Name: "#2004", Email: "a@example.test", Currency: "NOK", "Created at": "2025-01-01" });
    const orphan = row({ "Lineitem quantity": "1", "Lineitem name": "A" });
    const again = row({ Name: "#1001", Email: "a@example.test", Currency: "NOK", "Created at": "2025-01-01", "Lineitem quantity": "1", "Lineitem name": "A" });
    const { orders, problems } = readShopifyOrders([HEADER, orphan, FIRST, noEmail, badCurrency, badDate, noLines, again]);
    expect(orders.map((o) => o.name)).toEqual(["#1001"]);
    expect(problems.map((p) => [p.order, p.problem])).toEqual([
      [null, "no_name"],
      ["#2001", "no_email"],
      ["#2002", "currency"],
      ["#2003", "date"],
      ["#2004", "no_lines"],
      ["#1001", "duplicate"],
    ]);
  });

  it(`refuses an order of more than ${HISTORY_LINES_MAX} lines`, () => {
    const many = Array.from({ length: HISTORY_LINES_MAX + 1 }, () => row({ Name: "#3001", "Lineitem quantity": "1", "Lineitem name": "A", "Lineitem price": "1" }));
    many[0] = row({ Name: "#3001", Email: "a@example.test", Currency: "NOK", "Created at": "2025-01-01", "Lineitem quantity": "1", "Lineitem name": "A", "Lineitem price": "1" });
    expect(readShopifyOrders([HEADER, ...many]).problems.map((p) => p.problem)).toEqual(["too_many_lines"]);
  });
});
