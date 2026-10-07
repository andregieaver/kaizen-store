import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { emptyGroup, newField, type FieldChanges, type FieldDef, type FieldGroupInput } from "@/lib/custom-fields";
import { NO_FILTERS, parseListingParams, type ListingFilters } from "@/lib/listing-filters";
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
const listing = await import("./listing");
const { getStore } = await import("./stores");

/**
 * Number and measurement custom fields as listing range filters (D120): what
 * `f.<name>.min` and `.max` narrow, in the field's first unit, which fields
 * they never read, that a row holding anything else never raises, and the
 * range the listing's facets offer, on a real database.
 */

const run = Date.now().toString(36);
const no = toMarket({ code: "NO", currency: "NOK", defaultLocale: "nb-NO" });
const se = toMarket({ code: "SE", currency: "SEK", defaultLocale: "sv-SE" });
const viewer = { buyer: "private" as const, audienceBoth: false };
let store: Store;
let member: Membership;
let groupId: string;
const product = new Map<string, string>();

const pub = (over: Partial<FieldDef> & { type: FieldDef["type"] }): FieldDef => ({
  ...newField(over.type),
  access: "public",
  ...over,
});
const weight = pub({
  type: "measurement",
  name: "weight",
  label: "Vekt",
  labels: { "sv-SE": "Vikt" },
  units: ["g", "kg"],
  filter: true,
});
const height = pub({ type: "number", name: "height", label: "Høyde", unit: "cm", filter: true });
// Public but not flagged; and private, which can never be flagged.
const depth = pub({ type: "number", name: "depth", label: "Dybde" });
const secret = { ...newField("number"), name: "secret", label: "Hemmelig", access: "private" as const };

