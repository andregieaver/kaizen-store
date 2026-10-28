import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { sortedAttributes, standardProblems, type StandardAttributes } from "@/lib/product-taxonomy";
import { parsePaymentMode } from "@/lib/pay-later";
import { parseProductAudience, withVat, withoutVat, type StoreAudience } from "@/lib/b2b";
import { feeFor, parseSeason } from "@/lib/booking-prices";
import { parseRentalPeriod } from "@/lib/booking-ranges";
import { mainCurrency } from "@/lib/markets";
import { parseVatCategory, type VatCategory, type VatCategoryRow } from "@/lib/vat";
import {
  combineOptions,
  formatPriceInput,
  DEFAULT_APPOINTMENT,
  defaultBooking,
  GENERAL_TAX_CODE,
  isBooked,
  parseDelivery,
  parsePrice,
  MAX_VARIANTS,
  PRODUCT_KINDS,
  productProblems,
  variantLabel,
  type AppointmentInput,
  type MeasureInput,
  type OperatorChoice,
  type ProductInput,
} from "@/lib/product-input";
import type { PlanInterval } from "@/lib/subscriptions";
import type { Term } from "@/lib/taxonomy";
import { baseFits, isBase, measureFromColumns, normaliseMeasureAmount } from "@/lib/unit-price";
import { unitPriceProblems } from "@/lib/unit-price-rules";
import { limitRefusal } from "@/lib/usage-format";
import { FEATURES_BY_ID, featureOffText, featureOn, kindFeature } from "@/lib/store-features";
import { MEDIA_KINDS, mediaFileOk, type MediaItemKind, type VideoSource } from "@/lib/product-media";

import { bundleForEdit, componentProblems, saveBundleComponents } from "./bundles";
import { profileChoices } from "./shipping-admin";
import { aiFor } from "./ai";
import { productFacts, saveFieldData, variantFacts } from "./custom-fields";
import { storedFileInfo, uploadsEnabled } from "./media";
import { auditProductSave, productSnapshot } from "./product-audit";
import { checkLimit } from "./limits";
import { listLayoutChoices } from "./product-layouts";
import { listVatCategories, ratesNow } from "./vat-categories";
import type { Store } from "./stores";
import { withStockContext } from "./stock-context";
import { listTerms, scopedTermIds } from "./taxonomy";
import { categoryMarks } from "./unit-price-gaps";
import { taxonomy } from "./product-taxonomy";
import { deriveForProducts, marketPriceRules } from "./market-prices";

type Row = Record<string, unknown>;
type Tx = Parameters<Parameters<ReturnType<typeof db>["transaction"]>[0]>[0];

export type Operator = {
  id: string;
  name: string;
  postalAddress: string;
  electronicAddress: string;
  country: string;
};

/** What the editor needs to know about the store it edits for. */
export type EditorContext = {
  /** The store's languages, primary first. */
  locales: string[];
  primaryLocale: string;
  /**
   * Each market's VAT rate per category now (D65, D157), e.g. `{ standard: 0.25, accommodation: 0.12, food: 0.15, exempt: 0 }`,
   * and whether the country has a rate of its own for it (`vatRows`): a category with none takes the standard rate, which the
   * editor says ("no reduced rate known here", `describeRate()`).
   */
  markets: { code: string; currency: string; name: string; vatRates: Record<VatCategory, number>; vatRows: Record<VatCategory, boolean> }[];
  /** The VAT categories (platform admins keep them): the editor offers `categoriesFor()` of them. */
  vatCategories: VatCategoryRow[];
  /** Who the store sells to (B2B): a store selling only to businesses enters its prices without VAT. */
  audience: StoreAudience;
  /** The store's main currency (D152): what a variant's cost is entered in. */
  mainCurrency: string;
  operators: Operator[];
  /** Where stock is counted (the first location by rank); null until the first product is saved. */
  locationName: string | null;
  /**
   * How many stock locations are active (wave 3, D172). With one, a variant's stock number in the editor is that location's and is written
   * to it; with several it is the total over them, read-only, and the editor sends the person to the Inventory page.
   */
  activeLocations: number;
  /** The store's product categories and tags (D50). */
  terms: Term[];
  /**
   * The Selling group's features that are on (D178): appointments can be made (D65), stays and rentals (D67), purchase options offered
   * (D25). The editor offers a kind of product only while its feature is on (a product keeps its own), and the purchase options only while
   * subscriptions are on; `saveProduct()` holds to the same.
   */
  appointmentsOn: boolean;
  staysOn: boolean;
  /** Gift cards are on (D300): the editor offers the kind. */
  giftCardsOn: boolean;
  subscriptionsOn: boolean;
  /** The store's staff, rooms and homes, and items to rent (D65, D67); each kind of product picks from its own. */
  staff: { id: string; name: string; active: boolean; kind: "staff" | "unit" | "item" }[];
  places: { id: string; name: string }[];
  /** The store's active hosts (D71), for its stays and rentals. */
  hosts: { id: string; name: string; vatRegistered: boolean }[];
  /** The store's product layouts (D79), to choose one for the product. */
  layouts: { id: string; title: string; published: boolean }[];
  /** The store's AI has a text model, so staff can ask it for texts (D76). */
  aiWriting: boolean;
  /** The store's shipping profiles (D237), for the *Shipping profile* field; General is the empty choice. Absent: the field is not shown. */
  shippingProfiles?: { id: string; name: string }[];
  /** Markets whose prices a rule works out from another's (D335 A.2): an empty price there is the rule's, not "not sold". */
  ruledMarkets?: string[];
};

export async function getEditorContext(store: Store): Promise<EditorContext> {
  const [operators, [location], [counted], terms, rates, staff, places, hosts, layouts, vatCategories] = await Promise.all([
    db().execute<Row>(sql`
      select id, name, postal_address, electronic_address, country
      from commerce.economic_operators where store_id = ${store.id}::uuid
      order by name
    `),
    db().execute<Row>(sql`
      select name from commerce.inventory_locations
      where store_id = ${store.id}::uuid and active order by priority, created_at, id limit 1
    `),
    db().execute<Row>(sql`
      select count(*)::int as n from commerce.inventory_locations where store_id = ${store.id}::uuid and active
    `),
    listTerms({ storeId: store.id, contentType: "product" }),
    ratesNow(),
    db().execute<Row>(sql`
      select id, name, active, kind from commerce.booking_resources
      where store_id = ${store.id}::uuid order by active desc, position, name
    `),
    db().execute<Row>(sql`
      select id, case when kind = 'office' and name = '' then 'Office' else name end as name
      from commerce.store_locations where store_id = ${store.id}::uuid and kind in ('office', 'shop')
      order by kind = 'office' desc, position, name
    `),
    db().execute<Row>(sql`
      select id, name, vat_registered from commerce.hosts
      where store_id = ${store.id}::uuid and disabled_at is null order by lower(name)
    `),
    listLayoutChoices(store.id),
    listVatCategories(),
  ]);
  const noVat: Record<VatCategory, number> = { standard: 0, accommodation: 0, exempt: 0 };
  const ratesOf = (code: string): Record<VatCategory, number> =>
    rates[code] ? Object.fromEntries(Object.entries(rates[code]).map(([category, cell]) => [category, cell.rate])) : noVat;
  /** Whether the country has a rate of its own for the category (else it is the standard rate: the editor says so). */
  const rowsOf = (code: string): Record<VatCategory, boolean> =>
    rates[code] ? Object.fromEntries(Object.entries(rates[code]).map(([category, cell]) => [category, cell.hasRow])) : {};
  const locales = store.localization.locales;
  return {
    locales,
    primaryLocale: locales[0] ?? "en",
    terms,
    markets: store.markets.map((m) => ({ code: m.code, currency: m.currency, name: m.name, vatRates: ratesOf(m.code), vatRows: rowsOf(m.code) })),
    vatCategories,
    audience: store.audience,
    mainCurrency: mainCurrency(store),
    operators: operators.map((row) => ({
      id: String(row.id),
      name: String(row.name),
      postalAddress: String(row.postal_address),
      electronicAddress: String(row.electronic_address),
      country: String(row.country),
    })),
    locationName: location ? String(location.name) : null,
    activeLocations: Number(counted?.n ?? 0),
    appointmentsOn: featureOn(store, "appointments"),
    staysOn: featureOn(store, "bookings"),
    giftCardsOn: featureOn(store, "gift_cards"),
    subscriptionsOn: featureOn(store, "subscriptions"),
    staff: staff.map((row) => ({
      id: String(row.id),
      name: String(row.name),
      active: Boolean(row.active),
      kind: row.kind === "unit" || row.kind === "item" ? row.kind : "staff",
    })),
    places: places.map((row) => ({ id: String(row.id), name: String(row.name) })),
    hosts: hosts.map((row) => ({ id: String(row.id), name: String(row.name), vatRegistered: Boolean(row.vat_registered) })),
    layouts,
    aiWriting: Boolean((await aiFor(store.id))?.textModel),
    shippingProfiles: await profileChoices(store.id),
    ruledMarkets: (await marketPriceRules(store.id)).map((r) => r.market),
  };
}

/** A stay's or rental's host (D71), if one of the store's own; everything else is the store's. */
function hostOf(storeId: string, input: ProductInput) {
  if ((input.kind !== "stay" && input.kind !== "rental") || !input.hostId) return sql`null::uuid`;
  return sql`(select id from commerce.hosts where store_id = ${storeId}::uuid and id = ${input.hostId}::uuid)`;
}

/** A blank product with one variant, ready for the editor. */
export function emptyProduct(context: EditorContext): ProductInput {
  return {
    handle: "",
    status: "draft",
    translations: context.locales.map((locale) => ({
      locale,
      title: "",
      description: "",
      safetyInformation: "",
      seoTitle: "",
      seoDescription: "",
      excerpt: "",
    })),
    media: [],
    options: [],
    variants: [
      {
        id: null,
        options: {},
        sku: "",
        gtin: null,
        measure: null,
        prices: {},
        cost: "",
        stock: 0,
        stockPolicy: "deny",
        backorderDays: null,
        lowStockThreshold: null,
        minQuantity: 1,
        maxQuantity: null,
        quantityStep: 1,
        active: true,
        weightGrams: null,
        hsCode: null,
        originCountry: null,
        delivery: "physical",
        rentalPeriod: "day",
        image: null,
      },
    ],
    delivery: "physical",
    files: [],
    downloadLimit: 5,
    downloadDays: 30,
    plans: [],
    subscriptionOnly: false,
    audience: "all",
    soldByMeasure: false,
    vatCategory: "standard",
    kind: "goods",
    hostId: null,
    layoutId: null,
    standardCategory: null,
    standardAttributes: {},
    availability: { off: [], variants: {} },
    countryTexts: [],
    appointment: null,
    bundle: null,
    priceBreaks: [],
    taxCode: GENERAL_TAX_CODE,
    withdrawalExclusion: "none",
    // No scheme until the owner ticks one (D342, the owner's decision of 27 October 2026): a tick with no registration stops the sale.
    schemes: [],
    manufacturer: context.operators[0] ? { id: context.operators[0].id } : null,
    responsiblePerson: null,
    categories: [],
    tags: [],
  };
}

