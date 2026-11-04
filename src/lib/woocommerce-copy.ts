/**
 * *Copy my shop* from WooCommerce (D446 step 1, `docs/moving-from-woocommerce.md` 5), pure: each page of WooCommerce's REST answers written
 * as the lines the Shopify copy's bulk reads give (`readBulkLines()`: one object a line, a child naming its parent in `__parentId`), so the
 * files, imports, dry runs, *Bring it over* and *Undo this copy* of D445 bring them over unchanged (`fileOfFeed()` in `shopify-copy.ts`).
 * Only what WooCommerce says differently is decided here: a product's real address (its `slug`, never guessed as D384's file must), its
 * categories, the orders the history keeps, and its coupons as the discount lines step 5b writes. Read 3 November 2026 at
 * <https://woocommerce.github.io/woocommerce-rest-api-docs/> (v3: products, variations, customers, orders, coupons). Nothing here fetches.
 */
import { htmlToText } from "./product-csv-shopify";
import { REVIEW_BODY_MAX, REVIEW_NAME_MAX } from "./review-status";
import { categoryName, type ReviewLine } from "./shopify-copy";
import type { DiscountLeftOut, DiscountLine } from "./shopify-settings";

type Obj = Record<string, unknown>;

const s = (v: unknown, max = 5000): string => (typeof v === "string" ? v.slice(0, max) : typeof v === "number" && Number.isFinite(v) ? String(v) : "");
const o = (v: unknown): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});
const list = (v: unknown): Obj[] => (Array.isArray(v) ? v.map(o) : []);
const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};
/** A decimal amount as WooCommerce gives it ("12.5", "0.00"), or null. */
const amount = (v: unknown): string | null => {
  const text = s(v, 40).trim();
  return /^\d+(\.\d+)?$/.test(text) ? text : null;
};
/** WooCommerce's GMT times have no zone (`2026-11-03T10:15:00`): they are UTC. */
const gmt = (v: unknown): string | null => {
  const text = s(v, 40).trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(text)) return null;
  const at = new Date(`${text}Z`);
  return Number.isNaN(at.getTime()) ? null : at.toISOString();
};

/** The REST routes each feed reads, a page at a time (`page`, `per_page`), oldest first so a page stays the same while the shop sells. */
export const WOO_ROUTES = {
  products: "wc/v3/products",
  customers: "wc/v3/customers",
  orders: "wc/v3/orders",
  discounts: "wc/v3/coupons",
  reviews: "wc/v3/products/reviews",
} as const;
export type WooFeed = keyof typeof WOO_ROUTES;

/** The parts a WooCommerce copy brings in step 1 (categories come with the products); the others are later steps' (D446 12). */
export const WOO_COPY_FEEDS = ["products", "collections", "customers", "orders", "discounts", "reviews"] as const;
/** The parts our WordPress plugin brings once the owner connects it (D446 step 2): the redirect plugins' redirects and MailPoet's list. */
export const WOO_MOVER_FEEDS = ["redirects", "subscribers", "seo", "gift_cards", "pages", "articles", "menus"] as const;

/** How many of a feed a page holds: WooCommerce's most is 100; smaller pages are kinder to a shared host (D446 8). */
export const WOO_PAGE_SIZE = 50;

/** The query of a feed's page `page` (from 1). `since`: orders and customers changed from then (a catch-up), or orders placed from then. */
export function wooQuery(feed: WooFeed, page: number, options: { ordersSince?: string | null } = {}): Record<string, string | number> {
  const base = { page, per_page: WOO_PAGE_SIZE, orderby: "id", order: "asc" };
  if (feed === "products") return { ...base, status: "any" };
  if (feed === "orders") return { ...base, status: "any", ...(options.ordersSince ? { after: options.ordersSince } : {}) };
  if (feed === "customers") return { ...base, role: "customer" };
  // Every review but spam and the bin: the approved ones were shown, the held ones were waiting (`reviewLines()` keeps which).
  if (feed === "reviews") return { ...base, status: "all" };
  return base;
}

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------

