import "server-only";

import { sql } from "drizzle-orm";
import { cacheLife, cacheTag } from "next/cache";
import { connection } from "next/server";

import { db, readDb } from "@/db/client";
import { attributeName, categoryPath, googleCategory, isCategory, valueName } from "@/lib/product-taxonomy";
import { parseProductAudience, type ProductAudience } from "@/lib/b2b";
import { parseRentalPeriod, type RentalPeriod } from "@/lib/booking-ranges";
import { isNative, shown, type Market } from "@/lib/markets";
import { priceVat, priceView, type PriceView } from "@/lib/pricing";
import { parseDelivery, type Delivery } from "@/lib/product-input";
import type { ShownGroup } from "@/lib/custom-fields";
import { planPrice, type PlanInterval } from "@/lib/subscriptions";
import { ruleForKind, type QuantityRule } from "@/lib/quantity-rules";
import type { ShownMeasure } from "@/lib/unit-price";
import { shownMeasureFromColumns } from "@/lib/unit-price-rules";
import { stockOf, UNLIMITED, type VariantStock } from "@/lib/stock-availability";
import type { MediaItemKind, VideoSource } from "@/lib/product-media";

import { taxonomy, taxonomyWords } from "./product-taxonomy";
import { shownRegistrationNumbers, type ShownRegistration } from "./producer-registrations";
import { bundleItemsOf } from "./bundles";
import { fieldsTag, shownFieldsFor, shownFieldsForVariants } from "./custom-fields";
import { OFFERED, STORE_AUDIENCE, inTerms, manualPlace, plansOffered } from "./product-conditions";

/**
 * Cache tags. Revalidate a store's catalogue tag after any product or price
 * change in it; `catalog` covers every store.
 */
export const CATALOG_TAG = "catalog";
export const catalogTag = (storeId: string) => `catalog:${storeId}`;

export type ProductSummary = {
  id: string;
  handle: string;
  title: string;
  /**
   * `url` is the picture a card draws (the library's small copy when there is one); `large` the picture itself beside it and `width`
   * its own width where the library knows it, so a card offers both by width (D336).
   */
  image: { url: string; alt: string; large?: string; width?: number } | null;
  price: PriceView;
  /** True when variants differ in price, so the price shown is a minimum. */
  priceVaries: boolean;
  /** Who it is for (B2B); always `all` unless the store sells to both. */
  audience: ProductAudience;
};

export type EconomicOperator = {
  name: string;
  postalAddress: string;
  electronicAddress: string;
};

export type ProductVariant = {
  id: string;
  sku: string;
  gtin: string | null;
  options: Record<string, string>;
  price: PriceView;
  /** What is in it and what it is compared per in this market (D160); the price's own `measure` is the same. Null for no content. */
  measure: ShownMeasure | null;
  /** Shipped, or downloaded after payment (D24). */
  delivery: Delivery;
  /** How a rental's variant is booked (D69); "day" for everything else. */
  rentalPeriod: RentalPeriod;
  /**
   * Its own picture, shown where shoppers choose a variant; `thumbnailUrl` is the small copy, or the
   * picture itself; `alt` the media library's alt text for it (D89).
   */
  image: { url: string; thumbnailUrl: string; alt: string } | null;
  /** How many at a time (D323): its own minimum, maximum and step for goods and bundles, else the plain rule. */
  rule: QuantityRule;
};

/** A purchase option for subscribing (D25). */
export type SellingPlan = {
  id: string;
  interval: PlanInterval;
  intervalCount: number;
  discountPercent: number;
  /** Days free before the first charge (D29). */
  trialDays: number;
  /** One-time fee in the market's currency, in minor units; 0 for none (D29). */
  signupFeeMinor: number;
  /** Payments committed to, the first included; 0 for none (D29). */
  minCycles: number;
};

