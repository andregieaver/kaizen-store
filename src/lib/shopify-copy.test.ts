import { describe, expect, it } from "vitest";

import { parseCsv } from "./csv";
import { readShopifyOrders } from "./order-history";
import { detectFormat } from "./product-csv-shopify";
import { readRedirectFile } from "./redirect-csv";
import {
  COPY_FEEDS,
  copyOptionsOf,
  ordersSinceFor,
  consentLines,
  catchUpQuery,
  vendorLines,
  EMPTY_COPY,
  collectionsFile,
  directItems,
  menuInputOf,
  menuLinkOf,
  slugOf,
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

  it("gives a variant without a SKU one from its handle and options, unique in the file, as the import needs", () => {
    const tree = readBulkLines(
      lines(
        { id: "gid://shopify/Product/7", handle: "Bag", title: "Bag", status: "ACTIVE", options: [{ name: "Title", position: 1 }] },
        { id: "gid://shopify/ProductVariant/71", sku: "", price: "10.00", position: 1, selectedOptions: [{ name: "Title", value: "Default Title" }], __parentId: "gid://shopify/Product/7" },
        { id: "gid://shopify/Product/8", handle: "scarf", title: "Scarf", status: "ACTIVE", options: [{ name: "Colour", position: 1 }] },
        { id: "gid://shopify/ProductVariant/81", sku: null, price: "10.00", position: 1, selectedOptions: [{ name: "Colour", value: "Rød" }], __parentId: "gid://shopify/Product/8" },
        { id: "gid://shopify/ProductVariant/82", sku: "bag", price: "10.00", position: 2, selectedOptions: [{ name: "Colour", value: "Blue" }], __parentId: "gid://shopify/Product/8" },
      ),
    );
    const f = productsFile(tree);
    const parsed = parseCsv(new TextEncoder().encode(f.csv)).rows;
    const skus = parsed.slice(1).map((r) => r[parsed[0].indexOf("Variant SKU")]);
    expect([skus, f.madeSkus]).toEqual([["bag-2", "scarf-rod", "bag"], 2]);
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
    expect(copyStateOf({ startedAt: "2026-11-03T18:00:00.000Z", apply: false, lease: "x", feeds: { products: { stage: "reading", operation: "gid://shopify/BulkOperation/1", job: "nope", path: "../x" }, orders: { stage: "boom" } } })).toEqual({
      startedAt: "2026-11-03T18:00:00.000Z",
      apply: false,
      feeds: { ...EMPTY_COPY.feeds, products: { stage: "reading", operation: "gid://shopify/BulkOperation/1" } },
    });
    // A copy brought over before a part was added does not read it on its own: Start again brings it.
    const old = copyStateOf({ startedAt: "2026-11-03T18:00:00.000Z", apply: true, feeds: { products: { stage: "done" }, customers: { stage: "done" }, orders: { stage: "done" }, redirects: { stage: "done" } } });
    expect([old.feeds.pages.stage, old.feeds.collections.stage, nextToRead(old)]).toEqual(["empty", "empty", null]);
    expect(copyStateOf("garbage")).toEqual(EMPTY_COPY);
  });

  it("reads one feed at a time, in order", () => {
    expect(nextToRead(EMPTY_COPY)).toBeNull();
    expect(nextToRead(at({}))).toBe("products");
    expect(nextToRead(at({ products: { stage: "reading" } }))).toBeNull();
    expect(nextToRead(at({ products: { stage: "checked" } }))).toBe("collections");
    const allButMenus = at(Object.fromEntries(["products", "collections", "customers", "orders", "pages", "articles", "redirects"].map((f) => [f, { stage: "checked" as const }])));
    expect(nextToRead(allButMenus)).toBe("menus");
  });

  it("is ready when every feed is checked or had nothing, and applies in order, customers before orders", () => {
    const checked = at({ products: { stage: "checked" }, collections: { stage: "checked" }, customers: { stage: "checked" }, orders: { stage: "checked" }, pages: { stage: "empty" }, articles: { stage: "empty" }, menus: { stage: "empty" }, redirects: { stage: "empty" }, countries: { stage: "empty" }, shipping: { stage: "empty" }, discounts: { stage: "empty" }, look: { stage: "empty" }, subscribers: { stage: "empty" }, gift_cards: { stage: "empty" } });
    expect([copyReady(checked), copyMoving(checked), copyDone(checked)]).toEqual([true, false, false]);
    expect(nextToApply(checked)).toBeNull();
    const applying = { ...checked, apply: true };
    expect([copyReady(applying), nextToApply(applying), copyMoving(applying)]).toEqual([false, "products", true]);
    expect(nextToApply(at({ countries: { stage: "done" }, shipping: { stage: "empty" }, products: { stage: "applying" }, customers: { stage: "checked" } }, true))).toBeNull();
    // The countries come first: a price, a rate and a code are per country.
    expect(nextToApply(at({ countries: { stage: "checked" }, products: { stage: "checked" } }, true))).toBe("countries");
    expect(nextToApply(at({ countries: { stage: "empty" }, shipping: { stage: "done" }, products: { stage: "done" }, collections: { stage: "empty" }, customers: { stage: "failed" }, subscribers: { stage: "empty" }, orders: { stage: "checked" } }, true))).toBe("orders");
    const settled = (stage: "done" | "empty") => Object.fromEntries(COPY_FEEDS.map((f) => [f, { stage }]));
    expect(copyDone(at({ ...settled("done"), orders: { stage: "failed" } }, true))).toBe(true);
    expect(copyReady(at(settled("empty")))).toBe(false);
  });
});

