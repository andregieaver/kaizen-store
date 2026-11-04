import { describe, expect, it } from "vitest";

import { parseCsv } from "./csv";
import { readShopifyOrders } from "./order-history";
import { collectionsFile, customersFile, ordersFile, productsFile, readBulkLines } from "./shopify-copy";
import { collectionLines, couponLine, couponRefs, customerLines, orderLines, productLines, variableIds, weightUnitOf, wooQuery } from "./woocommerce-copy";

const jsonl = (lines: readonly unknown[]) => lines.map((l) => JSON.stringify(l)).join("\n");
const table = (csv: string) => {
  const rows = parseCsv(new TextEncoder().encode(csv)).rows;
  return rows.slice(1).map((r) => Object.fromEntries(rows[0].map((h, i) => [h, r[i] ?? ""])));
};

const simple = {
  id: 11,
  type: "simple",
  slug: "wool-hat",
  name: "Wool hat",
  status: "publish",
  description: "<p>Warm.</p>",
  short_description: "",
  price: "299.00",
  regular_price: "349.00",
  sku: "HAT-1",
  manage_stock: true,
  stock_quantity: 7,
  virtual: false,
  weight: "0.2",
  tags: [{ name: "Winter" }],
  categories: [{ id: 3, name: "Hats" }],
  images: [{ src: "https://myshop.com/hat.jpg", alt: "A hat" }],
  attributes: [],
};
const variable = {
  id: 12,
  type: "variable",
  slug: "scarf",
  name: "Scarf",
  status: "draft",
  description: "",
  short_description: "<p>Long.</p>",
  tags: [],
  categories: [{ id: 3, name: "Hats" }, { id: 4, name: "Gifts / Winter" }],
  images: [],
  attributes: [
    { name: "Colour", variation: true, options: ["Red", "Blue"] },
    { name: "Material", variation: false, options: ["Wool"] },
  ],
};
const variations = new Map<number, unknown[]>([
  [
    12,
    [
      { id: 121, sku: "", price: "199.00", manage_stock: false, menu_order: 2, attributes: [{ name: "Colour", option: "Blue" }], virtual: false, weight: "" },
      { id: 120, sku: "SCARF-R", price: "199.00", manage_stock: true, stock_quantity: 3, menu_order: 1, attributes: [{ name: "Colour", option: "Red" }], virtual: false, weight: "" },
    ],
  ],
]);

describe("WooCommerce's products as the product import's file (D446 step 1)", () => {
  it("keeps each product's real address, its variations, stock, weight, pictures and status; never a compare-at price", () => {
    const { lines, skipped } = productLines([simple, variable, { id: 13, type: "grouped", slug: "set" }, { id: 14, type: "external", slug: "elsewhere" }], variations, weightUnitOf("kg"));
    expect(skipped).toEqual(["grouped", "external"]);
    expect(variableIds([simple, variable])).toEqual([12]);
    const file = productsFile(readBulkLines(jsonl(lines)));
    expect(file.products).toBe(2);
    const rows = table(file.csv);
    expect(rows[0]).toMatchObject({ Handle: "wool-hat", Title: "Wool hat", "Body (HTML)": "<p>Warm.</p>", Tags: "Winter", Status: "active", Published: "TRUE", "Variant SKU": "HAT-1", "Variant Price": "299.00", "Variant Compare At Price": "", "Variant Inventory Qty": "7", "Variant Grams": "200", "Image Src": "https://myshop.com/hat.jpg", "Image Alt Text": "A hat" });
    // The draft's variations in WooCommerce's own order; one without a SKU is given one from its options.
    const scarf = rows.filter((r) => r.Handle === "scarf");
    expect(scarf.map((r) => [r["Option1 Name"], r["Option1 Value"], r["Variant SKU"], r["Variant Inventory Qty"]])).toEqual([
      ["Colour", "Red", "SCARF-R", "3"],
      ["", "Blue", "scarf-blue", ""],
    ]);
    expect(scarf[0]).toMatchObject({ Status: "draft", Published: "FALSE", "Body (HTML)": "<p>Long.</p>" });
  });

  it("brings the categories from the products' own lines", () => {
    const { lines } = productLines([simple, variable], variations, null);
    const file = collectionsFile(readBulkLines(jsonl(collectionLines(jsonl(lines)))));
    expect(file.collections).toBe(2);
    expect(table(file.csv)).toEqual([
      { handle: "wool-hat", sku: "", variant_id: "", categories: "Hats" },
      { handle: "scarf", sku: "", variant_id: "", categories: "Hats | Gifts - Winter" },
    ]);
  });

  it("reads products of every status, oldest first, and orders from a date", () => {
    expect(wooQuery("products", 3)).toEqual({ page: 3, per_page: 50, orderby: "id", order: "asc", status: "any" });
    expect(wooQuery("orders", 1, { ordersSince: "2025-01-01T00:00:00.000Z" })).toMatchObject({ status: "any", after: "2025-01-01T00:00:00.000Z" });
    expect(wooQuery("customers", 1)).toMatchObject({ role: "customer" });
  });
});

