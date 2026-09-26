import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { closeDb, db } from "@/db/client";
import { toMarket } from "@/lib/markets";
import { EMPTY_NAVIGATION } from "@/lib/navigation";
import { productInput, type ProductInput } from "@/lib/product-input";
import { parseStoreSeo } from "@/lib/seo";
import { templateSettings } from "@/lib/theme";

import {
  emptyProduct,
  getEditorContext,
  getProductForEdit,
  listAdminProducts,
  saveProduct,
  setArchived,
  type EditorContext,
} from "./products";
import type { Store } from "./stores";
import { createTerm } from "./taxonomy";

type Row = Record<string, unknown>;

let store: Store;
let other: Store;
let context: EditorContext;

async function createStore(slug: string): Promise<Store> {
  const [row] = await db().execute<Row>(sql`
    insert into commerce.stores (slug, name, country) values (${slug}, ${slug}, 'NO') returning id
  `);
  await db().execute(sql`
    insert into commerce.markets (store_id, code, currency, default_locale, locales, active)
    select ${String(row.id)}::uuid, code, currency, default_locale, locales, true
    from commerce.countries where code in ('NO', 'SE')
  `);
  return {
    id: String(row.id),
    slug,
    name: slug,
    status: "active",
    isTemplate: false,
    setupCompletedAt: null,
    paymentsOn: false,
    paymentsTest: false,
    details: { legalName: null, organisationNumber: null, contactEmail: null, postalAddress: null, country: "NO" },
    audience: "consumers",
    businessPopup: false,
    openCartOnAdd: false,
    bookingsOn: false,
    timeZone: "Europe/Oslo",
    markets: [
      toMarket({ code: "NO", currency: "NOK", defaultLocale: "nb-NO" }),
      toMarket({ code: "SE", currency: "SEK", defaultLocale: "sv-SE" }),
    ],
    seo: parseStoreSeo({}),
    navigation: EMPTY_NAVIGATION,
    frontPageId: null,
    tracking: {},
    customCode: {},
    fonts: {},
    theme: { base: "minimal", savedId: null, settings: templateSettings("minimal") },
  };
}

const run = Date.now().toString(36);

beforeAll(async () => {
  store = await createStore(`int-${run}-a`);
  other = await createStore(`int-${run}-b`);
  context = await getEditorContext(store);
});

afterAll(async () => {
  await closeDb();
});

/** A complete product, passed through the same validation as the editor's. */
function mug(overrides: Partial<ProductInput> = {}): ProductInput {
  const base = emptyProduct(context);
  return productInput.parse({
    ...base,
    handle: "kopp",
    translations: [
      {
        locale: "nb-NO",
        title: "Kopp",
        description: "En kopp.",
        safetyInformation: "Varm.",
        seoTitle: "Håndlaget kopp i steingods",
        seoDescription: "",
      },
      { locale: "sv-SE", title: "", description: "", safetyInformation: "" },
    ],
    media: [{ url: "https://example.com/kopp.webp", thumbnailUrl: "https://example.com/kopp-480.webp", alt: "" }],
    options: [{ name: "Farge", values: ["Hvit", "Svart"] }],
    variants: [
      { ...base.variants[0], options: { Farge: "Hvit" }, sku: `K-HVIT-${run}`, prices: { NO: "249,00", SE: "" }, stock: 5 },
      { ...base.variants[0], options: { Farge: "Svart" }, sku: `K-SVART-${run}`, prices: { NO: "249", SE: "269" }, stock: 0 },
    ],
    manufacturer: {
      new: { name: "Keramikk AS", postalAddress: "Storgata 1, 0155 Oslo", electronicAddress: "post@keramikk.no", country: "NO" },
    },
    responsiblePerson: {
      new: { name: "Keramik AB", postalAddress: "Drottninggatan 1, Stockholm", electronicAddress: "info@keramik.se", country: "SE" },
    },
    status: "active",
    ...overrides,
  });
}

