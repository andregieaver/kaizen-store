import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { MAX_LINE_QUANTITY } from "@/lib/cart";
import { t } from "@/lib/i18n";
import { formatMoney } from "@/lib/money";
import { marketPath, storeSiteUrl } from "@/lib/paths";
import { priceView, type PriceView } from "@/lib/pricing";
import { shown, type Market } from "@/lib/markets";
import { backorderNote, type VariantStock } from "@/lib/stock-availability";
import { cartableReason, cartLabels, stockOf, type CartLabels, type CartLineInput, type NotCartable } from "@/lib/wordpress-cart";
import { wordpressPrice, type WordpressPrice } from "@/lib/wordpress-view";
import { priceVat } from "@/lib/pricing";

import { getProduct, getVariantStock } from "./catalog";
import { createHandoffCart } from "./cart-handoff";
import { marketIn } from "./shop";
import type { Store } from "./stores";
import { OFFERED } from "./product-conditions";

type Row = Record<string, unknown>;

const absolute = (url: string, origin: string) => (url.startsWith("/") ? `${origin}${url}` : url);

/** What a card needs to offer a product for a cart on another site: whether it can be, the variant when there is only one, and whether it is sold out. */
export type CardCart = { cartable: boolean; reason: NotCartable | null; variant_id: string | null; variant_count: number; sold_out: boolean };

/**
 * For a list of products in a market: can each be put in a cart on another site (`cartableReason()`), which variant it is when it has one, and
 * is it sold out. One query and one stock read for all of them.
 */
export async function cardCarts(store: Store, market: Market, productIds: string[]): Promise<Map<string, CardCart>> {
  const out = new Map<string, CardCart>();
  if (productIds.length === 0) return out;
  const rows = await db().execute<Row>(sql`
    select p.id as product_id, p.kind, p.subscription_only, p.audience,
      array_agg(v.id order by cp.amount_minor, v.sku) as variant_ids,
      array_agg(v.delivery::text order by cp.amount_minor, v.sku) as deliveries
    from commerce.products p
    join commerce.product_variants v on v.store_id = p.store_id and v.product_id = p.id and v.active
    join commerce.current_prices cp on cp.variant_id = v.id and cp.market_code = ${market.code}
    where p.store_id = ${store.id}::uuid and p.status = 'active' and ${OFFERED} and p.id = any(${`{${productIds.join(",")}}`}::uuid[])
    group by p.id, p.kind, p.subscription_only, p.audience
  `);
  const stock = await getVariantStock(store.id, rows.flatMap((r) => r.variant_ids as string[]));
  for (const row of rows) {
    const ids = row.variant_ids as string[];
    const deliveries = row.deliveries as string[];
    const reason = cartableReason({ kind: String(row.kind), subscriptionOnly: Boolean(row.subscription_only), audience: String(row.audience) }, store.audience, deliveries);
    // A variant on backorder counts as sold out here: a card cannot state the days (D172); the plugin's product page can.
    const soldOut = ids.every((id, i) => deliveries[i] === "physical" && (stock.get(id)?.inStock ?? 0) <= 0);
    out.set(String(row.product_id), { cartable: reason === null, reason, variant_id: ids.length === 1 ? ids[0] : null, variant_count: ids.length, sold_out: soldOut });
  }
  return out;
}

export type WpVariant = {
  id: string;
  sku: string;
  options: Record<string, string>;
  price: WordpressPrice;
  image: { url: string; thumbnail: string; alt: string } | null;
  stock: { level: "in_stock" | "low" | "out"; max: number; low: number | null };
  /**
   * The days stated for a variant that keeps selling at zero stock and has none now (wave 3, D172); null otherwise. Its `stock.level` is
   * `out`, so a plugin that does not know backorders (before 1.2) shows it sold out, which is safe; one that does shows the days.
   */
  backorder_days: number | null;
};

export type WpProductPage = {
  store: { slug: string; name: string };
  market: { slug: string; country: string; name: string; currency: string; language: string };
  open: boolean;
  product: {
    id: string;
    handle: string;
    title: string;
    description: string;
    seo_title: string;
    seo_description: string;
    url: string;
    images: { url: string; thumbnail: string; alt: string }[];
    /** Option names in the owner's order, each with its values: how the shopper chooses a variant. */
    options: { name: string; values: string[] }[];
    variants: WpVariant[];
    cartable: boolean;
    reason: NotCartable | null;
  };
  labels: CartLabels;
};

const marketOut = (market: Market) => ({ slug: market.slug, country: market.code, name: market.name, currency: market.currency, language: market.lang });

/** The "view on the store" words, in the languages the storefront has by hand; English for the rest. */
const VIEW_IN_STORE: Record<string, string> = { nb: "Se i nettbutikken", nn: "Sjå i nettbutikken", no: "Se i nettbutikken", da: "Se i webshoppen", sv: "Se i webbutiken" };
const viewInStore = (lang: string) => VIEW_IN_STORE[lang.slice(0, 2).toLowerCase()] ?? "View in the store";