describe("WooCommerce's customers and orders (D446 step 1)", () => {
  it("writes a registered customer with their billing address, and no consent", () => {
    const file = customersFile(
      readBulkLines(
        jsonl(
          customerLines([
            { id: 5, email: "kari@example.com", first_name: "Kari", last_name: "Nordmann", billing: { phone: "+4712345678", address_1: "Storgata 1", city: "Oslo", postcode: "0150", country: "no" }, shipping: {} },
            { id: 6, email: "", first_name: "No", last_name: "Email", billing: {}, shipping: {} },
          ]),
        ),
      ),
    );
    expect(file.customers).toBe(1);
    expect(file.withoutEmail).toBe(1);
    // A cell a spreadsheet would read as a formula is written with a `'` in front (`csv.ts`); the import reads it back as the number.
    expect(table(file.csv)[0]).toMatchObject({ "First Name": "Kari", Email: "kari@example.com", Phone: "'+4712345678", "Default Address Address1": "Storgata 1", "Default Address Country Code": "NO" });
  });

  it("brings paid, completed, cancelled and refunded orders into the history, and leaves the unpaid", () => {
    const order = (id: number, status: string, extra: Record<string, unknown> = {}) => ({
      id,
      number: String(1000 + id),
      status,
      currency: "NOK",
      date_created_gmt: "2026-10-01T09:30:00",
      date_modified_gmt: "2026-10-02T10:00:00",
      total: "548.00",
      total_tax: "109.60",
      shipping_total: "49.00",
      discount_total: "0.00",
      billing: { first_name: "Kari", last_name: "Nordmann", email: "kari@example.com", address_1: "Storgata 1", city: "Oslo", postcode: "0150", country: "NO" },
      shipping: {},
      coupon_lines: [],
      line_items: [{ name: "Wool hat", sku: "HAT-1", quantity: 2, subtotal: "598.00", price: 249.5 }],
      ...extra,
    });
    const { lines, skipped } = orderLines([order(1, "completed"), order(2, "processing", { coupon_lines: [{ code: "WINTER10" }], discount_total: "50.00" }), order(3, "cancelled"), order(4, "refunded"), order(5, "pending"), order(6, "failed")]);
    expect(skipped).toBe(2);
    const file = ordersFile(readBulkLines(jsonl(lines)));
    expect(file.orders).toBe(4);
    const read = readShopifyOrders(parseCsv(new TextEncoder().encode(file.csv)).rows);
    expect(read.problems).toEqual([]);
    expect(read.orders.map((o) => [o.name, o.status, o.totalMinor, o.discountCode])).toEqual([
      ["#1001", "fulfilled", 54800, null],
      ["#1002", "paid", 54800, "WINTER10"],
      ["#1003", "cancelled", 54800, null],
      ["#1004", "cancelled", 54800, null],
    ]);
    // A line at what one cost before the coupon, as its subtotal says.
    expect(read.orders[0].lines).toEqual([{ sku: "HAT-1", title: "Wool hat", quantity: 2, unitPriceMinor: 29900, totalMinor: 59800 }]);
    expect(read.orders[0]).toMatchObject({ email: "kari@example.com", placedAt: "2026-10-01T09:30:00.000Z", subtotalMinor: 59800, shippingMinor: 4900, taxMinor: 10960, currency: "NOK" });
  });
});

