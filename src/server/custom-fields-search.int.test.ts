import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { emptyGroup, newField, type FieldChanges, type FieldDef, type FieldGroupInput } from "@/lib/custom-fields";
import { NO_FILTERS, type ListingFilters } from "@/lib/listing-filters";
import { toMarket } from "@/lib/markets";

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

const fields = await import("./custom-fields");
const fieldSearch = await import("./field-search");
const listing = await import("./listing");
const search = await import("./search");
const { getStore } = await import("./stores");

/**
 * Custom fields in keyword search and in listing filters (D118): what a public
 * field flagged `search` adds to a product's words in each language, and how
 * fields flagged `filter` narrow and count a listing, on a real database.
 */

const run = Date.now().toString(36);
const no = toMarket({ code: "NO", currency: "NOK", defaultLocale: "nb-NO" });
const se = toMarket({ code: "SE", currency: "SEK", defaultLocale: "sv-SE" });
const viewer = { buyer: "private" as const, audienceBoth: false };
let store: Store;
let member: Membership;
let groupId: string;
const product = new Map<string, string>();
const handleOf = new Map<string, string>();

const pub = (over: Partial<FieldDef> & { type: FieldDef["type"] }): FieldDef => ({
  ...newField(over.type),
  access: "public",
  ...over,
});
const designer = pub({
  type: "text",
  name: "designer",
  label: "Designer",
  labels: { "sv-SE": "Designer (sv)" },
  search: true,
});
const material = pub({
  type: "select",
  name: "material",
  label: "Material",
  labels: { "sv-SE": "Material (sv)" },
  search: true,
  filter: true,
  choices: [
    { key: "wool", label: "Ull", labels: { "sv-SE": "Ylle" } },
    { key: "cotton", label: "Bomull", labels: { "sv-SE": "Bomullen" } },
  ],
});
const care = pub({
  type: "checkbox",
  name: "care",
  label: "Vask",
  filter: true,
  choices: [
    { key: "wash", label: "Maskinvask" },
    { key: "hand", label: "Håndvask" },
  ],
});
const organic = pub({ type: "boolean", name: "organic", label: "Økologisk", filter: true });
// Public but not flagged; and private, which can never be flagged.
const note = pub({ type: "text", name: "note", label: "Merknad" });
const secret = { ...newField("text"), name: "secret", label: "Hemmelig", access: "private" as const };