export type AdminProductRow = {
  id: string;
  handle: string;
  title: string;
  status: "draft" | "active" | "archived";
  image: string | null;
  variants: number;
  /** Units on hand across shipped variants. */
  stock: number;
  /** Active variants that are downloaded, which have no stock (D24). */
  digitalVariants: number;
  price: { min: number; max: number; currency: string } | null;
  /** The feature that is off and keeps the product from shoppers (D178: an appointment with Appointments off), or null. */
  hiddenBy: string | null;
};

/** The store's products for the admin list, most recently changed first. */
export async function listAdminProducts(
  store: Store,
  { archived = false }: { archived?: boolean } = {},
): Promise<AdminProductRow[]> {
  const market = store.markets[0];
  const locale = market?.locale ?? "en";
  const rows = await db().execute<Row>(sql`
    select
      p.id, p.handle, p.status, p.kind, p.subscription_only,
      coalesce(tl.title, tf.title, p.handle) as title,
      (select coalesce(m.thumbnail_url, m.url) from commerce.product_media m
        where m.product_id = p.id order by m.position limit 1) as image,
      (select count(*)::int from commerce.product_variants v
        where v.product_id = p.id and v.active) as variants,
      (select count(*)::int from commerce.product_variants v
        where v.product_id = p.id and v.active and v.delivery = 'digital') as digital_variants,
      -- A bundle's stock (D322) is what its components allow, worked out by the one reader of stock.
      case when p.kind = 'bundle' then (
        select coalesce(sum(va.in_stock), 0)::int from commerce.variant_availability va
        join commerce.product_variants v on v.store_id = va.store_id and v.id = va.variant_id
        where v.product_id = p.id and v.active
      ) else (
        select coalesce(sum(greatest(l.on_hand, 0)), 0)::int
         from commerce.inventory_levels l
         join commerce.product_variants v on v.id = l.variant_id
        where v.product_id = p.id and v.active
      ) end as stock,
      pr.min_amount, pr.max_amount, pr.currency,
      commerce.vat_rate(${market?.code ?? ""}, p.vat_category) as vat_rate
    from commerce.products p
    left join commerce.product_translations tl on tl.product_id = p.id and tl.locale = ${locale}
    left join lateral (
      select title from commerce.product_translations where product_id = p.id order by locale limit 1
    ) tf on true
    left join lateral (
      select min(c.amount_minor) as min_amount, max(c.amount_minor) as max_amount, min(c.currency) as currency
      from commerce.kept_prices c
      join commerce.product_variants v on v.id = c.variant_id and v.active
      where v.product_id = p.id and c.market_code = ${market?.code ?? ""}
    ) pr on true
    where p.store_id = ${store.id}::uuid
      and ${archived ? sql`p.status = 'archived'` : sql`p.status <> 'archived'`}
    order by p.updated_at desc, p.handle
  `);
  // A store selling only to businesses sees its prices as it types them: without VAT (B2B).
  const shown = (amount: unknown, rate: unknown) =>
    store.audience === "businesses" ? withoutVat(Number(amount), Number(rate ?? 0)) : Number(amount);
  return rows.map((row) => ({
    id: String(row.id),
    handle: String(row.handle),
    title: String(row.title),
    status: row.status as AdminProductRow["status"],
    image: row.image ? String(row.image) : null,
    variants: Number(row.variants),
    stock: Number(row.stock),
    digitalVariants: Number(row.digital_variants),
    price:
      row.min_amount === null
        ? null
        : { min: shown(row.min_amount, row.vat_rate), max: shown(row.max_amount, row.vat_rate), currency: String(row.currency) },
    hiddenBy: hiddenBy(store, String(row.kind), Boolean(row.subscription_only)),
  }));
}

/** The label of the feature that keeps a product of this kind from shoppers while it is off (D178), or null when it is offered. */
function hiddenBy(store: Store, kind: string, subscriptionOnly: boolean): string | null {
  const needed = kindFeature(kind);
  if (needed && !featureOn(store, needed)) return FEATURES_BY_ID[needed].label;
  if (subscriptionOnly && !featureOn(store, "subscriptions")) return FEATURES_BY_ID.subscriptions.label;
  return null;
}

/**
 * A variant's content as the editor holds it (D160): the amount as canonical text, the unit, and the owner's own choice of
 * what to compare per (`measure_base`, null for the unit's default). Not the base a market shows (`effectiveBase()`).
 */
function editorMeasure(row: Row): MeasureInput | null {
  const measure = measureFromColumns(row.measure_amount, row.measure_unit);
  if (!measure) return null;
  return { amount: measure.amount, unit: measure.unit, base: isBase(row.measure_base) && baseFits(measure.unit, row.measure_base) ? row.measure_base : null };
}