describe("WooCommerce's coupons as discount codes (D446 step 1)", () => {
  const now = new Date("2026-11-04T12:00:00Z");
  const handles = new Map([[11, "wool-hat"]]);
  const categories = new Map([[3, "Hats"]]);
  const coupon = (extra: Record<string, unknown>) => ({ code: "winter10", discount_type: "percent", amount: "10.00", individual_use: false, product_ids: [], excluded_product_ids: [], product_categories: [], excluded_product_categories: [], email_restrictions: [], usage_limit: null, usage_limit_per_user: null, minimum_amount: "0.00", free_shipping: false, date_expires_gmt: null, ...extra });

  it("says percent and whole-basket coupons as ours, with their limits", () => {
    expect(couponLine(coupon({ usage_limit: 100, usage_limit_per_user: 1, minimum_amount: "300.00", date_expires_gmt: "2027-01-01T00:00:00" }), "NOK", handles, categories, now)).toMatchObject({
      code: "winter10",
      kind: "percent",
      percent: 10,
      minSubtotal: { amount: "300.00", currency: "NOK" },
      usageLimit: 100,
      oncePerCustomer: true,
      endsAt: "2027-01-01T00:00:00.000Z",
      productHandles: null,
    });
    expect(couponLine(coupon({ discount_type: "fixed_cart", amount: "50.00", individual_use: true }), "NOK", handles, categories, now)).toMatchObject({ kind: "fixed", amount: { amount: "50.00", currency: "NOK" }, combinesWith: [] });
    expect(couponLine(coupon({ product_ids: [11], product_categories: [3] }), "NOK", handles, categories, now)).toMatchObject({ productHandles: ["wool-hat"], categoryNames: ["Hats"] });
    expect(couponLine(coupon({ free_shipping: true, amount: "0" }), "NOK", handles, categories, now)).toMatchObject({ kind: "free_shipping" });
  });

  it("leaves what ours cannot say as WooCommerce did, and says why", () => {
    expect(couponLine(coupon({ discount_type: "fixed_product" }), "NOK", handles, categories, now)).toEqual({ leftOut: "each_item", code: "winter10" });
    expect(couponLine(coupon({ email_restrictions: ["kari@example.com"] }), "NOK", handles, categories, now)).toEqual({ leftOut: "some_customers", code: "winter10" });
    expect(couponLine(coupon({ date_expires_gmt: "2026-01-01T00:00:00" }), "NOK", handles, categories, now)).toEqual({ leftOut: "expired", code: "winter10" });
    expect(couponLine(coupon({ amount: "12.5" }), "NOK", handles, categories, now)).toEqual({ leftOut: "not_whole_percent", code: "winter10" });
    expect(couponLine(coupon({ product_ids: [99] }), "NOK", handles, categories, now)).toEqual({ leftOut: "variants", code: "winter10" });
    expect(couponLine(coupon({ excluded_product_ids: [11] }), "NOK", handles, categories, now)).toEqual({ leftOut: "other_kind", code: "winter10" });
    expect(couponLine(coupon({ code: " " }), "NOK", handles, categories, now)).toEqual({ leftOut: "no_code", code: "" });
  });

  it("names the products and categories its coupons point at, once each", () => {
    expect(couponRefs([coupon({ product_ids: [11, 12], product_categories: [3] }), coupon({ product_ids: [11] })])).toEqual({ products: [11, 12], categories: [3] });
  });
});
