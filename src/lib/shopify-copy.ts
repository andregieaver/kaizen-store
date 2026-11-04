/**
 * *Copy my shop* (D445 step 4, `docs/moving-from-shopify.md` 5.1 and 5.2), pure: what is read from Shopify by its bulk operations, and the
 * same files Shopify's own exports make (its product, customer and order exports, its redirect file), written from what was read, so the
 * imports that already guard each table (D165, D366, D384, D168) read them as they read a file the owner downloaded. The move has no writer
 * of its own: these files are its only output.
 *
 * Shopify's bulk operations answer in JSON Lines: each object of a nested connection is a line of its own with `__parentId`, the id of the
 * object it belongs to (read 3 November 2026 at <https://shopify.dev/docs/api/usage/bulk-operations/queries>). Nothing here fetches.
 */
import { writeCsv, type Cell } from "./csv";

// ---------------------------------------------------------------------------
// The feeds and their bulk queries
// ---------------------------------------------------------------------------

/**
 * What is copied, in the order it is brought over: the countries first (prices, shipping and codes are per country), collections after
 * products (they are the products' categories), customers before orders (an order is tied to its customer by email), discount codes after
 * the products and categories they name, menus after what they link to, redirects and the look last.
 */
export const COPY_FEEDS = ["countries", "shipping", "products", "collections", "customers", "subscribers", "orders", "gift_cards", "discounts", "pages", "articles", "menus", "redirects", "look"] as const;
export type CopyFeed = (typeof COPY_FEEDS)[number];

/**
 * How a feed is brought over: `import` feeds become a file their import checks at once (D165, D366, D384, D168); `later` (collections)
 * is a file the product import checks once the products are in, since a store has one open product import; `direct` feeds (pages, blog
 * posts, menus, and step 5b's countries, shipping, discount codes and look) are written one by one by their editor's own writer (`savePage()`,
 * `saveStoreMenu()`, `setMarkets()`, `saveShippingSettings()`, `saveDiscount()`, the look's `design_look`), since no file import exists for them.
 */
export const FEED_KIND: Record<CopyFeed, "import" | "later" | "direct"> = {
  countries: "direct",
  shipping: "direct",
  // From the customers' own read (their consent as Shopify records it, D445 step 8): written by the subscriber list's writer.
  subscribers: "direct",
  // Read now, issued on move day (step 8): until then nobody could spend one balance in both shops.
  gift_cards: "direct",
  discounts: "direct",
  look: "direct",
  products: "import",
  collections: "later",
  customers: "import",
  orders: "import",
  pages: "direct",
  articles: "direct",
  menus: "direct",
  redirects: "import",
};

/** Each feed's bulk query (Shopify's rule: no pagination arguments; connections at most two deep). */
export const BULK_QUERIES: Record<CopyFeed, string> = {
  products: `{ products { edges { node {
    id handle title vendor descriptionHtml tags status isGiftCard seo { title description }
    options { name position }
    variants { edges { node {
      id sku barcode price compareAtPrice inventoryQuantity position
      selectedOptions { name value }
      image { url }
      inventoryItem { requiresShipping unitCost { amount } measurement { weight { value unit } } }
    } } }
    media { edges { node { ... on MediaImage { image { url altText } } } } }
  } } } }`,
  customers: `{ customers { edges { node {
    id firstName lastName tags
    defaultEmailAddress { emailAddress marketingState marketingOptInLevel marketingUpdatedAt }
    defaultPhoneNumber { phoneNumber }
    defaultAddress { company address1 address2 city zip countryCodeV2 phone }
  } } } }`,
  orders: `{ orders { edges { node {
    id name email createdAt cancelledAt currencyCode displayFinancialStatus displayFulfillmentStatus discountCodes
    subtotalPriceSet { shopMoney { amount } }
    totalShippingPriceSet { shopMoney { amount } }
    totalTaxSet { shopMoney { amount } }
    totalDiscountsSet { shopMoney { amount } }
    totalPriceSet { shopMoney { amount } }
    billingAddress { name address1 address2 city zip countryCodeV2 }
    shippingAddress { name address1 address2 city zip countryCodeV2 }
    lineItems { edges { node { name sku quantity originalUnitPriceSet { shopMoney { amount } } } } }
  } } } }`,
  redirects: `{ urlRedirects { edges { node { id path target } } } }`,
  collections: `{ collections { edges { node { id handle title products { edges { node { handle } } } } } } }`,
  pages: `{ pages { edges { node { id handle title body isPublished } } } }`,
  articles: `{ articles { edges { node { id handle title body isPublished author { name } blog { handle title } } } } }`,
  // These are few and small, and read by ordinary queries (`MENUS_QUERY`, `src/lib/shopify-settings.ts`); never sent.
  menus: "",
  countries: "",
  shipping: "",
  subscribers: "",
  gift_cards: "",
  discounts: "",
  look: "",
};