/** A product in the editor's shape, or null if it is not the store's. */
export async function getProductForEdit(
  store: Store,
  context: EditorContext,
  productId: string,
): Promise<(ProductInput & { archived: boolean }) | null> {
  const [product] = await db().execute<Row>(sql`
    select id, handle, status, tax_code, withdrawal_exclusion, manufacturer_id, responsible_person_id,
           delivery, download_limit, download_days, subscription_only, audience, vat_category, kind, host_id, product_layout_id, sold_by_measure, shipping_profile_id,
           standard_category, standard_attributes
    from commerce.products where store_id = ${store.id}::uuid and id = ${productId}::uuid
  `);
  if (!product) return null;
  // Prices are typed without VAT at this product's rate in stores selling only to businesses.
  const category = parseVatCategory(product.vat_category);
  const kind = PRODUCT_KINDS.find((k) => k === product.kind) ?? "goods";

  const [translations, media, schemes, variants, prices, files, plans, termRows, [appointment], resources, seasons, bundle, breaks] = await Promise.all([
    db().execute<Row>(sql`
      select locale, title, description, safety_information, seo_title, seo_description, excerpt
      from commerce.product_translations where product_id = ${productId}::uuid
    `),
    db().execute<Row>(sql`
      select kind, source, media_url, url, thumbnail_url, alt from commerce.product_media
      where product_id = ${productId}::uuid order by position
    `),
    db().execute<Row>(sql`
      select scheme from commerce.product_schemes where product_id = ${productId}::uuid
    `),
    db().execute<Row>(sql`
      select v.id, v.sku, v.gtin, v.options, v.active, v.weight_grams, v.hs_code, v.origin_country, v.delivery, v.rental_period,
             v.image_url, v.image_thumbnail_url, v.cost_minor, v.measure_amount, v.measure_unit, v.measure_base,
             v.stock_policy, v.backorder_days, v.low_stock_threshold, v.min_quantity, v.max_quantity, v.quantity_step,
             -- The stock the editor shows: the total over the active locations (with one, that location), never below zero.
             -- What is owed on a backorder belongs to the Inventory page; the editor leaves a negative level as it is.
             greatest(coalesce((
               select sum(l.on_hand) from commerce.inventory_levels l
               join commerce.inventory_locations loc on loc.id = l.location_id and loc.active
               where l.variant_id = v.id
             ), 0), 0)::int as stock
      from commerce.product_variants v
      where v.store_id = ${store.id}::uuid and v.product_id = ${productId}::uuid
      order by v.active desc, v.created_at, v.sku
    `),
    db().execute<Row>(sql`
      select c.variant_id, c.market_code, c.currency, c.amount_minor, c.derived
      -- Every current price, also in a country the product is switched off in (D335): the editor keeps it.
      from commerce.kept_prices c
      join commerce.product_variants v on v.id = c.variant_id
      where v.product_id = ${productId}::uuid
    `),
    db().execute<Row>(sql`
      select f.id, f.name, f.path, f.size_bytes, f.content_type, v.sku as variant_sku
      from commerce.product_files f
      left join commerce.product_variants v on v.store_id = f.store_id and v.id = f.variant_id
      where f.store_id = ${store.id}::uuid and f.product_id = ${productId}::uuid and f.removed_at is null
      order by f.position, f.created_at
    `),
    db().execute<Row>(sql`
      select id, interval, interval_count, discount_percent, trial_days, signup_fee, min_cycles from commerce.selling_plans
      where store_id = ${store.id}::uuid and product_id = ${productId}::uuid and active
      order by position, created_at
    `),
    db().execute<Row>(sql`
      select t.id, t.kind from commerce.product_terms pt
      join commerce.terms t on t.id = pt.term_id
      where pt.store_id = ${store.id}::uuid and pt.product_id = ${productId}::uuid
    `),
    db().execute<Row>(sql`
      select duration_minutes, buffer_before_minutes, buffer_after_minutes, step_minutes, min_notice_minutes,
        max_days_ahead, location_id, payment, deposit_percent, cancel_hours, no_show_percent,
        check_in_time, check_out_time, min_nights, max_nights, booking_fee
      from commerce.appointment_settings where store_id = ${store.id}::uuid and product_id = ${productId}::uuid
    `),
    db().execute<Row>(sql`
      select resource_id from commerce.product_resources where store_id = ${store.id}::uuid and product_id = ${productId}::uuid
    `),
    db().execute<Row>(sql`
      select name, names, from_day, to_day, weekdays, percent from commerce.booking_seasons
      where store_id = ${store.id}::uuid and product_id = ${productId}::uuid order by position, created_at
    `),
    bundleForEdit(db(), store.id, productId),
    // Price breaks (D323), a variant's by its SKU.
    db().execute<Row>(sql`
      select v.sku as variant_sku, b.from_quantity, b.percent, b.amounts
      from commerce.price_breaks b
      left join commerce.product_variants v on v.store_id = b.store_id and v.id = b.variant_id
      where b.store_id = ${store.id}::uuid and b.product_id = ${productId}::uuid
      order by v.sku nulls first, b.from_quantity
    `),
  ]);

  const byLocale = new Map(translations.map((t) => [String(t.locale), t]));
  const primaryTitle = String(byLocale.get(context.primaryLocale)?.title ?? "");
  const variantOptions = variants.map((v) => (v.options ?? {}) as Record<string, string>);

  // Options, in the order they first appear on the variants.
  const options: ProductInput["options"] = [];
  for (const opts of variantOptions) {
    for (const [name, value] of Object.entries(opts)) {
      let option = options.find((o) => o.name === name);
      if (!option) {
        option = { name, values: [] };
        options.push(option);
      }
      if (!option.values.includes(value)) option.values.push(value);
    }
  }

  const choice = (id: unknown): OperatorChoice => (id ? { id: String(id) } : null);
  const sold = product.delivery === "digital" || variants.some((v) => v.delivery === "digital");

  return {
    archived: product.status === "archived",
    handle: String(product.handle),
    status: product.status === "active" ? "active" : "draft",
    translations: context.locales.map((locale) => {
      const t = byLocale.get(locale);
      return {
        locale,
        title: String(t?.title ?? ""),
        description: String(t?.description ?? ""),
        safetyInformation: String(t?.safety_information ?? ""),
        seoTitle: String(t?.seo_title ?? ""),
        seoDescription: String(t?.seo_description ?? ""),
        excerpt: String(t?.excerpt ?? ""),
      };
    }),
    media: media.map((m) => {
      const alt = (m.alt ?? {}) as Record<string, string>;
      const text = alt[context.primaryLocale] ?? "";
      // An alt text equal to the title was filled in for the owner; show it empty, in every language.
      const titleIn = (locale: string) => String(byLocale.get(locale)?.title ?? "");
      const alts = Object.fromEntries(
        context.locales.filter((l) => l !== context.primaryLocale && alt[l] && alt[l] !== titleIn(l) && alt[l] !== primaryTitle).map((l) => [l, alt[l]]),
      );
      return {
        kind: (MEDIA_KINDS as readonly string[]).includes(String(m.kind)) ? (String(m.kind) as MediaItemKind) : "image",
        source: m.source ? (String(m.source) as VideoSource) : null,
        mediaUrl: m.media_url ? String(m.media_url) : null,
        url: String(m.url),
        thumbnailUrl: m.thumbnail_url ? String(m.thumbnail_url) : null,
        alt: text === primaryTitle ? "" : text,
        alts,
      };
    }),
    options,
    variants: variants.map((v, i) => ({
      id: String(v.id),
      options: variantOptions[i],
      sku: String(v.sku),
      gtin: v.gtin ? String(v.gtin) : null,
      measure: editorMeasure(v),
      prices: Object.fromEntries(
        prices
          .filter((p) => String(p.variant_id) === String(v.id))
          .map((p) => [
            String(p.market_code),
            formatPriceInput(typedAmount(context, String(p.market_code), Number(p.amount_minor), category), String(p.currency)),
          ]),
      ),
      // The countries whose price here a market price rule wrote (D335 A.2): the editor says so; typing another price fixes it.
      derivedIn: prices.filter((p) => String(p.variant_id) === String(v.id) && p.derived === true).map((p) => String(p.market_code)),
      cost: v.cost_minor === null ? "" : formatPriceInput(Number(v.cost_minor), context.mainCurrency),
      stock: Number(v.stock),
      stockPolicy: v.stock_policy === "continue" ? ("continue" as const) : ("deny" as const),
      backorderDays: v.backorder_days === null ? null : Number(v.backorder_days),
      lowStockThreshold: v.low_stock_threshold === null ? null : Number(v.low_stock_threshold),
      minQuantity: Number(v.min_quantity ?? 1),
      maxQuantity: v.max_quantity === null || v.max_quantity === undefined ? null : Number(v.max_quantity),
      quantityStep: Number(v.quantity_step ?? 1),
      active: Boolean(v.active),
      weightGrams: v.weight_grams === null ? null : Number(v.weight_grams),
      hsCode: v.hs_code ? String(v.hs_code) : null,
      originCountry: v.origin_country ? String(v.origin_country) : null,
      delivery: parseDelivery(v.delivery),
      rentalPeriod: parseRentalPeriod(v.rental_period),
      image: v.image_url ? { url: String(v.image_url), thumbnailUrl: v.image_thumbnail_url ? String(v.image_thumbnail_url) : null } : null,
    })),
    delivery: parseDelivery(product.delivery),
    files: files.map((f) => ({
      id: String(f.id),
      name: String(f.name),
      path: String(f.path),
      sizeBytes: Number(f.size_bytes),
      contentType: String(f.content_type),
      variantSku: f.variant_sku ? String(f.variant_sku) : null,
    })),
    // Limits mean something only once a variant is digital; until then the
    // editor offers the usual ones (products made before D24 have none).
    downloadLimit: product.download_limit !== null ? Number(product.download_limit) : sold ? null : 5,
    downloadDays: product.download_days !== null ? Number(product.download_days) : sold ? null : 30,
    plans: plans.map((p) => ({
      id: String(p.id),
      interval: p.interval as PlanInterval,
      intervalCount: Number(p.interval_count),
      discountPercent: Number(p.discount_percent),
      trialDays: Number(p.trial_days),
      signupFee: Object.fromEntries(
        context.markets
          .filter((m) => (p.signup_fee as Record<string, number>)?.[m.code])
          .map((m) => [
            m.code,
            formatPriceInput(typedAmount(context, m.code, (p.signup_fee as Record<string, number>)[m.code], category), m.currency),
          ]),
      ),
      minCycles: Number(p.min_cycles),
    })),
    subscriptionOnly: Boolean(product.subscription_only),
    audience: parseProductAudience(product.audience),
    soldByMeasure: Boolean(product.sold_by_measure),
    vatCategory: category,
    kind,
    hostId: product.host_id ? String(product.host_id) : null,
    layoutId: product.product_layout_id ? String(product.product_layout_id) : null,
    shippingProfileId: product.shipping_profile_id ? String(product.shipping_profile_id) : null,
    standardCategory: product.standard_category ? String(product.standard_category) : null,
    standardAttributes: (product.standard_attributes ?? {}) as StandardAttributes,
    availability: await availabilityOf(store.id, productId),
    countryTexts: await countryTextsOf(store.id, productId),
    appointment: isBooked(kind)
        ? {
            durationMinutes: Number(appointment?.duration_minutes ?? DEFAULT_APPOINTMENT.durationMinutes),
            bufferBeforeMinutes: Number(appointment?.buffer_before_minutes ?? 0),
            bufferAfterMinutes: Number(appointment?.buffer_after_minutes ?? 0),
            stepMinutes: Number(appointment?.step_minutes ?? DEFAULT_APPOINTMENT.stepMinutes) as AppointmentInput["stepMinutes"],
            minNoticeMinutes: Number(appointment?.min_notice_minutes ?? DEFAULT_APPOINTMENT.minNoticeMinutes),
            maxDaysAhead: Number(appointment?.max_days_ahead ?? DEFAULT_APPOINTMENT.maxDaysAhead),
            locationId: appointment?.location_id ? String(appointment.location_id) : null,
            resourceIds: resources.map((row) => String(row.resource_id)),
            payment: parsePaymentMode(appointment?.payment),
            depositPercent: Number(appointment?.deposit_percent ?? DEFAULT_APPOINTMENT.depositPercent),
            cancelHours: Number(appointment?.cancel_hours ?? DEFAULT_APPOINTMENT.cancelHours),
            noShowPercent: Number(appointment?.no_show_percent ?? 0),
            checkInTime: String(appointment?.check_in_time ?? DEFAULT_APPOINTMENT.checkInTime),
            checkOutTime: String(appointment?.check_out_time ?? DEFAULT_APPOINTMENT.checkOutTime),
            minNights: Number(appointment?.min_nights ?? 1),
            maxNights: Number(appointment?.max_nights ?? 28),
            bookingFee: Object.fromEntries(
              context.markets
                .filter((m) => feeFor(appointment?.booking_fee, m.code) > 0)
                .map((m) => [m.code, formatPriceInput(typedAmount(context, m.code, feeFor(appointment?.booking_fee, m.code), category), m.currency)]),
            ),
            seasons: seasons.map(parseSeason),
          }
        : null,
    bundle,
    priceBreaks: breaks.map((b) => {
      const amounts = (b.amounts ?? {}) as Record<string, number>;
      return {
        variantSku: b.variant_sku === null || b.variant_sku === undefined ? null : String(b.variant_sku),
        from: Number(b.from_quantity),
        percent: b.percent === null || b.percent === undefined ? null : Number(b.percent),
        prices: Object.fromEntries(
          context.markets
            .filter((m) => typeof amounts[m.code] === "number")
            .map((m) => [m.code, formatPriceInput(typedAmount(context, m.code, amounts[m.code], category), m.currency)]),
        ),
      };
    }),
    taxCode: String(product.tax_code),
    withdrawalExclusion: String(product.withdrawal_exclusion),
    schemes: schemes.map((s) => String(s.scheme)),
    manufacturer: choice(product.manufacturer_id),
    responsiblePerson: choice(product.responsible_person_id),
    categories: termRows.filter((t) => t.kind === "category").map((t) => String(t.id)),
    tags: termRows.filter((t) => t.kind === "tag").map((t) => String(t.id)),
  };
}

/**
 * Prices are kept with VAT (B2B). A store selling only to businesses types
 * them without: shown to it that way, and kept as the price with VAT that
 * gives back exactly what was typed.
 */
function typedAmount(context: EditorContext, marketCode: string, keptMinor: number, category: VatCategory): number {
  const market = context.markets.find((m) => m.code === marketCode);
  return context.audience === "businesses" && market ? withoutVat(keptMinor, market.vatRates[category]) : keptMinor;
}

function keptAmount(
  context: Pick<EditorContext, "audience">,
  market: EditorContext["markets"][number],
  typedMinor: number | null,
  category: VatCategory,
): number | null {
  return typedMinor !== null && context.audience === "businesses" ? withVat(typedMinor, market.vatRates[category]) : typedMinor;
}

/**
 * A product's price breaks (D323) as given: the ones there are replaced, a variant found by its SKU among the product's, prices kept with VAT as
 * market prices are. Goods and bundles only; `productProblems()` checked them and the database checks them again.
 */
async function savePriceBreaks(tx: Tx, storeId: string, productId: string, input: ProductInput, context: EditorContext) {
  await tx.execute(sql`delete from commerce.price_breaks where store_id = ${storeId}::uuid and product_id = ${productId}::uuid`);
  if ((input.kind !== "goods" && input.kind !== "bundle") || input.priceBreaks.length === 0) return;
  const variants = await tx.execute<Row>(sql`
    select id, sku from commerce.product_variants where store_id = ${storeId}::uuid and product_id = ${productId}::uuid
  `);
  const idOf = new Map(variants.map((v) => [String(v.sku), String(v.id)]));
  const rows = input.priceBreaks.map((step) => {
    const amounts: Record<string, number> = {};
    if (step.percent === null) {
      for (const market of context.markets) {
        const amount = keptAmount(context, market, parsePrice(step.prices[market.code] ?? "", market.currency), input.vatCategory);
        if (amount !== null) amounts[market.code] = amount;
      }
    }
    return {
      variant_id: step.variantSku === null ? null : (idOf.get(step.variantSku) ?? null),
      from_quantity: step.from,
      percent: step.percent,
      amounts: step.percent === null ? amounts : null,
    };
  });
  if (rows.some((r, i) => input.priceBreaks[i].variantSku !== null && r.variant_id === null)) throw new Error("price_breaks.variant");
  await tx.execute(sql`
    insert into commerce.price_breaks (store_id, product_id, variant_id, from_quantity, percent, amounts)
    select ${storeId}::uuid, ${productId}::uuid, r.variant_id, r.from_quantity, r.percent, r.amounts
    from jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) as r(variant_id uuid, from_quantity integer, percent integer, amounts jsonb)
  `);
}