describe("collections, pages, blog posts and menus", () => {
  it("writes the collections as categories in Kaizena Flow's own product file, a product in each of its collections", () => {
    const tree = readBulkLines(
      lines(
        { id: "gid://shopify/Collection/1", handle: "hats", title: "Hats / Caps" },
        { handle: "wool-hat", __parentId: "gid://shopify/Collection/1" },
        { id: "gid://shopify/Collection/2", handle: "sale", title: "Sale" },
        { handle: "wool-hat", __parentId: "gid://shopify/Collection/2" },
        { handle: "scarf", __parentId: "gid://shopify/Collection/2" },
        { id: "gid://shopify/Collection/3", handle: "empty", title: "Empty" },
      ),
    );
    const f = collectionsFile(tree);
    expect(parseCsv(new TextEncoder().encode(f.csv)).rows).toEqual([
      ["handle", "sku", "variant_id", "categories"],
      ["wool-hat", "", "", "Hats - Caps | Sale"],
      ["scarf", "", "", "Sale"],
    ]);
    expect(detectFormat(["handle", "sku", "variant_id", "categories"])).toBe("kaizen");
    expect(f.collections).toBe(3);
    expect(collectionsFile(readBulkLines(lines({ id: "gid://shopify/Collection/3", handle: "empty", title: "Empty" }))).collections).toBe(0);
  });

  it("reads pages and posts with an address here, their blog and author", () => {
    const items = directItems(
      readBulkLines(
        lines(
          { id: "gid://shopify/Page/1", handle: "Om-Oss", title: "Om oss", body: "<p>Hei</p>", isPublished: true },
          { id: "gid://shopify/Article/2", handle: "vår-nyhet", title: "", body: "", isPublished: false, author: { name: "Kari" }, blog: { handle: "news", title: "Nyheter" } },
        ),
      ),
    );
    expect(items).toEqual([
      { handle: "om-oss", title: "Om oss", body: "<p>Hei</p>", published: true, blog: null, author: "" },
      { handle: "var-nyhet", title: "vår-nyhet", body: "", published: false, blog: { handle: "news", title: "Nyheter" }, author: "Kari" },
    ]);
    expect(slugOf("---")).toBe("page");
  });

  it("links a menu item to the same thing here, and keeps three levels", () => {
    expect([
      menuLinkOf("FRONTPAGE", "/"),
      menuLinkOf("COLLECTION", "/collections/hats"),
      menuLinkOf("COLLECTION", "/collections/all"),
      menuLinkOf("PRODUCT", "https://myshop.com/products/Wool-Hat"),
      menuLinkOf("PAGE", "/pages/about-us"),
      menuLinkOf("BLOG", "/blogs/news"),
      menuLinkOf("ARTICLE", "/blogs/news/spring"),
      menuLinkOf("HTTP", "https://instagram.com/myshop"),
      menuLinkOf("SEARCH", "/search"),
    ]).toEqual([
      { kind: "home" },
      { kind: "category", slug: "hats" },
      { kind: "products" },
      { kind: "product", handle: "wool-hat" },
      { kind: "page", slug: "about-us" },
      { kind: "blog" },
      { kind: "article", slug: "spring" },
      { kind: "url", url: "https://instagram.com/myshop" },
      { kind: "url", url: "/search" },
    ]);
    const menu = menuInputOf(
      { handle: "main-menu", title: "Main menu", items: [{ title: "Shop", type: "CATALOG", url: "/collections/all", items: [{ title: "Hats", type: "COLLECTION", url: "/collections/hats", items: [{ title: "Wool", type: "PRODUCT", url: "/products/wool-hat", items: [{ title: "Too deep", type: "HTTP", url: "/x" }] }] }] }, { title: "", type: "PAGE", url: "/pages/x" }] },
      "nb-NO",
    );
    expect(menu).toEqual({
      name: "Main menu",
      items: [
        { label: { "nb-NO": "Shop" }, link: { kind: "products" }, depth: 0 },
        { label: { "nb-NO": "Hats" }, link: { kind: "category", slug: "hats" }, depth: 1 },
        { label: { "nb-NO": "Wool" }, link: { kind: "product", handle: "wool-hat" }, depth: 2 },
      ],
    });
  });
});