/** WooCommerce's weight unit (`woocommerce_weight_unit`) as the bulk lines' (`gramsOf()` in `shopify-copy.ts`). */
export function weightUnitOf(unit: unknown): string | null {
  const u = s(unit, 10).toLowerCase();
  return ({ g: "GRAMS", kg: "KILOGRAMS", lbs: "POUNDS", oz: "OUNCES" } as Record<string, string>)[u] ?? null;
}

/** A product WooCommerce has that the copy leaves where it is, counted and said once. */
export type WooSkipped = "grouped" | "external" | "no_slug";

/** One page of products made into lines; `variations` are each variable product's own, by its id (read beside the page). */
export function productLines(page: unknown, variations: ReadonlyMap<number, unknown[]>, weightUnit: string | null): { lines: Obj[]; skipped: WooSkipped[] } {
  const lines: Obj[] = [];
  const skipped: WooSkipped[] = [];
  for (const p of list(page)) {
    const type = s(p.type, 20);
    if (type === "grouped") {
      // A group is its products, each a product of its own here (D446 5).
      skipped.push("grouped");
      continue;
    }
    if (type === "external") {
      skipped.push("external");
      continue;
    }
    const handle = s(p.slug, 200).toLowerCase().trim();
    if (handle === "" || !/^[a-z0-9%-][a-z0-9%_-]*$/.test(handle)) {
      skipped.push("no_slug");
      continue;
    }
    const id = `woo-product-${s(p.id, 20)}`;
    const status = s(p.status, 20);
    const options = list(p.attributes)
      .filter((a) => a.variation === true)
      .slice(0, 3)
      .map((a, n) => ({ name: s(a.name, 255), position: n + 1 }))
      .filter((a) => a.name !== "");
    lines.push({
      id,
      handle,
      title: s(p.name, 255),
      descriptionHtml: s(p.description, 60_000) || s(p.short_description, 60_000),
      tags: list(p.tags).map((t) => s(t.name, 255)).filter(Boolean),
      // Only a published product is live here; a draft, a pending one and a private one come over as drafts.
      status: status === "publish" ? "ACTIVE" : "DRAFT",
      isGiftCard: false,
      seo: { title: "", description: "" },
      options,
      // WooCommerce gives a product with no category its default, *Uncategorized*: that is no category here.
      categories: list(p.categories)
        .filter((c) => s(c.slug, 200) !== "uncategorized")
        .map((c) => categoryName(s(c.name, 255)))
        .filter(Boolean),
    });
    const variant = (v: Obj, position: number, selected: { name: string; value: string }[]) => {
      const stock = v.manage_stock === true ? num(v.stock_quantity) : null;
      const weight = num(v.weight);
      return {
        __parentId: id,
        id: `woo-variant-${s(v.id, 20)}`,
        sku: s(v.sku, 255).trim(),
        // `price` is what it sells for now (the sale price while its dates hold); never a compare-at price (D446 5, D384).
        price: amount(v.price),
        compareAtPrice: null,
        inventoryQuantity: stock !== null && Number.isSafeInteger(stock) ? stock : null,
        position,
        barcode: "",
        selectedOptions: selected,
        image: o(v.image).src ? { url: s(o(v.image).src, 2000) } : null,
        inventoryItem: {
          requiresShipping: v.virtual !== true,
          unitCost: null,
          measurement: { weight: weight !== null && weight > 0 && weightUnit ? { value: weight, unit: weightUnit } : null },
        },
      };
    };
    if (type === "variable") {
      const own = (variations.get(Number(p.id)) ?? []).map(o).sort((a, b) => (num(a.menu_order) ?? 0) - (num(b.menu_order) ?? 0));
      own.forEach((v, n) =>
        lines.push(
          variant(v, n + 1, options.map((opt) => ({ name: opt.name, value: s(list(v.attributes).find((a) => s(a.name, 255) === opt.name)?.option, 255) }))),
        ),
      );
    } else {
      lines.push(variant(p, 1, []));
    }
    for (const image of list(p.images).slice(0, 50)) {
      const url = s(image.src, 2000);
      if (url) lines.push({ __parentId: id, image: { url, altText: s(image.alt, 512) } });
    }
  }
  return { lines, skipped };
}

/** The ids of a page's variable products, whose variations are read beside it. */
export const variableIds = (page: unknown): number[] =>
  list(page)
    .filter((p) => s(p.type, 20) === "variable")
    .map((p) => Number(p.id))
    .filter((id) => Number.isSafeInteger(id) && id > 0);