/**
 * The product as its kind needs it (D65): an appointment's variants are
 * services, booked for a time; goods are shipped or downloaded.
 */
function asKind(input: ProductInput): ProductInput {
  const booked = isBooked(input.kind);
  const delivery = (d: ProductInput["delivery"]) => (booked ? "service" : d === "service" ? "physical" : d);
  return {
    ...input,
    delivery: delivery(input.delivery),
    variants: input.variants.map((v) => ({ ...v, delivery: delivery(v.delivery) })),
    subscriptionOnly: booked ? false : input.subscriptionOnly,
    appointment: isBooked(input.kind) ? (input.appointment ?? defaultBooking(input.kind)) : null,
  };
}

/** An appointment's settings and who does it (D65); only the store's own staff and places. Goods keep none. */
async function saveAppointment(tx: Tx, storeId: string, productId: string, input: ProductInput, context: EditorContext) {
  await tx.execute(sql`delete from commerce.product_resources where store_id = ${storeId}::uuid and product_id = ${productId}::uuid`);
  await tx.execute(sql`delete from commerce.booking_seasons where store_id = ${storeId}::uuid and product_id = ${productId}::uuid`);
  const a = input.appointment;
  if (!isBooked(input.kind) || !a) {
    await tx.execute(sql`delete from commerce.appointment_settings where store_id = ${storeId}::uuid and product_id = ${productId}::uuid`);
    return;
  }
  // Stays and rentals (D70): a fee per booking, kept with VAT like prices, and seasons.
  const ranged = input.kind === "stay" || input.kind === "rental";
  const fee: Record<string, number> = {};
  if (ranged) {
    for (const market of context.markets) {
      const amount = keptAmount(context, market, parsePrice(a.bookingFee[market.code] ?? "", market.currency), input.vatCategory);
      if (amount !== null && amount > 0) fee[market.code] = amount;
    }
    for (const [position, season] of a.seasons.entries()) {
      await tx.execute(sql`
        insert into commerce.booking_seasons (store_id, product_id, name, names, from_day, to_day, weekdays, percent, position)
        values (${storeId}::uuid, ${productId}::uuid, ${season.name}, ${JSON.stringify(season.names)}::jsonb, ${season.fromDay}, ${season.toDay},
          ${`{${[...new Set(season.weekdays)].sort().join(",")}}`}::int[], ${season.percent}, ${position})
      `);
    }
  }
  await tx.execute(sql`
    insert into commerce.appointment_settings (
      product_id, store_id, duration_minutes, buffer_before_minutes, buffer_after_minutes, step_minutes,
      min_notice_minutes, max_days_ahead, location_id, payment, deposit_percent, cancel_hours, no_show_percent,
      check_in_time, check_out_time, min_nights, max_nights, booking_fee
    ) values (
      ${productId}::uuid, ${storeId}::uuid, ${a.durationMinutes}, ${a.bufferBeforeMinutes}, ${a.bufferAfterMinutes},
      ${a.stepMinutes}, ${a.minNoticeMinutes}, ${a.maxDaysAhead},
      (select id from commerce.store_locations where store_id = ${storeId}::uuid and id = ${a.locationId}::uuid),
      ${a.payment}, ${a.depositPercent}, ${a.cancelHours}, ${a.noShowPercent},
      ${a.checkInTime}, ${a.checkOutTime}, ${a.minNights}, ${Math.max(a.minNights, a.maxNights)}, ${JSON.stringify(fee)}::jsonb
    )
    on conflict (product_id) do update set
      duration_minutes = excluded.duration_minutes, buffer_before_minutes = excluded.buffer_before_minutes,
      buffer_after_minutes = excluded.buffer_after_minutes, step_minutes = excluded.step_minutes,
      min_notice_minutes = excluded.min_notice_minutes, max_days_ahead = excluded.max_days_ahead,
      location_id = excluded.location_id, payment = excluded.payment, deposit_percent = excluded.deposit_percent,
      cancel_hours = excluded.cancel_hours, no_show_percent = excluded.no_show_percent,
      check_in_time = excluded.check_in_time, check_out_time = excluded.check_out_time,
      min_nights = excluded.min_nights, max_nights = excluded.max_nights,
      -- The fee of a country the editor does not show (not offered now, D178) is kept as it was.
      booking_fee = (coalesce(commerce.appointment_settings.booking_fee, '{}'::jsonb) - ${marketCodes(context.markets)}) || excluded.booking_fee
  `);
  if (a.resourceIds.length > 0) {
    await tx.execute(sql`
      insert into commerce.product_resources (store_id, product_id, resource_id)
      select ${storeId}::uuid, ${productId}::uuid, r.id from commerce.booking_resources r
      where r.store_id = ${storeId}::uuid and r.id = any(${`{${a.resourceIds.join(",")}}`}::uuid[])
    `);
  }
}

export type SaveProductResult = { ok: true; productId: string } | { ok: false; problems: string[] };

/**
 * Saves the whole product in one transaction: text, pictures, variants,
 * prices (through `commerce.set_price`, keeping the price history), stock,
 * safety contacts and status. Either everything is saved or nothing is.
 */
