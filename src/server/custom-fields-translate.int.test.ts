import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { emptyGroup, newField, newRowId, type FieldDef } from "@/lib/custom-fields";
import type { RichTextDoc } from "@/lib/page-content";

import type { Membership } from "./auth";
import type { Store } from "./stores";

type Row = Record<string, unknown>;

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({
  cacheLife: () => {},
  cacheTag: () => {},
  updateTag: () => {},
  revalidateTag: () => {},
  refresh: () => {},
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
  headers: async () => new Headers(),
}));

const fields = await import("./custom-fields");
const translate = await import("./store-translate");
const { getStore } = await import("./stores");

/**
 * Custom fields in the store's translation worklist (D110, D118): the labels of
 * a group's definition and the texts entered in a product's or page's fields,
 * from listing them to reading them back in the other language on the site.
 */

const run = Date.now().toString(36);
const slug = `ftr-${run}`;
let store: Store;
let member: Membership;
let productId: string;
let page: { id: string };
let legalPage: { id: string };

const doc = (...texts: string[]): RichTextDoc =>
  ({
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: texts.map((text, i) => ({ type: "text", text, ...(i % 2 === 1 && { marks: [{ type: "bold" }] }) })),
      },
    ],
  }) as RichTextDoc;

const pub = (over: Partial<FieldDef> & { type: FieldDef["type"] }): FieldDef => ({
  ...newField(over.type),
  access: "public",
  ...over,
});
const material = pub({
  type: "select",
  name: "material",
  label: "Materiale",
  choices: [
    { key: "ull", label: "Ull" },
    { key: "bomull", label: "Bomull" },
  ],
});
const title = pub({ type: "text", name: "tittel", label: "Tittel" });
const about = pub({ type: "richText", name: "om", label: "Om produktet" });
const cell = { ...newField("text"), name: "stoff", label: "Stoff" };
const list = pub({
  type: "repeater",
  name: "innhold",
  label: "Innhold",
  subFields: [cell],
  maxRows: 5,
  buttonLabel: "Legg til",
});
const secret = pub({ type: "text", name: "intern", label: "Internt", access: "private" });
const r1 = newRowId();
const r2 = newRowId();

async function asMember(): Promise<Membership> {
  return { ...member, store: (await getStore(slug))! };
}

const write = async (entity: "product" | "page", entityId: string, raw: unknown) => {
  const facts =
    entity === "product"
      ? await fields.productFacts(db(), store.id, entityId)
      : await fields.pageFacts(db(), store.id, entityId, "draft");
  return db().transaction((tx) =>
    fields.saveFieldData(tx, store.id, entity, entityId, raw, {
      facts: facts!,
      locales: ["nb-NO", "sv-SE"],
      main: "nb-NO",
      requireAll: false,
    }),
  );
};

const nbTexts = (rows: [string, string][]) => ({
  values: { [material.id]: "ull", [list.id]: rows.map(([id]) => ({ id })) },
  translations: {
    "nb-NO": {
      [title.id]: "Ullgenser",
      [about.id]: doc("Varm ", "og myk"),
      [secret.id]: "Intern notat",
      [list.id]: Object.fromEntries(rows.map(([id, text]) => [id, { [cell.id]: text }])),
    },
  },
});