/** The feeds a move-day catch-up reads again (D445 step 7): only what was made in Shopify since the copy began. */
export const CATCH_UP_FEEDS: readonly CopyFeed[] = ["products", "customers", "orders"];

const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

/**
 * A feed's bulk query limited to what was made at or after `since` (an ISO instant, checked here so nothing else reaches Shopify's search
 * syntax), for the catch-up; the plain query for any other feed, or when `since` is not an instant.
 */
export function catchUpQuery(feed: CopyFeed, since: string | null): string {
  const query = BULK_QUERIES[feed];
  if (!since || !ISO_INSTANT.test(since) || !CATCH_UP_FEEDS.includes(feed)) return query;
  return query.replace(new RegExp(`^\\{ ${feed} \\{`), `{ ${feed}(query: "created_at:>='${since}'") {`);
}

/** The shop's menus, three levels deep (the most a menu here has). */
export const MENUS_QUERY = `query KaizenMenus { menus(first: 25) { nodes { handle title items { title type url items { title type url items { title type url } } } } } }`;

/** The file each feed becomes: its name in the imports bucket (the import's own pattern: letters, digits, `.`, `_`, `-`). */
export const FEED_FILES: Record<CopyFeed, string> = {
  products: "shopify-products.csv",
  customers: "shopify-customers.csv",
  orders: "shopify-orders.csv",
  redirects: "shopify-redirects.csv",
  collections: "shopify-collections.csv",
  pages: "shopify-pages.jsonl",
  articles: "shopify-articles.jsonl",
  menus: "shopify-menus.jsonl",
  countries: "shopify-countries.jsonl",
  subscribers: "shopify-subscribers.jsonl",
  gift_cards: "shopify-giftcards.jsonl",
  shipping: "shopify-shipping.jsonl",
  discounts: "shopify-discounts.jsonl",
  look: "shopify-look.jsonl",
};

// ---------------------------------------------------------------------------
// Reading the JSON Lines
// ---------------------------------------------------------------------------

type Obj = Record<string, unknown>;

/** The objects of a bulk operation's file: the top ones in order, each with its children by the connection's own type name. */
export type BulkTree = { roots: Obj[]; children: Map<string, Obj[]> };

/** Reads a bulk operation's JSON Lines: a line that is not an object is skipped (and counted), never guessed. */
export function readBulkLines(text: string): BulkTree & { skipped: number } {
  const roots: Obj[] = [];
  const children = new Map<string, Obj[]>();
  let skipped = 0;
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      skipped += 1;
      continue;
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      skipped += 1;
      continue;
    }
    const obj = value as Obj;
    const parent = typeof obj.__parentId === "string" ? obj.__parentId : null;
    if (parent === null) roots.push(obj);
    else {
      const list = children.get(parent) ?? [];
      list.push(obj);
      children.set(parent, list);
    }
  }
  return { roots, children, skipped };
}

const s = (v: unknown, max = 5000): string => (typeof v === "string" ? v.slice(0, max) : typeof v === "number" ? String(v) : "");
const o = (v: unknown): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});
const idOf = (v: Obj): string => s(v.id, 200);
const kidsOf = (tree: BulkTree, parent: Obj): Obj[] => tree.children.get(idOf(parent)) ?? [];

/** A decimal amount as Shopify gives it ("12.5", "0.00") as a CSV number cell, or empty when it is not one. */
const amountCell = (v: unknown): Cell => {
  const text = s(v, 40).trim();
  return /^-?\d+(\.\d+)?$/.test(text) ? { num: text } : "";
};
const money = (set: unknown): Cell => amountCell(o(o(set).shopMoney).amount);

/** A weight in grams, rounded, from Shopify's value and unit; empty when it has none. */
export function gramsOf(weight: unknown): Cell {
  const w = o(weight);
  const value = typeof w.value === "number" ? w.value : Number(w.value);
  if (!Number.isFinite(value) || value <= 0) return "";
  const per: Record<string, number> = { GRAMS: 1, KILOGRAMS: 1000, OUNCES: 28.349523125, POUNDS: 453.59237 };
  const factor = per[s(w.unit, 20)];
  return factor === undefined ? "" : Math.round(value * factor);
}

