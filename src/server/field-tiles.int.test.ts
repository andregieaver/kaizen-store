import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { emptyGroup, newField, type FieldDef, type FieldGroupInput } from "@/lib/custom-fields";
import { loopOf } from "@/lib/field-loop";
import { newBlock } from "@/lib/page-rows";
import type { ContentGridBlock } from "@/lib/page-content";

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
const { shownFieldsForItems } = await import("./field-tiles");
const { gridData, withTileFields } = await import("./content-grid");
const { getStore } = await import("./stores");

/**
 * Custom fields on a content grid's tiles (D120): read for all the items in one
 * batch, each with its own values, only public fields of groups that apply to it.
 */

const run = Date.now().toString(36);
let store: Store;
let member: Membership;
let products: string[];
let category: string;
let pageCategory: string;

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
/** Writes what is the same in every language (locale empty) or one language's own texts, as the editor keeps them. */
const setValues = (entity: string, id: string, locale: string, values: Record<string, unknown>) =>
  db().execute(sql`
    insert into commerce.field_values (store_id, entity, entity_id, locale, values)
    values (${store.id}::uuid, ${entity}, ${id}::uuid, ${locale}, ${JSON.stringify(values)}::jsonb)
    on conflict (store_id, entity, entity_id, locale) do update set values = excluded.values
  `);
/** Both: the shared values, and the texts in the store's main language (Norwegian). */
const write = async (
  entity: string,
  id: string,
  shared: Record<string, unknown>,
  texts: Record<string, string> = {},
) => {
  await setValues(entity, id, "", shared);
  await setValues(entity, id, "nb-NO", texts);
};

const material = pub({ type: "text", name: "material", label: "Material" });
const weight = pub({ type: "number", name: "weight", label: "Weight", unit: "g" });
const secret = pub({ type: "text", name: "secret", label: "Secret", access: "private" });
const age = pub({ type: "text", name: "age", label: "Age" });
const photo = pub({ type: "image", name: "photo", label: "Photo" });
const kind = pub({ type: "boolean", name: "organic", label: "Organic" });