export async function saveProduct(
  store: Store,
  context: EditorContext,
  productId: string | null,
  given: ProductInput,
  /** What was entered in the product's custom fields (D118), as the editor sends it; saved with the rest. */
  fields?: unknown,
  /** What was entered in its variants' custom fields, by the variant's SKU, in the same shape. */
  variantFields?: unknown,
  /** Who saves it, for the activity log (wave 1, 1f): a product, and each price that changed, is written down when it is given. */
  actor?: { id: string },
  /** How stock is written (D165, `StockMode`): the import and the bulk editor pass what they read, the editor passes nothing. */
  stockMode?: StockMode,
): Promise<SaveProductResult> {
  // The Selling group's features (D178): a product becomes an appointment, a stay or a rental only while that feature is on (one that is
  // already of its kind keeps it and can still be edited), and while Subscriptions is off its purchase options and "only as a
  // subscription" are kept as they are, whatever a stale page sends.
  const [stored] = productId
    ? await db().execute<Row>(sql`select kind, subscription_only, status from commerce.products where store_id = ${store.id}::uuid and id = ${productId}::uuid`)
    : [];
  const neededFeature = kindFeature(given.kind);
  if (neededFeature && !featureOn(store, neededFeature) && stored?.kind !== given.kind) {
    return { ok: false, problems: [`${featureOffText(neededFeature)} Products of that kind can't be added until it is switched on.`] };
  }
  // A bundle (D322) is made as one and stays one: its variant holds no stock, a goods variant's stock has nowhere to go in a bundle.
  if (stored && (stored.kind === "bundle") !== (given.kind === "bundle")) {
    return { ok: false, problems: [given.kind === "bundle" ? "A product cannot become a bundle: make a new product of the kind Bundle." : "A bundle cannot become another kind of product: make a new product."] };
  }
  const subscriptionsOn = featureOn(store, "subscriptions");
  const input = asKind(subscriptionsOn ? given : { ...given, subscriptionOnly: Boolean(stored?.subscription_only) });
  const euRows = await db().execute<Row>(sql`select code from commerce.countries where in_eu`);
  const problems = productProblems(input, {
    markets: context.markets,
    mainCurrency: context.mainCurrency,
    primaryLocale: context.primaryLocale,
    operatorCountries: Object.fromEntries(context.operators.map((o) => [o.id, o.country])),
    euCountries: new Set(euRows.map((r) => String(r.code))),
  });
  // A gallery's videos and 3D models play only the store's own files, or a YouTube or Vimeo address (D325); one the product already had
  // stays (a store made from a template keeps the template's files until its copy job moves them).
  if (input.media.some((m) => m.kind !== "image")) {
    const had = productId
      ? new Set((await db().execute<Row>(sql`select media_url from commerce.product_media where store_id = ${store.id}::uuid and product_id = ${productId}::uuid and media_url is not null`)).map((r) => String(r.media_url)))
      : new Set<string>();
    if (input.media.some((m) => !mediaFileOk(m, store.id) && !(m.mediaUrl && had.has(m.mediaUrl)))) {
      problems.push("A video or 3D model in the gallery is not one of the store's own uploads: upload it again.");
    }
  }
  const optionNames = input.options.map((o) => o.name);
  const allowed = new Set(combineOptions(input.options).map((combo) => JSON.stringify(combo)));
  for (const variant of input.variants) {
    const keys = Object.keys(variant.options);
    if (keys.length !== optionNames.length || keys.some((k) => !optionNames.includes(k))) {
      problems.push("Every variant needs a value for each option.");
      break;
    }
    const ordered = Object.fromEntries(optionNames.map((name) => [name, variant.options[name]]));
    if (!allowed.has(JSON.stringify(ordered))) {
      problems.push("A variant uses an option value that is not listed.");
      break;
    }
  }
  // New download files must really be in storage, at the size the browser said.
  if (uploadsEnabled()) {
    for (const file of input.files.filter((f) => f.id === null)) {
      const stored = await storedFileInfo(file.path);
      if (!stored) problems.push(`The file "${file.name}" did not finish uploading. Add it again.`);
      else Object.assign(file, { sizeBytes: stored.size, contentType: stored.type });
    }
  }
  // Its own layout (D79) must be one of the store's product layouts; one deleted meanwhile is let go.
  if (input.layoutId && !context.layouts.some((layout) => layout.id === input.layoutId)) input.layoutId = null;
  // The store's product limit (D314): a new product, or one taken out of the archive, counts; saving one that already counts never does.
  if (!productId || stored?.status === "archived") {
    const room = await checkLimit(store.id, "products");
    if (!room.ok) problems.push(limitRefusal("products", room.limit));
  }
  problems.push(...(await componentProblems(db(), store.id, input, context.primaryLocale)));
  if (problems.length > 0) return { ok: false, problems };
  // Only the store's own product categories and tags; one deleted meanwhile is left out.
  const termScope = { storeId: store.id, contentType: "product" } as const;
  const categoryIds = await scopedTermIds(termScope, "category", input.categories);
  const termIds = [...categoryIds, ...(await scopedTermIds(termScope, "tag", input.tags))];

  // Content for the unit price (D160): a product that needs it (it is sold by measure, or sits in a marked category or under
  // one) cannot be saved active while an active physical variant has none; a draft can. The database refuses the same state
  // at commit (`commerce.check_unit_price()`), so this is the owner's sentences, not a second rule.
  const name = input.translations.find((tr) => tr.locale === context.primaryLocale)?.title || input.handle;
  const unitProblems = unitPriceProblems({
    status: input.status,
    kind: input.kind,
    soldByMeasure: input.soldByMeasure,
    categories: await categoryMarks(store.id, categoryIds),
    variants: input.variants.map((v) => ({
      sku: v.sku,
      title: [name, variantLabel(v.options)].filter(Boolean).join(" "),
      active: v.active,
      delivery: v.delivery,
      measure: v.measure && normaliseMeasureAmount(v.measure.amount) ? { amount: v.measure.amount, unit: v.measure.unit } : null,
    })),
  });
  if (unitProblems.length > 0) return { ok: false, problems: unitProblems.map((problem) => problem.message) };
  // The standard taxonomy's category and attributes (D327): checked against the release, kept in a stable order.
  if (input.standardCategory !== undefined) {
    const attributes = sortedAttributes(input.standardCategory === null ? {} : (input.standardAttributes ?? {}));
    const standard = standardProblems(await taxonomy(), input.standardCategory, attributes);
    if (standard.length > 0) return { ok: false, problems: standard };
    input.standardAttributes = attributes;
  }
  // Where it is not sold (D335 A.1): only the countries the editor shows, only its own variants.
  if (input.availability) {
    const shown = new Set(context.markets.map((m) => m.code));
    const skus = new Set(input.variants.map((v) => v.sku));
    const codes = [...input.availability.off, ...Object.values(input.availability.variants).flat()];
    if (codes.some((code) => !shown.has(code))) return { ok: false, problems: ["A country it is switched off in is not one the store sells to."] };
    const unknown = Object.keys(input.availability.variants).filter((sku) => !skus.has(sku));
    if (unknown.length > 0) return { ok: false, problems: [`No variant with the SKU ${unknown.join(", ")} to switch off.`] };
  }

  // A description for one country (D338): only the countries the editor shows, in the store's languages.
  if (input.countryTexts) {
    const shown = new Set(context.markets.map((m) => m.code));
    if (input.countryTexts.some((text) => !shown.has(text.market))) return { ok: false, problems: ["A country with a text of its own is not one the store sells to."] };
    if (input.countryTexts.some((text) => !context.locales.includes(text.locale))) return { ok: false, problems: ["A country's text is in a language the store does not offer."] };
  }

  const before = actor && productId ? await productSnapshot(store.id, productId, context.primaryLocale) : null;
  try {
    const id = await db().transaction(async (tx) => {
      const manufacturerId = await resolveOperator(tx, store.id, input.manufacturer);
      const responsibleId = await resolveOperator(tx, store.id, input.responsiblePerson);
      const saved = await upsertProduct(tx, store.id, productId, input, manufacturerId, responsibleId);
      await saveTranslations(tx, store.id, saved, context, input);
      await saveMedia(tx, store.id, saved, context, input);
      await tx.execute(sql`delete from commerce.product_schemes where product_id = ${saved}::uuid`);
      for (const scheme of input.schemes) {
        await tx.execute(sql`
          insert into commerce.product_schemes (store_id, product_id, scheme)
          values (${store.id}::uuid, ${saved}::uuid, ${scheme})
        `);
      }
      const locationId = await stockLocation(tx, store);
      await saveVariants(tx, store.id, saved, context, input, locationId, stockMode, actor?.id ?? null);
      await saveAppointment(tx, store.id, saved, input, context);
      if (input.kind === "bundle") await saveBundleComponents(tx, store.id, saved, input);
      await savePriceBreaks(tx, store.id, saved, input, context);
      await writeAvailability(tx, store.id, saved, input, context);
      await writeCountryTexts(tx, store.id, saved, input, context);
      // Markets that work their prices out from another's (D335 A.2) follow this product's prices.
      await deriveForProducts(tx, store.id, { productIds: [saved] });
      await saveFiles(tx, store.id, saved, input);
      // Kept as they are while Subscriptions is off (D178); a product that becomes a booking still loses them (it cannot be subscribed to).
      if (subscriptionsOn || isBooked(input.kind)) await savePlans(tx, store.id, saved, input, context.markets, context.audience);
      // Only the terms it leaves or joins are written, so its place in an owner's order of a category or tag (D319) stays where it was.
      const keep = `{${termIds.join(",")}}`;
      await tx.execute(sql`
        delete from commerce.product_terms where store_id = ${store.id}::uuid and product_id = ${saved}::uuid and not (term_id = any(${keep}::uuid[]))
      `);
      for (const termId of termIds) {
        await tx.execute(sql`
          insert into commerce.product_terms (store_id, product_id, term_id)
          values (${store.id}::uuid, ${saved}::uuid, ${termId}::uuid)
          on conflict (product_id, term_id) do nothing
        `);
      }
      // Custom fields (D118): those of the groups the finished product gets, in the same transaction.
      const facts = await productFacts(tx, store.id, saved);
      if (facts) {
        const fieldProblems = await saveFieldData(tx, store.id, "product", saved, fields, {
          facts,
          locales: context.locales,
          main: context.primaryLocale,
          requireAll: input.status === "active",
        });
        if (fieldProblems.length > 0) throw new FieldProblems(fieldProblems);
      }
      // And each variant's own (by SKU; one that is gone or not sold has nothing to keep).
      if (typeof variantFields === "object" && variantFields !== null && !Array.isArray(variantFields)) {
        const rows = await tx.execute<Row>(sql`
          select id, sku from commerce.product_variants where product_id = ${saved}::uuid and active
        `);
        const bySku = new Map(rows.map((row) => [String(row.sku), String(row.id)]));
        for (const [sku, raw] of Object.entries(variantFields as Record<string, unknown>)) {
          const variantId = bySku.get(sku);
          const variantRuleFacts = variantId ? await variantFacts(tx, store.id, variantId) : null;
          if (!variantId || !variantRuleFacts) continue;
          const variantProblems = await saveFieldData(tx, store.id, "variant", variantId, raw, {
            facts: variantRuleFacts,
            locales: context.locales,
            main: context.primaryLocale,
            requireAll: input.status === "active",
          });
          if (variantProblems.length > 0) throw new FieldProblems(variantProblems.map((problem) => `${sku}: ${problem}`));
        }
      }
      // Last, so the publishing check sees the finished listing.
      await tx.execute(sql`
        update commerce.products set status = ${input.status}, updated_at = now()
        where id = ${saved}::uuid
      `);
      return saved;
    });
    if (actor) await auditProductSave({ accountId: actor.id, storeId: store.id }, id, before, await productSnapshot(store.id, id, context.primaryLocale));
    return { ok: true, productId: id };
  } catch (error) {
    if (error instanceof FieldProblems) return { ok: false, problems: error.problems };
    return { ok: false, problems: [saveProblem(error, input)] };
  }
}

/** Where the product is not sold (D335 A.1), as the editor holds it: whole countries, and per variant by SKU. */
export async function availabilityOf(storeId: string, productId: string): Promise<NonNullable<ProductInput["availability"]>> {
  const rows = await db().execute<Row>(sql`
    select a.market_code, v.sku from commerce.market_availability a
    left join commerce.product_variants v on v.store_id = a.store_id and v.id = a.variant_id
    where a.store_id = ${storeId}::uuid and a.product_id = ${productId}::uuid
    order by a.market_code
  `);
  const off: string[] = [];
  const variants: Record<string, string[]> = {};
  for (const row of rows) {
    const code = String(row.market_code);
    if (row.sku === null || row.sku === undefined) off.push(code);
    else (variants[String(row.sku)] ??= []).push(code);
  }
  return { off, variants };
}

/**
 * Where the product is not sold (D335 A.1), written only here: the rows of the countries the editor shows are replaced by what was given,
 * those of countries it does not show (switched off with Countries, D178) are kept. A variant is named by its SKU, found after the variants
 * are written. Left out (`availability` undefined), nothing changes. The prices there are never touched.
 */
async function writeAvailability(tx: Tx, storeId: string, productId: string, input: ProductInput, context: EditorContext) {
  if (!input.availability) return;
  const shown = `{${context.markets.map((m) => m.code).join(",")}}`;
  await tx.execute(sql`
    delete from commerce.market_availability
    where store_id = ${storeId}::uuid and product_id = ${productId}::uuid and market_code = any(${shown}::text[])
  `);
  const off = [...new Set(input.availability.off)];
  const variantRows = Object.entries(input.availability.variants)
    .flatMap(([sku, codes]) => [...new Set(codes)].filter((code) => !off.includes(code)).map((code) => ({ sku, code })));
  if (off.length + variantRows.length === 0) return;
  await tx.execute(sql`
    insert into commerce.market_availability (store_id, product_id, variant_id, market_code)
    select ${storeId}::uuid, ${productId}::uuid, null, code from unnest(${`{${off.join(",")}}`}::text[]) as code
    union all
    select ${storeId}::uuid, ${productId}::uuid, v.id, r.code
      from jsonb_to_recordset(${JSON.stringify(variantRows)}::jsonb) as r(sku text, code text)
      join commerce.product_variants v on v.store_id = ${storeId}::uuid and v.product_id = ${productId}::uuid and v.sku = r.sku
  `);
}

/** Its descriptions for one country (D338), as the editor holds them. */
export async function countryTextsOf(storeId: string, productId: string): Promise<NonNullable<ProductInput["countryTexts"]>> {
  const rows = await db().execute<Row>(sql`
    select market_code, locale, description from commerce.product_market_texts
    where store_id = ${storeId}::uuid and product_id = ${productId}::uuid
    order by market_code, locale
  `);
  return rows.map((row) => ({ market: String(row.market_code), locale: String(row.locale), description: String(row.description) }));
}

/**
 * Its descriptions for one country (D338), written only here: the rows of the countries the editor shows are replaced by what was given, an
 * empty text dropped (the language's shows); those of countries it does not show are kept. Left out (`countryTexts` undefined), nothing changes.
 */
async function writeCountryTexts(tx: Tx, storeId: string, productId: string, input: ProductInput, context: EditorContext) {
  if (!input.countryTexts) return;
  const shown = `{${context.markets.map((m) => m.code).join(",")}}`;
  await tx.execute(sql`
    delete from commerce.product_market_texts
    where store_id = ${storeId}::uuid and product_id = ${productId}::uuid and market_code = any(${shown}::text[])
  `);
  const rows = input.countryTexts.filter((text) => text.description.trim() !== "").map((text) => ({ ...text, description: text.description.trim() }));
  if (rows.length === 0) return;
  await tx.execute(sql`
    insert into commerce.product_market_texts (store_id, product_id, market_code, locale, description)
    select ${storeId}::uuid, ${productId}::uuid, r.market, r.locale, r.description
      from jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) as r(market text, locale text, description text)
    on conflict (product_id, market_code, locale) do update set description = excluded.description, updated_at = now()
  `);
}

/** What is wrong with the custom fields entered: ends the transaction, so nothing is saved. */
class FieldProblems extends Error {
  constructor(readonly problems: string[]) {
    super(problems[0]);
  }
}