beforeAll(async () => {
  const [request] = await db().execute<Row>(
    sql`insert into commerce.access_requests (email, name, store_name) values (${`${slug}@example.com`}, 'F', 'Felt') returning id`,
  );
  await db().execute<Row>(
    sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${slug}, 'Felt', null)`,
  );
  await db().execute(sql`update commerce.stores set locales = array['nb-NO', 'sv-SE'], features = features || array['countries', 'languages', 'currencies'] where slug = ${slug}`);
  store = (await getStore(slug))!;
  const [owner] = await db().execute<Row>(
    sql`select id, email from commerce.accounts where email = ${`${slug}@example.com`}`,
  );
  member = {
    account: { id: String(owner.id), email: String(owner.email), name: "F", platformAdmin: false },
    role: "owner",
    store,
  };
  const [mine] = await db().execute<Row>(
    sql`select id from commerce.products where store_id = ${store.id}::uuid and status = 'active' order by handle limit 1`,
  );
  productId = String(mine.id);
  const insertPage = async (pageSlug: string, pageTitle: string) => {
    const [p] = await db().execute<Row>(sql`
      insert into commerce.pages (store_id, slug, draft, published, published_at)
      values (${store.id}::uuid, ${pageSlug}, ${JSON.stringify({ title: pageTitle, categories: [], tags: [] })}::jsonb, '{}', now()) returning id`);
    return { id: String(p.id) };
  };
  page = await insertPage(`om-${run}`, "Om oss");
  legalPage = await insertPage(`vilkar-${run}`, "Kjøpsvilkår");

  const saved = await fields.saveFieldGroup(member, {
    ...emptyGroup(),
    name: "Detaljer",
    slug: "detaljer",
    entities: ["product", "page"],
    fields: [material, title, about, list, secret],
  });
  expect(saved, JSON.stringify(saved)).toMatchObject({ ok: true });
  expect(
    await write(
      "product",
      productId,
      nbTexts([
        [r1, "Protein"],
        [r2, "Salt"],
      ]),
    ),
  ).toEqual([]);
  expect(await write("page", page.id, nbTexts([[r1, "Sider"]]))).toEqual([]);
  expect(await write("page", legalPage.id, nbTexts([[r1, "Vilkår"]]))).toEqual([]);
});

afterAll(async () => {
  await db().execute(sql`delete from commerce.field_values where store_id = ${store.id}::uuid`);
  await db().execute(sql`delete from commerce.field_groups where store_id = ${store.id}::uuid`);
  await db().execute(
    sql`delete from commerce.pages where store_id = ${store.id}::uuid and id in (${page.id}::uuid, ${legalPage.id}::uuid)`,
  );
  await closeDb();
});

const groupUnit = async (mode: "missing" | "all" = "missing") => {
  const { units } = await translate.translationWorklist(await asMember(), "sv-SE", ["fields"], mode, null);
  return units;
};

describe("the worklist of custom fields", () => {
  it("lists the group's labels and each thing's texts, public fields only, and the legal page as legal", async () => {
    const units = await groupUnit();
    expect(units.every((u) => u.scope === "fields")).toBe(true);

    const definitions = units.find((u) => u.id.startsWith("fielddef:"))!;
    expect(definitions.title).toBe("Detaljer");
    expect(definitions.legal).toBe(false);
    const keys = definitions.items.map((i) => i.key);
    expect(keys).toEqual(
      expect.arrayContaining([
        `${material.id}.label`,
        `${material.id}.choice.ull`,
        `${material.id}.choice.bomull`,
        `${title.id}.label`,
        `${list.id}.label`,
        `${cell.id}.label`,
      ]),
    );
    expect(keys.some((k) => k.startsWith(secret.id))).toBe(false);

    const product = units.find((u) => u.id === `fieldval:product:${productId}`)!;
    expect(product.kind).toBe("Product fields");
    expect(product.legal).toBe(false);
    expect(product.items.map((i) => i.key)).toEqual([
      title.id,
      about.id,
      `${list.id}.${r1}.${cell.id}`,
      `${list.id}.${r2}.${cell.id}`,
    ]);
    expect(product.items.find((i) => i.key === about.id)).toMatchObject({ rich: true, runs: ["Varm ", "og myk"] });

    expect(units.find((u) => u.id === `fieldval:page:${page.id}`)?.legal).toBe(false);
    expect(units.find((u) => u.id === `fieldval:page:${legalPage.id}`)?.legal).toBe(true);
    // Counted with the store's other scopes.
    expect((await translate.translationCoverage(await asMember()))["sv-SE"].fields).toBe(units.length);
  });

  it("is empty for the store's scopes that were not asked for, and skips groups switched off", async () => {
    const { units } = await translate.translationWorklist(await asMember(), "sv-SE", ["menus"], "missing", null);
    expect(units.some((u) => u.scope === "fields")).toBe(false);
    await db().execute(sql`update commerce.field_groups set active = false where store_id = ${store.id}::uuid`);
    expect(await groupUnit()).toEqual([]);
    await db().execute(sql`update commerce.field_groups set active = true where store_id = ${store.id}::uuid`);
  });
});

describe("saving what staff accepted", () => {
  it("writes labels into the definition and texts into the values, and the shopper reads them in Swedish", async () => {
    const m = await asMember();
    const units = await groupUnit();
    const definitions = units.find((u) => u.id.startsWith("fielddef:"))!;
    const [groupBefore] = await db().execute<Row>(
      sql`select * from commerce.field_groups where store_id = ${store.id}::uuid`,
    );

    const result = await translate.applyTranslations(m, "sv-SE", [
      {
        unitId: definitions.id,
        values: {
          [`${material.id}.label`]: "Material",
          [`${material.id}.choice.ull`]: "Ull",
          [`${material.id}.choice.bomull`]: "Bomull",
          [`${list.id}.label`]: "Innehåll",
          [`${secret.id}.label`]: "Should not be written",
        },
      },
      {
        unitId: `fieldval:product:${productId}`,
        values: {
          [title.id]: "Ulltröja",
          [about.id]: ["Varm ", "och len"],
          [`${list.id}.${r2}.${cell.id}`]: "Salt (sv)",
          bogus: "not asked for",
        },
      },
    ]);
    expect(result).toMatchObject({ ok: true, saved: 2, skipped: [] });

    // The definition changed only by labels in the language, and the private field not at all.
    const [groupAfter] = await db().execute<Row>(
      sql`select * from commerce.field_groups where store_id = ${store.id}::uuid`,
    );
    expect({ ...groupAfter, fields: undefined, updated_at: undefined }).toEqual({
      ...groupBefore,
      fields: undefined,
      updated_at: undefined,
    });
    const defs = groupAfter.fields as FieldDef[];
    expect(defs.find((f) => f.id === material.id)).toMatchObject({
      label: "Materiale",
      labels: { "sv-SE": "Material" },
    });
    expect(defs.find((f) => f.id === material.id)!.choices).toEqual([
      { key: "ull", label: "Ull", labels: { "sv-SE": "Ull" } },
      { key: "bomull", label: "Bomull", labels: { "sv-SE": "Bomull" } },
    ]);
    expect(defs.find((f) => f.id === secret.id)).toEqual(secret);
    expect(defs.find((f) => f.id === title.id)).toEqual(title);

    // Values: the language's own rows, the main language untouched.
    const data = await fields.getFieldData(store.id, "product", productId);
    expect(data.translations["nb-NO"]).toEqual(
      nbTexts([
        [r1, "Protein"],
        [r2, "Salt"],
      ]).translations["nb-NO"],
    );
    expect(data.translations["sv-SE"][title.id]).toBe("Ulltröja");
    expect(data.translations["sv-SE"][list.id]).toEqual({ [r2]: { [cell.id]: "Salt (sv)" } });
    expect(data.values[list.id]).toEqual([{ id: r1 }, { id: r2 }]);

    // What the shopper reads: Swedish where it exists, Norwegian for the rest; Norwegian is as it was.
    const sv = await fields.shownFieldsFor(store.id, "product", productId, "sv-SE", "sv", "se");
    const shown = sv[0].fields;
    expect(shown.find((f) => f.name === "tittel")!.text).toBe("Ulltröja");
    expect(shown.find((f) => f.name === "material")).toMatchObject({ label: "Material", text: "Ull" });
    expect(shown.find((f) => f.name === "om")!.text).toContain("Varm och len");
    const rows = shown.find((f) => f.name === "innhold")!;
    expect(rows.label).toBe("Innehåll");
    expect(rows.rows!.map((row) => row[0].text)).toEqual(["Protein", "Salt (sv)"]);
    const nb = await fields.shownFieldsFor(store.id, "product", productId, "nb-NO", "nb", "no");
    expect(nb[0].fields.find((f) => f.name === "tittel")).toMatchObject({ label: "Tittel", text: "Ullgenser" });
    expect(nb[0].fields.find((f) => f.name === "material")).toMatchObject({ label: "Materiale", text: "Ull" });
  });

  it("finds what is left, and everything again when asked", async () => {
    const missing = await groupUnit();
    const definitions = missing.find((u) => u.id.startsWith("fielddef:"))!;
    expect(definitions.items.map((i) => i.key)).not.toContain(`${material.id}.label`);
    expect(definitions.items.map((i) => i.key)).toContain(`${title.id}.label`);
    const product = missing.find((u) => u.id === `fieldval:product:${productId}`)!;
    expect(product.items.map((i) => i.key)).toEqual([`${list.id}.${r1}.${cell.id}`]);
    const all = await groupUnit("all");
    expect(all.find((u) => u.id === `fieldval:product:${productId}`)!.items.map((i) => i.key)).toContain(title.id);
  });

  it("leaves a thing that was not ticked as it was, and refuses what is too long or not asked for", async () => {
    const m = await asMember();
    const result = await translate.applyTranslations(m, "sv-SE", [
      { unitId: `fieldval:page:${page.id}`, values: { [title.id]: "x".repeat(600) } },
      { unitId: `fieldval:page:${crypto.randomUUID()}`, values: { [title.id]: "Nope" } },
      { unitId: `fielddef:${crypto.randomUUID()}`, values: { [`${title.id}.label`]: "Nope" } },
      {
        unitId: `fielddef:${(await db().execute<Row>(sql`select id from commerce.field_groups where store_id = ${store.id}::uuid`))[0].id}`,
        values: { [`${title.id}.label`]: "y".repeat(81) },
      },
    ]);
    expect(result).toMatchObject({ ok: true, saved: 0 });
    expect((result as { skipped: string[] }).skipped).toHaveLength(4);
    const data = await fields.getFieldData(store.id, "page", page.id);
    expect(data.translations["sv-SE"]).toBeUndefined();
    const legal = await fields.getFieldData(store.id, "page", legalPage.id);
    expect(legal.translations["sv-SE"]).toBeUndefined();
  });

  it("writes a rich text with the same runs and a page's own value, and refuses a language the store lacks", async () => {
    const m = await asMember();
    expect(
      await translate.applyTranslations(m, "fr-FR", [
        { unitId: `fieldval:page:${page.id}`, values: { [title.id]: "Bonjour" } },
      ]),
    ).toMatchObject({ ok: false });
    const result = await translate.applyTranslations(m, "sv-SE", [
      { unitId: `fieldval:page:${page.id}`, values: { [title.id]: "Om oss (sv)", [about.id]: ["Varm och mjuk"] } },
    ]);
    // The rich text came back split differently, so only the title is kept.
    expect(result).toMatchObject({ ok: true, saved: 1 });
    const data = await fields.getFieldData(store.id, "page", page.id);
    expect(data.translations["sv-SE"]).toEqual({ [title.id]: "Om oss (sv)" });
    expect(data.translations["nb-NO"]).toEqual(nbTexts([[r1, "Sider"]]).translations["nb-NO"]);
  });
});

describe("fields on variants and on categories and tags", () => {
  const vnote = pub({ type: "text", name: "merknad", label: "Merknad" });
  const vhidden = pub({ type: "text", name: "lager", label: "Lagerhylle", access: "private" });
  const intro = pub({ type: "text", name: "ingress", label: "Ingress" });
  const scratchSku = `ftr-scratch-${run}`;
  let variantId: string;
  let inactiveVariantId: string;
  let variantLabel: string;
  let categoryId: string;
  let bareCategoryId: string;
  let tagId: string;

  const facts = (entity: "variant" | "term", id: string) =>
    entity === "variant" ? fields.variantFacts(db(), store.id, id) : fields.termRuleFacts(db(), store.id, id);
  const writeOne = async (entity: "variant" | "term", id: string, raw: unknown) =>
    db().transaction(async (tx) =>
      fields.saveFieldData(tx, store.id, entity, id, raw, {
        facts: (await facts(entity, id))!,
        locales: ["nb-NO", "sv-SE"],
        main: "nb-NO",
        requireAll: false,
      }),
    );
  const newTerm = async (kind: string, name: string, termSlug: string) =>
    String(
      (
        await db().execute<Row>(sql`
          insert into commerce.terms (store_id, content_type, kind, name, slug)
          values (${store.id}::uuid, 'product', ${kind}, ${name}, ${`${termSlug}-${run}`}) returning id`)
      )[0].id,
    );
  const ours = async (mode: "missing" | "all" = "missing") => {
    const { units } = await translate.translationWorklist(await asMember(), "sv-SE", ["fields"], mode, null);
    return units;
  };

  beforeAll(async () => {
    const [v] = await db().execute<Row>(sql`
      select v.id, v.sku, v.options, coalesce(nullif(t.title, ''), p.handle) as title
      from commerce.product_variants v join commerce.products p on p.id = v.product_id
      left join commerce.product_translations t on t.product_id = p.id and t.locale = 'nb-NO'
      where v.product_id = ${productId}::uuid and v.active order by v.sku limit 1`);
    variantId = String(v.id);
    const options = Object.values((v.options ?? {}) as Record<string, unknown>).filter(
      (o) => typeof o === "string" && o,
    );
    variantLabel = `${v.title} · ${v.sku}${options.length > 0 ? ` (${options.join(", ")})` : ""}`;
    const [scratch] = await db().execute<Row>(sql`
      insert into commerce.product_variants (store_id, product_id, sku, options, active)
      select store_id, product_id, ${scratchSku}, '{}'::jsonb, false from commerce.product_variants where id = ${variantId}::uuid
      returning id`);
    inactiveVariantId = String(scratch.id);
    categoryId = await newTerm("category", "Kjøpsvilkår", "vilkar-kat");
    bareCategoryId = await newTerm("category", "Uten tekst", "uten-tekst");
    tagId = await newTerm("tag", "Nytt", "nytt");

    for (const group of [
      { name: "Variantfelt", slug: "variantfelt", entities: ["variant"], fields: [vnote, vhidden] },
      {
        name: "Kategorifelt",
        slug: "kategorifelt",
        entities: ["term"],
        location: [[{ param: "termKind", operator: "==", value: "category" }]],
        fields: [intro],
      },
    ] as const) {
      const saved = await fields.saveFieldGroup(member, { ...emptyGroup(), ...group } as never);
      expect(saved, JSON.stringify(saved)).toMatchObject({ ok: true });
    }
    const nb = (values: Record<string, string>) => ({ values: {}, translations: { "nb-NO": values } });
    expect(await writeOne("variant", variantId, nb({ [vnote.id]: "Passer stort", [vhidden.id]: "Hylle 4" }))).toEqual(
      [],
    );
    expect(await writeOne("term", categoryId, nb({ [intro.id]: "Alt om vilkår" }))).toEqual([]);
    // Values of a thing the groups do not apply to, or one that is not sold, or one with no words in the main language.
    const raw = (entity: string, id: string, locale: string, values: object) =>
      db().execute(sql`
        insert into commerce.field_values (store_id, entity, entity_id, locale, values)
        values (${store.id}::uuid, ${entity}, ${id}::uuid, ${locale}, ${JSON.stringify(values)}::jsonb)`);
    await raw("term", tagId, "nb-NO", { [intro.id]: "Skal ikke oversettes" });
    await raw("variant", inactiveVariantId, "nb-NO", { [vnote.id]: "Ikke i salg" });
    await raw("term", bareCategoryId, "sv-SE", { [intro.id]: "Bara på svenska" });
  });

  afterAll(async () => {
    // The store's values and groups go in the outer afterAll; what these made besides goes here.
    await db().execute(
      sql`delete from commerce.field_values where store_id = ${store.id}::uuid and entity in ('variant', 'term')`,
    );
    await db().execute(
      sql`delete from commerce.terms where store_id = ${store.id}::uuid and id in (${categoryId}::uuid, ${bareCategoryId}::uuid, ${tagId}::uuid)`,
    );
    await db().execute(sql`delete from commerce.product_variants where id = ${inactiveVariantId}::uuid`);
  });

  it("lists a variant and a category with their public texts, and nothing that does not apply", async () => {
    const units = await ours();
    const variant = units.find((u) => u.id === `fieldval:variant:${variantId}`)!;
    expect(variant).toMatchObject({
      scope: "fields",
      kind: "Variant fields",
      legal: false,
      title: variantLabel.slice(0, 80),
    });
    expect(variant.items.map((i) => i.key)).toEqual([vnote.id]);
    expect(variant.items[0]).toMatchObject({ label: "Merknad", runs: ["Passer stort"], rich: false });
    // A term named like a legal page is not a legal text.
    const category = units.find((u) => u.id === `fieldval:term:${categoryId}`)!;
    expect(category).toMatchObject({ kind: "Category fields", title: "Kjøpsvilkår", legal: false });
    expect(category.items.map((i) => i.key)).toEqual([intro.id]);
    for (const id of [`term:${tagId}`, `variant:${inactiveVariantId}`, `term:${bareCategoryId}`])
      expect(units.map((u) => u.id)).not.toContain(`fieldval:${id}`);
    // The definitions of the new groups are there as well, and counted with the rest.
    const titles = units.filter((u) => u.id.startsWith("fielddef:")).map((u) => u.title);
    expect(titles).toEqual(expect.arrayContaining(["Variantfelt", "Kategorifelt"]));
    expect((await translate.translationCoverage(await asMember()))["sv-SE"].fields).toBe(units.length);
  });

  it("writes the accepted texts in the language only, and the shopper reads them on the product and the category", async () => {
    const m = await asMember();
    const result = await translate.applyTranslations(m, "sv-SE", [
      {
        unitId: `fieldval:variant:${variantId}`,
        values: { [vnote.id]: "Passar stor", [vhidden.id]: "No", bogus: "no" },
      },
      { unitId: `fieldval:term:${categoryId}`, values: { [intro.id]: "Allt om villkor" } },
    ]);
    expect(result).toMatchObject({ ok: true, saved: 2, skipped: [] });

    const variantData = await fields.getFieldData(store.id, "variant", variantId);
    expect(variantData.translations["nb-NO"]).toEqual({ [vnote.id]: "Passer stort", [vhidden.id]: "Hylle 4" });
    expect(variantData.translations["sv-SE"]).toEqual({ [vnote.id]: "Passar stor" });
    const termData = await fields.getFieldData(store.id, "term", categoryId);
    expect(termData.translations["nb-NO"]).toEqual({ [intro.id]: "Alt om vilkår" });
    expect(termData.translations["sv-SE"]).toEqual({ [intro.id]: "Allt om villkor" });

    const sv = await fields.shownFieldsForVariants(store.id, productId, "sv-SE", "sv", "se");
    expect(sv[variantId].flatMap((g) => g.fields.map((f) => [f.label, f.text]))).toEqual([["Merknad", "Passar stor"]]);
    const nb = await fields.shownFieldsForVariants(store.id, productId, "nb-NO", "nb", "no");
    expect(nb[variantId].flatMap((g) => g.fields.map((f) => f.text))).toEqual(["Passer stort"]);
    const svTerm = await fields.shownFieldsFor(store.id, "term", categoryId, "sv-SE", "sv", "se");
    expect(svTerm.flatMap((g) => g.fields.map((f) => [f.label, f.text]))).toEqual([["Ingress", "Allt om villkor"]]);
    const nbTerm = await fields.shownFieldsFor(store.id, "term", categoryId, "nb-NO", "nb", "no");
    expect(nbTerm.flatMap((g) => g.fields.map((f) => f.text))).toEqual(["Alt om vilkår"]);

    // Done: what is left is only what was not translated, and everything again when asked.
    const left = (await ours()).map((u) => u.id);
    expect(left).not.toContain(`fieldval:variant:${variantId}`);
    expect(left).not.toContain(`fieldval:term:${categoryId}`);
    expect((await ours("all")).map((u) => u.id)).toEqual(
      expect.arrayContaining([`fieldval:variant:${variantId}`, `fieldval:term:${categoryId}`]),
    );
  });

  it("refuses a thing that is gone, one the groups do not apply to, and a kind that is not one", async () => {
    const m = await asMember();
    const result = await translate.applyTranslations(m, "sv-SE", [
      { unitId: `fieldval:term:${tagId}`, values: { [intro.id]: "Nej" } },
      { unitId: `fieldval:variant:${inactiveVariantId}`, values: { [vnote.id]: "Nej" } },
      { unitId: `fieldval:variant:${crypto.randomUUID()}`, values: { [vnote.id]: "Nej" } },
      { unitId: `fieldval:term:${crypto.randomUUID()}`, values: { [intro.id]: "Nej" } },
    ]);
    expect(result).toMatchObject({ ok: true, saved: 0 });
    expect((result as { skipped: string[] }).skipped).toHaveLength(4);
    expect((await fields.getFieldData(store.id, "term", tagId)).translations["sv-SE"]).toBeUndefined();
    expect((await fields.getFieldData(store.id, "variant", inactiveVariantId)).translations["sv-SE"]).toBeUndefined();
  });
});