const yesNo = (v: unknown): string => (v === true ? "TRUE" : v === false ? "FALSE" : "");

// ---------------------------------------------------------------------------
// The files
// ---------------------------------------------------------------------------

/** Shopify's classic product export header (the names `product-csv-shopify.ts` reads; Vendor and Type are left out: they are not read). */
export const PRODUCT_HEADER = [
  "Handle",
  "Title",
  "Body (HTML)",
  "Tags",
  "Published",
  "Status",
  "Option1 Name",
  "Option1 Value",
  "Option2 Name",
  "Option2 Value",
  "Option3 Name",
  "Option3 Value",
  "Variant SKU",
  "Variant Grams",
  "Variant Inventory Qty",
  "Variant Price",
  "Variant Compare At Price",
  "Variant Requires Shipping",
  "Variant Barcode",
  "Variant Image",
  "Image Src",
  "Image Position",
  "Image Alt Text",
  "Gift Card",
  "SEO Title",
  "SEO Description",
  "Cost per item",
] as const;

/** A SKU's words: lower case, letters and digits joined by hyphens. */
const skuPart = (text: string): string =>
  text
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[øæßđłþœ]/g, (c) => ({ ø: "o", æ: "ae", ß: "ss", đ: "d", ł: "l", þ: "th", œ: "oe" })[c] ?? c)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

/**
 * The product file: per product, its first row with the product's fields, a row for each further variant, then a row for each further picture.
 * Shopify lets a variant have no SKU, and the import needs one for every variant (it is how a variant is found again): a variant without one
 * is given its product's handle and its option values (`bag`, `bag-s-red`), kept unique within the file, and counted in `madeSkus`.
 */
export function productsFile(tree: BulkTree): { csv: string; products: number; rows: number; madeSkus: number } {
  const col = (name: (typeof PRODUCT_HEADER)[number]) => PRODUCT_HEADER.indexOf(name);
  const rows: Cell[][] = [[...PRODUCT_HEADER]];
  let products = 0;
  let madeSkus = 0;
  const taken = new Set<string>();
  for (const product of tree.roots)
    for (const kid of kidsOf(tree, product)) {
      const sku = s(kid.sku, 255).trim().toLowerCase();
      if (sku !== "") taken.add(sku);
    }
  const madeSku = (handle: string, values: readonly string[]): string => {
    const base = [skuPart(handle), ...values.map(skuPart)].filter(Boolean).join("-").slice(0, 60) || "variant";
    let sku = base;
    for (let n = 2; taken.has(sku); n += 1) sku = `${base}-${n}`;
    taken.add(sku);
    madeSkus += 1;
    return sku;
  };
  for (const product of tree.roots) {
    const handle = s(product.handle, 255);
    if (handle === "") continue;
    products += 1;
    const kids = kidsOf(tree, product);
    const variants = kids
      .filter((k) => "selectedOptions" in k || "price" in k)
      .sort((a, b) => Number(a.position ?? 0) - Number(b.position ?? 0));
    // A media line has only its picture; a variant line has its options and price.
    const pictures = kids.filter((k) => !("selectedOptions" in k) && !("price" in k)).map((k) => o(k.image)).filter((img) => s(img.url) !== "");
    const options = (Array.isArray(product.options) ? product.options : [])
      .map(o)
      .sort((a, b) => Number(a.position ?? 0) - Number(b.position ?? 0))
      .slice(0, 3)
      .map((opt) => s(opt.name, 255));
    const status = s(product.status, 20).toLowerCase();
    const seo = o(product.seo);
    const lines = Math.max(variants.length, pictures.length, 1);
    for (let i = 0; i < lines; i += 1) {
      const row: Cell[] = PRODUCT_HEADER.map(() => "");
      row[col("Handle")] = handle;
      if (i === 0) {
        row[col("Title")] = s(product.title, 255);
        row[col("Body (HTML)")] = s(product.descriptionHtml, 60_000);
        row[col("Tags")] = (Array.isArray(product.tags) ? product.tags : []).map((t) => s(t, 255)).filter(Boolean).join(", ");
        row[col("Published")] = status === "active" ? "TRUE" : "FALSE";
        row[col("Status")] = status;
        row[col("Gift Card")] = yesNo(product.isGiftCard === true);
        row[col("SEO Title")] = s(seo.title, 255);
        row[col("SEO Description")] = s(seo.description, 1000);
      }
      const variant = variants[i];
      if (variant) {
        const selected = (Array.isArray(variant.selectedOptions) ? variant.selectedOptions : []).map(o);
        options.forEach((name, n) => {
          const value = selected.find((so) => s(so.name, 255) === name)?.value;
          if (i === 0) row[col(`Option${n + 1} Name` as (typeof PRODUCT_HEADER)[number])] = name;
          row[col(`Option${n + 1} Value` as (typeof PRODUCT_HEADER)[number])] = s(value, 255);
        });
        const item = o(variant.inventoryItem);
        const values = selected.map((so) => s(so.value, 255)).filter((v) => v !== "" && v !== "Default Title");
        row[col("Variant SKU")] = s(variant.sku, 255).trim() || madeSku(handle, values);
        row[col("Variant Grams")] = gramsOf(o(item.measurement).weight);
        row[col("Variant Inventory Qty")] = typeof variant.inventoryQuantity === "number" && Number.isSafeInteger(variant.inventoryQuantity) ? variant.inventoryQuantity : "";
        row[col("Variant Price")] = amountCell(variant.price);
        row[col("Variant Compare At Price")] = amountCell(variant.compareAtPrice);
        row[col("Variant Requires Shipping")] = yesNo(item.requiresShipping);
        row[col("Variant Barcode")] = s(variant.barcode, 255);
        row[col("Variant Image")] = s(o(variant.image).url, 2000);
        row[col("Cost per item")] = amountCell(o(item.unitCost).amount);
      }
      const picture = pictures[i];
      if (picture) {
        row[col("Image Src")] = s(picture.url, 2000);
        row[col("Image Position")] = i + 1;
        row[col("Image Alt Text")] = s(picture.altText, 512);
      }
      rows.push(row);
    }
  }
  return { csv: writeCsv(rows), products, rows: rows.length - 1, madeSkus };
}