async function resolveOperator(tx: Tx, storeId: string, choice: OperatorChoice): Promise<string | null> {
  if (choice === null) return null;
  if ("id" in choice) {
    const [row] = await tx.execute<Row>(sql`
      select id from commerce.economic_operators where store_id = ${storeId}::uuid and id = ${choice.id}::uuid
    `);
    if (!row) throw new Error("unknown economic operator");
    return String(row.id);
  }
  const [row] = await tx.execute<Row>(sql`
    insert into commerce.economic_operators (store_id, name, postal_address, electronic_address, country)
    values (${storeId}::uuid, ${choice.new.name}, ${choice.new.postalAddress},
            ${choice.new.electronicAddress}, ${choice.new.country})
    returning id
  `);
  return String(row.id);
}

/** A bundle's pricing columns (D322): null for every other kind; a percentage only for a computed price. */
const bundlePricing = (input: ProductInput): string | null => (input.kind === "bundle" ? (input.bundle?.pricing ?? "fixed") : null);
const bundlePercent = (input: ProductInput): number | null => (input.kind === "bundle" && input.bundle?.pricing === "computed" ? input.bundle.percentOff : null);

async function upsertProduct(
  tx: Tx,
  storeId: string,
  productId: string | null,
  input: ProductInput,
  manufacturerId: string | null,
  responsibleId: string | null,
): Promise<string> {
  // A category switched off is kept by the products that already have it and cannot be newly chosen; an unknown one is refused (D157).
  const [category] = await tx.execute<Row>(sql`
    select k.active, (select p.vat_category = k.code from commerce.products p where p.store_id = ${storeId}::uuid and p.id = ${productId}::uuid) as kept
    from commerce.vat_categories k where k.code = ${input.vatCategory}
  `);
  if (!category || (category.active !== true && category.kept !== true)) {
    throw new FieldProblems(["That VAT category is not available: it does not exist or has been switched off. Choose another."]);
  }
  if (productId) {
    const [row] = await tx.execute<Row>(sql`
      update commerce.products set
        handle = ${input.handle}, status = 'draft',
        manufacturer_id = ${manufacturerId}::uuid, responsible_person_id = ${responsibleId}::uuid,
        tax_code = ${input.taxCode}, withdrawal_exclusion = ${input.withdrawalExclusion},
        delivery = ${input.delivery}, download_limit = ${input.downloadLimit}, download_days = ${input.downloadDays},
        subscription_only = ${input.subscriptionOnly}, audience = ${input.audience},
        vat_category = ${input.vatCategory}, kind = ${input.kind}, host_id = ${hostOf(storeId, input)},
        product_layout_id = ${input.layoutId}::uuid, sold_by_measure = ${input.soldByMeasure && input.kind === "goods"}, updated_at = now(),
        bundle_pricing = ${bundlePricing(input)}, bundle_percent_off = ${bundlePercent(input)},
        shipping_profile_id = ${input.shippingProfileId === undefined ? sql`shipping_profile_id` : sql`(select sp.id from commerce.shipping_profiles sp where sp.store_id = ${storeId}::uuid and sp.id = ${input.shippingProfileId ?? null}::uuid)`},
        standard_category = ${input.standardCategory === undefined ? sql`standard_category` : sql`${input.standardCategory}`},
        standard_attributes = ${input.standardCategory === undefined ? sql`standard_attributes` : sql`${JSON.stringify(input.standardAttributes ?? {})}::jsonb`}
      where store_id = ${storeId}::uuid and id = ${productId}::uuid
      returning id
    `);
    if (!row) throw new Error("unknown product");
    return String(row.id);
  }
  const [row] = await tx.execute<Row>(sql`
    insert into commerce.products (
      store_id, handle, status, manufacturer_id, responsible_person_id, tax_code, withdrawal_exclusion,
      delivery, download_limit, download_days, subscription_only, audience, vat_category, kind, host_id, product_layout_id,
      sold_by_measure, shipping_profile_id, bundle_pricing, bundle_percent_off, standard_category, standard_attributes
    ) values (
      ${storeId}::uuid, ${input.handle}, 'draft', ${manufacturerId}::uuid, ${responsibleId}::uuid,
      ${input.taxCode}, ${input.withdrawalExclusion}, ${input.delivery}, ${input.downloadLimit}, ${input.downloadDays},
      ${input.subscriptionOnly}, ${input.audience}, ${input.vatCategory}, ${input.kind}, ${hostOf(storeId, input)},
      ${input.layoutId}::uuid, ${input.soldByMeasure && input.kind === "goods"}, (select sp.id from commerce.shipping_profiles sp where sp.store_id = ${storeId}::uuid and sp.id = ${input.shippingProfileId ?? null}::uuid),
      ${bundlePricing(input)}, ${bundlePercent(input)}, ${input.standardCategory ?? null},
      ${JSON.stringify(input.standardCategory ? (input.standardAttributes ?? {}) : {})}::jsonb
    )
    returning id
  `);
  return String(row.id);
}

async function saveTranslations(
  tx: Tx,
  storeId: string,
  productId: string,
  context: EditorContext,
  input: ProductInput,
) {
  for (const locale of context.locales) {
    const t = input.translations.find((tr) => tr.locale === locale);
    if (t?.title) {
      await tx.execute(sql`
        insert into commerce.product_translations
          (store_id, product_id, locale, title, description, safety_information, seo_title, seo_description, excerpt)
        values (${storeId}::uuid, ${productId}::uuid, ${locale}, ${t.title}, ${t.description}, ${t.safetyInformation},
                ${t.seoTitle}, ${t.seoDescription}, ${t.excerpt})
        on conflict (product_id, locale) do update set
          title = excluded.title, description = excluded.description,
          safety_information = excluded.safety_information,
          seo_title = excluded.seo_title, seo_description = excluded.seo_description,
          excerpt = excluded.excerpt
      `);
    } else {
      // No title in this language: shoppers there see the primary language.
      await tx.execute(sql`
        delete from commerce.product_translations
        where product_id = ${productId}::uuid and locale = ${locale}
      `);
    }
  }
}

async function saveMedia(
  tx: Tx,
  storeId: string,
  productId: string,
  context: EditorContext,
  input: ProductInput,
) {
  await tx.execute(sql`delete from commerce.product_media where product_id = ${productId}::uuid`);
  const titles = new Map(input.translations.map((t) => [t.locale, t.title]));
  const primaryTitle = titles.get(context.primaryLocale) ?? "";
  for (const [position, media] of input.media.entries()) {
    // Without words of its own in a language, an item is described by the product title there (D325: each language as typed).
    const typed = (locale: string) => (locale === context.primaryLocale ? media.alt : (media.alts[locale] ?? "")).trim();
    const alt = Object.fromEntries(context.locales.map((locale) => [locale, typed(locale) || titles.get(locale) || primaryTitle]));
    await tx.execute(sql`
      insert into commerce.product_media (store_id, product_id, kind, source, media_url, url, thumbnail_url, position, alt)
      values (${storeId}::uuid, ${productId}::uuid, ${media.kind}, ${media.kind === "video" ? media.source : null},
              ${media.kind === "image" ? null : media.mediaUrl}, ${media.url}, ${media.thumbnailUrl},
              ${position}, ${JSON.stringify(alt)}::jsonb)
    `);
  }
}

/** The store's default stock location: the first active one by rank (`priority`, `created_at`, `id`), created on first use. */
async function stockLocation(tx: Tx, store: Store): Promise<string> {
  const [existing] = await tx.execute<Row>(sql`
    select id from commerce.inventory_locations
    where store_id = ${store.id}::uuid and active order by priority, created_at, id limit 1
  `);
  if (existing) return String(existing.id);
  const country = store.details.country ?? store.markets[0]?.code ?? "NO";
  const [row] = await tx.execute<Row>(sql`
    insert into commerce.inventory_locations (store_id, name, country)
    values (${store.id}::uuid, 'Main warehouse', ${country})
    returning id
  `);
  return String(row.id);
}

/**
 * How a save treats stock (D165). Without it (the editor) a physical variant's `stock` is written as given. With it, `loaded` holds the stock
 * each existing variant had when the caller read it: a variant whose `stock` is still that figure is LEFT ALONE (a sale paid since the read stays
 * paid, an import that has no stock column never writes one), and a changed one is written as given, or, with `relative`, as the change from what
 * was read applied to what is there now (`on_hand + (stock - loaded)`, never below 0), so an adjustment of 5 is 5 more whatever was sold meanwhile.
 */
export type StockMode = {
  loaded: ReadonlyMap<string, number>;
  relative?: boolean;
  /**
   * Where the change comes from, for the history (wave 3, D172): the bulk editor says `bulk`, the product file `file`, the AI manager's catalogue
   * tools `ai_manager` (D308); the editor says nothing (`editor`).
   */
  source?: "bulk" | "file" | "ai_manager";
  /** The member who made the change (the history's "by"), and the bulk batch or import job it belongs to. */
  accountId?: string | null;
  jobId?: string | null;
};

type StockWrite = { id: string; isNew: boolean; typed: number; base: number | undefined };

/**
 * Writes the stock a save carries (wave 3, D172, `docs/wave-3-inventory.md` 5.2). The editor's number is ONE location's: with exactly one
 * active location it is that location's `on_hand`, with several it is the total, shown read-only, and an existing variant's levels are
 * never written from it (a stale number in a saved form cannot overwrite a location; the Inventory page changes them). A NEW variant's
 * first number is an `opening` movement at the default location. A negative level (what is owed on a backorder) is left as it is unless a
 * different number is typed. Every write is a movement with its reason, source and the member (`withStockContext()`).
 */
