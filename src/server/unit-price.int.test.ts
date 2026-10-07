import { sql } from "drizzle-orm";
import type Stripe from "stripe";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { conversionFor, localizationOf } from "@/lib/localization";
import { showMarket, toMarket } from "@/lib/markets";
import { productInput, type ProductInput } from "@/lib/product-input";
import { unitPrice, unitPriceShown } from "@/lib/unit-price";
import { allowSmallBase } from "@/lib/unit-price-test-support";
import { lineUnitPriceText } from "@/lib/unit-price-text";
import { t } from "@/lib/i18n";

import type { Store } from "./stores";

type Row = Record<string, unknown>;

/**
 * The unit price on the server (D160, `docs/wave-1d-unit-price.md`): the measure is saved and read back by the editor's
 * save, refused where the rules say, read into the catalogue and the cart in the market's view, frozen on the sold line,
 * kept by the subscription's renewal, and reported when a category is marked later. The price per kg itself is only
 * ever `unitPrice()`'s; what is held here is that every read hands it the right inputs and no money changes.
 */

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, refresh: () => {} }));
const jar = vi.hoisted(() => new Map<string, string>());
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    getAll: () => [...jar].map(([name, value]) => ({ name, value })),
    set: (name: string, value: string) => void jar.set(name, value),
    delete: (name: string) => void jar.delete(name),
  }),
  headers: async () => new Headers(),
}));

const { getCart } = await import("./cart");
const { getProduct, listProducts, listGridProducts } = await import("./catalog");
const { placeOrder } = await import("./checkout");
const { getOrder } = await import("./orders");
const { emptyProduct, getEditorContext, getProductForEdit, saveProduct } = await import("./products");
const { getStore } = await import("./stores");
const { createTerm, updateTerm, listTerms } = await import("./taxonomy");
const { categoryGaps, categoryMarks, productsNeedingMeasure, variantUnitPrices } = await import("./unit-price-gaps");
const { sendOrderConfirmation } = await import("./shopper-emails");
const { applySession } = await import("./stripe-webhooks");
const { getSubscription, renewSubscription } = await import("./subscriptions");

const run = Date.now().toString(36);
const no = toMarket({ code: "NO", currency: "NOK", defaultLocale: "nb-NO" });
const de = toMarket({ code: "DE", currency: "EUR", defaultLocale: "de-DE" });
/** Norway shown in euro (D109): 1 EUR = 11.5 NOK. */
const noInEuro = showMarket(
  { code: "NO", currency: "NOK", defaultLocale: "nb-NO" },
  {
    currency: "EUR",
    conversion: conversionFor(
      localizationOf(
        [],
        [
          { currency: "NOK", rate: 11.5, roundTo: 1 },
          { currency: "EUR", rate: 1, roundTo: 1 },
        ],
        [no],
      ),
      "NOK",
      "EUR",
    )!,
  },
);

let storeId: string;
let otherId: string;
let store: Store;
let owner: { id: string; email: string; name: string; platformAdmin: boolean };
let context: Awaited<ReturnType<typeof getEditorContext>>;

async function newStore(slug: string): Promise<string> {
  const [request] = await db().execute<Row>(sql`
    insert into commerce.access_requests (email, name, store_name) values (${`${slug}@example.com`}, 'Test', 'Test') returning id
  `);
  const [row] = await db().execute<Row>(sql`
    select commerce.approve_access_request(${String(request.id)}::uuid, ${slug}, 'Test', null) as id
  `);
  // A new store starts with the shop alone (D178): these tests sell subscriptions, as an owner switches them on under Features.
  await db().execute(sql`update commerce.stores set features = features || array['subscriptions']::text[] where slug = ${slug}`);
  return String(row.id);
}

beforeAll(async () => {
  storeId = await newStore(`up-${run}`);
  otherId = await newStore(`up-other-${run}`);
  // A market in Germany, the one country the table of the rules reads (the small base is never used there).
  await db().execute(sql`
    insert into commerce.markets (store_id, code, currency, default_locale, locales, active)
    select ${storeId}::uuid, code, currency, default_locale, locales, true from commerce.countries where code = 'DE'
  `);
  await db().execute(sql`
    insert into commerce.store_currencies (store_id, currency, rate, round_to, position)
    values (${storeId}::uuid, 'NOK', 11.5, 1, 0), (${storeId}::uuid, 'EUR', 1, 1, 1)
    on conflict do nothing
  `);
  const [account] = await db().execute<Row>(sql`
    insert into commerce.accounts (email, name) values (${`owner-up-${run}@example.com`}, 'Owner') returning id, email
  `);
  owner = { id: String(account.id), email: String(account.email), name: "Owner", platformAdmin: false };
  store = (await getStore(`up-${run}`))!;
  context = await getEditorContext(store);
  // Plenty on the shelf.
  await db().execute(sql`update commerce.inventory_levels set on_hand = on_hand + 500 where store_id = ${storeId}::uuid`);
});

afterAll(async () => {
  await closeDb();
});

const variantId = async (sku: string, id = storeId): Promise<string> => {
  const [row] = await db().execute<Row>(sql`select id from commerce.product_variants where store_id = ${id}::uuid and sku = ${sku}`);
  return String(row.id);
};