export const CUSTOMER_HEADER = [
  "First Name",
  "Last Name",
  "Email",
  "Phone",
  "Default Address Company",
  "Default Address Address1",
  "Default Address Address2",
  "Default Address City",
  "Default Address Zip",
  "Default Address Country Code",
  "Tags",
] as const;

/**
 * The customer file: one row a customer with an email (a customer without one cannot be found again by email, the import's one key, and is
 * counted, not written). Consent is never in it: the customer import reads none (D366), and the email list's evidence is step 8's.
 */
export function customersFile(tree: BulkTree): { csv: string; customers: number; withoutEmail: number } {
  const rows: Cell[][] = [[...CUSTOMER_HEADER]];
  let withoutEmail = 0;
  for (const c of tree.roots) {
    const email = s(o(c.defaultEmailAddress).emailAddress, 320).trim();
    if (email === "") {
      withoutEmail += 1;
      continue;
    }
    const a = o(c.defaultAddress);
    rows.push([
      s(c.firstName, 255),
      s(c.lastName, 255),
      email,
      s(o(c.defaultPhoneNumber).phoneNumber, 40) || s(a.phone, 40),
      s(a.company, 255),
      s(a.address1, 255),
      s(a.address2, 255),
      s(a.city, 255),
      s(a.zip, 40),
      s(a.countryCodeV2, 2),
      (Array.isArray(c.tags) ? c.tags : []).map((t) => s(t, 255)).filter(Boolean).join(", "),
    ]);
  }
  return { csv: writeCsv(rows), customers: rows.length - 1, withoutEmail };
}

export const ORDER_HEADER = [
  "Name",
  "Email",
  "Financial Status",
  "Fulfillment Status",
  "Currency",
  "Subtotal",
  "Shipping",
  "Taxes",
  "Total",
  "Discount Code",
  "Discount Amount",
  "Created at",
  "Canceled at",
  "Lineitem quantity",
  "Lineitem name",
  "Lineitem price",
  "Lineitem sku",
  "Billing Name",
  "Billing Address1",
  "Billing Address2",
  "Billing City",
  "Billing Zip",
  "Billing Country",
  "Shipping Name",
  "Shipping Address1",
  "Shipping Address2",
  "Shipping City",
  "Shipping Zip",
  "Shipping Country",
] as const;