describe("saving a product", () => {
  let productId: string;

  it("creates the product with its variants, prices, stock and safety contacts", async () => {
    const result = await saveProduct(store, context, null, mug());
    expect(result).toMatchObject({ ok: true });
    productId = (result as { productId: string }).productId;

    context = await getEditorContext(store);
    expect(context.operators.map((o) => o.name)).toEqual(["Keramik AB", "Keramikk AS"]);
    expect(context.locationName).toBe("Main warehouse");

    const saved = await getProductForEdit(store, context, productId);
    expect(saved).toMatchObject({
      archived: false,
      status: "active",
      handle: "kopp",
      options: [{ name: "Farge", values: ["Hvit", "Svart"] }],
    });
    expect(saved?.translations).toEqual([
      {
        locale: "nb-NO",
        title: "Kopp",
        description: "En kopp.",
        safetyInformation: "Varm.",
        seoTitle: "Håndlaget kopp i steingods",
        seoDescription: "",
      },
      { locale: "sv-SE", title: "", description: "", safetyInformation: "", seoTitle: "", seoDescription: "" },
    ]);
    expect(saved?.variants.map((v) => [v.sku, v.prices, v.stock])).toEqual([
      [`K-HVIT-${run}`, { NO: "249,00" }, 5],
      [`K-SVART-${run}`, { NO: "249,00", SE: "269,00" }, 0],
    ]);
  });

  it("keeps the product's categories and tags: only the store's own product ones (D50)", async () => {
    const [account] = await db().execute<Row>(sql`
      insert into commerce.accounts (email, name) values (${`products-${run}@example.com`}, 'Owner') returning id, email
    `);
    const owner = { id: String(account.id), email: String(account.email), name: "Owner", platformAdmin: false };
    const own = await createTerm(owner, { storeId: store.id, contentType: "product" }, { kind: "category", name: "Kopper" });
    const tag = await createTerm(owner, { storeId: store.id, contentType: "product" }, { kind: "tag", name: "Nyhet" });
    const foreign = await createTerm(owner, { storeId: other.id, contentType: "product" }, { kind: "category", name: "Kopper" });
    if (!own.ok || !tag.ok || !foreign.ok) throw new Error("terms not created");
    context = await getEditorContext(store);
    expect(context.terms.map((t) => t.name).sort()).toEqual(["Kopper", "Nyhet"]);

    const current = await getProductForEdit(store, context, productId);
    const { archived: _archived, ...input } = current!;
    void _archived;
    const result = await saveProduct(store, context, productId, {
      ...input,
      categories: [own.id, foreign.id],
      tags: [tag.id, own.id],
    });
    expect(result).toMatchObject({ ok: true });
    const saved = await getProductForEdit(store, context, productId);
    expect(saved?.categories).toEqual([own.id]);
    expect(saved?.tags).toEqual([tag.id]);
  });

  it("changes prices through the price history and ends removed prices", async () => {
    const current = await getProductForEdit(store, context, productId);
    const { archived, ...input } = current!;
    expect(archived).toBe(false);
    input.variants[0].prices = { NO: "199", SE: "219" };
    input.variants[1].prices = { NO: "249", SE: "" };
    expect(await saveProduct(store, context, productId, productInput.parse(input))).toMatchObject({ ok: true });

    const history = await db().execute<Row>(sql`
      select v.sku, p.market_code, p.amount_minor::int as amount, p.valid_to is null as open
      from commerce.prices p join commerce.product_variants v on v.id = p.variant_id
      where v.product_id = ${productId}::uuid
      order by v.sku, p.market_code, p.id
    `);
    expect(history.map((r) => [r.sku, r.market_code, r.amount, r.open])).toEqual([
      [`K-HVIT-${run}`, "NO", 24900, false],
      [`K-HVIT-${run}`, "NO", 19900, true],
      [`K-HVIT-${run}`, "SE", 21900, true],
      [`K-SVART-${run}`, "NO", 24900, true],
      [`K-SVART-${run}`, "SE", 26900, false],
    ]);
  });

  it("switches off variants taken out, instead of deleting them", async () => {
    const current = await getProductForEdit(store, context, productId);
    const { archived, ...input } = current!;
    expect(archived).toBe(false);
    input.options = [{ name: "Farge", values: ["Hvit"] }];
    input.variants = input.variants.filter((v) => v.options.Farge === "Hvit");
    expect(await saveProduct(store, context, productId, productInput.parse(input))).toMatchObject({ ok: true });

    const variants = await db().execute<Row>(sql`
      select sku, active from commerce.product_variants where product_id = ${productId}::uuid order by sku
    `);
    expect(variants.map((v) => [v.sku, v.active])).toEqual([
      [`K-HVIT-${run}`, true],
      [`K-SVART-${run}`, false],
    ]);
  });

  it("lists the product with its thumbnail, stock and price", async () => {
    const [row] = await listAdminProducts(store);
    expect(row).toMatchObject({
      id: productId,
      title: "Kopp",
      status: "active",
      image: "https://example.com/kopp-480.webp",
      variants: 1,
      stock: 5,
      price: { min: 19900, max: 19900, currency: "NOK" },
    });
  });

  it("archives and restores", async () => {
    expect(await setArchived(store, productId, true)).toBe(true);
    expect(await listAdminProducts(store)).toEqual([]);
    expect((await listAdminProducts(store, { archived: true }))[0]?.id).toBe(productId);
    await setArchived(store, productId, false);
    expect((await getProductForEdit(store, context, productId))?.status).toBe("draft");
  });
});