export type ProductDetail = {
  id: string;
  handle: string;
  title: string;
  description: string;
  /** The owner's title and description for search results; empty uses title and description. */
  seoTitle: string;
  seoDescription: string;
  safetyInformation: string;
  withdrawalExclusion: string;
  /** In the owner's order; `thumbnailUrl` is the 480 px copy, or the picture itself. */
  /** The gallery in the owner's order (D325): every item's picture, and a video's or 3D model's own file or address. */
  images: { url: string; thumbnailUrl: string; alt: string; kind: MediaItemKind; source: VideoSource | null; mediaUrl: string | null }[];
  manufacturer: EconomicOperator | null;
  responsiblePerson: EconomicOperator | null;
  variants: ProductVariant[];
  /** Purchase options for subscribing, in the owner's order. */
  plans: SellingPlan[];
  /** Sold only through its purchase options. */
  subscriptionOnly: boolean;
  /** Only sold as a subscription, and the currency shown is not the country's own, the only one subscriptions are in (D109). */
  needsNativeCurrency: boolean;
  /** Who it is for (B2B); always `all` unless the store sells to both. */
  audience: ProductAudience;
  /** Goods, an appointment booked for a time (D65), a stay or a rental (D67), or a gift card (D300). */
  kind: "goods" | "appointment" | "stay" | "rental" | "gift_card";
  /** The outside host who lists it, when the store is a marketplace (D71). */
  hostName: string | null;
  /** The store's public custom fields with a value for it, by group, in the shopper's language (D118). */
  fields: ShownGroup[];
  /** The public fields of its variants that have some, by variant id (D118, phase 2). */
  variantFields: Record<string, ShownGroup[]>;
  /** The store's own public fields (D120), for the components set to show them; read with the product so its page stays prerendered. */
  storeFields: ShownGroup[];
  /** What a bundle holds (D322): each component's title, how many, and its own product's address when that is offered; empty for any other product. */
  bundleItems: { title: string; quantity: number; handle: string | null }[];
  /**
   * The standard taxonomy's category (D327): its path in the page's language (the structured data's `category`), Google's id (the feeds'),
   * and the chosen values' English names by attribute handle (the feeds' colour, material and pattern); null for none.
   */
  standard: { id: string; path: string; google: number | null; english: Record<string, string[]> } | null;
  /** Producer responsibility (D342): the registration numbers the owner chose to show in this market for the product's schemes, valid today. */
  producerNumbers: ShownRegistration[];
};

type Row = Record<string, unknown>;

// Postgres bigint arrives as a string; amounts in minor units fit a JS number.
const num = (value: unknown): number => Number(value);
const numOrNull = (value: unknown): number | null =>
  value === null || value === undefined ? null : Number(value);
const str = (value: unknown): string => (value === null ? "" : String(value));
const orNull = (value: number | null, map: (n: number) => number): number | null => (value === null ? null : map(value));

/**
 * The measure of the variant a card's price is the price of (D160): the cheapest active variant in the market, ties
 * broken by SKU, the same one `getProduct()` lists first. Read in the same lateral as the price so the two cannot be
 * of different variants.
 */
const CHEAPEST_MEASURE = sql`
        (array_agg(v.measure_amount order by cp.amount_minor, v.sku))[1] as measure_amount,
        (array_agg(v.measure_unit order by cp.amount_minor, v.sku))[1] as measure_unit,
        (array_agg(v.measure_base order by cp.amount_minor, v.sku))[1] as measure_base`;

/** A row's measure as the market shows it: the base follows the market's country, never its language or currency (D109). */
const shownMeasure = (row: Row, market: Pick<Market, "code">): ShownMeasure | null =>
  shownMeasureFromColumns(row.measure_amount, row.measure_unit, row.measure_base, market.code);

/** Who a product is for (B2B): only in stores selling to both does it matter. */
const productAudience = (row: Row): ProductAudience =>
  row.store_audience === "both" ? parseProductAudience(row.audience) : "all";