/** Shopify's order export: the order's fields on its first row, each line item a row of its own, in the shop's currency (`shopMoney`). */
export function ordersFile(tree: BulkTree): { csv: string; orders: number } {
  const col = (name: (typeof ORDER_HEADER)[number]) => ORDER_HEADER.indexOf(name);
  const rows: Cell[][] = [[...ORDER_HEADER]];
  let orders = 0;
  for (const order of tree.roots) {
    const name = s(order.name, 100);
    if (name === "") continue;
    orders += 1;
    const lines = kidsOf(tree, order);
    const count = Math.max(lines.length, 1);
    for (let i = 0; i < count; i += 1) {
      const row: Cell[] = ORDER_HEADER.map(() => "");
      row[col("Name")] = name;
      if (i === 0) {
        const bill = o(order.billingAddress);
        const ship = o(order.shippingAddress);
        const codes = (Array.isArray(order.discountCodes) ? order.discountCodes : []).map((c) => s(c, 255)).filter(Boolean);
        row[col("Email")] = s(order.email, 320);
        row[col("Financial Status")] = s(order.displayFinancialStatus, 40).toLowerCase();
        row[col("Fulfillment Status")] = s(order.displayFulfillmentStatus, 40).toLowerCase();
        row[col("Currency")] = s(order.currencyCode, 3);
        row[col("Subtotal")] = money(order.subtotalPriceSet);
        row[col("Shipping")] = money(order.totalShippingPriceSet);
        row[col("Taxes")] = money(order.totalTaxSet);
        row[col("Total")] = money(order.totalPriceSet);
        row[col("Discount Code")] = codes.join(", ");
        row[col("Discount Amount")] = money(order.totalDiscountsSet);
        row[col("Created at")] = s(order.createdAt, 40);
        row[col("Canceled at")] = s(order.cancelledAt, 40);
        for (const [prefix, a] of [["Billing", bill], ["Shipping", ship]] as const) {
          row[col(`${prefix} Name`)] = s(a.name, 255);
          row[col(`${prefix} Address1`)] = s(a.address1, 255);
          row[col(`${prefix} Address2`)] = s(a.address2, 255);
          row[col(`${prefix} City`)] = s(a.city, 255);
          row[col(`${prefix} Zip`)] = s(a.zip, 40);
          row[col(`${prefix} Country`)] = s(a.countryCodeV2, 2);
        }
      }
      const line = lines[i];
      if (line) {
        row[col("Lineitem quantity")] = typeof line.quantity === "number" && Number.isSafeInteger(line.quantity) ? line.quantity : "";
        row[col("Lineitem name")] = s(line.name, 300);
        row[col("Lineitem price")] = money(line.originalUnitPriceSet);
        row[col("Lineitem sku")] = s(line.sku, 64);
      }
      rows.push(row);
    }
  }
  return { csv: writeCsv(rows), orders };
}

/** Shopify's redirect file: `Redirect from`, `Redirect to`. */
export function redirectsFile(tree: BulkTree): { csv: string; redirects: number } {
  const rows: Cell[][] = [["Redirect from", "Redirect to"]];
  for (const r of tree.roots) {
    const from = s(r.path, 500).trim();
    const to = s(r.target, 2000).trim();
    if (from !== "" && to !== "") rows.push([from, to]);
  }
  return { csv: writeCsv(rows), redirects: rows.length - 1 };
}

/** A category's name from a collection's title: the product import reads `/` as a level and `|` between categories, so neither is in a name. */
export const categoryName = (title: string): string => title.replace(/[/|]+/g, "-").replace(/\s+/g, " ").trim().slice(0, 80);

/**
 * The collections as Kaizena Flow's own product file (`handle`, `sku`, `variant_id`, `categories`), only the categories column filled: the
 * product import finds each product by its handle, creates each category by its name and puts the product in it (D165); nothing else of
 * the product is touched. A product in several collections is in each of their categories. A rule-filled (smart) collection comes over as
 * the products it holds now.
 */
export function collectionsFile(tree: BulkTree): { csv: string; collections: number } {
  const byProduct = new Map<string, string[]>();
  let collections = 0;
  for (const c of tree.roots) {
    const name = categoryName(s(c.title, 255));
    if (name === "") continue;
    collections += 1;
    for (const p of kidsOf(tree, c)) {
      const handle = s(p.handle, 255);
      if (handle === "") continue;
      const list = byProduct.get(handle) ?? [];
      if (!list.includes(name) && list.length < 50) list.push(name);
      byProduct.set(handle, list);
    }
  }
  const rows: Cell[][] = [["handle", "sku", "variant_id", "categories"]];
  for (const [handle, names] of byProduct) rows.push([handle, "", "", names.join(" | ")]);
  return { csv: writeCsv(rows), collections: byProduct.size === 0 ? 0 : collections };
}

