import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { emptyGroup, newField, type FieldChanges, type FieldDef, type FieldGroupInput } from "@/lib/custom-fields";

import type { Membership } from "./auth";
import type { Store } from "./stores";

type Row = Record<string, unknown>;

vi.mock("next/cache", () => ({
  cacheLife: () => {},
  cacheTag: () => {},
  updateTag: () => {},
  revalidateTag: () => {},
  refresh: () => {},
}));

const fields = await import("./custom-fields");
const { getStore } = await import("./stores");

/**
 * Fields on variants and on categories and tags (D118, phase 2): which groups
 * they get, how they are kept and shown, and that they go with what they are on.
 */

const run = Date.now().toString(36);
let store: Store;
let member: Membership;
let product: { id: string; kind: string };
let variants: string[];
let category: string;
let tag: string;

beforeAll(async () => {
  const name = `entities-${run}`;
  const [request] = await db().execute<Row>(
    sql`insert into commerce.access_requests (email, name, store_name) values (${`${name}@example.com`}, 'F', 'Enheter') returning id`,
  );
  await db().execute<Row>(
    sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${name}, 'Enheter', null)`,
  );
  const [owner] = await db().execute<Row>(
    sql`select id, email from commerce.accounts where email = ${`${name}@example.com`}`,
  );
  await db().execute(sql`update commerce.stores set locales = array['nb-NO', 'sv-SE'], features = features || array['countries', 'languages', 'currencies'] where slug = ${name}`);
  store = (await getStore(name))!;
  member = {
    account: { id: String(owner.id), email: String(owner.email), name: "F", platformAdmin: false },
    role: "owner",
    store,
  } as Membership;
  const [mine] = await db().execute<Row>(sql`
    select p.id, p.kind from commerce.products p
    where p.store_id = ${store.id}::uuid and p.status = 'active'
      and (select count(*) from commerce.product_variants v where v.product_id = p.id and v.active) >= 1
    order by (select count(*) from commerce.product_variants v where v.product_id = p.id and v.active) desc, p.handle limit 1`);
  product = { id: String(mine.id), kind: String(mine.kind) };
  variants = (
    await db().execute<Row>(
      sql`select id from commerce.product_variants where product_id = ${product.id}::uuid and active order by sku`,
    )
  ).map((r) => String(r.id));
  const term = async (kind: string, label: string, slug: string) =>
    String(
      (
        await db().execute<Row>(
          sql`insert into commerce.terms (store_id, content_type, kind, name, slug) values (${store.id}::uuid, 'product', ${kind}, ${label}, ${slug}) returning id`,
        )
      )[0].id,
    );
  category = await term("category", "Kjøkken", "kjokken");
  tag = await term("tag", "Nytt", "nytt");
});

afterAll(async () => {
  await closeDb();
});

const pub = (over: Partial<FieldDef> & { type: FieldDef["type"] }): FieldDef => ({
  ...newField(over.type),
  access: "public",
  ...over,
});
const saveGroup = async (input: Partial<FieldGroupInput> & { fields: FieldDef[] }) => {
  const result = await fields.saveFieldGroup(member, {
    ...emptyGroup(),
    name: "G",
    slug: `g-${Math.random().toString(36).slice(2, 8)}`,
    ...input,
  });
  expect(result, JSON.stringify(result)).toMatchObject({ ok: true });
};

describe("a variant's fields", () => {
  const note = pub({ type: "text", name: "note", label: "Note" });
  const weight = pub({ type: "number", name: "weight", label: "Weight" });

  beforeAll(async () => {
    await saveGroup({ name: "Variant facts", slug: "variant-facts", entities: ["variant"], fields: [note, weight] });
  });

  it("apply by what the product is, and follow the product's category rules", async () => {
    const facts = await fields.variantFacts(db(), store.id, variants[0]);
    expect(facts).toMatchObject({ entity: "variant", kind: product.kind });
    expect(await fields.variantFacts(db(), store.id, crypto.randomUUID())).toBeNull();
    const groups = await fields.activeFieldGroups(store.id, "variant");
    expect(groups.map((g) => g.slug)).toContain("variant-facts");
    expect((await fields.activeFieldGroups(store.id, "product")).map((g) => g.slug)).not.toContain("variant-facts");
  });

  it("are kept per variant and shown for the product, only for variants that have some", async () => {
    const facts = (await fields.variantFacts(db(), store.id, variants[0]))!;
    const changes: FieldChanges = {
      values: { [weight.id]: 250 },
      translations: { "nb-NO": { [note.id]: "Rød" }, "sv-SE": { [note.id]: "Röd" } },
    } as never;
    const problems = await db().transaction((tx) =>
      fields.saveFieldData(tx, store.id, "variant", variants[0], changes, {
        facts,
        locales: ["nb-NO", "sv-SE"],
        main: "nb-NO",
        requireAll: false,
      }),
    );
    expect(problems).toEqual([]);

    const shown = await fields.shownFieldsForVariants(store.id, product.id, "sv-SE", "sv", "se");
    expect(Object.keys(shown)).toEqual([variants[0]]);
    const texts = shown[variants[0]].flatMap((g) => g.fields.map((f) => [f.label, f.text]));
    expect(texts).toEqual([
      ["Note", "Röd"],
      ["Weight", expect.stringContaining("250")],
    ]);
  });

  it("go with the variant when it is deleted", async () => {
    const [row] = await db().execute<Row>(
      sql`select count(*)::int as n from commerce.field_values where store_id = ${store.id}::uuid and entity = 'variant' and entity_id = ${variants[0]}::uuid`,
    );
    expect(Number(row.n)).toBeGreaterThan(0);
    // A variant with an order or stock cannot be deleted; a scratch one can.
    const [scratch] = await db().execute<Row>(sql`
      insert into commerce.product_variants (store_id, product_id, sku, options)
      select store_id, product_id, ${`scratch-${run}`}, '{}'::jsonb from commerce.product_variants where id = ${variants[0]}::uuid returning id`);
    const id = String(scratch.id);
    await db().execute(
      sql`insert into commerce.field_values (store_id, entity, entity_id, locale, values) values (${store.id}::uuid, 'variant', ${id}::uuid, '', '{"x": 1}')`,
    );
    await db().execute(sql`delete from commerce.product_variants where id = ${id}::uuid`);
    const [gone] = await db().execute<Row>(
      sql`select count(*)::int as n from commerce.field_values where entity_id = ${id}::uuid`,
    );
    expect(Number(gone.n)).toBe(0);
  });
});

describe("a category's and a tag's fields", () => {
  const intro = pub({ type: "text", name: "intro", label: "Intro" });
  const perks = pub({ type: "text", name: "perks", label: "Perks" });

  beforeAll(async () => {
    await saveGroup({
      name: "Category facts",
      slug: "category-facts",
      entities: ["term"],
      location: [[{ param: "termKind", operator: "==", value: "category" }]],
      fields: [intro],
    });
    await saveGroup({ name: "All terms", slug: "all-terms", entities: ["term"], fields: [perks] });
  });

  it("apply by whether it is a category or a tag", async () => {
    const categoryFacts = (await fields.termRuleFacts(db(), store.id, category))!;
    const tagFacts = (await fields.termRuleFacts(db(), store.id, tag))!;
    expect(categoryFacts).toMatchObject({ entity: "term", termKind: "category", content: "product" });
    const groups = await fields.activeFieldGroups(store.id, "term");
    const { groupApplies } = await import("@/lib/custom-fields");
    expect(groups.filter((g) => groupApplies(g, categoryFacts)).map((g) => g.slug)).toEqual([
      "category-facts",
      "all-terms",
    ]);
    expect(groups.filter((g) => groupApplies(g, tagFacts)).map((g) => g.slug)).toEqual(["all-terms"]);
  });

  it("are saved for the store's own terms only, and shown in the shopper's language", async () => {
    const changes = {
      values: {},
      translations: { "nb-NO": { [intro.id]: "Alt til kjøkkenet" }, "sv-SE": { [intro.id]: "Allt för köket" } },
    };
    expect(await fields.saveTermFields(member, category, changes)).toEqual({ ok: true });
    const shown = await fields.shownFieldsFor(store.id, "term", category, "sv-SE", "sv", "se");
    expect(shown.flatMap((g) => g.fields.map((f) => f.text))).toEqual(["Allt för köket"]);

    // Another store's term, or one that is not there, is refused.
    const [otherRequest] = await db().execute<Row>(
      sql`insert into commerce.access_requests (email, name, store_name) values (${`ent2-${run}@example.com`}, 'F', 'Annen') returning id`,
    );
    await db().execute<Row>(
      sql`select commerce.approve_access_request(${String(otherRequest.id)}::uuid, ${`entities-other-${run}`}, 'Annen', null)`,
    );
    const other = (await getStore(`entities-other-${run}`))!;
    const [foreign] = await db().execute<Row>(
      sql`insert into commerce.terms (store_id, content_type, kind, name, slug) values (${other.id}::uuid, 'product', 'category', 'X', 'x') returning id`,
    );
    expect(await fields.saveTermFields(member, String(foreign.id), changes)).toMatchObject({ ok: false });
    expect(await fields.saveTermFields(member, crypto.randomUUID(), changes)).toMatchObject({ ok: false });
  });

  it("go with the term when it is deleted", async () => {
    await db().execute(sql`delete from commerce.terms where id = ${category}::uuid`);
    const [gone] = await db().execute<Row>(
      sql`select count(*)::int as n from commerce.field_values where entity = 'term' and entity_id = ${category}::uuid`,
    );
    expect(Number(gone.n)).toBe(0);
  });
});