async function setMeasure(sku: string, measure: { amount: string; unit: string; base: string | null } | null, id = storeId) {
  await db().execute(sql`
    update commerce.product_variants set measure_amount = ${measure?.amount ?? null}::numeric, measure_unit = ${measure?.unit ?? null},
      measure_base = ${measure?.base ?? null}
    where store_id = ${id}::uuid and sku = ${sku}
  `);
}

async function cartOf(market: typeof no, lines: [string, number][], jarIt = true): Promise<string> {
  const [row] = await db().execute<Row>(sql`
    insert into commerce.carts (store_id, market_code, currency, locale, expires_at)
    values (${storeId}::uuid, ${market.code}, ${market.currency}, ${market.locale}, now() + interval '1 day') returning id
  `);
  for (const [sku, quantity] of lines) {
    await db().execute(sql`
      insert into commerce.cart_lines (store_id, cart_id, variant_id, quantity)
      values (${storeId}::uuid, ${String(row.id)}::uuid, ${await variantId(sku)}::uuid, ${quantity})
    `);
  }
  if (jarIt) jar.set(`cart_${storeId}_${market.code.toLowerCase()}`, String(row.id));
  return String(row.id);
}

/** A complete product through the same validation as the editor's, two variants with 250 g and 500 g unless said. */
function coffee(handle: string, over: Partial<ProductInput> = {}): ProductInput {
  const base = emptyProduct(context);
  return productInput.parse({
    ...base,
    handle,
    translations: [{ locale: context.primaryLocale, title: "Kaffe", description: "Kaffe.", safetyInformation: "Varm.", seoTitle: "", seoDescription: "" }],
    media: [{ url: "https://example.com/kaffe.webp", thumbnailUrl: "https://example.com/kaffe-480.webp", alt: "" }],
    options: [{ name: "Størrelse", values: ["250 g", "500 g"] }],
    variants: [
      {
        ...base.variants[0],
        options: { Størrelse: "250 g" },
        sku: `${handle}-250`.toUpperCase(),
        prices: { NO: "49,90" },
        stock: 5,
        measure: { amount: "250", unit: "g", base: null },
      },
      {
        ...base.variants[0],
        options: { Størrelse: "500 g" },
        sku: `${handle}-500`.toUpperCase(),
        prices: { NO: "89,90" },
        stock: 5,
        measure: { amount: "0,5", unit: "kg", base: "100g" },
      },
    ],
    manufacturer: { new: { name: "Kaffe AS", postalAddress: "Storgata 1, 0155 Oslo", electronicAddress: "post@kaffe.no", country: "SE" } },
    responsiblePerson: null,
    status: "active",
    ...over,
  });
}

async function save(input: ProductInput, id: string | null = null) {
  context = await getEditorContext(store);
  return saveProduct(store, context, id, input);
}

async function saved(input: ProductInput): Promise<string> {
  const result = await save(input);
  if (!result.ok) throw new Error(result.problems.join(" "));
  return result.productId;
}

/** Every message in an error's chain (the driver's text is on the cause of drizzle's "Failed query"). */
const chain = (error: unknown): string => {
  const parts: string[] = [];
  for (let e: unknown = error; e && parts.length < 6; e = (e as { cause?: unknown }).cause) parts.push(String((e as { message?: unknown }).message ?? ""));
  return parts.join(" | ");
};
async function refusedWith(promise: Promise<unknown>, pattern: RegExp) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error, "the database should refuse").not.toBeNull();
  expect(chain(error)).toMatch(pattern);
}

const category = async (name: string, over: Record<string, unknown> = {}) => {
  const made = await createTerm(owner, { storeId, contentType: "product" }, { kind: "category", name, ...over });
  if (!made.ok) throw new Error(made.problems.join(" "));
  return made.id;
};

describe("saving a measure", () => {
  it("keeps the content, the unit and the owner's choice of base, and reads them back as the editor holds them", async () => {
    const id = await saved(coffee(`kaffe-a-${run}`));
    const editor = (await getProductForEdit(store, context, id))!;
    expect(editor.variants.map((v) => [v.sku, v.measure])).toEqual([
      [`KAFFE-A-${run}-250`.toUpperCase(), { amount: "250", unit: "g", base: null }],
      [`KAFFE-A-${run}-500`.toUpperCase(), { amount: "0.5", unit: "kg", base: "100g" }],
    ]);
    expect(editor.soldByMeasure).toBe(false);
    // The database holds the amount as a numeric with four decimals, never a float.
    const rows = await db().execute<Row>(sql`
      select sku, measure_amount::text as amount, measure_unit, measure_base from commerce.product_variants where product_id = ${id}::uuid order by sku
    `);
    expect(rows.map((r) => [r.amount, r.measure_unit, r.measure_base])).toEqual([
      ["250.0000", "g", null],
      ["0.5000", "kg", "100g"],
    ]);
  });

  it("changes and clears a measure, and a variant without one stays without", async () => {
    const id = await saved(coffee(`kaffe-b-${run}`));
    const { archived, ...current } = (await getProductForEdit(store, context, id))!;
    expect(archived).toBe(false);
    current.variants[0].measure = { amount: "0,75", unit: "l", base: "100ml" };
    current.variants[1].measure = null;
    expect(await save(productInput.parse(current), id)).toMatchObject({ ok: true });
    const again = (await getProductForEdit(store, context, id))!;
    expect(again.variants.map((v) => v.measure)).toEqual([{ amount: "0.75", unit: "l", base: "100ml" }, null]);
  });

  it("refuses what is not a measure, a base of another family, and content on anything but physical goods; nothing is written", async () => {
    const input = coffee(`kaffe-c-${run}`);
    const bad = (measure: unknown) => productInput.safeParse({ ...input, variants: [{ ...input.variants[0], measure }, input.variants[1]] });
    expect(bad({ amount: "0", unit: "g", base: null }).success).toBe(false);
    expect(bad({ amount: "1e3", unit: "g", base: null }).success).toBe(false);
    expect(bad({ amount: "250", unit: "stone", base: null }).success).toBe(false);
    expect(bad({ amount: "250", unit: "g", base: "l" }).success).toBe(false);

    const digital = coffee(`kaffe-c-${run}`, {});
    digital.variants[0].delivery = "digital";
    const refused = await save(digital);
    expect(refused).toMatchObject({ ok: false });
    expect((refused as { problems: string[] }).problems.join(" ")).toMatch(/only be given for physical goods/);
    const [count] = await db().execute<Row>(
      sql`select count(*)::int as n from commerce.products where store_id = ${storeId}::uuid and handle = ${`kaffe-c-${run}`}`,
    );
    expect(Number(count.n)).toBe(0);
  });
});

