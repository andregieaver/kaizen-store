import { describe, expect, it } from "vitest";

import { parseCsv } from "./csv";
import { readShopifyOrders } from "./order-history";
import { detectFormat } from "./product-csv-shopify";
import { readRedirectFile } from "./redirect-csv";
import {
  EMPTY_COPY,
  copyDone,
  copyMoving,
  copyReady,
  copyStateOf,
  customersFile,
  fileOfFeed,
  gramsOf,
  nextToApply,
  nextToRead,
  ordersFile,
  productsFile,
  readBulkLines,
  redirectsFile,
  type CopyState,
} from "./shopify-copy";

const lines = (...objects: object[]) => objects.map((o) => JSON.stringify(o)).join("\n");

const PRODUCTS = lines(
  { id: "gid://shopify/Product/1", handle: "wool-hat", title: "Wool hat", descriptionHtml: "<p>Warm</p>", tags: ["wool", "winter"], status: "ACTIVE", isGiftCard: false, seo: { title: "Hat", description: null }, options: [{ name: "Size", position: 1 }] },
  { id: "gid://shopify/ProductVariant/12", sku: "HAT-M", price: "319.00", compareAtPrice: "399.00", inventoryQuantity: 2, position: 2, selectedOptions: [{ name: "Size", value: "M" }], image: null, inventoryItem: { requiresShipping: true, unitCost: null, measurement: { weight: { value: 0.25, unit: "KILOGRAMS" } } }, __parentId: "gid://shopify/Product/1" },
  { id: "gid://shopify/ProductVariant/11", sku: "HAT-S", price: "299.00", compareAtPrice: null, inventoryQuantity: 5, position: 1, selectedOptions: [{ name: "Size", value: "S" }], image: { url: "https://cdn.shopify.com/s.jpg" }, inventoryItem: { requiresShipping: true, unitCost: { amount: "100.0" }, measurement: { weight: { value: 200, unit: "GRAMS" } } }, __parentId: "gid://shopify/Product/1" },
  { image: { url: "https://cdn.shopify.com/a.jpg", altText: "A hat" }, __parentId: "gid://shopify/Product/1" },
  { image: { url: "https://cdn.shopify.com/b.jpg", altText: null }, __parentId: "gid://shopify/Product/1" },
  { image: { url: "https://cdn.shopify.com/c.jpg", altText: null }, __parentId: "gid://shopify/Product/1" },
  { __parentId: "gid://shopify/Product/1" },
  { id: "gid://shopify/Product/2", handle: "", title: "No handle" },
);

describe("reading Shopify's bulk files", () => {
  it("puts each line under its parent, keeps the order, and skips a line that is not an object", () => {
    const tree = readBulkLines(`${PRODUCTS}\nnot json\n[1]\n`);
    expect(tree.roots.map((r) => r.handle)).toEqual(["wool-hat", ""]);
    expect(tree.children.get("gid://shopify/Product/1")).toHaveLength(6);
    expect(tree.skipped).toBe(2);
  });

  it("weighs in grams from any of Shopify's units", () => {
    expect([gramsOf({ value: 0.25, unit: "KILOGRAMS" }), gramsOf({ value: 1, unit: "POUNDS" }), gramsOf({ value: 3, unit: "OUNCES" }), gramsOf({ value: 0, unit: "GRAMS" }), gramsOf(null)]).toEqual([250, 454, 85, "", ""]);
  });
});

