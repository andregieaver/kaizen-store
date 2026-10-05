import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { parseCsv } from "@/lib/csv";
import { emptyGroup, newField, type FieldDef, type FieldGroupInput } from "@/lib/custom-fields";
import { productInput, type ProductInput } from "@/lib/product-input";

import type { Membership } from "./auth";
import { addSwedish, depsWith, fakeStorage, importThrough, itemsOf, membersOf, rowsOfCsv } from "./data-test-support";
import { makeStore, type Fixture } from "./invoice-test-fixture";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));

const jobs = await import("./data-jobs");
const fields = await import("./custom-fields");
const { getEditorContext, emptyProduct, saveProduct } = await import("./products");
const { getStore } = await import("./stores");

type Row = Record<string, unknown>;

/**
 * Export, then import, changes nothing (D165, `docs/wave-2-data.md` 4.1.3, 6.1 criterion 3, 6.3 criterion 1): every product is `unchanged`, no `prices` row
 * is added, no `updated_at` moves, the custom field values (the plain ones through the file, a rich text untouched) are as they were, and a store whose
 * texts start with every character a spreadsheet runs as a formula goes out escaped and comes back equal.
 */

let fx: Fixture;
let members: Awaited<ReturnType<typeof membersOf>>;
let owner: Membership;

const text = (name: string, over: Partial<FieldDef> = {}): FieldDef => ({ ...newField("text", []), name, label: name, access: "public", ...over });
const group = (over: Partial<FieldGroupInput> & { fields?: FieldDef[] } = {}): FieldGroupInput => ({ ...emptyGroup(), name: "Details", slug: "details", ...over });

let subtitle: FieldDef;
let months: FieldDef;
let blurb: FieldDef;
let batch: FieldDef;

async function product(over: Record<string, unknown>, fieldChanges?: unknown, variantFields?: unknown): Promise<string> {
  const store = (await getStore(fx.slug))!;
  const ctx = await getEditorContext(store);
  const base = emptyProduct(ctx);
  const input: ProductInput = productInput.parse({ ...base, ...over });
  const saved = await saveProduct(store, ctx, null, input, fieldChanges, variantFields);
  if (!saved.ok) throw new Error(saved.problems.join(" "));
  return saved.productId;
}

const variant = (sku: string, o: Record<string, unknown> = {}) => ({
  id: null,
  options: {},
  sku,
  gtin: null,
  measure: null,
  prices: { NO: "199" },
  cost: "",
  stock: 3,
  active: true,
  weightGrams: null,
  hsCode: null,
  originCountry: null,
  delivery: "physical",
  rentalPeriod: "day",
  image: null,
  ...o,
});