async function writeStock(tx: Tx, storeId: string, writes: readonly StockWrite[], locationId: string, mode?: StockMode, actorId: string | null = null): Promise<void> {
  if (writes.length === 0) return;
  const [counted] = await tx.execute<Row>(sql`select count(*)::int as n from commerce.inventory_locations where store_id = ${storeId}::uuid and active`);
  const single = Number(counted?.n ?? 0) <= 1;
  const source = mode?.source ?? "editor";
  const context = { source, accountId: mode?.accountId ?? actorId, jobId: mode?.jobId ?? null } as const;
  const ordered = [...writes].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  // A few statements whatever the number of variants (wave 6 unit B, D320): each kind of write is one statement over a list.
  const opening = ordered.filter((w) => w.isNew).map((w) => ({ id: w.id, on_hand: w.typed }));
  const existing = ordered.filter((w) => !w.isNew);
  const made = new Set<string>();
  await withStockContext(tx, { reason: "opening", ...context }, async () => {
    if (opening.length > 0) {
      await tx.execute(sql`
        insert into commerce.inventory_levels (store_id, variant_id, location_id, on_hand)
        select ${storeId}::uuid, r.id, ${locationId}::uuid, r.on_hand
        from jsonb_to_recordset(${JSON.stringify(opening)}::jsonb) as r(id uuid, on_hand integer)
        order by r.id
        on conflict (variant_id, location_id) do nothing
      `);
    }
    // A variant that has no level anywhere gets one at the default location (as it always did); nothing else is made or overwritten for it.
    if (existing.length > 0) {
      const rows = await tx.execute<Row>(sql`
        insert into commerce.inventory_levels (store_id, variant_id, location_id, on_hand)
        select ${storeId}::uuid, r.id, ${locationId}::uuid, r.on_hand
        from jsonb_to_recordset(${JSON.stringify(existing.map((w) => ({ id: w.id, on_hand: w.typed })))}::jsonb) as r(id uuid, on_hand integer)
        where not exists (select 1 from commerce.inventory_levels l where l.store_id = ${storeId}::uuid and l.variant_id = r.id)
        order by r.id
        on conflict (variant_id, location_id) do nothing
        returning variant_id
      `);
      for (const row of rows) made.add(String(row.variant_id));
    }
  });
  if (!single) return;
  // One active location: the number is that location's. The levels are read and locked in variant order, as every writer locks them.
  const rest = existing.filter((w) => !made.has(w.id));
  if (rest.length === 0) return;
  const levels = await tx.execute<Row>(sql`
    select variant_id, on_hand from commerce.inventory_levels
    where store_id = ${storeId}::uuid and location_id = ${locationId}::uuid and variant_id = any(${`{${rest.map((w) => w.id).join(",")}}`}::uuid[])
    order by variant_id
    for update
  `);
  const onHand = new Map(levels.map((row) => [String(row.variant_id), Number(row.on_hand)]));
  const corrections: { id: string; on_hand: number }[] = [];
  for (const w of rest) {
    const now = onHand.has(w.id) ? (onHand.get(w.id) as number) : null;
    // What a save does with the figure typed: nothing when it is the one shown (a negative level is shown as 0), the relative change for an
    // adjustment (bulk), else the figure as given.
    if (w.base !== undefined && w.base === w.typed) continue;
    if (w.base === undefined && now !== null && w.typed === Math.max(now, 0)) continue;
    corrections.push({ id: w.id, on_hand: w.base !== undefined && mode?.relative ? Math.max(0, (now ?? 0) + (w.typed - w.base)) : w.typed });
  }
  if (corrections.length === 0) return;
  await withStockContext(tx, { reason: "correction", ...context }, () =>
    tx.execute(sql`
      insert into commerce.inventory_levels (store_id, variant_id, location_id, on_hand)
      select ${storeId}::uuid, r.id, ${locationId}::uuid, r.on_hand
      from jsonb_to_recordset(${JSON.stringify(corrections)}::jsonb) as r(id uuid, on_hand integer)
      order by r.id
      on conflict (variant_id, location_id) do update set on_hand = excluded.on_hand, updated_at = now()
    `),
  );
}

/** A variant's columns as the save writes them, worked out from what the editor sent. */
type VariantColumns = {
  /** Its place in what the editor sent, the order new variants are made in. */
  n: number;
  id: string | null;
  sku: string;
  gtin: string | null;
  options: Record<string, string>;
  active: boolean;
  delivery: string;
  rental_period: string;
  weight_grams: number | null;
  hs_code: string | null;
  origin_country: string | null;
  image_url: string | null;
  image_thumbnail_url: string | null;
  cost_minor: number | null;
  measure_amount: string | null;
  measure_unit: string | null;
  measure_base: string | null;
  stock_policy: string;
  backorder_days: number | null;
  low_stock_threshold: number | null;
  min_quantity: number;
  max_quantity: number | null;
  quantity_step: number;
};

/** The record type `jsonb_to_recordset()` reads a variant's columns with. */
const VARIANT_RECORD = sql.raw(`r(
  n integer, id uuid, sku text, gtin text, options jsonb, active boolean, delivery commerce.delivery, rental_period text, weight_grams integer,
  hs_code text, origin_country text, image_url text, image_thumbnail_url text, cost_minor bigint, measure_amount numeric,
  measure_unit text, measure_base text, stock_policy text, backorder_days integer, low_stock_threshold integer,
  min_quantity integer, max_quantity integer, quantity_step integer
)`);

/**
 * Saves the variants, their prices and their stock (wave 6 unit B, D320, `docs/wave-6-catalogue.md` B.2): a few statements whatever the number of
 * variants, so a product of 2,048 saves in one transaction within its time budget. The rules are those of the one-by-one save it replaced:
 * variants taken out are switched off, prices change only through `commerce.set_price` (keeping the history), stock through `writeStock()`.
 */
async function saveVariants(
  tx: Tx,
  storeId: string,
  productId: string,
  context: EditorContext,
  input: ProductInput,
  locationId: string,
  stockMode?: StockMode,
  /** The member who saves, for the history of stock (a bulk or import run names its own in `stockMode`). */
  actorId: string | null = null,
) {
  const existing = await tx.execute<Row>(sql`
    select v.id,
           coalesce(jsonb_object_agg(p.market_code, p.amount_minor) filter (where p.market_code is not null), '{}'::jsonb) as prices
    from commerce.product_variants v
    left join commerce.prices p on p.variant_id = v.id and p.valid_to is null
    where v.store_id = ${storeId}::uuid and v.product_id = ${productId}::uuid
    group by v.id
  `);
  const current = new Map(existing.map((row) => [String(row.id), (row.prices ?? {}) as Record<string, number | string>]));

  const ruled = input.kind === "goods" || input.kind === "bundle";
  const columns = input.variants.map((variant, n): VariantColumns => {
    // Digital variants are not shipped: no weight or customs details.
    const physical = variant.delivery === "physical";
    // The content for the unit price (D160): physical goods only (`productProblems()` refused it elsewhere), as typed text
    // parsed by `normaliseMeasureAmount()`, never a float. No content clears all three columns.
    const content = physical && input.kind === "goods" && variant.measure ? { ...variant.measure, amount: normaliseMeasureAmount(variant.measure.amount) } : null;
    if (content && content.amount === null) throw new Error("unit_price.invalid_amount");
    // Backorder and the low-stock level (wave 3, D172): goods that are shipped only; `productProblems()` refused the rest, the database checks it again.
    const keeps = physical && variant.stockPolicy === "continue";
    return {
      n,
      id: variant.id && current.has(variant.id) ? variant.id : null,
      sku: variant.sku,
      gtin: variant.gtin,
      options: variant.options,
      active: variant.active,
      delivery: variant.delivery,
      rental_period: input.kind === "rental" ? variant.rentalPeriod : "day",
      weight_grams: physical ? variant.weightGrams : null,
      hs_code: physical ? variant.hsCode : null,
      origin_country: physical ? variant.originCountry : null,
      image_url: variant.image?.url ?? null,
      image_thumbnail_url: variant.image?.thumbnailUrl ?? null,
      // The cost per unit (D152), in the main currency; unknown when empty, and sold lines keep what it was then.
      cost_minor: parsePrice(variant.cost, context.mainCurrency),
      measure_amount: content?.amount ?? null,
      measure_unit: content?.unit ?? null,
      measure_base: content?.base ?? null,
      stock_policy: keeps ? "continue" : "deny",
      backorder_days: keeps ? variant.backorderDays : null,
      low_stock_threshold: physical ? variant.lowStockThreshold : null,
      // How many at a time (D323): goods and bundles keep theirs (`productProblems()` checked it), any other kind one at a time.
      ...(ruled
        ? { min_quantity: variant.minQuantity, max_quantity: variant.maxQuantity, quantity_step: variant.quantityStep }
        : { min_quantity: 1, max_quantity: null, quantity_step: 1 }),
    };
  });

  // The variants kept first, then the new ones, so a new variant may take a SKU a kept one let go of in the same save.
  const kept = columns.filter((c) => c.id !== null);
  if (kept.length > 0) {
    await tx.execute(sql`
      update commerce.product_variants v set
        sku = r.sku, gtin = r.gtin, options = r.options, active = r.active, delivery = r.delivery, rental_period = r.rental_period,
        weight_grams = r.weight_grams, hs_code = r.hs_code, origin_country = r.origin_country,
        image_url = r.image_url, image_thumbnail_url = r.image_thumbnail_url, cost_minor = r.cost_minor,
        measure_amount = r.measure_amount, measure_unit = r.measure_unit, measure_base = r.measure_base,
        stock_policy = r.stock_policy, backorder_days = r.backorder_days, low_stock_threshold = r.low_stock_threshold,
        min_quantity = r.min_quantity, max_quantity = r.max_quantity, quantity_step = r.quantity_step
      from jsonb_to_recordset(${JSON.stringify(kept)}::jsonb) as ${VARIANT_RECORD}
      where v.id = r.id and v.store_id = ${storeId}::uuid and v.product_id = ${productId}::uuid
    `);
  }
  const fresh = columns.filter((c) => c.id === null);
  const newIds = new Map<string, string>();
  if (fresh.length > 0) {
    // A new variant's low-stock level is written after its first stock (below), so the level is compared with that stock and not with the
    // nothing it has before it (D370): one created at or below its level is one crossing, with its real figure; one above it is none.
    const rows = await tx.execute<Row>(sql`
      insert into commerce.product_variants (
        store_id, product_id, sku, gtin, options, active, delivery, rental_period, weight_grams, hs_code, origin_country,
        image_url, image_thumbnail_url, cost_minor, measure_amount, measure_unit, measure_base,
        stock_policy, backorder_days, low_stock_threshold, min_quantity, max_quantity, quantity_step
      )
      select ${storeId}::uuid, ${productId}::uuid, r.sku, r.gtin, r.options, r.active, r.delivery, r.rental_period, r.weight_grams, r.hs_code,
             r.origin_country, r.image_url, r.image_thumbnail_url, r.cost_minor, r.measure_amount, r.measure_unit, r.measure_base,
             r.stock_policy, r.backorder_days, null::integer, r.min_quantity, r.max_quantity, r.quantity_step
      from jsonb_to_recordset(${JSON.stringify(fresh)}::jsonb) as ${VARIANT_RECORD}
      order by r.n
      returning id, sku
    `);
    // SKUs are the store's own once (`product_variants_store_sku_key`), so a new variant is found by its SKU.
    for (const row of rows) newIds.set(String(row.sku), String(row.id));
  }
  const idOf = (c: VariantColumns) => c.id ?? (newIds.get(c.sku) as string);

  // Prices: only those that changed go through `commerce.set_price`, in one statement; a price taken away is ended (its history is kept).
  const changed: { n: number; variant_id: string; market_code: string; amount_minor: number }[] = [];
  const ended: { variant_id: string; market_code: string }[] = [];
  // A computed bundle's prices are the database's (`refresh_bundle_prices()`, D322): none is typed or ended here.
  const computed = input.kind === "bundle" && input.bundle?.pricing === "computed";
  input.variants.forEach((variant, index) => {
    if (computed) return;
    const id = idOf(columns[index]);
    const before = current.get(id) ?? {};
    for (const market of context.markets) {
      const amount = keptAmount(context, market, parsePrice(variant.prices[market.code] ?? "", market.currency), input.vatCategory);
      const was = before[market.code];
      if (amount !== null && (was === undefined || Number(was) !== amount)) changed.push({ n: changed.length, variant_id: id, market_code: market.code, amount_minor: amount });
      else if (amount === null && was !== undefined) ended.push({ variant_id: id, market_code: market.code });
    }
  });
  if (changed.length > 0) {
    await tx.execute(sql`
      select commerce.set_price(r.variant_id, r.market_code, r.amount_minor)
      from jsonb_to_recordset(${JSON.stringify(changed)}::jsonb) as r(n integer, variant_id uuid, market_code text, amount_minor bigint)
      order by r.n
    `);
  }
  if (ended.length > 0) {
    await tx.execute(sql`
      update commerce.prices p set valid_to = now()
      from jsonb_to_recordset(${JSON.stringify(ended)}::jsonb) as r(variant_id uuid, market_code text)
      where p.variant_id = r.variant_id and p.market_code = r.market_code and p.valid_to is null
    `);
  }

  // Downloads never run out: digital variants keep no stock. The writes are made in variant order, so the level rows are locked in the order
  // every writer uses and a checkout in the middle cannot deadlock with this save.
  const stockWrites: StockWrite[] = input.variants.flatMap((variant, index) => {
    // A bundle holds no stock of its own (D322): its components do.
    if (variant.delivery !== "physical" || input.kind === "bundle") return [];
    const c = columns[index];
    return [{ id: idOf(c), isNew: c.id === null, typed: variant.stock, base: c.id !== null ? stockMode?.loaded.get(c.id) : undefined }];
  });
  await writeStock(tx, storeId, stockWrites, locationId, stockMode, actorId);

  // The new variants' low-stock levels, now that their stock is written (`commerce.refresh_stock_alert()` runs on the change of the level).
  const levels = fresh.filter((c) => c.low_stock_threshold !== null).map((c) => ({ id: idOf(c), low_stock_threshold: c.low_stock_threshold }));
  if (levels.length > 0) {
    await tx.execute(sql`
      update commerce.product_variants v set low_stock_threshold = r.low_stock_threshold
      from jsonb_to_recordset(${JSON.stringify(levels)}::jsonb) as r(id uuid, low_stock_threshold integer)
      where v.id = r.id and v.store_id = ${storeId}::uuid and v.product_id = ${productId}::uuid
    `);
  }

  // Variants taken out of the editor are switched off, not deleted: orders and price history may refer to them.
  const keep = `{${columns.map(idOf).join(",")}}`;
  await tx.execute(sql`
    update commerce.product_variants set active = false
    where store_id = ${storeId}::uuid and product_id = ${productId}::uuid and active and not (id = any(${keep}::uuid[]))
  `);
}