/**
 * A product with everything its page needs: pictures, options, each variant's price written out and its stock, and the words, in the market
 * (null when the store is not open or the product is not there). Read as the storefront's own product page reads it (`getProduct()`).
 */
export async function productPageOf(store: Store, marketRef: string | null, handle: string): Promise<WpProductPage | null> {
  const market = marketIn(store, marketRef);
  if (!market || store.status !== "active" || !/^[a-z0-9][a-z0-9-]{0,98}$/i.test(handle)) return null;
  const detail = await getProduct(store.id, market, handle);
  if (!detail) return null;
  const origin = storeSiteUrl(store.slug);
  const stock = await getVariantStock(store.id, detail.variants.map((v) => v.id));
  const words = t(market.lang);
  const names: string[] = [];
  for (const variant of detail.variants) for (const name of Object.keys(variant.options)) if (!names.includes(name)) names.push(name);
  const reason = cartableReason(detail, store.audience, detail.variants.map((v) => v.delivery));
  return {
    store: { slug: store.slug, name: store.name },
    market: marketOut(market),
    open: true,
    product: {
      id: detail.id,
      handle: detail.handle,
      title: detail.title,
      description: detail.description,
      seo_title: detail.seoTitle,
      seo_description: detail.seoDescription,
      url: origin + marketPath(store.slug, market.slug, `/p/${detail.handle}`),
      images: detail.images.map((image) => ({ url: absolute(image.url, origin), thumbnail: absolute(image.thumbnailUrl, origin), alt: image.alt })),
      options: names.map((name) => ({ name, values: [...new Set(detail.variants.map((v) => v.options[name]).filter((value): value is string => typeof value === "string"))] })),
      variants: detail.variants.map((variant) => ({
        id: variant.id,
        sku: variant.sku,
        options: variant.options,
        price: wordpressPrice(variant.price, false, market.locale, words),
        image: variant.image ? { url: absolute(variant.image.url, origin), thumbnail: absolute(variant.image.thumbnailUrl, origin), alt: variant.image.alt } : null,
        stock: stockOf(variant.delivery === "physical" ? (stock.get(variant.id)?.inStock ?? 0) : MAX_LINE_QUANTITY),
        backorder_days: variant.delivery === "physical" ? backorderDaysOf(stock.get(variant.id)) : null,
      })),
      cartable: reason === null,
      reason,
    },
    labels: cartLabels(words, { viewInStore: viewInStore(market.lang) }),
  };
}

export type WpQuoteLine = {
  variant_id: string;
  product_id: string;
  handle: string;
  title: string;
  options: Record<string, string>;
  image: { url: string; alt: string } | null;
  url: string;
  quantity: number;
  /** `ok`; `insufficient` (more asked than there is: `available` says how many); `unavailable` (cannot be bought, so it is left out of the total). */
  status: "ok" | "insufficient" | "unavailable";
  available: number;
  /** The units beyond what is in stock and the days stated for them (D172), for a variant that keeps selling at zero; null otherwise. */
  backorder: { units: number; days: number } | null;
  unit: WordpressPrice | null;
  line_text: string | null;
};

export type WpQuote = {
  market: { slug: string; country: string; name: string; currency: string; language: string };
  lines: WpQuoteLine[];
  subtotal_minor: number;
  subtotal_text: string;
  vat_label: string;
  count: number;
  labels: CartLabels;
};

/**
 * What a cart held on another site costs now: each line's live price, stock and picture, and a subtotal of what can be bought, written in the
 * market's language and currency (`wordpressPrice()`). No shipping, discount or campaign: those are worked out at checkout with the address,
 * as the store does, which is why this is a subtotal and not a total. A line that cannot be bought (gone, not goods, no stock) is shown as
 * such and left out of the subtotal, and a quantity above the stock is counted at the stock, as the cart would cut it.
 */
