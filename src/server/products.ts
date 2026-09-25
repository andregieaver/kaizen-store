import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import {
  combineOptions,
  formatPriceInput,
  GENERAL_TAX_CODE,
  parsePrice,
  productProblems,
  type OperatorChoice,
  type ProductInput,
} from "@/lib/product-input";
import type { PlanInterval } from "@/lib/subscriptions";
import type { Term } from "@/lib/taxonomy";

import { storedFileInfo, uploadsEnabled } from "./media";
import type { Store } from "./stores";
import { listTerms, scopedTermIds } from "./taxonomy";

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
  markets: { code: string; currency: string; name: string }[];
  operators: Operator[];
  /** Where stock is counted; null until the first product is saved. */
  locationName: string | null;
  /** The store's product categories and tags (D50). */
  terms: Term[];
};

export async function getEditorContext(store: Store): Promise<EditorContext> {
  const [operators, [location], terms] = await Promise.all([
    db().execute<Row>(sql`
      select id, name, postal_address, electronic_address, country
      from commerce.economic_operators where store_id = ${store.id}::uuid
      order by name
    `),
    db().execute<Row>(sql`
      select name from commerce.inventory_locations
      where store_id = ${store.id}::uuid and active order by created_at limit 1
    `),
    listTerms({ storeId: store.id, contentType: "product" }),
  ]);
  const locales = [...new Set(store.markets.map((m) => m.locale))];
  return {
    locales,
    primaryLocale: locales[0] ?? "en",
    terms,
    markets: store.markets.map((m) => ({ code: m.code, currency: m.currency, name: m.name })),
    operators: operators.map((row) => ({
      id: String(row.id),
      name: String(row.name),
      postalAddress: String(row.postal_address),
      electronicAddress: String(row.electronic_address),
      country: String(row.country),
    })),
    locationName: location ? String(location.name) : null,
  };
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
    })),
    media: [],
    options: [],
    variants: [
      {
        id: null,
        options: {},
        sku: "",
        gtin: null,
        prices: {},
        stock: 0,
        active: true,
        weightGrams: null,
        hsCode: null,
        originCountry: null,
        delivery: "physical",
      },
    ],
    delivery: "physical",
    files: [],
    downloadLimit: 5,
    downloadDays: 30,
    plans: [],
    subscriptionOnly: false,
    taxCode: GENERAL_TAX_CODE,
    withdrawalExclusion: "none",
    schemes: ["packaging"],
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
      p.id, p.handle, p.status,
      coalesce(tl.title, tf.title, p.handle) as title,
      (select coalesce(m.thumbnail_url, m.url) from commerce.product_media m
        where m.product_id = p.id order by m.position limit 1) as image,
      (select count(*)::int from commerce.product_variants v
        where v.product_id = p.id and v.active) as variants,
      (select count(*)::int from commerce.product_variants v
        where v.product_id = p.id and v.active and v.delivery = 'digital') as digital_variants,
      (select coalesce(sum(l.on_hand), 0)::int
         from commerce.inventory_levels l
         join commerce.product_variants v on v.id = l.variant_id
        where v.product_id = p.id and v.active) as stock,
      pr.min_amount, pr.max_amount, pr.currency
    from commerce.products p
    left join commerce.product_translations tl on tl.product_id = p.id and tl.locale = ${locale}
    left join lateral (
      select title from commerce.product_translations where product_id = p.id order by locale limit 1
    ) tf on true
    left join lateral (
      select min(c.amount_minor) as min_amount, max(c.amount_minor) as max_amount, min(c.currency) as currency
      from commerce.current_prices c
      join commerce.product_variants v on v.id = c.variant_id and v.active
      where v.product_id = p.id and c.market_code = ${market?.code ?? ""}
    ) pr on true
    where p.store_id = ${store.id}::uuid
      and ${archived ? sql`p.status = 'archived'` : sql`p.status <> 'archived'`}
    order by p.updated_at desc, p.handle
  `);
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
        : { min: Number(row.min_amount), max: Number(row.max_amount), currency: String(row.currency) },
  }));
}

/** A product in the editor's shape, or null if it is not the store's. */
export async function getProductForEdit(
  store: Store,
  context: EditorContext,
  productId: string,
): Promise<(ProductInput & { archived: boolean }) | null> {
  const [product] = await db().execute<Row>(sql`
    select id, handle, status, tax_code, withdrawal_exclusion, manufacturer_id, responsible_person_id,
           delivery, download_limit, download_days, subscription_only
    from commerce.products where store_id = ${store.id}::uuid and id = ${productId}::uuid
  `);
  if (!product) return null;

  const [translations, media, schemes, variants, prices, files, plans, termRows] = await Promise.all([
    db().execute<Row>(sql`
      select locale, title, description, safety_information, seo_title, seo_description
      from commerce.product_translations where product_id = ${productId}::uuid
    `),
    db().execute<Row>(sql`
      select url, thumbnail_url, alt from commerce.product_media
      where product_id = ${productId}::uuid order by position
    `),
    db().execute<Row>(sql`
      select scheme from commerce.product_schemes where product_id = ${productId}::uuid
    `),
    db().execute<Row>(sql`
      select v.id, v.sku, v.gtin, v.options, v.active, v.weight_grams, v.hs_code, v.origin_country, v.delivery,
             coalesce((
               select l.on_hand from commerce.inventory_levels l
               join commerce.inventory_locations loc on loc.id = l.location_id and loc.active
               where l.variant_id = v.id order by loc.created_at limit 1
             ), 0) as stock
      from commerce.product_variants v
      where v.store_id = ${store.id}::uuid and v.product_id = ${productId}::uuid
      order by v.active desc, v.created_at, v.sku
    `),
    db().execute<Row>(sql`
      select c.variant_id, c.market_code, c.currency, c.amount_minor
      from commerce.current_prices c
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
      };
    }),
    media: media.map((m) => {
      const alt = (m.alt ?? {}) as Record<string, string>;
      const text = alt[context.primaryLocale] ?? "";
      return {
        url: String(m.url),
        thumbnailUrl: m.thumbnail_url ? String(m.thumbnail_url) : null,
        // An alt text equal to the title was filled in for the owner; show it empty.
        alt: text === primaryTitle ? "" : text,
      };
    }),
    options,
    variants: variants.map((v, i) => ({
      id: String(v.id),
      options: variantOptions[i],
      sku: String(v.sku),
      gtin: v.gtin ? String(v.gtin) : null,
      prices: Object.fromEntries(
        prices
          .filter((p) => String(p.variant_id) === String(v.id))
          .map((p) => [String(p.market_code), formatPriceInput(Number(p.amount_minor), String(p.currency))]),
      ),
      stock: Number(v.stock),
      active: Boolean(v.active),
      weightGrams: v.weight_grams === null ? null : Number(v.weight_grams),
      hsCode: v.hs_code ? String(v.hs_code) : null,
      originCountry: v.origin_country ? String(v.origin_country) : null,
      delivery: v.delivery === "digital" ? ("digital" as const) : ("physical" as const),
    })),
    delivery: product.delivery === "digital" ? "digital" : "physical",
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
          .map((m) => [m.code, formatPriceInput((p.signup_fee as Record<string, number>)[m.code], m.currency)]),
      ),
      minCycles: Number(p.min_cycles),
    })),
    subscriptionOnly: Boolean(product.subscription_only),
    taxCode: String(product.tax_code),
    withdrawalExclusion: String(product.withdrawal_exclusion),
    schemes: schemes.map((s) => String(s.scheme)),
    manufacturer: choice(product.manufacturer_id),
    responsiblePerson: choice(product.responsible_person_id),
    categories: termRows.filter((t) => t.kind === "category").map((t) => String(t.id)),
    tags: termRows.filter((t) => t.kind === "tag").map((t) => String(t.id)),
  };
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
  input: ProductInput,
): Promise<SaveProductResult> {
  const euRows = await db().execute<Row>(sql`select code from commerce.countries where in_eu`);
  const problems = productProblems(input, {
    markets: context.markets,
    primaryLocale: context.primaryLocale,
    operatorCountries: Object.fromEntries(context.operators.map((o) => [o.id, o.country])),
    euCountries: new Set(euRows.map((r) => String(r.code))),
  });
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
  if (problems.length > 0) return { ok: false, problems };
  // Only the store's own product categories and tags; one deleted meanwhile is left out.
  const termScope = { storeId: store.id, contentType: "product" } as const;
  const termIds = [
    ...(await scopedTermIds(termScope, "category", input.categories)),
    ...(await scopedTermIds(termScope, "tag", input.tags)),
  ];

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
      await saveVariants(tx, store.id, saved, context, input, locationId);
      await saveFiles(tx, store.id, saved, input);
      await savePlans(tx, store.id, saved, input, context.markets);
      await tx.execute(sql`delete from commerce.product_terms where store_id = ${store.id}::uuid and product_id = ${saved}::uuid`);
      for (const termId of termIds) {
        await tx.execute(sql`
          insert into commerce.product_terms (store_id, product_id, term_id)
          values (${store.id}::uuid, ${saved}::uuid, ${termId}::uuid)
        `);
      }
      // Last, so the publishing check sees the finished listing.
      await tx.execute(sql`
        update commerce.products set status = ${input.status}, updated_at = now()
        where id = ${saved}::uuid
      `);
      return saved;
    });
    return { ok: true, productId: id };
  } catch (error) {
    return { ok: false, problems: [saveProblem(error, input)] };
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

async function upsertProduct(
  tx: Tx,
  storeId: string,
  productId: string | null,
  input: ProductInput,
  manufacturerId: string | null,
  responsibleId: string | null,
): Promise<string> {
  if (productId) {
    const [row] = await tx.execute<Row>(sql`
      update commerce.products set
        handle = ${input.handle}, status = 'draft',
        manufacturer_id = ${manufacturerId}::uuid, responsible_person_id = ${responsibleId}::uuid,
        tax_code = ${input.taxCode}, withdrawal_exclusion = ${input.withdrawalExclusion},
        delivery = ${input.delivery}, download_limit = ${input.downloadLimit}, download_days = ${input.downloadDays},
        subscription_only = ${input.subscriptionOnly}, updated_at = now()
      where store_id = ${storeId}::uuid and id = ${productId}::uuid
      returning id
    `);
    if (!row) throw new Error("unknown product");
    return String(row.id);
  }
  const [row] = await tx.execute<Row>(sql`
    insert into commerce.products (
      store_id, handle, status, manufacturer_id, responsible_person_id, tax_code, withdrawal_exclusion,
      delivery, download_limit, download_days, subscription_only
    ) values (
      ${storeId}::uuid, ${input.handle}, 'draft', ${manufacturerId}::uuid, ${responsibleId}::uuid,
      ${input.taxCode}, ${input.withdrawalExclusion}, ${input.delivery}, ${input.downloadLimit}, ${input.downloadDays},
      ${input.subscriptionOnly}
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
          (store_id, product_id, locale, title, description, safety_information, seo_title, seo_description)
        values (${storeId}::uuid, ${productId}::uuid, ${locale}, ${t.title}, ${t.description}, ${t.safetyInformation},
                ${t.seoTitle}, ${t.seoDescription})
        on conflict (product_id, locale) do update set
          title = excluded.title, description = excluded.description,
          safety_information = excluded.safety_information,
          seo_title = excluded.seo_title, seo_description = excluded.seo_description
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
    // Without a description, a picture is described by the product title.
    const alt = Object.fromEntries(
      context.locales.map((locale) => [
        locale,
        locale === context.primaryLocale && media.alt ? media.alt : titles.get(locale) || primaryTitle,
      ]),
    );
    await tx.execute(sql`
      insert into commerce.product_media (store_id, product_id, url, thumbnail_url, position, alt)
      values (${storeId}::uuid, ${productId}::uuid, ${media.url}, ${media.thumbnailUrl},
              ${position}, ${JSON.stringify(alt)}::jsonb)
    `);
  }
}

/** The store's first active stock location, created on first use. */
async function stockLocation(tx: Tx, store: Store): Promise<string> {
  const [existing] = await tx.execute<Row>(sql`
    select id from commerce.inventory_locations
    where store_id = ${store.id}::uuid and active order by created_at limit 1
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

async function saveVariants(
  tx: Tx,
  storeId: string,
  productId: string,
  context: EditorContext,
  input: ProductInput,
  locationId: string,
) {
  const existing = await tx.execute<Row>(sql`
    select id from commerce.product_variants
    where store_id = ${storeId}::uuid and product_id = ${productId}::uuid
  `);
  const existingIds = new Set(existing.map((row) => String(row.id)));
  const kept = new Set<string>();

  for (const variant of input.variants) {
    // Digital variants are not shipped: no weight or customs details.
    const physical = variant.delivery === "physical";
    const fields = sql`
      sku = ${variant.sku}, gtin = ${variant.gtin}, options = ${JSON.stringify(variant.options)}::jsonb,
      active = ${variant.active}, delivery = ${variant.delivery},
      weight_grams = ${physical ? variant.weightGrams : null},
      hs_code = ${physical ? variant.hsCode : null}, origin_country = ${physical ? variant.originCountry : null}
    `;
    let id: string;
    if (variant.id && existingIds.has(variant.id)) {
      await tx.execute(sql`update commerce.product_variants set ${fields} where id = ${variant.id}::uuid`);
      id = variant.id;
    } else {
      const [row] = await tx.execute<Row>(sql`
        insert into commerce.product_variants (
          store_id, product_id, sku, gtin, options, active, delivery, weight_grams, hs_code, origin_country
        ) values (
          ${storeId}::uuid, ${productId}::uuid, ${variant.sku}, ${variant.gtin},
          ${JSON.stringify(variant.options)}::jsonb, ${variant.active}, ${variant.delivery},
          ${physical ? variant.weightGrams : null}, ${physical ? variant.hsCode : null},
          ${physical ? variant.originCountry : null}
        )
        returning id
      `);
      id = String(row.id);
    }
    kept.add(id);

    for (const market of context.markets) {
      const amount = parsePrice(variant.prices[market.code] ?? "", market.currency);
      const [current] = await tx.execute<Row>(sql`
        select amount_minor from commerce.prices
        where variant_id = ${id}::uuid and market_code = ${market.code} and valid_to is null
      `);
      if (amount !== null && Number(current?.amount_minor) !== amount) {
        await tx.execute(sql`select commerce.set_price(${id}::uuid, ${market.code}, ${amount})`);
      } else if (amount === null && current) {
        // No price any more: end the current one (history is kept).
        await tx.execute(sql`
          update commerce.prices set valid_to = now()
          where variant_id = ${id}::uuid and market_code = ${market.code} and valid_to is null
        `);
      }
    }

    // Downloads never run out: digital variants keep no stock.
    if (physical) {
      await tx.execute(sql`
        insert into commerce.inventory_levels (store_id, variant_id, location_id, on_hand)
        values (${storeId}::uuid, ${id}::uuid, ${locationId}::uuid, ${variant.stock})
        on conflict (variant_id, location_id) do update set on_hand = excluded.on_hand, updated_at = now()
      `);
    }
  }

  // Variants taken out of the editor are switched off, not deleted: orders
  // and price history may refer to them.
  for (const id of existingIds) {
    if (!kept.has(id)) {
      await tx.execute(sql`update commerce.product_variants set active = false where id = ${id}::uuid`);
    }
  }
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
) {
  const kept: string[] = [];
  for (const [position, plan] of input.plans.entries()) {
    // Sign-up fees in minor units per market; empty or zero means none (D29).
    const fees: Record<string, number> = {};
    for (const market of markets) {
      const amount = parsePrice(plan.signupFee[market.code] ?? "", market.currency);
      if (amount) fees[market.code] = amount;
    }
    const [row] = plan.id
      ? await tx.execute<Row>(sql`
          update commerce.selling_plans set
            interval = ${plan.interval}, interval_count = ${plan.intervalCount},
            discount_percent = ${plan.discountPercent}, trial_days = ${plan.trialDays},
            signup_fee = ${JSON.stringify(fees)}::jsonb, min_cycles = ${plan.minCycles},
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
  for (let e: unknown = error; e && parts.length < 5; e = (e as { cause?: unknown }).cause) {
    const record = e as { message?: unknown; constraint_name?: unknown };
    if (typeof record.message === "string") parts.push(record.message);
    if (typeof record.constraint_name === "string") parts.push(record.constraint_name);
  }
  const text = parts.join(" ");
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
export async function setArchived(store: Store, productId: string, archived: boolean): Promise<boolean> {
  const rows = await db().execute<Row>(sql`
    update commerce.products
       set status = ${archived ? "archived" : "draft"}, updated_at = now()
     where store_id = ${store.id}::uuid and id = ${productId}::uuid
    returning id
  `);
  return rows.length > 0;
}