/** Active products with a price in the market, cheapest variant first. */
export async function listProducts(storeId: string, market: Market): Promise<ProductSummary[]> {
  "use cache";
  cacheLife("hours");
  cacheTag(CATALOG_TAG, catalogTag(storeId));
  const { code: marketCode, locale } = market;

  const rows = await readDb().execute<Row>(sql`
    select
      p.id,
      p.handle,
      coalesce(tl.title, tf.title) as title,
      coalesce(m.thumbnail_url, m.url) as image_url,
      coalesce(nullif(m.alt ->> ${locale}, ''), commerce.media_alt(m.url, ${locale}), '') as image_alt,
      -- The picture beside its small copy (D336), with its own width where the library knows it, for a card's srcset.
      case when m.thumbnail_url is not null and m.thumbnail_url <> m.url then m.url end as image_large,
      (select md.width from commerce.media md where md.url = m.url) as image_width,
      pr.min_amount,
      pr.max_amount,
      pr.currency,
      pr.prior_30d, pr.measure_amount, pr.measure_unit, pr.measure_base,
      case when p.subscription_only then (
        select max(sp.discount_percent) from commerce.selling_plans sp where sp.product_id = p.id and sp.active
      ) end as subscriber_discount,
      p.audience,
      ${STORE_AUDIENCE} as store_audience,
      commerce.vat_rate(${marketCode}, p.vat_category) as vat_rate
    from commerce.products p
    join commerce.stores s on s.id = p.store_id
    left join commerce.product_translations tl
      on tl.product_id = p.id and tl.locale = ${locale}
    left join lateral (
      select title from commerce.product_translations
      where product_id = p.id order by locale limit 1
    ) tf on true
    left join lateral (
      select url, thumbnail_url, alt from commerce.product_media
      where product_id = p.id order by position limit 1
    ) m on true
    join lateral (
      select
        min(cp.amount_minor) as min_amount,
        max(cp.amount_minor) as max_amount,
        min(cp.currency) as currency,
        (array_agg(cp.prior_30d_minor order by cp.amount_minor, v.sku))[1] as prior_30d,
        ${CHEAPEST_MEASURE}
      from commerce.current_prices cp
      join commerce.product_variants v on v.id = cp.variant_id
      where v.product_id = p.id and v.active and cp.market_code = ${marketCode}
    ) pr on pr.min_amount is not null
    where p.store_id = ${storeId}::uuid and p.status = 'active' and ${OFFERED}
    order by p.created_at, p.handle
  `);

  return rows.map((row) => {
    // Sold only by subscription: the best subscriber's price, as "from".
    const discount = numOrNull(row.subscriber_discount);
    const vat = priceVat(row.store_audience, row.vat_rate);
    return {
      id: str(row.id),
      handle: str(row.handle),
      title: str(row.title),
      image: summaryImage(row),
      // Kept in the country's own currency; shown in the one chosen (D109).
      price:
        discount === null
          ? priceView(shown(market, num(row.min_amount)), market.currency, orNull(numOrNull(row.prior_30d), (n) => shown(market, n)), vat, shownMeasure(row, market))
          : priceView(planPrice(shown(market, num(row.min_amount)), discount), market.currency, null, vat, shownMeasure(row, market)),
      priceVaries: discount !== null || num(row.min_amount) !== num(row.max_amount),
      audience: productAudience(row),
    };
  });
}