beforeAll(async () => {
  const name = `tiles-${run}`;
  const [request] = await db().execute<Row>(
    sql`insert into commerce.access_requests (email, name, store_name) values (${`${name}@example.com`}, 'T', 'Fliser') returning id`,
  );
  await db().execute<Row>(
    sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${name}, 'Fliser', null)`,
  );
  const [owner] = await db().execute<Row>(
    sql`select id, email from commerce.accounts where email = ${`${name}@example.com`}`,
  );
  await db().execute(sql`update commerce.stores set locales = array['nb-NO', 'sv-SE'] where slug = ${name}`);
  store = (await getStore(name))!;
  member = {
    account: { id: String(owner.id), email: String(owner.email), name: "T", platformAdmin: false },
    role: "owner",
    store,
  } as Membership;
  products = (
    await db().execute<Row>(sql`
      select id from commerce.products where store_id = ${store.id}::uuid and status = 'active' order by handle limit 3`)
  ).map((r) => String(r.id));
  expect(products.length).toBeGreaterThanOrEqual(3);
  const term = async (content: string, label: string, slug: string) =>
    String(
      (
        await db().execute<Row>(
          sql`insert into commerce.terms (store_id, content_type, kind, name, slug) values (${store.id}::uuid, ${content}, 'category', ${label}, ${slug}) returning id`,
        )
      )[0].id,
    );
  category = await term("product", "Barn", "barn");
  pageCategory = await term("page", "Guider", "guider");
  // The third product is in the category; the others are not.
  await db().execute(
    sql`insert into commerce.product_terms (store_id, product_id, term_id) values (${store.id}::uuid, ${products[2]}::uuid, ${category}::uuid)`,
  );
  await saveGroup({
    name: "Specs",
    slug: "specs",
    entities: ["product"],
    fields: [material, weight, secret, photo, kind],
  });
  await saveGroup({
    name: "For children",
    slug: "for-children",
    entities: ["product"],
    location: [[{ param: "category", operator: "==", value: category }]],
    fields: [age],
  });
});

afterAll(async () => {
  await closeDb();
});

describe("fields on tiles, read for all the items at once (D120)", () => {
  it("gives each product its own values, in the shopper's language", async () => {
    const [a, b, c] = products;
    await write("product", a, { [weight.id]: 250, [kind.id]: true }, { [material.id]: "Tre", [secret.id]: "hemmelig" });
    await setValues("product", a, "sv-SE", { [material.id]: "Trä" });
    await write("product", b, { [weight.id]: 1200 }, { [material.id]: "Stål" });
    await write("product", c, {}, { [material.id]: "Bambus" });

    const ids = [material.id, weight.id, kind.id];
    const nb = await shownFieldsForItems(store.id, "product", [a, b, c], ids, "nb-NO", "nb", "no");
    expect(nb[a]).toEqual([
      { label: "Material", text: "Tre" },
      { label: "Weight", text: expect.stringContaining("250") },
      { label: "Organic", text: "Ja" },
    ]);
    expect(nb[b]).toEqual([
      { label: "Material", text: "Stål" },
      { label: "Weight", text: expect.stringMatching(/1\s?200/) },
    ]);
    expect(nb[c]).toEqual([{ label: "Material", text: "Bambus" }]);

    // Swedish where written, the main language's where not.
    const sv = await shownFieldsForItems(store.id, "product", [a, b], [material.id], "sv-SE", "sv", "se");
    expect(sv[a]).toEqual([{ label: "Material", text: "Trä" }]);
    expect(sv[b]).toEqual([{ label: "Material", text: "Stål" }]);
  });

  it("follows the order the grid names the fields in, and shows at most three", async () => {
    const [a] = products;
    const out = await shownFieldsForItems(
      store.id,
      "product",
      [a],
      [weight.id, material.id, kind.id, age.id],
      "nb-NO",
      "nb",
      "no",
    );
    expect(out[a].map((line) => line.label)).toEqual(["Weight", "Material", "Organic"]);
  });

  it("leaves out private fields, fields that are not plain, unknown ones and items with nothing", async () => {
    const [a, b, c] = products;
    // The private field has a value, and so does the picture's slot: neither is shown.
    await write(
      "product",
      b,
      { [weight.id]: 1200, [photo.id]: { url: "https://x.example/a.webp", thumbnailUrl: null, alt: "" } },
      { [material.id]: "Stål" },
    );
    const out = await shownFieldsForItems(
      store.id,
      "product",
      [a, b, c],
      [secret.id, photo.id, "f_unknown0"],
      "nb-NO",
      "nb",
      "no",
    );
    expect(out).toEqual({});
    expect(await shownFieldsForItems(store.id, "product", [a], [], "nb-NO", "nb", "no")).toEqual({});
    expect(await shownFieldsForItems(store.id, "product", [], [material.id], "nb-NO", "nb", "no")).toEqual({});
    expect(await shownFieldsForItems(store.id, "product", ["not-an-id"], [material.id], "nb-NO", "nb", "no")).toEqual(
      {},
    );
    // A product with no values at all has no entry.
    const [none] = (
      await db().execute<Row>(
        sql`select id from commerce.products where store_id = ${store.id}::uuid and status = 'active' order by handle desc limit 1`,
      )
    ).map((r) => String(r.id));
    const only = await shownFieldsForItems(store.id, "product", [none], [material.id], "nb-NO", "nb", "no");
    expect(Object.keys(only).every((id) => id === none)).toBe(true);
  });

  it("respects where a group applies: a group with a rule only reaches the products it matches", async () => {
    const [a, , c] = products;
    // Both have an age stored; only the product in the category gets the group, so only it shows the field.
    await write("product", a, { [weight.id]: 250 }, { [material.id]: "Tre", [age.id]: "3+" });
    await write("product", c, {}, { [material.id]: "Bambus", [age.id]: "5+" });
    const out = await shownFieldsForItems(store.id, "product", [a, c], [age.id], "nb-NO", "nb", "no");
    expect(out[a]).toBeUndefined();
    expect(out[c]).toEqual([{ label: "Age", text: "5+" }]);
  });

  it("does not show the fields of a group that is switched off", async () => {
    const [a] = products;
    const [g] = await db().execute<Row>(
      sql`select id from commerce.field_groups where store_id = ${store.id}::uuid and slug = 'specs'`,
    );
    await db().execute(sql`update commerce.field_groups set active = false where id = ${String(g.id)}::uuid`);
    const off = await shownFieldsForItems(store.id, "product", [a], [material.id], "nb-NO", "nb", "no");
    expect(off).toEqual({});
    await db().execute(sql`update commerce.field_groups set active = true where id = ${String(g.id)}::uuid`);
    expect((await shownFieldsForItems(store.id, "product", [a], [material.id], "nb-NO", "nb", "no"))[a]).toBeDefined();
  });

  it("never reads another store's values", async () => {
    const [a] = products;
    const [otherStore] = await db().execute<Row>(
      sql`select id from commerce.stores where id <> ${store.id}::uuid limit 1`,
    );
    const out = await shownFieldsForItems(String(otherStore.id), "product", [a], [material.id], "nb-NO", "nb", "no");
    expect(out).toEqual({});
  });
});

describe("fields on the tiles of pages and articles", () => {
  it("apply by the page's categories, one read for all of them", async () => {
    const topic = pub({ type: "text", name: "topic", label: "Topic" });
    await saveGroup({
      name: "Guide facts",
      slug: "guide-facts",
      entities: ["page", "article"],
      location: [[{ param: "category", operator: "==", value: pageCategory }]],
      fields: [topic],
    });
    const page = async (slug: string, categories: string[]) =>
      String(
        (
          await db().execute<Row>(sql`
            insert into commerce.pages (store_id, slug, draft, published, published_at)
            values (${store.id}::uuid, ${slug}, '{}', ${JSON.stringify({ categories, tags: [] })}::jsonb, now()) returning id`)
        )[0].id,
      );
    const inGuides = await page("guide-one", [pageCategory]);
    const elsewhere = await page("guide-two", []);
    await write("page", inGuides, {}, { [topic.id]: "Care" });
    await write("page", elsewhere, {}, { [topic.id]: "Not shown" });
    const out = await shownFieldsForItems(store.id, "page", [inGuides, elsewhere], [topic.id], "nb-NO", "nb", "no");
    expect(out).toEqual({ [inGuides]: [{ label: "Topic", text: "Care" }] });
    // Asked as articles, a page has nothing.
    expect(await shownFieldsForItems(store.id, "article", [inGuides], [topic.id], "nb-NO", "nb", "no")).toEqual({});
  });
});

describe("a content grid with tile fields", () => {
  it("carries each item's lines from gridData and leaves the grid as it was without them", async () => {
    const grid = {
      ...(newBlock("contentGrid", () => "g1") as ContentGridBlock),
      source: { type: "products" as const },
      limit: 12,
      tileFields: [material.id],
    };
    const withFields = await gridData(grid, { pageId: null, owner: store.id, market: "no" });
    const [a] = products;
    expect(withFields.items.find((item) => item.id === a)?.fields).toEqual([{ label: "Material", text: "Tre" }]);
    const plain = await gridData({ ...grid, tileFields: undefined }, { pageId: null, owner: store.id, market: "no" });
    expect(plain.items.length).toBe(withFields.items.length);
    expect(plain.items.every((item) => item.fields === undefined)).toBe(true);
  });

  it("adds the lines to items looked up some other way", async () => {
    const [a, b] = products;
    const items = [a, b].map((id) => ({ id, href: "/", title: id, excerpt: "", image: null, price: null }));
    const out = await withTileFields(
      store.id,
      "product",
      { locale: "nb-NO", lang: "nb", slug: "no" },
      [material.id],
      items,
    );
    expect(out.map((item) => item.fields?.[0]?.text)).toEqual(["Tre", "Stål"]);
    expect(await withTileFields(store.id, "product", { locale: "nb-NO", lang: "nb", slug: "no" }, [], items)).toBe(
      items,
    );
  });
});

describe("a field loop over a page's repeater (D120)", () => {
  it("gives each row its slots from the page's public values, in the shopper's language", async () => {
    const title = pub({ type: "text", name: "title", label: "Title" });
    const picture = pub({ type: "image", name: "picture", label: "Picture" });
    const more = pub({ type: "link", name: "more", label: "More" });
    const benefits = pub({ type: "repeater", name: "benefits", label: "Benefits", subFields: [title, picture, more] });
    await saveGroup({ name: "Benefits", slug: "benefits", entities: ["page"], fields: [benefits] });
    const [page] = await db().execute<Row>(sql`
      insert into commerce.pages (store_id, slug, draft, published, published_at)
      values (${store.id}::uuid, 'loop-page', '{}', '{"categories": [], "tags": []}', now()) returning id`);
    const id = String(page.id);
    const [a, b] = ["r_loopaaaaaaa1", "r_loopbbbbbbb2"];
    await setValues("page", id, "", {
      [benefits.id]: [
        { id: a, [picture.id]: { url: "https://images.example/a.webp", thumbnailUrl: null, alt: "A" } },
        { id: b },
      ],
    });
    await setValues("page", id, "nb-NO", {
      [benefits.id]: {
        [a]: {
          [title.id]: "Rask",
          [more.id]: { kind: "url", ref: "https://example.com/a", label: "Mer", newTab: false },
        },
        [b]: { [title.id]: "Trygg" },
      },
    });
    await setValues("page", id, "sv-SE", { [benefits.id]: { [a]: { [title.id]: "Snabb" } } });

    const slots = { image: picture.id, title: title.id, link: more.id };
    const nb = await fields.shownFieldsFor(store.id, "page", id, "nb-NO", "nb", "no");
    expect(loopOf(nb, { fieldId: benefits.id, slots })).toEqual([
      {
        image: { url: "https://images.example/a.webp", thumbnailUrl: null, alt: "A" },
        title: "Rask",
        link: { label: "Mer", href: "https://example.com/a", image: null },
      },
      { title: "Trygg" },
    ]);
    const sv = await fields.shownFieldsFor(store.id, "page", id, "sv-SE", "sv", "se");
    expect(loopOf(sv, { fieldId: benefits.id, slots }).map((row) => row.title)).toEqual(["Snabb", "Trygg"]);
    // Not a repeater, or not a field of the page: nothing.
    expect(loopOf(nb, { fieldId: title.id, slots })).toEqual([]);
    expect(loopOf(nb, { fieldId: "f_unknown00", slots })).toEqual([]);
  });
});