/**
 * The categories as the collections' lines (`collectionsFile()`): one a category, its products as its children, from the products' own
 * lines (each names its categories), so no read of its own is needed.
 */
export function collectionLines(productLinesText: string): Obj[] {
  const byName = new Map<string, string[]>();
  for (const line of productLinesText.split("\n")) {
    if (line.trim() === "") continue;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      continue;
    }
    const p = o(value);
    if (p.__parentId !== undefined || typeof p.handle !== "string") continue;
    for (const name of Array.isArray(p.categories) ? p.categories : []) {
      if (typeof name !== "string" || name === "") continue;
      const handles = byName.get(name) ?? [];
      handles.push(p.handle);
      byName.set(name, handles);
    }
  }
  const out: Obj[] = [];
  let n = 0;
  for (const [name, handles] of byName) {
    n += 1;
    const id = `woo-category-${n}`;
    out.push({ id, handle: name.toLowerCase(), title: name });
    for (const handle of handles) out.push({ __parentId: id, handle });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Customers and orders
// ---------------------------------------------------------------------------

/**
 * One page of customers (registered ones: a guest buyer is not a customer in WooCommerce, and is kept only in the order history, the
 * owner's Decision 3). Their billing address, else their shipping one. WooCommerce records no consent: none is written (D446 6.2).
 */
export function customerLines(page: unknown): Obj[] {
  return list(page).map((c) => {
    const billing = o(c.billing);
    const shipping = o(c.shipping);
    const a = s(billing.address_1) || s(billing.city) ? billing : shipping;
    return {
      id: `woo-customer-${s(c.id, 20)}`,
      firstName: s(c.first_name, 255) || s(billing.first_name, 255),
      lastName: s(c.last_name, 255) || s(billing.last_name, 255),
      tags: [],
      defaultEmailAddress: { emailAddress: s(c.email, 320) || s(billing.email, 320) },
      defaultPhoneNumber: { phoneNumber: s(billing.phone, 40) },
      defaultAddress: {
        company: s(a.company, 255),
        address1: s(a.address_1, 255),
        address2: s(a.address_2, 255),
        city: s(a.city, 255),
        zip: s(a.postcode, 40),
        countryCodeV2: s(a.country, 2).toUpperCase(),
        phone: s(billing.phone, 40),
      },
    };
  });
}

/** An order WooCommerce never took money for (left in the cart, failed, a draft of the checkout, in the bin): not history, counted. */
export const WOO_SKIPPED_ORDER = ["pending", "failed", "checkout-draft", "trash", "auto-draft"] as const;

const addressOf = (a: Obj) => ({
  name: [s(a.first_name, 120), s(a.last_name, 120)].filter(Boolean).join(" ").trim() || s(a.company, 255),
  address1: s(a.address_1, 255),
  address2: s(a.address_2, 255),
  city: s(a.city, 255),
  zip: s(a.postcode, 40),
  countryCodeV2: s(a.country, 2).toUpperCase(),
});

const money = (v: unknown) => ({ shopMoney: { amount: amount(v) ?? "0" } });

/**
 * One page of orders as the history's lines: `#{number}`, the buyer's email, the shop's money, its lines at what was paid for each.
 * Completed is fulfilled, cancelled and refunded are cancelled, processing and on hold are paid (`statusOf()` in `order-history.ts`).
 */
export function orderLines(page: unknown): { lines: Obj[]; skipped: number } {
  const lines: Obj[] = [];
  let skipped = 0;
  for (const order of list(page)) {
    const status = s(order.status, 30);
    if ((WOO_SKIPPED_ORDER as readonly string[]).includes(status)) {
      skipped += 1;
      continue;
    }
    const number = s(order.number, 40).trim() || s(order.id, 20);
    const id = `woo-order-${s(order.id, 20)}`;
    const items = list(order.line_items);
    // The lines' own prices before tax and coupons, the way WooCommerce adds them up to the order's subtotal.
    const subtotal = items.reduce((sum, item) => sum + (num(item.subtotal) ?? 0), 0);
    const placed = gmt(order.date_created_gmt);
    lines.push({
      id,
      name: `#${number}`,
      email: s(o(order.billing).email, 320),
      createdAt: placed ?? "",
      cancelledAt: status === "cancelled" ? (gmt(order.date_modified_gmt) ?? placed) : null,
      currencyCode: s(order.currency, 3).toUpperCase(),
      displayFinancialStatus: status === "refunded" ? "REFUNDED" : "PAID",
      displayFulfillmentStatus: status === "completed" ? "FULFILLED" : "UNFULFILLED",
      discountCodes: list(order.coupon_lines).map((c) => s(c.code, 255)).filter(Boolean),
      subtotalPriceSet: money(subtotal.toFixed(2)),
      totalShippingPriceSet: money(order.shipping_total),
      totalTaxSet: money(order.total_tax),
      totalDiscountsSet: money(order.discount_total),
      totalPriceSet: money(order.total),
      billingAddress: addressOf(o(order.billing)),
      shippingAddress: addressOf(o(order.shipping)),
    });
    for (const item of items) {
      const quantity = num(item.quantity);
      if (quantity === null || !Number.isInteger(quantity) || quantity <= 0) continue;
      // What one cost before the coupon, as the line's subtotal says (WooCommerce's `price` is after it).
      const each = (num(item.subtotal) ?? 0) / quantity;
      lines.push({ __parentId: id, name: s(item.name, 300), sku: s(item.sku, 64), quantity, originalUnitPriceSet: money(each.toFixed(2)) });
    }
  }
  return { lines, skipped };
}

// ---------------------------------------------------------------------------
// Coupons
// ---------------------------------------------------------------------------

/**
 * A coupon as step 5b's discount line (`DiscountLine`, written by `saveDiscount()`, switched off until the move), or what is left out:
 * percent and fixed-cart coupons, with their minimum spend, usage limit, expiry, and the products and categories they are limited to; a
 * fixed-per-product coupon, one limited to some customers' emails, or one excluding products, is said and left. `handles` and
 * `categories` name WooCommerce's ids (read beside the page).
 */
export function couponLine(
  coupon: unknown,
  currency: string,
  handles: ReadonlyMap<number, string>,
  categories: ReadonlyMap<number, string>,
  now: Date,
): DiscountLine | { leftOut: DiscountLeftOut; code: string } {
  const c = o(coupon);
  const code = s(c.code, 255).trim();
  if (code === "") return { leftOut: "no_code", code };
  const type = s(c.discount_type, 30);
  const ends = gmt(c.date_expires_gmt);
  if (ends && new Date(ends) <= now) return { leftOut: "expired", code };
  if (Array.isArray(c.email_restrictions) && c.email_restrictions.length > 0) return { leftOut: "some_customers", code };
  if ((Array.isArray(c.excluded_product_ids) && c.excluded_product_ids.length > 0) || (Array.isArray(c.excluded_product_categories) && c.excluded_product_categories.length > 0))
    return { leftOut: "other_kind", code };
  if (type === "fixed_product") return { leftOut: "each_item", code };
  const ids = (v: unknown) => (Array.isArray(v) ? v.map(Number).filter((n) => Number.isSafeInteger(n) && n > 0) : []);
  const productIds = ids(c.product_ids);
  const categoryIds = ids(c.product_categories);
  const productHandles = productIds.map((id) => handles.get(id)).filter((h): h is string => typeof h === "string");
  const categoryNames = categoryIds.map((id) => categories.get(id)).filter((n): n is string => typeof n === "string").map(categoryName).filter(Boolean);
  // A coupon limited to products or categories this shop no longer has cannot be said as it was.
  if (productIds.length > productHandles.length || categoryIds.length > categoryNames.length) return { leftOut: "variants", code };
  const min = amount(c.minimum_amount);
  const usage = num(c.usage_limit);
  const perUser = num(c.usage_limit_per_user);
  const value = num(c.amount);
  const base = {
    code,
    minSubtotal: min && Number(min) > 0 ? { amount: min, currency } : null,
    minQuantity: null,
    startsAt: null,
    endsAt: ends,
    usageLimit: usage !== null && Number.isInteger(usage) && usage >= 1 ? Math.min(usage, 1_000_000) : null,
    oncePerCustomer: perUser === 1,
    // WooCommerce's "Individual use only" is a code that combines with no other.
    combinesWith: c.individual_use === true ? [] : (["products", "order"] as ("products" | "order")[]),
    productHandles: productIds.length > 0 || categoryIds.length > 0 ? productHandles : null,
    categoryNames,
  };
  if (c.free_shipping === true && (value === null || value === 0)) return { ...base, kind: "free_shipping", percent: null, amount: null, productHandles: null, categoryNames: [] };
  if (type === "percent") {
    if (value === null || !Number.isInteger(value) || value < 1 || value > 100) return { leftOut: "not_whole_percent", code };
    return { ...base, kind: "percent", percent: value, amount: null };
  }
  if (type === "fixed_cart") {
    const a = amount(c.amount);
    if (!a || Number(a) <= 0) return { leftOut: "other_kind", code };
    return { ...base, kind: "fixed", percent: null, amount: { amount: a, currency } };
  }
  return { leftOut: "other_kind", code };
}

/** The product and category ids a page of coupons names, to read their slugs and names beside it. */
export function couponRefs(page: unknown): { products: number[]; categories: number[] } {
  const products = new Set<number>();
  const categories = new Set<number>();
  for (const c of list(page)) {
    for (const id of Array.isArray(c.product_ids) ? c.product_ids : []) if (Number.isSafeInteger(Number(id)) && Number(id) > 0) products.add(Number(id));
    for (const id of Array.isArray(c.product_categories) ? c.product_categories : []) if (Number.isSafeInteger(Number(id)) && Number(id) > 0) categories.add(Number(id));
  }
  return { products: [...products], categories: [...categories] };
}

/** A list of ids as WooCommerce's `include` takes it (`11,12,13`): a query value, not a CSV. */
export const includeOf = (ids: readonly number[]): string => ids.filter((id) => Number.isSafeInteger(id) && id > 0).join(",");

// ---------------------------------------------------------------------------
// Reviews (step 1b)
// ---------------------------------------------------------------------------

/** A review WooCommerce has that does not come over: spam or in the bin, no stars, a product not read, or no name. Counted, said once. */
export type WooReviewSkipped = "status" | "rating" | "product" | "author";

/**
 * One page of product reviews as lines for the review import (`reviewsFile()`): the product by its handle (`handles`, WooCommerce's ids read
 * beside the page), the stars, the reviewer's name, the words as plain text (WooCommerce keeps them as HTML) and the day it was written.
 * `approved` were shown on the shop and come over published; `hold` were waiting and come over waiting. WooCommerce's *verified owner* is not
 * carried: a review here is a verified purchase only when it is a buyer's of an order line in this store (D301).
 */
export function reviewLines(page: unknown, handles: ReadonlyMap<number, string>): { lines: ReviewLine[]; skipped: WooReviewSkipped[] } {
  const lines: ReviewLine[] = [];
  const skipped: WooReviewSkipped[] = [];
  for (const r of list(page)) {
    const status = s(r.status, 20);
    if (status !== "approved" && status !== "hold") {
      skipped.push("status");
      continue;
    }
    const rating = num(r.rating);
    if (rating === null || !Number.isInteger(rating) || rating < 1 || rating > 5) {
      skipped.push("rating");
      continue;
    }
    const handle = handles.get(Number(r.product_id));
    if (!handle) {
      skipped.push("product");
      continue;
    }
    const author = [...s(r.reviewer, 400).replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim()].slice(0, REVIEW_NAME_MAX).join("").trim();
    if (author === "") {
      skipped.push("author");
      continue;
    }
    const date = (gmt(r.date_created_gmt) ?? "").slice(0, 10);
    lines.push({ handle, rating, author, body: [...htmlToText(s(r.review, 60_000))].slice(0, REVIEW_BODY_MAX).join("").trim(), date, approved: status === "approved" });
  }
  return { lines, skipped };
}

/** The products a page of reviews is about, to read their handles beside it. */
export const reviewProductIds = (page: unknown): number[] => [
  ...new Set(
    list(page)
      .map((r) => Number(r.product_id))
      .filter((id) => Number.isSafeInteger(id) && id > 0),
  ),
];