describe("a product that must have its content", () => {
  it("is refused active without it, sentence by variant, and nothing is written; a draft is allowed", async () => {
    const needs = coffee(`kaffe-d-${run}`, { soldByMeasure: true });
    needs.variants[1].measure = null;
    const refused = await save(needs);
    expect(refused).toEqual({
      ok: false,
      problems: [
        `Add the content of Kaffe 500 g (SKU ${`kaffe-d-${run}-500`.toUpperCase()}): this product needs a price per kg or litre because it is sold by measure.`,
      ],
    });
    const [none] = await db().execute<Row>(
      sql`select count(*)::int as n from commerce.products where store_id = ${storeId}::uuid and handle = ${`kaffe-d-${run}`}`,
    );
    expect(Number(none.n)).toBe(0);

    // A draft may be incomplete; so may a variant that is switched off.
    const draft = await save({ ...needs, status: "draft" });
    expect(draft).toMatchObject({ ok: true });
    const id = (draft as { productId: string }).productId;
    const { archived, ...current } = (await getProductForEdit(store, context, id))!;
    expect(archived).toBe(false);
    current.status = "active";
    current.variants[1].active = false;
    const offSaved = await save(productInput.parse(current), id);
    expect(offSaved, JSON.stringify(offSaved)).toMatchObject({ ok: true });
    // The same product goes live once the last content is given.
    current.variants[1].active = true;
    expect(await save(productInput.parse(current), id)).toMatchObject({ ok: false });
    current.variants[1].measure = { amount: "500", unit: "g", base: null };
    expect(await save(productInput.parse(current), id)).toMatchObject({ ok: true });
  });

  it("is refused when its category, or one above it, is marked, and not when another store's is", async () => {
    const top = await category(`Mat ${run}`, { requiresUnitPrice: true });
    const child = await category(`Kaffe ${run}`, { parentId: top });
    const loose = await category(`Annet ${run}`);
    const foreign = await createTerm(owner, { storeId: otherId, contentType: "product" }, { kind: "category", name: `Mat ${run}`, requiresUnitPrice: true });
    if (!foreign.ok) throw new Error("not made");

    const chain = await categoryMarks(storeId, [child]);
    expect(chain.map((c) => [c.name, c.requiresUnitPrice]).sort()).toEqual([
      [`Kaffe ${run}`, false],
      [`Mat ${run}`, true],
    ]);
    expect(await categoryMarks(storeId, [foreign.id])).toEqual([]);

    const under = coffee(`kaffe-e-${run}`, { categories: [child] });
    under.variants[0].measure = null;
    const refused = await save(under);
    expect(refused).toMatchObject({ ok: false });
    expect((refused as { problems: string[] }).problems[0]).toMatch(new RegExp(`because its category Mat ${run} is marked as needing one`));
    // In an unmarked category, or only in another store's marked one (it is not this store's, so it is left out), it is fine.
    expect(
      await save({ ...under, handle: `kaffe-e2-${run}`, categories: [loose], variants: under.variants.map((v, i) => ({ ...v, sku: `E2-${i}-${run}` })) }),
    ).toMatchObject({ ok: true });
    expect(
      await save({ ...under, handle: `kaffe-e3-${run}`, categories: [foreign.id], variants: under.variants.map((v, i) => ({ ...v, sku: `E3-${i}-${run}` })) }),
    ).toMatchObject({ ok: true });
  });

  it("is refused by the database too, if something goes round the save", async () => {
    const id = await saved(coffee(`kaffe-f-${run}`, { soldByMeasure: true }));
    await refusedWith(
      db().transaction(async (tx) => {
        await tx.execute(
          sql`update commerce.product_variants set measure_amount = null, measure_unit = null, measure_base = null where product_id = ${id}::uuid and sku like '%-250'`,
        );
      }),
      /unit_price\.measure_required/,
    );
    await refusedWith(
      db().execute(sql`update commerce.product_variants set delivery = 'digital' where product_id = ${id}::uuid`),
      /unit_price\.not_applicable/,
    );
  });
});