describe("selling to businesses (B2B)", () => {
  it("lets a store selling only to businesses type prices without VAT, and keeps them with it", async () => {
    const b2b: Store = { ...other, audience: "businesses" };
    const b2bContext = await getEditorContext(b2b);
    expect(b2bContext.markets.map((m) => [m.code, m.vatRates])).toEqual([
      ["NO", { standard: 0.25, accommodation: 0.12, exempt: 0 }],
      ["SE", { standard: 0.25, accommodation: 0.12, exempt: 0 }],
    ]);
    const product = mug({ handle: "firmakopp", audience: "businesses", manufacturer: null, responsiblePerson: null, status: "draft" });
    product.variants = product.variants.map((v, i) => ({ ...v, sku: `B2B-${i}-${run}`, prices: { NO: "199,20", SE: "" } }));
    const result = await saveProduct(b2b, b2bContext, null, product);
    expect(result).toMatchObject({ ok: true });
    const productId = (result as { productId: string }).productId;

    const [row] = await db().execute<Row>(sql`
      select p.audience, min(pr.amount_minor)::int as amount
      from commerce.products p
      join commerce.product_variants v on v.product_id = p.id
      join commerce.current_prices pr on pr.variant_id = v.id and pr.market_code = 'NO'
      where p.id = ${productId}::uuid group by p.audience
    `);
    expect(row).toEqual({ audience: "businesses", amount: 24900 });
    const saved = await getProductForEdit(b2b, b2bContext, productId);
    expect(saved?.audience).toBe("businesses");
    expect(saved?.variants.map((v) => v.prices)).toEqual([{ NO: "199,20" }, { NO: "199,20" }]);
  });
});

describe("refusing bad products", () => {
  it("explains what stops a product going on sale, and saves nothing", async () => {
    const result = await saveProduct(store, context, null, mug({ handle: "no-picture", media: [], manufacturer: null }));
    expect(result).toEqual({
      ok: false,
      problems: [
        "Add at least one picture before publishing the product.",
        "Add the manufacturer: EU product-safety rules require it on the listing.",
      ],
    });
    const rows = await db().execute(sql`
      select 1 from commerce.products where store_id = ${store.id}::uuid and handle = 'no-picture'
    `);
    expect(rows).toHaveLength(0);
  });

  it("refuses a web address or SKU already in use in the store", async () => {
    const taken = await saveProduct(store, context, null, mug({ status: "draft" }));
    expect(taken).toEqual({
      ok: false,
      problems: ['Another product already uses the web address "kopp". Choose another.'],
    });
    const sku = await saveProduct(store, context, null, mug({ handle: "kopp-2", status: "draft" }));
    expect(sku).toEqual({
      ok: false,
      problems: ["Another product already uses one of these SKUs. SKUs must be unique in the store."],
    });
  });

  it("does not let one store use another store's manufacturer or product", async () => {
    const theirContext = await getEditorContext(other);
    const borrowed = await saveProduct(other, theirContext, null, {
      ...mug({ status: "draft", handle: "borrowed" }),
      manufacturer: { id: context.operators[0].id },
    });
    expect(borrowed.ok).toBe(false);

    const [mine] = await listAdminProducts(store);
    const stolen = await saveProduct(other, theirContext, mine.id, mug({ status: "draft" }));
    expect(stolen).toEqual({ ok: false, problems: ["This product no longer exists."] });
    expect(await getProductForEdit(other, theirContext, mine.id)).toBeNull();
  });
});

