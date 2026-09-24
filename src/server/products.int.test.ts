import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { closeDb, db } from "@/db/client";
import { toMarket } from "@/lib/markets";
import { productInput, type ProductInput } from "@/lib/product-input";
import { parseStoreSeo } from "@/lib/seo";

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
    markets: [
      toMarket({ code: "NO", currency: "NOK", defaultLocale: "nb-NO" }),
      toMarket({ code: "SE", currency: "SEK", defaultLocale: "sv-SE" }),
    ],
    seo: parseStoreSeo({}),
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

describe("refusing bad products", () => {
  it("explains what stops a product going on sale, and saves nothing", async () => {
    const result = await saveProduct(store, context, null, mug({ handle: "no-picture", media: [], manufacturer: null }));
    expect(result).toEqual({
      ok: false,
      problems: [
        "Add at least one picture before putting the product on sale.",
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