beforeAll(async () => {
  fx = await makeStore("rtrip");
  members = await membersOf(fx);
  owner = members.owner;
  await addSwedish(fx);
  owner = { ...owner, store: (await getStore(fx.slug))! };
  subtitle = text("subtitle");
  months = { ...newField("number", []), name: "months", label: "Months", access: "public", min: 0 };
  blurb = { ...newField("richText", []), name: "blurb", label: "Blurb", access: "public" };
  batch = text("batch");
  expect(await fields.saveFieldGroup(owner, group({ fields: [subtitle, months, blurb] }))).toMatchObject({ ok: true });
  expect(await fields.saveFieldGroup(owner, group({ name: "Batches", slug: "batches", entities: ["variant"], fields: [batch] }))).toMatchObject({ ok: true });
  const doc = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Handmade in Norway" }] }] };
  const [lamp] = await db().execute<Row>(sql`select 1 as x`);
  void lamp;
  const category = (await db().execute<Row>(sql`insert into commerce.terms (store_id, content_type, kind, name, slug) values (${fx.storeId}::uuid, 'product', 'category', 'Home', 'home') returning id`))[0];
  const child = (await db().execute<Row>(sql`insert into commerce.terms (store_id, content_type, kind, parent_id, name, slug) values (${fx.storeId}::uuid, 'product', 'category', ${String(category.id)}::uuid, 'Lighting', 'lighting') returning id`))[0];
  const tag = (await db().execute<Row>(sql`insert into commerce.terms (store_id, content_type, kind, name, slug) values (${fx.storeId}::uuid, 'product', 'tag', 'handmade', 'handmade') returning id`))[0];
  await product(
    {
      handle: "rt-lamp",
      status: "active",
      translations: [
        { locale: "nb-NO", title: "Lampe", description: "En fin lampe,\nmed to linjer.", safetyInformation: "Varm.", seoTitle: "Lampe SEO", seoDescription: "Om lampen" },
        { locale: "sv-SE", title: "Lampa", description: "En fin lampa.", safetyInformation: "", seoTitle: "", seoDescription: "" },
      ],
      media: [
        { url: "/demo/lamp.webp", thumbnailUrl: null, alt: "En lampe" },
        { url: "/demo/lamp-2.webp", thumbnailUrl: null, alt: "" },
        { url: "/demo/lamp-3.webp", thumbnailUrl: null, alt: "Fra siden" },
      ],
      options: [{ name: "Size", values: ["S", "M"] }],
      variants: [
        variant("RT-LAMP-S", { options: { Size: "S" }, gtin: "1234567890123", prices: { NO: "199", SE: "249,50" }, cost: "80", stock: 5, weightGrams: 500, hsCode: "940540", originCountry: "CN", measure: { amount: "1", unit: "piece", base: null } }),
        variant("RT-LAMP-M", { options: { Size: "M" }, prices: { NO: "249" }, stock: 0 }),
      ],
      categories: [String(child.id)],
      tags: [String(tag.id)],
    },
    {
      values: { [months.id]: 12 },
      translations: { "nb-NO": { [subtitle.id]: "Undertittel", [blurb.id]: doc }, "sv-SE": { [subtitle.id]: "Undertitel" } },
    },
    { "RT-LAMP-S": { values: {}, translations: { "nb-NO": { [batch.id]: "B-1" } } } },
  );
  await product({ handle: "rt-mug", status: "draft", translations: [{ locale: "nb-NO", title: "Kopp", description: "", safetyInformation: "", seoTitle: "", seoDescription: "" }, { locale: "sv-SE", title: "", description: "", safetyInformation: "", seoTitle: "", seoDescription: "" }], variants: [variant("RT-MUG", { prices: { NO: "99" } })] });
  // An archived product, and a variant that is switched off.
  const archived = await product({ handle: "rt-old", status: "draft", translations: [{ locale: "nb-NO", title: "Gammel", description: "", safetyInformation: "", seoTitle: "", seoDescription: "" }, { locale: "sv-SE", title: "", description: "", safetyInformation: "", seoTitle: "", seoDescription: "" }], options: [{ name: "Colour", values: ["Red", "Blue"] }], variants: [variant("RT-OLD-R", { options: { Colour: "Red" } }), variant("RT-OLD-B", { options: { Colour: "Blue" }, active: false })] });
  await db().execute(sql`update commerce.products set status = 'archived' where id = ${archived}::uuid`);
});

afterAll(async () => {
  await closeDb();
});

const snapshot = async (storeId: string) => ({
  products: (await db().execute<Row>(sql`select handle, status, updated_at::text as at from commerce.products where store_id = ${storeId}::uuid order by handle`)).map((r) => `${r.handle}|${r.status}|${r.at}`),
  prices: Number((await db().execute<Row>(sql`select count(*)::int as n from commerce.prices where store_id = ${storeId}::uuid`))[0].n),
  fieldValues: (await db().execute<Row>(sql`select entity, locale, values::text as v from commerce.field_values where store_id = ${storeId}::uuid order by entity, locale, values::text`)).map((r) => `${r.entity}|${r.locale}|${r.v}`),
  variants: (await db().execute<Row>(sql`select sku, active, cost_minor from commerce.product_variants where store_id = ${storeId}::uuid order by sku`)).map((r) => `${r.sku}|${r.active}|${r.cost_minor}`),
  stock: (await db().execute<Row>(sql`select v.sku, l.on_hand from commerce.inventory_levels l join commerce.product_variants v on v.id = l.variant_id where l.store_id = ${storeId}::uuid order by v.sku`)).map((r) => `${r.sku}|${r.on_hand}`),
  media: (await db().execute<Row>(sql`select p.handle, m.url, m.position from commerce.product_media m join commerce.products p on p.id = m.product_id where m.store_id = ${storeId}::uuid order by p.handle, m.position`)).map((r) => `${r.handle}|${r.url}|${r.position}`),
});