export async function quoteCart(store: Store, marketRef: string | null, lines: CartLineInput[]): Promise<WpQuote | null> {
  const market = marketIn(store, marketRef);
  if (!market || store.status !== "active") return null;
  const origin = storeSiteUrl(store.slug);
  const ids = lines.map((l) => l.variantId);
  const rows = await db().execute<Row>(sql`
    select v.id as variant_id, v.product_id, v.options, v.delivery, v.image_url as variant_image, p.handle, p.kind, p.subscription_only, p.audience,
      commerce.vat_rate(${market.code}, p.vat_category) as vat_rate,
      coalesce(tl.title, tf.title) as title,
      coalesce(m.thumbnail_url, m.url) as image_url,
      coalesce(nullif(m.alt ->> ${market.locale}, ''), commerce.media_alt(m.url, ${market.locale}), '') as image_alt,
      cp.amount_minor, cp.prior_30d_minor
    from commerce.product_variants v
    join commerce.products p on p.store_id = v.store_id and p.id = v.product_id and p.status = 'active' and ${OFFERED}
    join commerce.current_prices cp on cp.variant_id = v.id and cp.market_code = ${market.code}
    left join commerce.product_translations tl on tl.product_id = p.id and tl.locale = ${market.locale}
    left join lateral (select title from commerce.product_translations where product_id = p.id order by locale limit 1) tf on true
    left join lateral (select url, thumbnail_url, alt from commerce.product_media where product_id = p.id order by position limit 1) m on true
    where v.store_id = ${store.id}::uuid and v.active and v.id = any(${`{${ids.join(",")}}`}::uuid[])
  `);
  const found = new Map(rows.map((row) => [String(row.variant_id), row]));
  const stock = await getVariantStock(store.id, [...found.keys()]);
  const words = t(market.lang);
  const vat = priceVat(store.audience, rows[0]?.vat_rate);
  let subtotal = 0;
  let count = 0;
  const out: WpQuoteLine[] = lines.map((line): WpQuoteLine => {
    const row = found.get(line.variantId);
    const gone: WpQuoteLine = { variant_id: line.variantId, product_id: "", handle: "", title: "", options: {}, image: null, url: "", quantity: line.quantity, status: "unavailable", available: 0, backorder: null, unit: null, line_text: null };
    if (!row) return gone;
    const reason = cartableReason({ kind: String(row.kind), subscriptionOnly: Boolean(row.subscription_only), audience: String(row.audience) }, store.audience, [String(row.delivery)]);
    const held = String(row.delivery) === "physical" ? stock.get(line.variantId) : undefined;
    // What a line may hold: the stock, or the line maximum for a variant that keeps selling at zero (D172).
    const available = String(row.delivery) !== "physical" ? MAX_LINE_QUANTITY : held ? (held.stockPolicy === "continue" ? MAX_LINE_QUANTITY : held.inStock) : 0;
    const base = {
      ...gone,
      product_id: String(row.product_id),
      handle: String(row.handle),
      title: String(row.title ?? ""),
      options: (row.options ?? {}) as Record<string, string>,
      image: row.variant_image || row.image_url ? { url: absolute(String(row.variant_image ?? row.image_url), origin), alt: String(row.image_alt) } : null,
      url: origin + marketPath(store.slug, market.slug, `/p/${row.handle}`),
    };
    if (reason !== null || available <= 0) return base;
    const price: PriceView = priceView(shown(market, Number(row.amount_minor)), market.currency, row.prior_30d_minor === null ? null : shown(market, Number(row.prior_30d_minor)), priceVat(store.audience, row.vat_rate));
    const unit = wordpressPrice(price, false, market.locale, words);
    const quantity = Math.min(line.quantity, available, MAX_LINE_QUANTITY);
    subtotal += unit.amount_minor * quantity;
    count += quantity;
    return {
      ...base,
      quantity: line.quantity,
      status: line.quantity > available ? "insufficient" : "ok",
      available: Math.min(available, MAX_LINE_QUANTITY),
      backorder: held ? backorderNote(quantity, held) : null,
      unit,
      line_text: formatMoney(unit.amount_minor * quantity, market.currency, market.locale),
    };
  });
  return {
    market: marketOut(market),
    lines: out,
    subtotal_minor: subtotal,
    subtotal_text: formatMoney(subtotal, market.currency, market.locale),
    vat_label: vat.shown === "excl" ? words.vatExcluded : words.vatIncluded,
    count,
    labels: cartLabels(words, { viewInStore: viewInStore(market.lang) }),
  };
}

export type WpHandoff = { ok: true; url: string; lines: { variant_id: string; quantity: number; outcome: string }[] } | { ok: false; reason: "no_such_market" | "nothing_to_buy" };

/** Makes the cart in the store and gives the one-time address that opens it (`createHandoffCart()`), on the store's own host. */
export async function handoffCart(store: Store, marketRef: string | null, lines: CartLineInput[], to: "cart" | "checkout"): Promise<WpHandoff> {
  const market = marketIn(store, marketRef);
  if (!market || store.status !== "active") return { ok: false, reason: "no_such_market" };
  const made = await createHandoffCart({ storeId: store.id, market }, lines, to);
  if (!made.ok) return { ok: false, reason: "nothing_to_buy" };
  return {
    ok: true,
    url: `${storeSiteUrl(store.slug)}${marketPath(store.slug, market.slug, "/cart/resume")}?t=${encodeURIComponent(made.token)}`,
    lines: made.lines.map((line) => ({ variant_id: line.variantId, quantity: line.quantity, outcome: line.outcome })),
  };
}

/** The days a variant states when it keeps selling at zero and has none in stock now; null otherwise (a variant with stock is simply in stock). */
function backorderDaysOf(stock: VariantStock | undefined): number | null {
  return stock && stock.stockPolicy === "continue" && stock.inStock <= 0 ? stock.backorderDays : null;
}