/** One active product with its variants priced in the market, or null. */
export async function getProduct(storeId: string, market: Market, handle: string): Promise<ProductDetail | null> {
  "use cache";
  cacheLife("hours");
  // Custom fields are read inside it (D118), so a change to a store's fields refreshes it too.
  cacheTag(CATALOG_TAG, catalogTag(storeId), fieldsTag(storeId));
  const { code: marketCode, locale } = market;

  const [product] = await readDb().execute<Row>(sql`
    select
      p.id, p.handle, p.withdrawal_exclusion, p.subscription_only, p.kind, p.standard_category, p.standard_attributes,
      p.audience, ${STORE_AUDIENCE} as store_audience, commerce.vat_rate(${marketCode}, p.vat_category) as vat_rate,
      coalesce(tl.title, tf.title) as title,
      -- The country's own description over its language's (D338), else the language's. A country whose language the product is not
      -- written in reads the description in the language it falls back to, so the country's own is the one written in that language.
      coalesce(
        (select mt.description from commerce.product_market_texts mt
          where mt.product_id = p.id and mt.market_code = ${marketCode} and mt.locale = ${locale}),
        tl.description,
        (select mt.description from commerce.product_market_texts mt
          where mt.product_id = p.id and mt.market_code = ${marketCode} and mt.locale = tf.locale),
        tf.description, '') as description,
      coalesce(tl.safety_information, tf.safety_information, '') as safety_information,
      -- Search text in the page's own language, or with the fallback text.
      coalesce(case when tl.product_id is null then tf.seo_title else tl.seo_title end, '') as seo_title,
      coalesce(case when tl.product_id is null then tf.seo_description else tl.seo_description end, '') as seo_description,
      mf.name as mf_name, mf.postal_address as mf_postal, mf.electronic_address as mf_electronic,
      rp.name as rp_name, rp.postal_address as rp_postal, rp.electronic_address as rp_electronic,
      (select h.name from commerce.hosts h where h.store_id = p.store_id and h.id = p.host_id) as host_name
    from commerce.products p
    join commerce.stores s on s.id = p.store_id
    left join commerce.product_translations tl
      on tl.product_id = p.id and tl.locale = ${locale}
    left join lateral (
      select locale, title, description, safety_information, seo_title, seo_description
      from commerce.product_translations
      where product_id = p.id order by locale limit 1
    ) tf on true
    left join commerce.economic_operators mf
      on mf.store_id = p.store_id and mf.id = p.manufacturer_id
    left join commerce.economic_operators rp
      on rp.store_id = p.store_id and rp.id = p.responsible_person_id
    where p.store_id = ${storeId}::uuid and p.handle = ${handle} and p.status = 'active' and ${OFFERED}
  `);
  if (!product) return null;
  // A bundle's components (D322), in the page's language, each linked where its own product is offered to shoppers.
  const bundleItems = product.kind === "bundle" ? await bundleItemsOf(readDb(), storeId, String(product.id), locale) : [];

  const [media, variants, plans, fields, variantFields, storeFields, producerNumbers] = await Promise.all([
    readDb().execute<Row>(sql`
      select url, thumbnail_url, kind, source, media_url,
        coalesce(nullif(alt ->> ${locale}, ''), commerce.media_alt(url, ${locale}), '') as alt
      from commerce.product_media
      where product_id = ${product.id}
      order by position
    `),
    readDb().execute<Row>(sql`
      select v.id, v.sku, v.gtin, v.options, v.delivery, v.rental_period, v.image_url, v.image_thumbnail_url,
        v.measure_amount, v.measure_unit, v.measure_base, v.min_quantity, v.max_quantity, v.quantity_step,
        coalesce(commerce.media_alt(v.image_url, ${locale}), '') as image_alt,
        cp.amount_minor, cp.currency, cp.prior_30d_minor
      from commerce.product_variants v
      join commerce.current_prices cp
        on cp.variant_id = v.id and cp.market_code = ${marketCode}
      where v.product_id = ${product.id} and v.active
      order by cp.amount_minor, v.sku
    `),
    readDb().execute<Row>(sql`
      select id, interval, interval_count, discount_percent, trial_days, min_cycles,
        coalesce((signup_fee ->> ${marketCode})::bigint, 0) as signup_fee
      from commerce.selling_plans sp
      -- Purchase options are offered while Subscriptions is on (D178); the product is then sold once only.
      where sp.product_id = ${product.id} and sp.active and ${plansOffered(sql`sp.store_id`)}
      order by sp.position, sp.created_at
    `),
    shownFieldsFor(storeId, "product", str(product.id), locale, market.lang, market.slug),
    shownFieldsForVariants(storeId, str(product.id), locale, market.lang, market.slug),
    shownFieldsFor(storeId, "store", storeId, locale, market.lang, market.slug),
    shownRegistrationNumbers(readDb(), storeId, String(product.id), marketCode),
  ]);
  if (variants.length === 0) return null;
  const vat = priceVat(product.store_audience, product.vat_rate);

  const operator = (prefix: "mf" | "rp"): EconomicOperator | null =>
    product[`${prefix}_name`]
      ? {
          name: str(product[`${prefix}_name`]),
          postalAddress: str(product[`${prefix}_postal`]),
          electronicAddress: str(product[`${prefix}_electronic`]),
        }
      : null;

  return {
    id: str(product.id),
    handle: str(product.handle),
    title: str(product.title),
    description: str(product.description),
    seoTitle: str(product.seo_title),
    seoDescription: str(product.seo_description),
    safetyInformation: str(product.safety_information),
    withdrawalExclusion: str(product.withdrawal_exclusion),
    images: media.map((m) => ({
      url: str(m.url),
      thumbnailUrl: str(m.thumbnail_url ?? m.url),
      alt: str(m.alt),
      kind: m.kind === "video" || m.kind === "model" ? m.kind : "image",
      source: m.source === "upload" || m.source === "youtube" || m.source === "vimeo" ? m.source : null,
      mediaUrl: m.media_url ? str(m.media_url) : null,
    })),
    manufacturer: operator("mf"),
    responsiblePerson: operator("rp"),
    variants: variants.map((v) => ({
      id: str(v.id),
      sku: str(v.sku),
      gtin: v.gtin ? str(v.gtin) : null,
      options: (v.options ?? {}) as Record<string, string>,
      price: priceView(shown(market, num(v.amount_minor)), market.currency, orNull(numOrNull(v.prior_30d_minor), (n) => shown(market, n)), vat, shownMeasure(v, market)),
      measure: shownMeasure(v, market),
      delivery: parseDelivery(v.delivery),
      rentalPeriod: parseRentalPeriod(v.rental_period),
      image: v.image_url ? { url: str(v.image_url), thumbnailUrl: str(v.image_thumbnail_url ?? v.image_url), alt: str(v.image_alt) } : null,
      rule: ruleForKind(product.kind, v),
    })),
    // Subscriptions are in the country's own currency only (D109): they renew at a price kept in it.
    plans: (isNative(market) ? plans : []).map((plan) => ({
      id: str(plan.id),
      interval: plan.interval as PlanInterval,
      intervalCount: num(plan.interval_count),
      discountPercent: num(plan.discount_percent),
      trialDays: num(plan.trial_days),
      signupFeeMinor: shown(market, num(plan.signup_fee)),
      minCycles: num(plan.min_cycles),
    })),
    // Without an option to subscribe to, it can only be bought once.
    subscriptionOnly: Boolean(product.subscription_only) && plans.length > 0,
    needsNativeCurrency: !isNative(market) && Boolean(product.subscription_only) && plans.length > 0,
    hostName: product.host_name ? String(product.host_name) : null,
    fields,
    variantFields,
    storeFields,
    audience: productAudience(product),
    kind:
      product.kind === "appointment" || product.kind === "stay" || product.kind === "rental" || product.kind === "gift_card" ? product.kind : "goods",
    bundleItems,
    standard: await standardOf(product.standard_category, product.standard_attributes, locale),
    producerNumbers,
  };
}