describe("export then import", () => {
  it("changes nothing: every product unchanged, no price row added, no updated_at moved, no field value touched", async () => {
    const exported = await jobs.requestProductExport(owner, {});
    if (!exported.ok || exported.mode !== "file") throw new Error("file");
    // The file has the plain custom fields of products and variants, in both languages for the translatable one.
    const header = rowsOfCsv(exported.csv)[0];
    expect(header).toEqual(expect.arrayContaining(["field:subtitle", "field:subtitle:sv-SE", "field:months", "variant_field:batch", "title:sv-SE", "price:NO", "price:SE", "price_basis"]));
    // A rich text field is not a plain value: it is not in the file.
    expect(header.some((h) => h.includes("blurb"))).toBe(false);
    const before = await snapshot(fx.storeId);
    const storage = fakeStorage();
    const run = await importThrough(owner, storage, new TextEncoder().encode(exported.csv), {});
    const items = await itemsOf(run.jobId);
    const products = items.filter((i) => i.kind === "product");
    expect(products.map((i) => `${i.ref}:${i.outcome}`).sort(), JSON.stringify(items.flatMap((i) => i.messages))).toEqual(["rt-lamp:unchanged", "rt-mug:unchanged", "rt-old:unchanged"].concat(
      // Every other product of the store (the demo's) is in the file too.
      products.map((i) => i.ref).filter((r) => !String(r).startsWith("rt-")).map((r) => `${r}:unchanged`),
    ).sort());
    expect(run.dry).toMatchObject({ toCreate: 0, toUpdate: 0, withProblems: 0 });
    const counts = run.applied?.counts as Record<string, number>;
    expect(counts).toMatchObject({ created: 0, updated: 0, drafted: 0, failed: 0, skipped: 0, pricesChanged: 0 });
    expect(counts.unchanged).toBe(products.length);
    const after = await snapshot(fx.storeId);
    expect(after).toEqual(before);
    // Nothing was written: no entry per product in the activity log, only the job's two.
    expect((await db().execute<Row>(sql`select action from commerce.audit_log where store_id = ${fx.storeId}::uuid and action in ('product.updated', 'product.created')`)).length).toBe(0);
  });

  it("is the same through the Excel (Nordic) dialect: semicolons, decimal commas and a byte order mark are read back", async () => {
    const exported = await jobs.requestProductExport(owner, { dialect: "excel_nordic" });
    if (!exported.ok || exported.mode !== "file") throw new Error("file");
    expect(exported.csv.charCodeAt(0)).toBe(0xfeff);
    expect(exported.csv.split("\r\n")[0]).toContain(";");
    const before = await snapshot(fx.storeId);
    const run = await importThrough(owner, fakeStorage(), new TextEncoder().encode(exported.csv), {});
    expect(run.dry).toMatchObject({ toCreate: 0, toUpdate: 0 });
    expect(await snapshot(fx.storeId)).toEqual(before);
  });

  it("keeps an archived product archived and a switched-off variant switched off", async () => {
    const exported = await jobs.requestProductExport(owner, {});
    if (!exported.ok || exported.mode !== "file") throw new Error("file");
    const rows = rowsOfCsv(exported.csv);
    const h = rows[0];
    const old = rows.filter((r) => r[h.indexOf("handle")] === "rt-old");
    expect(old[0][h.indexOf("status")]).toBe("archived");
    expect(old.map((r) => r[h.indexOf("active")])).toEqual(["true", "false"]);
    await importThrough(owner, fakeStorage(), new TextEncoder().encode(exported.csv), {});
    const [row] = await db().execute<Row>(sql`select status from commerce.products where store_id = ${fx.storeId}::uuid and handle = 'rt-old'`);
    expect(row.status).toBe("archived");
    const [v] = await db().execute<Row>(sql`select active from commerce.product_variants where store_id = ${fx.storeId}::uuid and sku = 'RT-OLD-B'`);
    expect(v.active).toBe(false);
  });

  it("applies a real change and only that one: a new price is one price row, the rest is as it was", async () => {
    const exported = await jobs.requestProductExport(owner, {});
    if (!exported.ok || exported.mode !== "file") throw new Error("file");
    const rows = rowsOfCsv(exported.csv);
    const h = rows[0];
    const lampS = rows.find((r) => r[h.indexOf("sku")] === "RT-LAMP-S")!;
    lampS[h.indexOf("price:NO")] = "219";
    lampS[h.indexOf("title")] = "Lampe, ny";
    const { writeCsv } = await import("@/lib/csv");
    const before = await snapshot(fx.storeId);
    const run = await importThrough(owner, fakeStorage(), new TextEncoder().encode(writeCsv(rows.map((r) => r.map((c) => c)))), {});
    expect(run.dry).toMatchObject({ toUpdate: 1, toCreate: 0 });
    expect(run.applied?.counts).toMatchObject({ updated: 1, pricesChanged: 1 });
    const after = await snapshot(fx.storeId);
    expect(after.prices).toBe(before.prices + 1);
    const [price] = await db().execute<Row>(sql`select c.amount_minor from commerce.current_prices c join commerce.product_variants v on v.id = c.variant_id where v.store_id = ${fx.storeId}::uuid and v.sku = 'RT-LAMP-S' and c.market_code = 'NO'`);
    expect(Number(price.amount_minor)).toBe(21900);
    expect(after.fieldValues).toEqual(before.fieldValues);
    // The rich text is untouched.
    expect(after.fieldValues.some((v) => v.includes("Handmade in Norway"))).toBe(true);
  });
});