describe("marking a category", () => {
  it("is for a store's product categories only, is kept when an update says nothing, and never crosses stores", async () => {
    const id = await category(`Drikke ${run}`);
    const tag = await createTerm(owner, { storeId, contentType: "product" }, { kind: "tag", name: `Nytt ${run}`, requiresUnitPrice: true });
    expect(tag).toEqual({ ok: false, problems: ["Only a product category can need a price per kg or litre."] });
    const page = await createTerm(owner, { storeId, contentType: "page" }, { kind: "category", name: `Side ${run}`, requiresUnitPrice: true });
    expect(page).toEqual({ ok: false, problems: ["Only a product category can need a price per kg or litre."] });

    const mark = async (extra: Record<string, unknown>) => {
      const done = await updateTerm(owner, { storeId, contentType: "product" }, id, { name: `Drikke ${run}`, ...extra });
      if (!done.ok) throw new Error(done.problems.join(" "));
      return (await listTerms({ storeId, contentType: "product" })).find((term) => term.id === id)!.requiresUnitPrice;
    };
    expect(await mark({})).toBe(false);
    expect(await mark({ requiresUnitPrice: true })).toBe(true);
    // A save of the name alone (the page builder's, the assistant's) leaves the mark as it was.
    expect(await mark({ name: `Drikke ${run}` })).toBe(true);
    expect(await mark({ requiresUnitPrice: false })).toBe(false);

    // Another store's account cannot reach it: the scope is part of the update.
    const foreignScope = await updateTerm(owner, { storeId: otherId, contentType: "product" }, id, { name: "X", requiresUnitPrice: true });
    expect(foreignScope).toMatchObject({ ok: false });
    expect(await mark({})).toBe(false);
  });
});

describe("what still needs its content", () => {
  it("lists the products that were on sale before the category was marked, with why, and counts them per category", async () => {
    const mat = await category(`Gaps ${run}`);
    const sub = await category(`Gaps under ${run}`, { parentId: mat });
    const flagged = await saved({ ...coffee(`gap-flag-${run}`), categories: [] });
    const inCategory = coffee(`gap-cat-${run}`, { categories: [mat] });
    const inSub = coffee(`gap-sub-${run}`, { categories: [sub] });
    for (const v of [...inCategory.variants, ...inSub.variants]) v.measure = null;
    const catId = await saved(inCategory);
    const subId = await saved(inSub);
    // Marking afterwards changes nothing in the shop: the products stay on sale and are reported.
    await db().execute(sql`update commerce.terms set requires_unit_price = true where id = ${mat}::uuid`);
    const live = await db().execute<Row>(sql`select status from commerce.products where id in (${catId}::uuid, ${subId}::uuid)`);
    expect(live.map((r) => r.status)).toEqual(["active", "active"]);

    // The flag on a product copied with a gap (a store copy switches the check off): the same, reported by the flag first.
    const copied = coffee(`gap-flagged-${run}`);
    copied.variants[1].measure = null;
    copied.variants[0].measure = { amount: "250", unit: "g", base: null };
    const copiedId = await saved({ ...copied, status: "draft" });
    await db().transaction(async (tx) => {
      await tx.execute(sql`select set_config('commerce.unit_price_copying', 'on', true)`);
      await tx.execute(sql`update commerce.products set sold_by_measure = true, status = 'active' where id = ${copiedId}::uuid`);
    });

    const gaps = await productsNeedingMeasure(storeId, "nb-NO");
    const mine = gaps.filter((g) => g.handle.endsWith(run));
    expect(mine.map((g) => [g.handle, g.reason, g.skus.length])).toEqual([
      [`gap-cat-${run}`, { kind: "category", category: `Gaps ${run}` }, 2],
      [`gap-flagged-${run}`, { kind: "flag" }, 1],
      [`gap-sub-${run}`, { kind: "category", category: `Gaps ${run}` }, 2],
    ]);
    expect(gaps.find((g) => g.productId === flagged)).toBeUndefined();
    // The marked category counts its own products and its subcategories'.
    expect((await categoryGaps(storeId)).get(mat)).toBe(2);

    // Saving it gives the owner the sentences; with the content given it is let through and leaves the report.
    const editor = (await getProductForEdit(store, context, catId))!;
    const { archived, ...input } = editor;
    expect(archived).toBe(false);
    expect(await save(productInput.parse(input), catId)).toMatchObject({ ok: false });
    input.variants.forEach((v) => (v.measure = { amount: "250", unit: "g", base: null }));
    expect(await save(productInput.parse(input), catId)).toMatchObject({ ok: true });
    expect((await productsNeedingMeasure(storeId, "nb-NO")).some((g) => g.productId === catId)).toBe(false);
    expect((await categoryGaps(storeId)).get(mat)).toBe(1);
  });

  it("never reports another store's products", async () => {
    // The other store's products were copied with gaps (a store copy switches the check off): flagged, and with no content.
    await db().transaction(async (tx) => {
      await tx.execute(sql`select set_config('commerce.unit_price_copying', 'on', true)`);
      await tx.execute(sql`update commerce.products set sold_by_measure = true where store_id = ${otherId}::uuid and kind = 'goods'`);
    });
    const mine = await productsNeedingMeasure(storeId, "nb-NO");
    const theirs = await productsNeedingMeasure(otherId, "nb-NO");
    expect(theirs.length).toBeGreaterThan(0);
    expect(new Set(mine.map((g) => g.productId)).size).toBe(mine.length);
    const ids = new Set(theirs.map((g) => g.productId));
    expect(mine.some((g) => ids.has(g.productId))).toBe(false);
  });
});