/** A product's standard category as its page and the feeds read it (D327); null for none or one the release no longer knows. */
async function standardOf(category: unknown, attributes: unknown, locale: string): Promise<ProductDetail["standard"]> {
  if (typeof category !== "string") return null;
  const [t, words, english] = await Promise.all([taxonomy(), taxonomyWords(locale), taxonomyWords("en")]);
  if (!isCategory(t, category)) return null;
  const chosen: Record<string, string[]> = {};
  for (const [attributeId, valueIds] of Object.entries((attributes ?? {}) as Record<string, unknown>)) {
    const attribute = attributeName(t, english, Number(attributeId));
    if (!attribute || !Array.isArray(valueIds)) continue;
    const names = valueIds.flatMap((v) => (typeof v === "number" ? [valueName(t, english, v)?.name ?? ""] : [])).filter(Boolean);
    if (names.length > 0) chosen[attribute.handle] = names;
  }
  return { id: category, path: categoryPath(words, category), google: googleCategory(t, category), english: chosen };
}

/**
 * What a shopper can buy of each variant, read through `commerce.variant_availability`, the one reader of stock (wave 3, D172): the
 * units in stock across active locations net of live checkout holds (never below zero), the variant's policy at zero and the days it
 * states for a backorder. Never cached: stock, policy and days are read on every request, so the prerendered shell never goes stale.
 * A download or a service has no stock and is `UNLIMITED`; a variant that is not the store's is absent from the map.
 */