beforeAll(async () => {
  const [request] = await db().execute<Row>(sql`
    insert into commerce.access_requests (email, name, store_name) values (${`fsearch-${run}@example.com`}, 'F', 'Søk') returning id`);
  await db().execute(
    sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${`fsearch-${run}`}, 'Søk', null)`,
  );
  // A new store starts with the shop alone (D178): the demo appointment, stay and rental are offered with their features on, as an owner switches them under Features.
  await db().execute(sql`update commerce.stores set features = features || array['appointments', 'bookings']::text[] where slug = ${`fsearch-${run}`}`);
  const [owner] = await db().execute<Row>(
    sql`select id, email from commerce.accounts where email = ${`fsearch-${run}@example.com`}`,
  );
  await db().execute(
    sql`update commerce.stores set locales = array['nb-NO', 'sv-SE'] where slug = ${`fsearch-${run}`}`,
  );
  store = (await getStore(`fsearch-${run}`))!;
  member = {
    account: { id: String(owner.id), email: String(owner.email), name: "F", platformAdmin: false },
    role: "owner",
    store,
  } as Membership;
  const rows = await db().execute<Row>(
    sql`select id, handle from commerce.products where store_id = ${store.id}::uuid`,
  );
  for (const row of rows) {
    product.set(String(row.handle), String(row.id));
    handleOf.set(String(row.id), String(row.handle));
  }
  const saved = await fields.saveFieldGroup(member, {
    ...emptyGroup(),
    name: "Details",
    slug: "details",
    fields: [designer, material, care, organic, note, secret],
  } satisfies FieldGroupInput);
  expect(saved, JSON.stringify(saved)).toMatchObject({ ok: true });
  groupId = String((saved as { id: string }).id);
});

afterAll(async () => {
  // What this file made: the group, the values and the search texts (the store itself stays, as in the other files).
  await db().execute(sql`delete from commerce.field_search where store_id = ${store.id}::uuid`);
  await db().execute(sql`delete from commerce.field_values where store_id = ${store.id}::uuid`);
  await db().execute(sql`delete from commerce.field_groups where store_id = ${store.id}::uuid`);
  await closeDb();
});

const write = async (handle: string, raw: FieldChanges) => {
  const id = product.get(handle)!;
  const facts = await fields.productFacts(db(), store.id, id);
  return db().transaction((tx) =>
    fields.saveFieldData(tx, store.id, "product", id, raw, {
      facts: facts!,
      locales: ["nb-NO", "sv-SE"],
      main: "nb-NO",
      requireAll: false,
    }),
  );
};
const found = async (query: string, market = no, prefix = false) =>
  (await search.matchingIds({ storeId: store.id, market }, query, 20, prefix)).map((id) => handleOf.get(id));
const rowsOf = async (handle: string) =>
  db().execute<Row>(
    sql`select locale, body from commerce.field_search where store_id = ${store.id}::uuid and entity_id = ${product.get(handle)!}::uuid order by locale`,
  );
const listed = async (filters: Partial<ListingFilters>, market = no) =>
  (await listing.listingProducts(store.id, market, {}, { ...NO_FILTERS, ...filters }, viewer)).map((p) => p.handle);

describe("custom fields in keyword search", () => {
  it("keeps a text per language for the words of public fields flagged for search, in the same transaction as the values", async () => {
    const changes = {
      values: { [material.id]: "wool", [care.id]: ["wash"], [organic.id]: true },
      translations: {
        "nb-NO": { [designer.id]: "Kari Nordmann", [note.id]: "kjedeligord", [secret.id]: "hemmeligord" },
        "sv-SE": { [designer.id]: "Kari Svensson" },
      },
    } as FieldChanges;
    expect(await write("demo-keramikkopp", changes)).toEqual([]);
    expect(await write("demo-hytte", { values: { [material.id]: "cotton" }, translations: {} })).toEqual([]);
    // A language with no text of its own has the main language's, and a choice is its label in the language.
    expect(
      await write("demo-sykkelutleie", { values: {}, translations: { "nb-NO": { [designer.id]: "Voss Verksted" } } }),
    ).toEqual([]);

    expect(await rowsOf("demo-keramikkopp")).toEqual([
      { locale: "nb-NO", body: "Kari Nordmann Ull" },
      { locale: "sv-SE", body: "Kari Svensson Ylle" },
    ]);
    expect(await rowsOf("demo-sykkelutleie")).toEqual([
      { locale: "nb-NO", body: "Voss Verksted" },
      { locale: "sv-SE", body: "Voss Verksted" },
    ]);
  });

  it("finds a product by its fields' words in the market's language, and while typing", async () => {
    expect(await found("Nordmann")).toContain("demo-keramikkopp");
    expect(await found("Svensson", se)).toContain("demo-keramikkopp");
    // Each language has its own words.
    expect(await found("Nordmann", se)).not.toContain("demo-keramikkopp");
    expect(await found("Svensson")).not.toContain("demo-keramikkopp");
    // A choice by its label in the language.
    expect(await found("Ull")).toContain("demo-keramikkopp");
    expect(await found("Ylle", se)).toContain("demo-keramikkopp");
    expect(await found("Bomull")).toEqual(expect.arrayContaining(["demo-hytte"]));
    // A language without words of its own finds the main language's.
    expect(await found("Voss", se)).toContain("demo-sykkelutleie");
    expect(await found("Nord", no, true)).toContain("demo-keramikkopp");
    const suggested = await search.suggestProducts({ storeId: store.id, market: no }, "Nord");
    expect(suggested.map((s) => s.handle)).toContain("demo-keramikkopp");
  });

  it("does not search a private field or one that is not flagged, even when its definition is wrong", async () => {
    expect(await found("kjedeligord")).toEqual([]);
    expect(await found("hemmeligord")).toEqual([]);
    // The generator refuses to flag a private field ...
    const refused = await fields.saveFieldGroup(member, {
      ...emptyGroup(),
      name: "Bad",
      slug: "bad",
      fields: [{ ...secret, search: true }],
    } satisfies FieldGroupInput);
    expect(refused.ok).toBe(false);
    // ... and if one got the flag some other way, its words are still not kept.
    const flagged = [designer, material, care, organic, note, { ...secret, search: true }];
    await db().execute(
      sql`update commerce.field_groups set fields = ${JSON.stringify(flagged)}::jsonb where id = ${groupId}::uuid`,
    );
    await fieldSearch.refreshStoreFieldSearch(store.id);
    expect(await found("hemmeligord")).toEqual([]);
    expect(await found("Nordmann")).toContain("demo-keramikkopp");
    // The same for an unflagged public one turned on: it is found once it is flagged.
    await db().execute(
      sql`update commerce.field_groups set fields = ${JSON.stringify([designer, material, care, organic, { ...note, search: true }, secret])}::jsonb where id = ${groupId}::uuid`,
    );
    await fieldSearch.refreshStoreFieldSearch(store.id);
    expect(await found("kjedeligord")).toContain("demo-keramikkopp");
  });

  it("follows the group: unflagging a field, switching the group off and deleting it take the words away", async () => {
    // The generator's own save, with the note unflagged again, makes the store's texts again.
    const current = (await fields.getFieldGroup(store.id, groupId))!;
    const saved = await fields.saveFieldGroup(member, {
      ...current,
      fields: [designer, material, care, organic, note, secret],
    });
    expect(saved.ok).toBe(true);
    expect(await found("kjedeligord")).toEqual([]);
    expect(await found("Nordmann")).toContain("demo-keramikkopp");

    expect((await fields.setFieldGroupActive(member, groupId, false)).ok).toBe(true);
    expect(await found("Nordmann")).toEqual([]);
    expect(await rowsOf("demo-keramikkopp")).toEqual([]);
    expect((await fields.setFieldGroupActive(member, groupId, true)).ok).toBe(true);
    expect(await found("Nordmann")).toContain("demo-keramikkopp");

    // A product's own save takes a value away.
    expect(await write("demo-keramikkopp", { values: {}, translations: { "nb-NO": { [designer.id]: null } } })).toEqual(
      [],
    );
    expect(await found("Nordmann")).toEqual([]);
    expect(await found("Ull")).toContain("demo-keramikkopp");
    expect(
      await write("demo-keramikkopp", {
        values: { [material.id]: null },
        translations: { "sv-SE": { [designer.id]: null } },
      }),
    ).toEqual([]);
    expect(await rowsOf("demo-keramikkopp")).toEqual([]);
  });

  it("takes a deleted group's words away", async () => {
    const tag = pub({ type: "text", name: "tagline", label: "Tagline", search: true });
    const saved = await fields.saveFieldGroup(member, {
      ...emptyGroup(),
      name: "Temp",
      slug: "temp",
      fields: [tag],
    } satisfies FieldGroupInput);
    expect(saved.ok).toBe(true);
    const id = (saved as { id: string }).id;
    expect(await write("demo-hytte", { values: {}, translations: { "nb-NO": { [tag.id]: "Fjellro" } } })).toEqual([]);
    expect(await found("Fjellro")).toContain("demo-hytte");
    expect((await fields.deleteFieldGroup(member, id)).ok).toBe(true);
    expect(await found("Fjellro")).toEqual([]);
  });
});

describe("custom fields as listing filters", () => {
  beforeAll(async () => {
    const changes = {
      values: { [material.id]: "wool", [care.id]: ["wash", "hand"], [organic.id]: true },
      translations: { "nb-NO": { [secret.id]: "hemmeligord" } },
    } as FieldChanges;
    expect(await write("demo-keramikkopp", changes)).toEqual([]);
    expect(
      await write("demo-hytte", { values: { [material.id]: "cotton", [care.id]: ["hand"] }, translations: {} }),
    ).toEqual([]);
  });

  it("narrows a listing by a choice, any of several, a checkbox's list and a yes, all fields together", async () => {
    const all = await listed({});
    expect(all.length).toBeGreaterThan(3);
    expect(await listed({ fields: [{ name: "material", values: ["wool"] }] })).toEqual(["demo-keramikkopp"]);
    expect((await listed({ fields: [{ name: "material", values: ["wool", "cotton"] }] })).sort()).toEqual([
      "demo-hytte",
      "demo-keramikkopp",
    ]);
    expect(await listed({ fields: [{ name: "care", values: ["wash"] }] })).toEqual(["demo-keramikkopp"]);
    expect((await listed({ fields: [{ name: "care", values: ["hand"] }] })).sort()).toEqual([
      "demo-hytte",
      "demo-keramikkopp",
    ]);
    expect(await listed({ fields: [{ name: "organic", values: ["1"] }] })).toEqual(["demo-keramikkopp"]);
    expect(
      await listed({
        fields: [
          { name: "material", values: ["cotton"] },
          { name: "organic", values: ["1"] },
        ],
      }),
    ).toEqual([]);
    // A value the field does not have finds nothing to filter by, and is dropped.
    expect(await listed({ fields: [{ name: "material", values: ["silk"] }] })).toEqual(all);
  });

  it("never filters by a private or unflagged field, or one that does not exist", async () => {
    const all = await listed({});
    expect(await listed({ fields: [{ name: "secret", values: ["hemmeligord"] }] })).toEqual(all);
    expect(await listed({ fields: [{ name: "note", values: ["x"] }] })).toEqual(all);
    expect(await listed({ fields: [{ name: "designer", values: ["Kari"] }] })).toEqual(all);
    expect(await listed({ fields: [{ name: "nothing", values: ["1"] }] })).toEqual(all);
    // A parameter in the address cannot smuggle in SQL: the id is a parameter, the value a choice's key.
    expect(await listed({ fields: [{ name: "material", values: ["wool') or true --"] }] })).toEqual(all);
  });

  it("offers each field with its choices and how many products have them, in the market's language", async () => {
    const facets = await listing.listingFacets(store.id, no, {}, viewer);
    const byName = new Map(facets.fields.map((f) => [f.name, f]));
    expect([...byName.keys()].sort()).toEqual(["care", "material", "organic"]);
    expect(byName.get("material")).toMatchObject({
      label: "Material",
      values: [
        { value: "wool", label: "Ull", count: 1 },
        { value: "cotton", label: "Bomull", count: 1 },
      ],
    });
    expect(byName.get("care")!.values).toEqual([
      { value: "wash", label: "Maskinvask", count: 1 },
      { value: "hand", label: "Håndvask", count: 2 },
    ]);
    expect(byName.get("organic")!.values).toEqual([{ value: "1", label: "Ja", count: 1 }]);
    // The private and unflagged fields are not offered.
    expect(JSON.stringify(facets)).not.toContain("secret");
    expect(JSON.stringify(facets)).not.toContain("hemmeligord");

    const swedish = await listing.listingFacets(store.id, se, {}, viewer);
    expect(swedish.fields.find((f) => f.name === "material")).toMatchObject({
      label: "Material (sv)",
      values: [{ label: "Ylle" }, { label: "Bomullen" }],
    });
    expect(swedish.fieldLabels.find((f) => f.name === "material")!.values).toEqual({
      wool: "Ylle",
      cotton: "Bomullen",
    });
  });

  it("counts within the page's own products", async () => {
    const ids = [product.get("demo-keramikkopp")!, product.get("demo-hytte")!, product.get("demo-sykkelutleie")!];
    const facets = await listing.listingFacets(store.id, no, { ids }, viewer);
    expect(facets.total).toBe(3);
    expect(facets.fields.find((f) => f.name === "care")!.values.map((v) => v.count)).toEqual([1, 2]);
    // Every product of the page having a value does not narrow it: only the yes of the organic field does.
    const onlyTwo = await listing.listingFacets(store.id, no, { ids: ids.slice(0, 2) }, viewer);
    expect(onlyTwo.fields.find((f) => f.name === "material")!.values.map((v) => v.count)).toEqual([1, 1]);
    expect(onlyTwo.fields.find((f) => f.name === "care")!.values.map((v) => v.value)).toEqual(["wash"]);
  });
});