beforeAll(async () => {
  const [request] = await db().execute<Row>(sql`
    insert into commerce.access_requests (email, name, store_name) values (${`franges-${run}@example.com`}, 'F', 'Område') returning id`);
  await db().execute(
    sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${`franges-${run}`}, 'Område', null)`,
  );
  // A new store starts with the shop alone (D178): the demo appointment, stay and rental are offered with their features on, as an owner switches them under Features.
  await db().execute(sql`update commerce.stores set features = features || array['appointments', 'bookings']::text[] where slug = ${`franges-${run}`}`);
  const [owner] = await db().execute<Row>(
    sql`select id, email from commerce.accounts where email = ${`franges-${run}@example.com`}`,
  );
  await db().execute(
    sql`update commerce.stores set locales = array['nb-NO', 'sv-SE'] where slug = ${`franges-${run}`}`,
  );
  store = (await getStore(`franges-${run}`))!;
  member = {
    account: { id: String(owner.id), email: String(owner.email), name: "F", platformAdmin: false },
    role: "owner",
    store,
  } as Membership;
  const rows = await db().execute<Row>(
    sql`select id, handle from commerce.products where store_id = ${store.id}::uuid`,
  );
  for (const row of rows) product.set(String(row.handle), String(row.id));
  const saved = await fields.saveFieldGroup(member, {
    ...emptyGroup(),
    name: "Mål",
    slug: "maal",
    fields: [weight, height, depth, secret],
  } satisfies FieldGroupInput);
  expect(saved, JSON.stringify(saved)).toMatchObject({ ok: true });
  groupId = String((saved as { id: string }).id);
});

afterAll(async () => {
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
/** A row as it would be if it did not come through the editor: any JSON at all. */
const raw = (handle: string, values: string) =>
  db().execute(sql`
    insert into commerce.field_values (store_id, entity, entity_id, locale, values)
    values (${store.id}::uuid, 'product', ${product.get(handle)!}::uuid, '', ${values}::jsonb)
    on conflict (store_id, entity, entity_id, locale) do update set values = excluded.values`);
const range = (query: string) => parseListingParams(new URLSearchParams(query));
const listed = async (filters: Partial<ListingFilters> | string, market = no) =>
  (
    await listing.listingProducts(
      store.id,
      market,
      {},
      typeof filters === "string" ? range(filters) : { ...NO_FILTERS, ...filters },
      viewer,
    )
  )
    .map((p) => p.handle)
    .sort();

describe("custom fields as listing ranges", () => {
  beforeAll(async () => {
    const put = async (handle: string, values: Record<string, unknown>) =>
      expect(await write(handle, { values, translations: {} } as FieldChanges)).toEqual([]);
    await put("demo-keramikkopp", {
      [weight.id]: { value: 200, unit: "g" },
      [height.id]: 10,
      [depth.id]: 5,
      [secret.id]: 7,
    });
    await put("demo-hytte", { [weight.id]: { value: 450, unit: "g" }, [height.id]: 25.5, [depth.id]: 50 });
    // Entered in another unit: the range compares grams only.
    await put("demo-sykkelutleie", { [weight.id]: { value: 2, unit: "kg" }, [height.id]: 100 });
    // Rows that hold anything else are left out, and never raise.
    await raw("demo-notatbok", JSON.stringify({ [weight.id]: "heavy", [height.id]: { x: 1 } }));
    await raw("demo-bordlampe", JSON.stringify({ [weight.id]: { value: "abc", unit: "g" }, [height.id]: null }));
    await raw("demo-massasje", JSON.stringify({ [weight.id]: [1, 2], [height.id]: "12" }));
  });

  it("narrows a listing by the least, the most, or both, ends included", async () => {
    const all = await listed({});
    expect(all.length).toBeGreaterThan(5);
    expect(await listed("f.weight.max=300")).toEqual(["demo-keramikkopp"]);
    expect(await listed("f.weight.min=300")).toEqual(["demo-hytte"]);
    expect(await listed("f.weight.min=200&f.weight.max=450")).toEqual(["demo-hytte", "demo-keramikkopp"]);
    expect(await listed("f.weight.min=201&f.weight.max=449")).toEqual([]);
    // Decimals, with a comma or a point.
    expect(await listed("f.height.min=25.5&f.height.max=25,5")).toEqual(["demo-hytte"]);
    expect(await listed("f.height.max=25")).toEqual(["demo-keramikkopp"]);
    expect((await listed("f.height.min=10")).sort()).toEqual(["demo-hytte", "demo-keramikkopp", "demo-sykkelutleie"]);
  });

  it("puts fields together with each other and with other filters", async () => {
    expect(await listed("f.weight.max=500&f.height.min=20")).toEqual(["demo-hytte"]);
    expect(await listed("f.weight.max=500&f.height.min=200")).toEqual([]);
    expect(await listed("f.weight.max=500&kind=goods")).toEqual(["demo-keramikkopp"]);
    expect(await listed("f.weight.max=500&kind=rental")).toEqual([]);
  });

  it("compares a measurement only in the field's first unit", async () => {
    // 2 kg is 2000 g, but nothing converts between units: it is not a value in grams.
    expect(await listed("f.weight.min=1")).toEqual(["demo-hytte", "demo-keramikkopp"]);
    expect(await listed("f.weight.max=5000")).toEqual(["demo-hytte", "demo-keramikkopp"]);
    // A number field is compared as it is, whatever its unit label.
    expect(await listed("f.height.min=90")).toEqual(["demo-sykkelutleie"]);
  });

  it("never filters by a private or unflagged field, or one that does not exist", async () => {
    const all = await listed({});
    expect(await listed("f.secret.min=6&f.secret.max=8")).toEqual(all);
    expect(await listed("f.depth.min=40")).toEqual(all);
    expect(await listed("f.nothing.max=1")).toEqual(all);
    // A range asked of a choice or a name that is not a filter changes nothing either.
    expect(await listed({ ranges: [{ name: "weight", min: null, max: null }] })).toEqual(all);
  });

  it("never raises on rows that hold something else than a number", async () => {
    const all = await listed({});
    // Every product with a text, a list, a missing or a null value is simply not in the range.
    expect(await listed("f.weight.min=-1000000&f.weight.max=1000000")).toEqual(["demo-hytte", "demo-keramikkopp"]);
    expect(await listed("f.height.min=-1000000&f.height.max=1000000")).toEqual([
      "demo-hytte",
      "demo-keramikkopp",
      "demo-sykkelutleie",
    ]);
    expect(all.length).toBeGreaterThan(5);
    // A number no double can hold is still a number, compared exactly and without an error.
    await raw("demo-notatbok", `{"${weight.id}": {"value": 1e400, "unit": "g"}, "${height.id}": 1e400}`);
    expect(await listed("f.height.min=1000000000")).toEqual(["demo-notatbok"]);
    expect(await listed("f.weight.min=1&f.height.max=1000000000")).toEqual(["demo-hytte", "demo-keramikkopp"]);
  });

  it("keeps every value a parameter", async () => {
    const all = await listed({});
    // The address parser only lets numbers through; a range built by hand still cannot smuggle SQL in.
    const hand = { ranges: [{ name: "weight') or true --", min: 1, max: null }] };
    expect(await listed(hand)).toEqual(all);
  });

  it("offers each range field with the least and most the page's products hold, in the market's language", async () => {
    // Back to plain values for the facets.
    await raw("demo-notatbok", JSON.stringify({ [weight.id]: "heavy", [height.id]: { x: 1 } }));
    const facets = await listing.listingFacets(store.id, no, {}, viewer);
    expect(facets.ranges).toEqual([
      { name: "weight", label: "Vekt", unit: "g", min: 200, max: 450 },
      { name: "height", label: "Høyde", unit: "cm", min: 10, max: 100 },
    ]);
    expect(facets.rangeLabels).toEqual([
      { name: "weight", label: "Vekt", unit: "g" },
      { name: "height", label: "Høyde", unit: "cm" },
    ]);
    // The private and unflagged fields are not offered, and a range is not a choice.
    expect(JSON.stringify(facets)).not.toContain("secret");
    expect(JSON.stringify(facets)).not.toContain("Dybde");
    expect(facets.fields).toEqual([]);
    const swedish = await listing.listingFacets(store.id, se, {}, viewer);
    expect(swedish.ranges.find((r) => r.name === "weight")).toMatchObject({ label: "Vikt", min: 200, max: 450 });
  });

  it("counts within the page's own products, and offers a range only where products differ", async () => {
    const ids = [product.get("demo-keramikkopp")!, product.get("demo-hytte")!];
    const two = await listing.listingFacets(store.id, no, { ids }, viewer);
    expect(two.ranges.map((r) => [r.name, r.min, r.max])).toEqual([
      ["weight", 200, 450],
      ["height", 10, 25.5],
    ]);
    // One product holding a value has nothing to narrow, though the field is still worded for a chosen range.
    const one = await listing.listingFacets(store.id, no, { ids: [ids[0]] }, viewer);
    expect(one.ranges).toEqual([]);
    expect(one.rangeLabels.map((r) => r.name)).toEqual(["weight", "height"]);
    // Products with no value or a value in another unit do not stretch the range.
    const kg = await listing.listingFacets(store.id, no, { ids: [product.get("demo-sykkelutleie")!, ids[0]] }, viewer);
    expect(kg.ranges.map((r) => r.name)).toEqual(["height"]);
  });

  it("follows the group: unflagging a field takes its range away, and so does switching the group off", async () => {
    const current = (await fields.getFieldGroup(store.id, groupId))!;
    const saved = await fields.saveFieldGroup(member, {
      ...current,
      fields: [{ ...weight, filter: false }, height, depth, secret],
    });
    expect(saved.ok).toBe(true);
    expect((await listing.listingFacets(store.id, no, {}, viewer)).ranges.map((r) => r.name)).toEqual(["height"]);
    expect(await listed("f.weight.max=300")).toEqual(await listed({}));
    expect((await fields.setFieldGroupActive(member, groupId, false)).ok).toBe(true);
    expect((await listing.listingFacets(store.id, no, {}, viewer)).ranges).toEqual([]);
    expect(await listed("f.height.max=25")).toEqual(await listed({}));
  });
});