describe("the rules as read: no market compares per 100 g, whatever the owner chose", () => {
  const handle = "demo-keramikkopp";
  beforeAll(async () => {
    await setMeasure("DEMO-MUG-WHITE", { amount: "250", unit: "g", base: "100g" });
    await setMeasure("DEMO-MUG-BLACK", { amount: "300", unit: "g", base: null });
    for (const country of ["DE"]) {
      for (const sku of ["DEMO-MUG-WHITE", "DEMO-MUG-BLACK"]) await db().execute(sql`select commerce.set_price(${await variantId(sku)}::uuid, ${country}, 2490)`);
    }
  });

  it("shows kg in Norway, Sweden, Denmark and Germany for an owner's 100 g, in the catalogue, the cart and the sold line", async () => {
    for (const country of ["NO", "SE", "DK", "DE"]) {
      const market = toMarket({
        code: country,
        currency: country === "DE" ? "EUR" : country === "SE" ? "SEK" : country === "DK" ? "DKK" : "NOK",
        defaultLocale: "nb-NO",
      });
      const product = (await getProduct(storeId, market, handle))!;
      expect(product.variants.find((v) => v.sku === "DEMO-MUG-WHITE")!.measure, country).toEqual({ amount: "250", unit: "g", base: "kg" });
    }
    const norwayInEnglish = (await getProduct(storeId, showMarket({ code: "NO", currency: "NOK", defaultLocale: "nb-NO" }, { locale: "en-GB" }), handle))!;
    expect(norwayInEnglish.variants.find((v) => v.sku === "DEMO-MUG-WHITE")!.measure?.base).toBe("kg");
    await cartOf(no, [["DEMO-MUG-WHITE", 2]]);
    expect((await getCart({ storeId, market: no })).lines[0].measure).toEqual({ amount: "250", unit: "g", base: "kg" });
    const cartId = await cartOf(no, [["DEMO-MUG-WHITE", 2]], false);
    const placed = await placeOrder({ storeId, market: no }, cartId);
    if (!placed.ok) throw new Error(placed.problem);
    const mug = (await getOrder(storeId, placed.order.orderId))!.lines.find((l) => l.sku === "DEMO-MUG-WHITE")!;
    expect(mug.measure).toEqual({ amount: "250", unit: "g", base: "kg" });
    // 249 kr for 250 g is 996 kr per kg, never 99,60 kr per 100 g.
    expect(lineUnitPriceText(mug, "NOK", "nb-NO", t("nb"))?.replace(/\s/g, " ")).toBe("996,00 kr/kg");
    const rows = await db().execute<Row>(
      sql`select measure_base from commerce.order_lines where order_id = ${placed.order.orderId}::uuid and sku = 'DEMO-MUG-WHITE'`,
    );
    expect(rows[0].measure_base).toBe("kg");
  });

  it("lists the staff's per-market unit prices per kg in every market", async () => {
    const [product] = await db().execute<Row>(sql`select id from commerce.products where store_id = ${storeId}::uuid and handle = ${handle}`);
    const rows = await variantUnitPrices(storeId, String(product.id));
    const white = rows.filter((r) => r.sku === "DEMO-MUG-WHITE");
    expect(white.length).toBeGreaterThan(0);
    for (const row of white)
      expect([row.marketCode, row.measure?.base, row.unit?.incl && "ok" in row.unit.incl && row.unit.incl.ok ? row.unit.incl.base : null]).toEqual([
        row.marketCode,
        "kg",
        "kg",
      ]);
  });
});