/** A page's or post's address here from its Shopify handle: lower-case words with hyphens, at most 80 characters. */
export function slugOf(handle: string): string {
  return (
    handle
      .normalize("NFKD")
      .replace(/\p{M}/gu, "")
      .toLowerCase()
      .replace(/[øæßđłþœ]/g, (c) => ({ ø: "o", æ: "ae", ß: "ss", đ: "d", ł: "l", þ: "th", œ: "oe" })[c] ?? c)
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80)
      .replace(/-+$/, "") || "page"
  );
}

/** A Shopify page or blog post as the page editor's input: its title, its address, its body as one text block. */
export type DirectItem = { handle: string; title: string; body: string; published: boolean; blog: { handle: string; title: string } | null; author: string };

export function directItems(tree: BulkTree): DirectItem[] {
  return tree.roots
    .map((r) => ({
      handle: slugOf(s(r.handle, 255)),
      title: s(r.title, 200).trim() || s(r.handle, 200),
      body: s(r.body, 400_000),
      published: r.isPublished === true,
      blog: r.blog && typeof r.blog === "object" ? { handle: slugOf(s(o(r.blog).handle, 60)).slice(0, 60), title: s(o(r.blog).title, 80).trim() } : null,
      author: s(o(r.author).name, 100).trim(),
    }))
    .filter((i) => i.title !== "");
}

/** What a menu item links to here, from Shopify's type and address; a custom address when ours has no counterpart. */
export function menuLinkOf(type: string, url: string): Record<string, string> {
  let path = "/";
  let absolute: string | null = null;
  try {
    const u = new URL(url, "https://shop.invalid");
    path = u.pathname.replace(/\/+$/, "") || "/";
    if (u.hostname !== "shop.invalid" && (u.protocol === "https:" || u.protocol === "http:")) absolute = u.toString();
  } catch {
    path = "/";
  }
  const parts = path.split("/").filter(Boolean);
  const last = parts[parts.length - 1] ?? "";
  switch (type) {
    case "FRONTPAGE":
      return { kind: "home" };
    case "CATALOG":
    case "COLLECTIONS":
      return { kind: "products" };
    case "COLLECTION":
      return last === "" || last === "all" || last === "collections" ? { kind: "products" } : { kind: "category", slug: slugOf(last) };
    case "PRODUCT":
      return last ? { kind: "product", handle: last.toLowerCase() } : { kind: "products" };
    case "PAGE":
      return last ? { kind: "page", slug: slugOf(last) } : { kind: "home" };
    case "BLOG":
      return { kind: "blog" };
    case "ARTICLE":
      return last ? { kind: "article", slug: slugOf(last) } : { kind: "blog" };
    case "CUSTOMER":
      return { kind: "account" };
    default:
      return absolute && type === "HTTP" ? { kind: "url", url: absolute } : { kind: "url", url: path };
  }
}

/** A Shopify menu as the menu editor's input: its items with their depth (at most three levels), each label in the store's main language. */
export function menuInputOf(menu: Obj, locale: string): { name: string; items: { label: Record<string, string>; link: Record<string, string>; depth: number }[] } {
  const items: { label: Record<string, string>; link: Record<string, string>; depth: number }[] = [];
  const walk = (list: unknown, depth: number) => {
    if (!Array.isArray(list) || depth > 2) return;
    for (const raw of list) {
      if (items.length >= 100) return;
      const item = o(raw);
      const title = s(item.title, 60).trim();
      if (title === "") continue;
      items.push({ label: { [locale]: title }, link: menuLinkOf(s(item.type, 40), s(item.url, 2000)), depth });
      walk(item.items, depth + 1);
    }
  };
  walk(menu.items, 0);
  return { name: s(menu.title, 80).trim() || s(menu.handle, 80) || "Menu", items };
}

/** The file the products' vendors are kept in (D445 step 6): one line a product, for *Who makes your products?*. */
export const VENDORS_FILE = "shopify-vendors.jsonl";

/** A product's vendor as Shopify names it (never its manufacturer: that is the owner's to say), its handle, and whether it was on sale there. */
export type VendorLine = { vendor: string; handle: string; active: boolean };

/** Each product's vendor, from the products' bulk read; a gift card is no product here and is left out. */
export function vendorLines(tree: BulkTree): VendorLine[] {
  return tree.roots
    .filter((p) => s(p.handle, 255) !== "" && p.isGiftCard !== true)
    .map((p) => ({ vendor: s(p.vendor, 255).replace(/\s+/g, " ").trim(), handle: s(p.handle, 255), active: s(p.status, 20) === "ACTIVE" }));
}

/**
 * A customer's email consent as Shopify records it (D445 step 8, `docs/moving-from-shopify.md` 6.2): kept as Shopify gave it, the evidence the
 * subscriber list is built from; read from the customers' bulk read.
 */