describe("digital products (D24)", () => {
  const ebook = (overrides: Partial<ProductInput> = {}) => {
    const base = mug();
    return productInput.parse({
      ...base,
      handle: `e-bok-${run}`,
      options: [],
      delivery: "digital",
      variants: [{ ...base.variants[0], options: {}, sku: `EBOK-${run}`, stock: 0, delivery: "digital", weightGrams: 300 }],
      files: [
        {
          id: null,
          name: "Boken.pdf",
          path: `${store.id}/f1/boken.pdf`,
          sizeBytes: 2048,
          contentType: "application/pdf",
          variantSku: null,
        },
      ],
      downloadLimit: 3,
      downloadDays: null,
      manufacturer: null,
      responsiblePerson: null,
      ...overrides,
    });
  };

  it("puts a download on sale without a manufacturer, stock or weight", async () => {
    const result = await saveProduct(store, context, null, ebook());
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    const saved = await getProductForEdit(store, context, result.productId);
    expect(saved).toMatchObject({
      status: "active",
      delivery: "digital",
      downloadLimit: 3,
      downloadDays: null,
      variants: [{ delivery: "digital", weightGrams: null }],
      files: [{ name: "Boken.pdf", sizeBytes: 2048, variantSku: null }],
    });
    const levels = await db().execute(sql`
      select 1 from commerce.inventory_levels l
      join commerce.product_variants v on v.id = l.variant_id
      where v.sku = ${`EBOK-${run}`}
    `);
    expect(levels).toHaveLength(0);
    const [row] = (await listAdminProducts(store)).filter((p) => p.id === result.productId);
    expect(row).toMatchObject({ variants: 1, digitalVariants: 1 });
  });

  it("keeps a removed file for earlier buyers, and refuses another store's files", async () => {
    const [product] = (await listAdminProducts(store)).filter((p) => p.handle === `e-bok-${run}`);
    const current = await getProductForEdit(store, context, product.id);
    const replaced = await saveProduct(store, context, product.id, {
      ...current!,
      files: [{ ...current!.files[0], id: null, name: "Boken v2.pdf", path: `${store.id}/f2/boken.pdf` }],
    });
    expect(replaced).toMatchObject({ ok: true });
    const files = await db().execute<Row>(sql`
      select name, removed_at is not null as removed from commerce.product_files
      where product_id = ${product.id}::uuid order by created_at
    `);
    expect(files.map((f) => [f.name, f.removed])).toEqual([
      ["Boken.pdf", true],
      ["Boken v2.pdf", false],
    ]);

    const foreign = await saveProduct(store, context, product.id, {
      ...current!,
      files: [{ ...current!.files[0], id: null, path: `${other.id}/f1/stolen.pdf` }],
    });
    expect(foreign.ok).toBe(false);
  });

  it("needs a file before a download goes on sale", async () => {
    const result = await saveProduct(store, context, null, ebook({ handle: `tom-${run}`, files: [], variants: [
      { ...ebook().variants[0], sku: `TOM-${run}` },
    ] }));
    expect(result).toEqual({ ok: false, problems: ["Default is digital: add a file for shoppers to download."] });
  });
});