// No country allows 100 g today: Norway, Sweden and Denmark are opened for the describes inside this one, which hold the
// mechanism (a base chosen by the owner and allowed by the country is shown, snapshotted and frozen) for the day a source
// allows it. They are closed again at its end: every other describe runs on the table as it is.
describe("where a country allows the small base", () => {
  let restoreSmall = () => {};
  beforeAll(() => {
    restoreSmall = allowSmallBase("NO", "SE", "DK");
  });
  afterAll(() => restoreSmall());

  describe("the catalogue reads the measure in the market's view", () => {
    const handle = "demo-keramikkopp";
    // 249 kr for a mug of 250 g, compared per 100 g where the owner chose it and the country allows it.
    beforeAll(async () => {
      await setMeasure("DEMO-MUG-WHITE", { amount: "250", unit: "g", base: "100g" });
      await setMeasure("DEMO-MUG-BLACK", { amount: "300", unit: "g", base: null });
      for (const sku of ["DEMO-MUG-WHITE", "DEMO-MUG-BLACK"]) {
        await db().execute(sql`select commerce.set_price(${await variantId(sku)}::uuid, 'DE', 2490)`);
      }
    });

    it("gives each variant its measure with the base the market's country shows, and the price the same one", async () => {
      const norway = (await getProduct(storeId, no, handle))!;
      const white = norway.variants.find((v) => v.sku === "DEMO-MUG-WHITE")!;
      expect(white.measure).toEqual({ amount: "250", unit: "g", base: "100g" });
      expect(white.price.measure).toEqual(white.measure);
      expect(norway.variants.find((v) => v.sku === "DEMO-MUG-BLACK")!.measure).toEqual({ amount: "300", unit: "g", base: "kg" });
      // Germany never compares packaged goods per 100 g, whatever the owner chose; the language and currency do not decide it.
      const germany = (await getProduct(storeId, de, handle))!;
      expect(germany.variants.find((v) => v.sku === "DEMO-MUG-WHITE")!.measure).toEqual({ amount: "250", unit: "g", base: "kg" });
      const norwayInEnglish = (await getProduct(storeId, showMarket({ code: "NO", currency: "NOK", defaultLocale: "nb-NO" }, { locale: "en-GB" }), handle))!;
      expect(norwayInEnglish.variants.find((v) => v.sku === "DEMO-MUG-WHITE")!.measure?.base).toBe("100g");
    });

    it("gives the card the measure of the variant whose price it shows: the cheapest, ties by SKU, never another's", async () => {
      // In Norway the two mugs cost the same: the first by SKU (black, 300 g, per kg).
      const card = (await listProducts(storeId, no)).find((p) => p.handle === handle)!;
      expect(card.price.measure).toEqual({ amount: "300", unit: "g", base: "kg" });
      // Make the white one cheaper: the card follows it, base and all.
      await db().execute(sql`select commerce.set_price(${await variantId("DEMO-MUG-WHITE")}::uuid, 'NO', 19900)`);
      const cheaper = (await listProducts(storeId, no)).find((p) => p.handle === handle)!;
      expect(cheaper.price.amountMinor).toBe(19900);
      expect(cheaper.price.measure).toEqual({ amount: "250", unit: "g", base: "100g" });
      expect(
        (await listGridProducts(storeId, no, { categoryIds: [], tagIds: [], sort: "newest", limit: 48 })).find((p) => p.handle === handle)!.price.measure,
      ).toEqual(cheaper.price.measure);
      await db().execute(sql`select commerce.set_price(${await variantId("DEMO-MUG-WHITE")}::uuid, 'NO', 24900)`);
      // A product with no measured variant has none.
      expect((await listProducts(storeId, no)).find((p) => p.handle === "demo-notatbok")!.price.measure).toBeNull();
    });

    it("works the unit price from the price as shown: in euro from the euro price, never from the converted krone figure", async () => {
      // 249 kr in euro at 11,5: 21.65 shown (rounded), so 86.60 per kg for 250 g; converting the krone figure (996 kr) gives 86.61.
      const white = (await getProduct(storeId, noInEuro, handle))!.variants.find((v) => v.sku === "DEMO-MUG-WHITE")!;
      expect(white.price.currency).toBe("EUR");
      const shownMinor = Math.round(24900 / 11.5);
      expect(white.price.amountMinor).toBe(shownMinor);
      const result = unitPrice(white.price.amountMinor, white.price.measure!, "kg");
      expect(result).toEqual({ ok: true, minor: shownMinor * 4, base: "kg" });
      expect((result as { minor: number }).minor).not.toBe(Math.round((24900 * 4) / 11.5));
      // The listing's card does the same.
      const card = (await listProducts(storeId, noInEuro)).find((p) => p.handle === handle)!;
      expect(card.price.measure).toMatchObject({ unit: "g" });
    });

    it("follows the store's VAT display: a business-only store compares the price without VAT, netted first", async () => {
      // Selling to businesses only, with Sell to businesses on (D178).
      await db().execute(sql`update commerce.stores set audience = 'businesses', features = features || array['business'] where id = ${storeId}::uuid`);
      try {
        const mug = (await getProduct(storeId, no, handle))!.variants.find((v) => v.sku === "DEMO-MUG-BLACK")!;
        expect(mug.price.vat.shown).toBe("excl");
        const shown = unitPriceShown(mug.price.amountMinor, mug.price.vat, mug.measure!, "kg");
        const net = Math.round(24900 / 1.25);
        expect(shown.incl).toBeUndefined();
        expect(shown.excl).toEqual({ ok: true, minor: Math.round((net * 1000) / 300), base: "kg" });
      } finally {
        await db().execute(sql`update commerce.stores set audience = 'consumers' where id = ${storeId}::uuid`);
      }
    });
  });

  describe("the cart and the sold line", () => {
    beforeAll(async () => {
      await setMeasure("DEMO-MUG-WHITE", { amount: "250", unit: "g", base: "100g" });
      await setMeasure("DEMO-NOTEBOOK-LINED", null);
    });

    it("reads the measure live from the variant, in the market's view, for goods only", async () => {
      await cartOf(no, [
        ["DEMO-MUG-WHITE", 2],
        ["DEMO-NOTEBOOK-LINED", 1],
      ]);
      const cart = await getCart({ storeId, market: no });
      expect(cart.lines.map((l) => [l.handle, l.measure])).toEqual([
        ["demo-keramikkopp", { amount: "250", unit: "g", base: "100g" }],
        ["demo-notatbok", null],
      ]);
      // The unit price of one unit as the cart shows it: the same for two as for one.
      const mug = cart.lines[0];
      expect(unitPrice(mug.unitPriceMinor!, mug.measure!, mug.measure!.base)).toEqual({ ok: true, minor: 9960, base: "100g" });
      // Edited while the cart is open: the cart follows.
      await setMeasure("DEMO-MUG-WHITE", { amount: "500", unit: "g", base: null });
      expect((await getCart({ storeId, market: no })).lines[0].measure).toEqual({ amount: "500", unit: "g", base: "kg" });
      await setMeasure("DEMO-MUG-WHITE", { amount: "250", unit: "g", base: "100g" });
    });

    it("snapshots the measure on the line when the order is placed, with the base in effect, frozen after", async () => {
      const cartId = await cartOf(
        no,
        [
          ["DEMO-MUG-WHITE", 2],
          ["DEMO-NOTEBOOK-LINED", 1],
        ],
        false,
      );
      const placed = await placeOrder({ storeId, market: no }, cartId);
      if (!placed.ok) throw new Error(placed.problem);
      const order = (await getOrder(storeId, placed.order.orderId))!;
      const mug = order.lines.find((l) => l.sku === "DEMO-MUG-WHITE")!;
      expect(mug.measure).toEqual({ amount: "250", unit: "g", base: "100g" });
      expect(order.lines.find((l) => l.sku === "DEMO-NOTEBOOK-LINED")!.measure).toBeNull();
      // From the line's own price and its snapshot: 249 kr for 250 g is 99,60 kr per 100 g.
      expect(lineUnitPriceText(mug, order.currency, order.locale, t("nb"))?.replace(/\s/g, " ")).toBe("99,60 kr/100 g");
      // The owner corrects the variant afterwards: the order keeps what it said, the catalogue and the cart follow.
      await setMeasure("DEMO-MUG-WHITE", { amount: "200", unit: "g", base: null });
      expect((await getOrder(storeId, placed.order.orderId))!.lines.find((l) => l.sku === "DEMO-MUG-WHITE")!.measure).toEqual({
        amount: "250",
        unit: "g",
        base: "100g",
      });
      await refusedWith(
        db().execute(sql`update commerce.order_lines set measure_amount = 1 where order_id = ${placed.order.orderId}::uuid and sku = 'DEMO-MUG-WHITE'`),
        /unit_price\.frozen/,
      );
      await setMeasure("DEMO-MUG-WHITE", { amount: "250", unit: "g", base: "100g" });
    });

    it("changes no money: the same basket totals with and without a measure", async () => {
      const totals = async () => {
        const cartId = await cartOf(
          no,
          [
            ["DEMO-MUG-WHITE", 3],
            ["DEMO-NOTEBOOK-LINED", 2],
          ],
          false,
        );
        const placed = await placeOrder({ storeId, market: no }, cartId);
        if (!placed.ok) throw new Error(placed.problem);
        const order = (await getOrder(storeId, placed.order.orderId))!;
        return {
          total: order.totalMinor,
          vat: order.taxMinor,
          subtotal: order.subtotalMinor,
          shipping: order.shippingMinor,
          lines: order.lines.map((l) => [l.sku, l.unitPriceMinor, l.totalMinor, l.taxMinor]),
        };
      };
      const without = await (async () => {
        await setMeasure("DEMO-MUG-WHITE", null);
        return totals();
      })();
      await setMeasure("DEMO-MUG-WHITE", { amount: "250", unit: "g", base: "100g" });
      await setMeasure("DEMO-NOTEBOOK-LINED", { amount: "120", unit: "g", base: null });
      const withMeasure = await totals();
      expect(withMeasure).toEqual(without);
      await setMeasure("DEMO-NOTEBOOK-LINED", null);
    });

    it("puts the unit price after the line in the order's emails, from the snapshot", async () => {
      const cartId = await cartOf(no, [["DEMO-MUG-WHITE", 2]], false);
      const placed = await placeOrder({ storeId, market: no }, cartId);
      if (!placed.ok) throw new Error(placed.problem);
      await db().execute(sql`update commerce.orders set status = 'paid', email = ${`unit-${run}@example.com`} where id = ${placed.order.orderId}::uuid`);
      await sendOrderConfirmation(storeId, placed.order.orderId);
      const [mail] = await db().execute<Row>(
        sql`select html from commerce.email_messages where store_id = ${storeId}::uuid and order_id = ${placed.order.orderId}::uuid`,
      );
      expect(String(mail.html).replace(/&nbsp;|\s/g, " ")).toMatch(/2 × [^<]* · 99,60 kr\/100 g/);
    });
  });

  describe("a measure per market and per variant, for the staff and the assistant", () => {
    it("lists each variant's measure and its unit price in each market, from the same function the shop uses", async () => {
      await setMeasure("DEMO-MUG-WHITE", { amount: "250", unit: "g", base: "100g" });
      const [product] = await db().execute<Row>(sql`select id from commerce.products where store_id = ${storeId}::uuid and handle = 'demo-keramikkopp'`);
      const rows = await variantUnitPrices(storeId, String(product.id));
      const white = rows.filter((r) => r.sku === "DEMO-MUG-WHITE");
      expect(white.map((r) => [r.marketCode, r.measure?.base, r.unit?.incl])).toEqual([
        ["DE", "kg", { ok: true, minor: 9960, base: "kg" }],
        ["DK", "100g", { ok: true, minor: 7160, base: "100g" }],
        ["NO", "100g", { ok: true, minor: 9960, base: "100g" }],
        ["SE", "100g", { ok: true, minor: 9960, base: "100g" }],
      ]);
      expect(white.find((r) => r.marketCode === "NO")!.currency).toBe("NOK");
    });
  });
});