export async function getVariantStock(storeId: string, variantIds: string[]): Promise<Map<string, VariantStock>> {
  await connection();
  return variantStockOf(db(), storeId, variantIds);
}

/** The same read for a caller already in a request or a transaction (the cart, the chat agent, the WordPress routes). */
export async function variantStockOf(
  reader: Pick<ReturnType<typeof db>, "execute">,
  storeId: string,
  variantIds: readonly string[],
): Promise<Map<string, VariantStock>> {
  if (variantIds.length === 0) return new Map();
  const rows = await reader.execute<Row>(sql`
    select va.variant_id, va.delivery, va.in_stock, va.raw_available, va.stock_policy, va.backorder_days, va.can_buy
    from commerce.variant_availability va
    where va.store_id = ${storeId}::uuid and va.variant_id in (${sql.join(
      variantIds.map((id) => sql`${id}::uuid`),
      sql`, `,
    )})
  `);
  return new Map(
    rows.map((r) => [
      str(r.variant_id),
      r.delivery === "physical"
        ? stockOf({
            in_stock: num(r.in_stock),
            raw_available: num(r.raw_available),
            stock_policy: str(r.stock_policy),
            backorder_days: r.backorder_days === null ? null : num(r.backorder_days),
            can_buy: Boolean(r.can_buy),
          })
        : UNLIMITED,
    ]),
  );
}

/** A summary's picture as a row has it (D336): the small copy as `url`, the large beside it when the two differ. */
function summaryImage(row: Row): ProductSummary["image"] {
  if (!row.image_url) return null;
  const image: NonNullable<ProductSummary["image"]> = { url: str(row.image_url), alt: str(row.image_alt) };
  if (row.image_large) {
    image.large = str(row.image_large);
    if (row.image_width !== null && row.image_width !== undefined) image.width = Number(row.image_width);
  }
  return image;
}

export type GridProduct = ProductSummary & { description: string; /** Its own short text, when it has one (else a tile summarises the description). */ excerpt?: string };

/**
 * Active products with a price in the market for a content grid (D51):
 * only those in one of `categoryIds` (when given) and one of `tagIds`
 * (when given), sorted and at most `limit`. With `ids` (search results),
 * only those products, in that order. Sort `manual` is the owner's order of
 * the category or tag `orderTerm` (D319): placed products by their place,
 * then the others by when they were made.
 */