describe("purchase options (D25)", () => {
  it("saves options, and switches off the ones taken away instead of deleting them", async () => {
    const plans = [
      { id: null, interval: "month" as const, intervalCount: 1, discountPercent: 10, trialDays: 14, signupFee: { NO: "49" }, minCycles: 3 },
      { id: null, interval: "week" as const, intervalCount: 2, discountPercent: 0, trialDays: 0, signupFee: {} as Record<string, string>, minCycles: 0 },
    ];
    const result = await saveProduct(
      store,
      context,
      null,
      mug({ handle: `abonnement-${run}`, status: "draft", plans, subscriptionOnly: true, variants: [
        { ...mug().variants[0], sku: `ABO-${run}` },
      ] }),
    );
    if (!result.ok) throw new Error(result.problems.join(" "));
    const saved = await getProductForEdit(store, context, result.productId);
    expect(saved).toMatchObject({
      subscriptionOnly: true,
      plans: [
        { interval: "month", discountPercent: 10, trialDays: 14, signupFee: { NO: "49,00" }, minCycles: 3 },
        { interval: "week", trialDays: 0, signupFee: {} as Record<string, string>, minCycles: 0 },
      ],
    });

    const kept = saved!.plans[1];
    expect(await saveProduct(store, context, result.productId, { ...saved!, plans: [kept] })).toMatchObject({ ok: true });
    expect((await getProductForEdit(store, context, result.productId))?.plans).toEqual([kept]);
    const [off] = await db().execute<Row>(sql`
      select count(*)::int as n from commerce.selling_plans where product_id = ${result.productId}::uuid and not active
    `);
    expect(off.n).toBe(1);
  });
});

describe("appointments (D65)", () => {
  it("saves how an appointment is booked and who does it, as services with no stock, and clears it all for goods", async () => {
    const [staff] = await db().execute<Row>(sql`
      insert into commerce.booking_resources (store_id, name, hours) values (${store.id}::uuid, 'Kari', '{}') returning id
    `);
    const [elsewhere] = await db().execute<Row>(sql`
      insert into commerce.booking_resources (store_id, name, hours) values (${other.id}::uuid, 'Ola', '{}') returning id
    `);
    const appointment = mug({
      handle: "massasje",
      kind: "appointment",
      appointment: {
        durationMinutes: 45,
        bufferBeforeMinutes: 0,
        bufferAfterMinutes: 15,
        stepMinutes: 15,
        minNoticeMinutes: 120,
        maxDaysAhead: 30,
        locationId: null,
        // Another store's staff are left out.
        resourceIds: [String(staff.id), String(elsewhere.id)],
      },
      manufacturer: null,
      responsiblePerson: null,
    });
    appointment.variants = [{ ...appointment.variants[0], options: {}, sku: `MASSASJE-${run}`, prices: { NO: "890" } }];
    appointment.options = [];
    const result = await saveProduct(store, context, null, appointment);
    expect(result).toMatchObject({ ok: true });
    const productId = (result as { productId: string }).productId;

    const saved = await getProductForEdit(store, context, productId);
    expect(saved).toMatchObject({ kind: "appointment", appointment: { durationMinutes: 45, bufferAfterMinutes: 15, resourceIds: [String(staff.id)] } });
    expect(saved?.variants.map((v) => v.delivery)).toEqual(["service"]);
    const [stock] = await db().execute<Row>(sql`
      select count(*)::int as n from commerce.inventory_levels l
      join commerce.product_variants v on v.id = l.variant_id where v.product_id = ${productId}::uuid
    `);
    expect(stock.n).toBe(0);

    // Back to goods: shipped again, and nothing of the appointment kept.
    const { archived, ...input } = saved!;
    expect(archived).toBe(false);
    expect(await saveProduct(store, context, productId, productInput.parse({ ...input, kind: "goods", status: "draft" }))).toMatchObject({ ok: true });
    const goods = await getProductForEdit(store, context, productId);
    expect(goods).toMatchObject({ kind: "goods", appointment: null });
    expect(goods?.variants.map((v) => v.delivery)).toEqual(["physical"]);
    const [left] = await db().execute<Row>(sql`
      select (select count(*) from commerce.appointment_settings where product_id = ${productId}::uuid)::int
           + (select count(*) from commerce.product_resources where product_id = ${productId}::uuid)::int as n
    `);
    expect(left.n).toBe(0);
  });
});