/**
 * Saves the purchase options (D25). An option left out is switched off, not
 * deleted: carts, orders and subscriptions keep pointing at it.
 */
async function savePlans(
  tx: Tx,
  storeId: string,
  productId: string,
  input: ProductInput,
  markets: EditorContext["markets"],
  audience: StoreAudience,
) {
  const kept: string[] = [];
  for (const [position, plan] of input.plans.entries()) {
    // Sign-up fees in minor units per market; empty or zero means none (D29).
    const fees: Record<string, number> = {};
    for (const market of markets) {
      const amount = keptAmount({ audience }, market, parsePrice(plan.signupFee[market.code] ?? "", market.currency), input.vatCategory);
      if (amount) fees[market.code] = amount;
    }
    const [row] = plan.id
      ? await tx.execute<Row>(sql`
          update commerce.selling_plans set
            interval = ${plan.interval}, interval_count = ${plan.intervalCount},
            discount_percent = ${plan.discountPercent}, trial_days = ${plan.trialDays},
            signup_fee = (coalesce(signup_fee, '{}'::jsonb) - ${marketCodes(markets)}) || ${JSON.stringify(fees)}::jsonb, min_cycles = ${plan.minCycles},
            position = ${position}, active = true
          where store_id = ${storeId}::uuid and product_id = ${productId}::uuid and id = ${plan.id}::uuid
          returning id
        `)
      : await tx.execute<Row>(sql`
          insert into commerce.selling_plans (
            store_id, product_id, interval, interval_count, discount_percent, trial_days, signup_fee, min_cycles, position
          ) values (
            ${storeId}::uuid, ${productId}::uuid, ${plan.interval}, ${plan.intervalCount}, ${plan.discountPercent},
            ${plan.trialDays}, ${JSON.stringify(fees)}::jsonb, ${plan.minCycles}, ${position}
          )
          returning id
        `);
    if (!row) throw new Error("unknown selling plan");
    kept.push(String(row.id));
  }
  await tx.execute(sql`
    update commerce.selling_plans set active = false
    where store_id = ${storeId}::uuid and product_id = ${productId}::uuid and active
      ${kept.length > 0 ? sql`and id not in (${sql.join(kept.map((id) => sql`${id}::uuid`), sql`, `)})` : sql``}
  `);
}

/** The codes of the markets the editor shows, as a SQL text array: what a per-country JSON value is rewritten for, the rest kept (D178). */
function marketCodes(markets: readonly { code: string }[]) {
  return sql`array[${sql.join(markets.map((m) => sql`${m.code}`), sql`, `)}]::text[]`;
}

/**
 * The product's download files. Files taken out are marked removed, not
 * deleted, so shoppers who bought them can still download them.
 */
async function saveFiles(tx: Tx, storeId: string, productId: string, input: ProductInput) {
  const variants = await tx.execute<Row>(sql`
    select id, sku from commerce.product_variants
    where store_id = ${storeId}::uuid and product_id = ${productId}::uuid
  `);
  const variantBySku = new Map(variants.map((v) => [String(v.sku), String(v.id)]));
  const kept: string[] = [];
  for (const [position, file] of input.files.entries()) {
    // Only files uploaded to this store's own folder.
    if (!file.path.startsWith(`${storeId}/`) || file.path.includes("..")) throw new Error("foreign file");
    const variantId = file.variantSku === null ? null : (variantBySku.get(file.variantSku) ?? null);
    const [row] = await tx.execute<Row>(sql`
      insert into commerce.product_files
        (store_id, product_id, variant_id, name, path, size_bytes, content_type, position)
      values (${storeId}::uuid, ${productId}::uuid, ${variantId}::uuid, ${file.name}, ${file.path},
              ${file.sizeBytes}, ${file.contentType}, ${position})
      on conflict (path) do update set
        variant_id = excluded.variant_id, name = excluded.name, position = excluded.position, removed_at = null
      where commerce.product_files.store_id = ${storeId}::uuid
        and commerce.product_files.product_id = ${productId}::uuid
      returning id
    `);
    if (!row) throw new Error("foreign file");
    kept.push(String(row.id));
  }
  await tx.execute(sql`
    update commerce.product_files set removed_at = now()
    where store_id = ${storeId}::uuid and product_id = ${productId}::uuid and removed_at is null
      ${kept.length > 0 ? sql`and id not in (${sql.join(kept.map((id) => sql`${id}::uuid`), sql`, `)})` : sql``}
  `);
}

function saveProblem(error: unknown, input: ProductInput): string {
  const parts: string[] = [];
  let detail = "";
  for (let e: unknown = error; e && parts.length < 5; e = (e as { cause?: unknown }).cause) {
    const record = e as { message?: unknown; constraint_name?: unknown; detail?: unknown };
    if (typeof record.message === "string") parts.push(record.message);
    if (typeof record.constraint_name === "string") parts.push(record.constraint_name);
    if (typeof record.detail === "string" && !detail) detail = record.detail;
  }
  const text = parts.join(" ");
  // The unit price rules of the database (D160), if something went round the check above: the SKUs are in the detail.
  if (text.includes("unit_price.measure_required")) {
    return `Add the content of ${detail ? `the variants with SKU ${detail}` : "every active variant"}: this product needs a price per kg or litre. Nothing was changed.`;
  }
  if (text.includes("unit_price.not_applicable")) {
    return `Remove the content of ${detail ? `the variants with SKU ${detail}` : "the variants"}: content can only be given for physical goods. Nothing was changed.`;
  }
  if (text.includes("unit_price.invalid_amount")) return "The content of a variant is not a valid amount.";
  // The bundle rules of the database (D322), if something changed between the check above and the save.
  if (text.includes("bundle_components.vat_category")) return "A bundle and its components take one VAT category: change the bundle's, or take that component out. Nothing was changed.";
  if (text.includes("bundle_components.goods")) return "Only goods sent by post can go in a bundle. Nothing was changed.";
  if (text.includes("bundle_components.max")) return "A bundle has at most 20 components. Nothing was changed.";
  if (text.includes("bundle_components.bundle")) return "Only a bundle has components. Nothing was changed.";
  if (text.includes("variants.too_many")) return `A product can have at most ${MAX_VARIANTS} variants for sale. Use fewer option values, or switch some off. Nothing was changed.`;
  if (text.includes("products_store_handle_key")) {
    return `Another product already uses the web address "${input.handle}". Choose another.`;
  }
  if (text.includes("product_variants_store_sku_key")) {
    return "Another product already uses one of these SKUs. SKUs must be unique in the store.";
  }
  if (text.includes("without a picture")) return "Add at least one picture before publishing the product.";
  if (text.includes("responsible person")) {
    return "The manufacturer is outside the EU, so add a responsible person established in the EU.";
  }
  if (text.includes("without a manufacturer")) return "Add the manufacturer before publishing the product.";
  if (text.includes("without an active variant")) return "Switch on at least one variant before publishing the product.";
  if (text.includes("without a title")) return "Give the product a title.";
  if (text.includes("unknown product")) return "This product no longer exists.";
  if (text.includes("foreign file")) return "A file could not be found. Upload it again.";
  return "The product could not be saved. Nothing was changed; try again.";
}

/** Takes a product off sale and out of the list (it is kept, not deleted). */
export async function setArchived(store: Store, productId: string, archived: boolean, actor?: { id: string }): Promise<boolean> {
  const primary = store.localization.locales[0] ?? "en";
  const before = actor ? await productSnapshot(store.id, productId, primary) : null;
  const rows = await db().execute<Row>(sql`
    update commerce.products
       set status = ${archived ? "archived" : "draft"}, updated_at = now()
     where store_id = ${store.id}::uuid and id = ${productId}::uuid
    returning id
  `);
  if (actor && rows.length > 0 && before) await auditProductSave({ accountId: actor.id, storeId: store.id }, productId, before, await productSnapshot(store.id, productId, primary));
  return rows.length > 0;
}