export type ConsentLine = { email: string; name: string; state: string; level: string; updatedAt: string | null };

export function consentLines(tree: BulkTree): ConsentLine[] {
  return tree.roots.flatMap((c) => {
    const address = o(c.defaultEmailAddress);
    const email = s(address.emailAddress, 320).trim().toLowerCase();
    if (!email.includes("@")) return [];
    const at = s(address.marketingUpdatedAt, 40);
    return [
      {
        email,
        name: [s(c.firstName, 100), s(c.lastName, 100)].filter(Boolean).join(" ").trim().slice(0, 200),
        state: s(address.marketingState, 40),
        level: s(address.marketingOptInLevel, 40),
        updatedAt: at && !Number.isNaN(Date.parse(at)) ? new Date(at).toISOString() : null,
      },
    ];
  });
}

/** A feed's file from its bulk operation's text, and how many things it holds. */
export function fileOfFeed(feed: CopyFeed, text: string): { csv: string; count: number } {
  const tree = readBulkLines(text);
  switch (feed) {
    case "products": {
      const f = productsFile(tree);
      return { csv: f.csv, count: f.products };
    }
    case "customers": {
      const f = customersFile(tree);
      return { csv: f.csv, count: f.customers };
    }
    case "orders": {
      const f = ordersFile(tree);
      return { csv: f.csv, count: f.orders };
    }
    case "redirects": {
      const f = redirectsFile(tree);
      return { csv: f.csv, count: f.redirects };
    }
    case "collections": {
      const f = collectionsFile(tree);
      return { csv: f.csv, count: f.collections };
    }
    case "pages":
    case "articles":
      return { csv: text, count: directItems(tree).length };
    case "menus":
    case "countries":
    case "shipping":
    case "subscribers":
    case "gift_cards":
    case "discounts":
    case "look":
      return { csv: text, count: tree.roots.length };
  }
}

// ---------------------------------------------------------------------------
// The copy's state
// ---------------------------------------------------------------------------

/**
 * Where a feed is: `waiting` to be read; `reading` (a bulk operation running at Shopify); `checking` (its file is the import's dry run);
 * `checked` (ready, or with problems to look at on the import's own page); `applying`; `done`; `empty` (nothing of it in the shop);
 * `failed` (with a code the page words).
 */
export type FeedStage = "waiting" | "reading" | "checking" | "checked" | "applying" | "done" | "empty" | "failed";
export type FeedProblem = "shopify_refused" | "shopify_failed" | "too_large" | "storage" | "import_refused" | "import_failed" | "needs_fixing";
export type FeedState = {
  stage: FeedStage;
  operation?: string;
  job?: string;
  count?: number;
  problem?: FeedProblem;
  /** A `later` or `direct` feed's file in the imports bucket, kept until it is brought over. */
  path?: string;
  /** The products feed only: its vendors' file (`VENDORS_FILE`) in the imports bucket. */
  vendors?: string;
  /** A `direct` feed's next item, and how many it made and could not make. */
  cursor?: number;
  made?: number;
  refused?: number;
};
/** `since`: a move-day catch-up (D445 step 7) reading only what Shopify made from then on, brought over without asking. */
export type CopyState = { startedAt: string | null; apply: boolean; since?: string; feeds: Record<CopyFeed, FeedState> };

export const EMPTY_COPY: CopyState = {
  startedAt: null,
  apply: false,
  feeds: {
    countries: { stage: "waiting" },
    shipping: { stage: "waiting" },
    subscribers: { stage: "waiting" },
    gift_cards: { stage: "waiting" },
    discounts: { stage: "waiting" },
    look: { stage: "waiting" },
    products: { stage: "waiting" },
    collections: { stage: "waiting" },
    customers: { stage: "waiting" },
    orders: { stage: "waiting" },
    pages: { stage: "waiting" },
    articles: { stage: "waiting" },
    menus: { stage: "waiting" },
    redirects: { stage: "waiting" },
  },
};

const STAGES: readonly FeedStage[] = ["waiting", "reading", "checking", "checked", "applying", "done", "empty", "failed"];
const PROBLEMS: readonly FeedProblem[] = ["shopify_refused", "shopify_failed", "too_large", "storage", "import_refused", "import_failed", "needs_fixing"];
const GID = /^gid:\/\/shopify\/BulkOperation\/\d+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FILE_PATH = /^[0-9a-f-]{36}\/[0-9a-f-]{36}\/shopify-[a-z]+\.(csv|jsonl)$/i;
const count = (v: unknown): number | undefined => (typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : undefined);