describe("the product file", () => {
  it("is Shopify's own export: the product's row, a row per further variant in its order, a row per further picture", () => {
    const { csv, products, rows } = productsFile(readBulkLines(PRODUCTS));
    expect([products, rows]).toEqual([1, 3]);
    const parsed = parseCsv(new TextEncoder().encode(csv)).rows;
    expect(detectFormat(parsed[0])).toBe("shopify");
    const at = (row: number, name: string) => parsed[row][parsed[0].indexOf(name)];
    expect([at(1, "Handle"), at(1, "Title"), at(1, "Tags"), at(1, "Status"), at(1, "Published"), at(1, "Option1 Name"), at(1, "Option1 Value")]).toEqual(["wool-hat", "Wool hat", "wool, winter", "active", "TRUE", "Size", "S"]);
    expect([at(1, "Variant SKU"), at(1, "Variant Price"), at(1, "Variant Grams"), at(1, "Variant Inventory Qty"), at(1, "Cost per item"), at(1, "Variant Image")]).toEqual(["HAT-S", "299.00", "200", "5", "100.0", "https://cdn.shopify.com/s.jpg"]);
    expect([at(2, "Handle"), at(2, "Title"), at(2, "Option1 Name"), at(2, "Option1 Value"), at(2, "Variant SKU"), at(2, "Variant Compare At Price"), at(2, "Variant Grams")]).toEqual(["wool-hat", "", "", "M", "HAT-M", "399.00", "250"]);
    expect([1, 2, 3].map((r) => [at(r, "Image Src"), at(r, "Image Position")])).toEqual([
      ["https://cdn.shopify.com/a.jpg", "1"],
      ["https://cdn.shopify.com/b.jpg", "2"],
      ["https://cdn.shopify.com/c.jpg", "3"],
    ]);
    expect(at(3, "Variant SKU")).toBe("");
  });
});

describe("the customer, order and redirect files", () => {
  it("writes a customer with an email, and counts one without", () => {
    const tree = readBulkLines(
      lines(
        { id: "gid://shopify/Customer/1", firstName: "Kari", lastName: "Nordmann", tags: ["vip"], defaultEmailAddress: { emailAddress: "kari@example.com" }, defaultPhoneNumber: { phoneNumber: "+4712345678" }, defaultAddress: { address1: "Gata 1", city: "Oslo", zip: "0150", countryCodeV2: "NO" } },
        { id: "gid://shopify/Customer/2", firstName: "No", lastName: "Email", defaultEmailAddress: null },
      ),
    );
    const { csv, customers, withoutEmail } = customersFile(tree);
    expect([customers, withoutEmail]).toEqual([1, 1]);
    const rows = parseCsv(new TextEncoder().encode(csv)).rows;
    expect(rows[1]).toEqual(["Kari", "Nordmann", "kari@example.com", "'+4712345678", "", "Gata 1", "", "Oslo", "0150", "NO", "vip"]);
  });

  it("writes orders that Shopify's order reader reads back as they were", () => {
    const tree = readBulkLines(
      lines(
        {
          id: "gid://shopify/Order/9",
          name: "#1001",
          email: "kari@example.com",
          createdAt: "2026-10-01T10:00:00Z",
          cancelledAt: null,
          currencyCode: "NOK",
          displayFinancialStatus: "PAID",
          displayFulfillmentStatus: "FULFILLED",
          discountCodes: ["WELCOME"],
          subtotalPriceSet: { shopMoney: { amount: "618.0" } },
          totalShippingPriceSet: { shopMoney: { amount: "49.0" } },
          totalTaxSet: { shopMoney: { amount: "133.4" } },
          totalDiscountsSet: { shopMoney: { amount: "20.0" } },
          totalPriceSet: { shopMoney: { amount: "647.0" } },
          billingAddress: { name: "Kari Nordmann", address1: "Gata 1", city: "Oslo", zip: "0150", countryCodeV2: "NO" },
          shippingAddress: null,
        },
        { name: "Wool hat - S", sku: "HAT-S", quantity: 1, originalUnitPriceSet: { shopMoney: { amount: "299.0" } }, __parentId: "gid://shopify/Order/9" },
        { name: "-Sale- Wool hat - M", sku: "HAT-M", quantity: 1, originalUnitPriceSet: { shopMoney: { amount: "319.0" } }, __parentId: "gid://shopify/Order/9" },
      ),
    );
    const { csv, orders } = ordersFile(tree);
    expect(orders).toBe(1);
    const read = readShopifyOrders(parseCsv(new TextEncoder().encode(csv)).rows);
    expect(read.problems).toEqual([]);
    const [order] = read.orders;
    expect([order.name, order.email, order.currency, order.status, order.totalMinor, order.shippingMinor, order.discountMinor, order.discountCode]).toEqual(["#1001", "kari@example.com", "NOK", "fulfilled", 64700, 4900, 2000, "WELCOME"]);
    expect(order.lines.map((l) => [l.title, l.sku, l.quantity, l.unitPriceMinor])).toEqual([
      ["Wool hat - S", "HAT-S", 1, 29900],
      ["-Sale- Wool hat - M", "HAT-M", 1, 31900],
    ]);
    expect(order.billing?.city).toBe("Oslo");
  });

  it("writes Shopify's redirect file, which the redirect import reads as it is", () => {
    const { csv, redirects } = redirectsFile(readBulkLines(lines({ path: "/pages/old", target: "/pages/new" }, { path: "", target: "/x" })));
    expect(redirects).toBe(1);
    const read = readRedirectFile(new TextEncoder().encode(csv));
    expect(read.ok && read.lines.map((l) => [l.from, l.to])).toEqual([["/pages/old", "/pages/new"]]);
  });

  it("says a feed with nothing in it is empty", () => {
    expect(fileOfFeed("customers", "").count).toBe(0);
  });
});