export async function listGridProducts(
  storeId: string,
  market: Market,
  filter: { categoryIds: string[]; tagIds: string[]; sort: string; limit: number; ids?: string[]; orderTerm?: string },
): Promise<GridProduct[]> {
  "use cache";
  cacheLife("hours");
  cacheTag(CATALOG_TAG, catalogTag(storeId));
  const { code: marketCode, locale } = market;

  const ids = (list: string[]) => `{${list.filter((id) => /^[0-9a-f-]{36}$/i.test(id)).join(",")}}`;
  const given = filter.ids ? ids(filter.ids) : null;
  const orderTerm = filter.sort === "manual" && filter.orderTerm && /^[0-9a-f-]{36}$/i.test(filter.orderTerm) ? filter.orderTerm : null;
  const order = given && filter.sort === "given"
    ? sql`array_position(${given}::uuid[], p.id)`
    : orderTerm
      ? sql`${manualPlace(orderTerm)}, p.created_at, p.handle`
      : filter.sort === "oldest"
      ? sql`p.created_at, p.handle`
      : filter.sort === "title"
        ? sql`lower(coalesce(tl.title, tf.title)), p.handle`
        : filter.sort === "priceLow"
          ? sql`pr.min_amount, p.handle`
          : filter.sort === "priceHigh"
            ? sql`pr.min_amount desc, p.handle`
            : sql`p.created_at desc, p.handle`;

  const rows = await readDb().execute<Row>(sql`
    select
      p.id,
      p.handle,
      coalesce(tl.title, tf.title) as title,
      coalesce(nullif(tl.description, ''), tf.description, '') as description,
      coalesce(nullif(tl.excerpt, ''), tf.excerpt, '') as excerpt,
      coalesce(m.thumbnail_url, m.url) as image_url,
      coalesce(nullif(m.alt ->> ${locale}, ''), commerce.media_alt(m.url, ${locale}), '') as image_alt,
      -- The picture beside its small copy (D336), with its own width where the library knows it, for a card's srcset.
      case when m.thumbnail_url is not null and m.thumbnail_url <> m.url then m.url end as image_large,
      (select md.width from commerce.media md where md.url = m.url) as image_width,
      pr.min_amount,
      pr.max_amount,
      pr.currency,
      pr.prior_30d, pr.measure_amount, pr.measure_unit, pr.measure_base,
      case when p.subscription_only then (
        select max(sp.discount_percent) from commerce.selling_plans sp where sp.product_id = p.id and sp.active
      ) end as subscriber_discount,
      p.audience,
      ${STORE_AUDIENCE} as store_audience,
      commerce.vat_rate(${marketCode}, p.vat_category) as vat_rate
    from commerce.products p
    join commerce.stores s on s.id = p.store_id
    left join commerce.product_translations tl
      on tl.product_id = p.id and tl.locale = ${locale}
    left join lateral (
      select title, description, excerpt from commerce.product_translations
      where product_id = p.id order by locale limit 1
    ) tf on true
    left join lateral (
      select url, thumbnail_url, alt from commerce.product_media
      where product_id = p.id order by position limit 1
    ) m on true
    join lateral (
      select
        min(cp.amount_minor) as min_amount,
        max(cp.amount_minor) as max_amount,
        min(cp.currency) as currency,
        (array_agg(cp.prior_30d_minor order by cp.amount_minor, v.sku))[1] as prior_30d,
        ${CHEAPEST_MEASURE}
      from commerce.current_prices cp
      join commerce.product_variants v on v.id = cp.variant_id
      where v.product_id = p.id and v.active and cp.market_code = ${marketCode}
    ) pr on pr.min_amount is not null
    where p.store_id = ${storeId}::uuid and p.status = 'active' and ${OFFERED}
      and ${inTerms(filter.categoryIds)}
      and ${inTerms(filter.tagIds)}
      and ${given ? sql`p.id = any(${given}::uuid[])` : sql`true`}
    order by ${order}
    limit ${Math.max(1, Math.min(48, filter.limit))}
  `);

  return rows.map((row) => {
    const discount = numOrNull(row.subscriber_discount);
    const vat = priceVat(row.store_audience, row.vat_rate);
    return {
      id: str(row.id),
      handle: str(row.handle),
      title: str(row.title),
      description: str(row.description),
      excerpt: str(row.excerpt),
      image: summaryImage(row),
      // Kept in the country's own currency; shown in the one chosen (D109).
      price:
        discount === null
          ? priceView(shown(market, num(row.min_amount)), market.currency, orNull(numOrNull(row.prior_30d), (n) => shown(market, n)), vat, shownMeasure(row, market))
          : priceView(planPrice(shown(market, num(row.min_amount)), discount), market.currency, null, vat, shownMeasure(row, market)),
      priceVaries: discount !== null || num(row.min_amount) !== num(row.max_amount),
      audience: productAudience(row),
    };
  });
}