describe("a subscription", () => {
  const reference = `sub_up_${run}`;
  const session = `cs_up_${run}`;
  let subscriptionId: string;
  let firstOrderId: string;

  beforeAll(async () => {
    await setMeasure("DEMO-NOTEBOOK-LINED", { amount: "200", unit: "g", base: null });
    const [plan] = await db().execute<Row>(sql`
      insert into commerce.selling_plans (store_id, product_id, interval, interval_count, discount_percent)
      select store_id, id, 'month', 1, 10 from commerce.products where store_id = ${storeId}::uuid and handle = 'demo-notatbok' returning id
    `);
    const [row] = await db().execute<Row>(sql`
      insert into commerce.carts (store_id, market_code, currency, locale, expires_at)
      values (${storeId}::uuid, 'NO', 'NOK', 'nb-NO', now() + interval '1 day') returning id
    `);
    await db().execute(sql`
      insert into commerce.cart_lines (store_id, cart_id, variant_id, quantity, selling_plan_id)
      values (${storeId}::uuid, ${String(row.id)}::uuid, ${await variantId("DEMO-NOTEBOOK-LINED")}::uuid, 1, ${String(plan.id)}::uuid)
    `);
    const placed = await placeOrder({ storeId, market: no }, String(row.id), { subscription: true });
    if (!placed.ok) throw new Error(placed.problem);
    subscriptionId = placed.order.subscription!.id;
    firstOrderId = placed.order.orderId;
    await db().execute(sql`
      insert into commerce.payments (store_id, order_id, provider, provider_reference, provider_account, amount_minor, currency)
      values (${storeId}::uuid, ${firstOrderId}::uuid, 'stripe', ${session}, 'acct_up', ${placed.order.totalMinor}, 'NOK')
    `);
    await applySession(storeId, {
      id: session,
      object: "checkout.session",
      mode: "subscription",
      status: "complete",
      payment_status: "paid",
      subscription: reference,
      customer_details: {
        email: "kari@example.com",
        name: "Kari Nordmann",
        address: { line1: "Storgata 1", postal_code: "0155", city: "Oslo", country: "NO" },
      },
    } as unknown as Stripe.Checkout.Session);
  });

  it("keeps the measure on the first order's line, and shows it on the subscription with the price of one delivery", async () => {
    const first = (await getOrder(storeId, firstOrderId))!;
    expect(first.lines.find((l) => l.sku === "DEMO-NOTEBOOK-LINED")!.measure).toEqual({ amount: "200", unit: "g", base: "kg" });
    const subscription = (await getSubscription(storeId, subscriptionId))!;
    const line = subscription.lines[0];
    expect(line.measure).toEqual({ amount: "200", unit: "g", base: "kg" });
    // 129 kr less 10 % is 116,10 kr for 200 g: 580,50 kr per kg.
    expect(unitPrice(line.unitPriceMinor, line.measure!, "kg")).toEqual({ ok: true, minor: 58050, base: "kg" });
  });

  it("takes the variant's measure as it is when a delivery renews, and leaves earlier orders as they were", async () => {
    const invoice = (id: string) =>
      ({
        id,
        billing_reason: "subscription_cycle",
        amount_paid: 21510,
        parent: { subscription_details: { subscription: reference } },
        lines: { data: [{ period: { end: 1_902_600_000 } }] },
      }) as unknown as Stripe.Invoice;
    const renewal = await renewSubscription(storeId, invoice(`in_up_${run}`));
    expect(renewal).not.toBeNull();
    const renewed = (await getOrder(storeId, renewal!))!;
    expect(renewed.lines[0].measure).toEqual({ amount: "200", unit: "g", base: "kg" });
    expect(lineUnitPriceText(renewed.lines[0], renewed.currency, renewed.locale, t("nb"))?.replace(/\s/g, " ")).toBe("580,50 kr/kg");

    // The owner changes the pack size: the next delivery says so, the earlier ones keep what they said.
    await setMeasure("DEMO-NOTEBOOK-LINED", { amount: "250", unit: "g", base: null });
    const next = await renewSubscription(storeId, invoice(`in_up2_${run}`));
    expect((await getOrder(storeId, next!))!.lines[0].measure).toEqual({ amount: "250", unit: "g", base: "kg" });
    expect((await getOrder(storeId, renewal!))!.lines[0].measure).toEqual({ amount: "200", unit: "g", base: "kg" });
    expect((await getOrder(storeId, firstOrderId))!.lines.find((l) => l.sku === "DEMO-NOTEBOOK-LINED")!.measure).toEqual({
      amount: "200",
      unit: "g",
      base: "kg",
    });
    await setMeasure("DEMO-NOTEBOOK-LINED", null);
  });
});