describe("the copy's state", () => {
  const at = (feeds: Partial<Record<keyof CopyState["feeds"], CopyState["feeds"]["products"]>>, apply = false): CopyState => ({ startedAt: "2026-11-03T18:00:00.000Z", apply, feeds: { ...EMPTY_COPY.feeds, ...feeds } });

  it("reads back only what it wrote: an unknown stage or a foreign id is dropped", () => {
    expect(copyStateOf({ startedAt: "2026-11-03T18:00:00.000Z", apply: true, lease: "x", feeds: { products: { stage: "reading", operation: "gid://shopify/BulkOperation/1", job: "nope" }, orders: { stage: "boom" } } })).toEqual({
      startedAt: "2026-11-03T18:00:00.000Z",
      apply: true,
      feeds: { ...EMPTY_COPY.feeds, products: { stage: "reading", operation: "gid://shopify/BulkOperation/1" } },
    });
    expect(copyStateOf("garbage")).toEqual(EMPTY_COPY);
  });

  it("reads one feed at a time, in order", () => {
    expect(nextToRead(EMPTY_COPY)).toBeNull();
    expect(nextToRead(at({}))).toBe("products");
    expect(nextToRead(at({ products: { stage: "reading" } }))).toBeNull();
    expect(nextToRead(at({ products: { stage: "checked" } }))).toBe("customers");
  });

  it("is ready when every feed is checked or had nothing, and applies in order, customers before orders", () => {
    const checked = at({ products: { stage: "checked" }, customers: { stage: "checked" }, orders: { stage: "checked" }, redirects: { stage: "empty" } });
    expect([copyReady(checked), copyMoving(checked), copyDone(checked)]).toEqual([true, false, false]);
    expect(nextToApply(checked)).toBeNull();
    const applying = { ...checked, apply: true };
    expect([copyReady(applying), nextToApply(applying), copyMoving(applying)]).toEqual([false, "products", true]);
    expect(nextToApply(at({ products: { stage: "applying" }, customers: { stage: "checked" } }, true))).toBeNull();
    expect(nextToApply(at({ products: { stage: "done" }, customers: { stage: "failed" }, orders: { stage: "checked" } }, true))).toBe("orders");
    expect(copyDone(at({ products: { stage: "done" }, customers: { stage: "done" }, orders: { stage: "failed" }, redirects: { stage: "empty" } }, true))).toBe(true);
    expect(copyReady(at({ products: { stage: "empty" }, customers: { stage: "empty" }, orders: { stage: "empty" }, redirects: { stage: "empty" } }))).toBe(false);
  });
});