describe("the products' vendors", () => {
  it("keeps each product's vendor, handle and whether it was on sale, gift cards left out", () => {
    const tree = readBulkLines(
      [
        { id: "gid://shopify/Product/1", handle: "hat", vendor: " Nordic  Wool ", status: "ACTIVE", isGiftCard: false },
        { id: "gid://shopify/Product/2", handle: "scarf", vendor: null, status: "DRAFT", isGiftCard: false },
        { id: "gid://shopify/Product/3", handle: "card", vendor: "Shop", status: "ACTIVE", isGiftCard: true },
        { sku: "x", __parentId: "gid://shopify/Product/1" },
      ]
        .map((o) => JSON.stringify(o))
        .join("\n"),
    );
    expect(vendorLines(tree)).toEqual([
      { vendor: "Nordic Wool", handle: "hat", active: true },
      { vendor: "", handle: "scarf", active: false },
    ]);
  });
});

describe("move day's catch-up", () => {
  it("reads only what was made since the copy began, for products, customers and past orders, and never lets other text into the search", () => {
    const since = "2026-11-03T18:00:00.000Z";
    expect(catchUpQuery("orders", since)).toMatch(/^\{ orders\(query: "created_at:>='2026-11-03T18:00:00.000Z'"\) \{ edges/);
    expect(catchUpQuery("products", since)).toMatch(/^\{ products\(query: "created_at:>=/);
    expect(catchUpQuery("customers", since)).toMatch(/^\{ customers\(query: /);
    expect(catchUpQuery("pages", since)).not.toMatch(/created_at/);
    expect(catchUpQuery("orders", null)).not.toMatch(/created_at/);
    expect(catchUpQuery("orders", `2026-11-03T18:00:00Z" OR "x`)).not.toMatch(/created_at/);
  });
});

describe("the customers' email consent", () => {
  it("keeps each customer's consent as Shopify records it, the address in lower case, and leaves out one without an address", () => {
    const tree = readBulkLines(
      [
        { id: "gid://shopify/Customer/1", firstName: "Kari", lastName: "Nordmann", defaultEmailAddress: { emailAddress: "Kari@Example.com", marketingState: "SUBSCRIBED", marketingOptInLevel: "CONFIRMED_OPT_IN", marketingUpdatedAt: "2025-03-02T10:00:00Z" } },
        { id: "gid://shopify/Customer/2", firstName: "Ola", defaultEmailAddress: { emailAddress: "ola@example.com", marketingState: "UNSUBSCRIBED", marketingOptInLevel: "SINGLE_OPT_IN", marketingUpdatedAt: null } },
        { id: "gid://shopify/Customer/3", defaultEmailAddress: null },
      ]
        .map((o) => JSON.stringify(o))
        .join("\n"),
    );
    expect(consentLines(tree)).toEqual([
      { email: "kari@example.com", name: "Kari Nordmann", state: "SUBSCRIBED", level: "CONFIRMED_OPT_IN", updatedAt: "2025-03-02T10:00:00.000Z" },
      { email: "ola@example.com", name: "Ola", state: "UNSUBSCRIBED", level: "SINGLE_OPT_IN", updatedAt: null },
    ]);
  });
});

describe("what to bring", () => {
  it("keeps only parts that are parts, and a date that is one", () => {
    expect(copyOptionsOf({ skip: ["pages", "nope", "pages", 3], ordersSince: "2024-11-04T00:00:00.000Z" })).toEqual({ skip: ["pages"], ordersSince: "2024-11-04T00:00:00.000Z" });
    expect(copyOptionsOf({ ordersSince: "two years" })).toEqual({ skip: [], ordersSince: null });
    expect(copyOptionsOf(null)).toEqual({ skip: [], ordersSince: null });
  });

  it("makes the last so many years a date from the start of that day, all orders by default", () => {
    const now = new Date("2026-11-04T15:30:00Z");
    expect([ordersSinceFor(2, now), ordersSinceFor(1, now), ordersSinceFor(null, now), ordersSinceFor(0, now)]).toEqual(["2024-11-04T00:00:00.000Z", "2025-11-04T00:00:00.000Z", null, null]);
  });
});