/** The kept state read back, every field checked (an unknown shape is a fresh start, never trusted). */
export function copyStateOf(raw: unknown): CopyState {
  const r = o(raw);
  const feeds = o(r.feeds);
  const out: CopyState = { startedAt: typeof r.startedAt === "string" && !Number.isNaN(Date.parse(r.startedAt)) ? r.startedAt : null, apply: r.apply === true, feeds: { ...EMPTY_COPY.feeds } };
  if (typeof r.since === "string" && ISO_INSTANT.test(r.since)) out.since = r.since;
  for (const feed of COPY_FEEDS) {
    const f = o(feeds[feed]);
    // A part this copy was started without (one added since) is not part of it: Start again brings it.
    if (!(feed in feeds) && out.startedAt !== null && out.apply) {
      out.feeds[feed] = { stage: "empty" };
      continue;
    }
    const stage = STAGES.includes(f.stage as FeedStage) ? (f.stage as FeedStage) : "waiting";
    const state: FeedState = { stage };
    if (typeof f.operation === "string" && GID.test(f.operation)) state.operation = f.operation;
    if (typeof f.job === "string" && UUID.test(f.job)) state.job = f.job;
    if (typeof f.count === "number" && Number.isSafeInteger(f.count) && f.count >= 0) state.count = f.count;
    if (PROBLEMS.includes(f.problem as FeedProblem)) state.problem = f.problem as FeedProblem;
    if (typeof f.path === "string" && FILE_PATH.test(f.path)) state.path = f.path;
    if (typeof f.vendors === "string" && FILE_PATH.test(f.vendors)) state.vendors = f.vendors;
    for (const key of ["cursor", "made", "refused"] as const) {
      const n = count(f[key]);
      if (n !== undefined) state[key] = n;
    }
    out.feeds[feed] = state;
  }
  return out;
}

const SETTLED: readonly FeedStage[] = ["done", "empty", "failed"];

/** Whether the copy has started and something in it still moves without the owner (the page asks again while it does). */
export const copyMoving = (state: CopyState): boolean =>
  state.startedAt !== null && (COPY_FEEDS.some((f) => ["waiting", "reading", "checking", "applying"].includes(state.feeds[f].stage)) || nextToApply(state) !== null);

/** Whether every feed has been read and checked (or had nothing), so *Bring it over* can be pressed. */
export const copyReady = (state: CopyState): boolean =>
  state.startedAt !== null && !state.apply && COPY_FEEDS.every((f) => ["checked", "empty", "failed"].includes(state.feeds[f].stage)) && COPY_FEEDS.some((f) => state.feeds[f].stage === "checked");

/** How many feeds could not come over (`failed`), for the page's last line. */
export const copyFailed = (state: CopyState): number => COPY_FEEDS.filter((f) => state.feeds[f].stage === "failed").length;

/** Whether everything that could come over has. */
export const copyDone = (state: CopyState): boolean => state.startedAt !== null && COPY_FEEDS.every((f) => SETTLED.includes(state.feeds[f].stage));

/** The feed to apply next: in the order of `COPY_FEEDS`, the first checked one whose earlier feeds are settled (customers before orders). */
export function nextToApply(state: CopyState): CopyFeed | null {
  if (!state.apply) return null;
  for (const feed of COPY_FEEDS) {
    const stage = state.feeds[feed].stage;
    if (stage === "applying") return null;
    if (stage === "checked") return feed;
    if (!SETTLED.includes(stage)) return null;
  }
  return null;
}

/** The order feeds are READ in: the bulk reads first, then the few read by their own small queries (`PLAIN_FEEDS`). */
export const READ_ORDER: readonly CopyFeed[] = ["products", "collections", "customers", "orders", "pages", "articles", "redirects", "menus", "countries", "shipping", "discounts", "look", "gift_cards"];

/** The feeds read by an ordinary query, in one tick, rather than a bulk operation. */
export const PLAIN_FEEDS: readonly CopyFeed[] = ["menus", "countries", "shipping", "discounts", "look", "gift_cards"];

/** The feed to read next: one bulk operation at a time per shop, in `READ_ORDER`. */
export function nextToRead(state: CopyState): CopyFeed | null {
  if (state.startedAt === null || COPY_FEEDS.some((f) => state.feeds[f].stage === "reading")) return null;
  return READ_ORDER.find((f) => state.feeds[f].stage === "waiting") ?? null;
}