describe("a store whose texts start with every character a spreadsheet runs", () => {
  let evil: Fixture;
  let evilOwner: Membership;

  beforeAll(async () => {
    evil = await makeStore("rtevil");
    await addSwedish(evil);
    evilOwner = { ...(await membersOf(evil)).owner, store: (await getStore(evil.slug))! };
    const note = text("note");
    expect(await fields.saveFieldGroup(evilOwner, { ...emptyGroup(), name: "Notes", slug: "notes", fields: [note] })).toMatchObject({ ok: true });
    const store = (await getStore(evil.slug))!;
    const ctx = await getEditorContext(store);
    const tag = (await db().execute<Row>(sql`insert into commerce.terms (store_id, content_type, kind, name, slug) values (${evil.storeId}::uuid, 'product', 'tag', '=tag', 'eq-tag') returning id`))[0];
    const cat = (await db().execute<Row>(sql`insert into commerce.terms (store_id, content_type, kind, name, slug) values (${evil.storeId}::uuid, 'product', 'category', '@Cat', 'at-cat') returning id`))[0];
    for (const [i, lead] of ["=", "+", "-", "@"].entries()) {
      const input = productInput.parse({
        ...emptyProduct(ctx),
        handle: `evil-${i}`,
        status: "draft",
        translations: [
          { locale: "nb-NO", title: `${lead}1+1 tittel`, description: `${lead}SUM(A1)\n\tinnrykk, "sitat"; semikolon`, safetyInformation: `${lead}HYPERLINK("x")`, seoTitle: `${lead}seo`, seoDescription: `${lead}seod` },
          { locale: "sv-SE", title: `${lead}svensk`, description: "", safetyInformation: "", seoTitle: "", seoDescription: "" },
        ],
        media: [{ url: "/demo/e.webp", thumbnailUrl: null, alt: `${lead}alt` }],
        options: [{ name: `${lead}Opt`, values: [`${lead}A`, `${lead}B`] }],
        variants: [variant(`${lead}SKU-${i}-A`, { options: { [`${lead}Opt`]: `${lead}A` } }), variant(`${lead}SKU-${i}-B`, { options: { [`${lead}Opt`]: `${lead}B` } })],
        categories: [String(cat.id)],
        tags: [String(tag.id)],
      });
      const saved = await saveProduct(store, ctx, null, input, { values: {}, translations: { "nb-NO": { [note.id]: `${lead}formula` } } });
      if (!saved.ok) throw new Error(saved.problems.join(" "));
    }
  });

  it("writes no cell that starts unescaped with = + - @ tab, CR or LF, and reads them all back equal", async () => {
    const exported = await jobs.requestProductExport(evilOwner, {});
    if (!exported.ok || exported.mode !== "file") throw new Error("file");
    // The raw cells, as a spreadsheet would see them.
    const raw = parseCsv(exported.csv).rows;
    const offending = raw.flatMap((r, i) => r.flatMap((c, j) => (/^[=+\-@\t\r\n]/.test(c) && !/^-?\d+([.,]\d+)?$/.test(c) ? [`${i}:${j}:${c}`] : [])));
    expect(offending).toEqual([]);
    expect(exported.csv).toContain("'=1+1 tittel");
    expect(exported.csv).toContain("'@Cat");
    const before = await snapshot(evil.storeId);
    const run = await importThrough(evilOwner, fakeStorage(), new TextEncoder().encode(exported.csv), {});
    expect(run.dry, JSON.stringify((await itemsOf(run.jobId)).flatMap((i) => i.messages))).toMatchObject({ toCreate: 0, toUpdate: 0, withProblems: 0 });
    expect(run.applied?.counts).toMatchObject({ created: 0, updated: 0, failed: 0 });
    expect(await snapshot(evil.storeId)).toEqual(before);
  });

  it("holds in the Excel (Nordic) dialect too", async () => {
    const exported = await jobs.requestProductExport(evilOwner, { dialect: "excel_nordic" });
    if (!exported.ok || exported.mode !== "file") throw new Error("file");
    const raw = parseCsv(exported.csv, { delimiter: ";" }).rows;
    expect(raw.flatMap((r) => r.filter((c) => /^[=+\-@\t\r\n]/.test(c) && !/^-?\d+([.,]\d+)?$/.test(c)))).toEqual([]);
    const run = await importThrough(evilOwner, fakeStorage(), new TextEncoder().encode(exported.csv), {});
    expect(run.dry).toMatchObject({ toCreate: 0, toUpdate: 0, withProblems: 0 });
  });
});

void depsWith;
