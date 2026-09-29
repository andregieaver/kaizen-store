import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { emptyGroup, newField, newRowId, type FieldChanges, type FieldDef, type FieldGroupInput } from "@/lib/custom-fields";

import type { Membership } from "./auth";
import type { Store } from "./stores";

type Row = Record<string, unknown>;

vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
// Files are kept in Storage, which is not here: an address in the store's own folder is what counts.
vi.mock("./media", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./media")>()),
  isOwnFieldFile: (storeId: string, url: string) => url.startsWith(`https://files.example/field-files/${storeId}/`),
}));

const fields = await import("./custom-fields");
const { getStore } = await import("./stores");

/**
 * Groups, repeaters, links, relations and files (D118, phase 2): how they are
 * kept with the thing, checked against the store's own things, and drawn for a
 * shopper, on a real database.
 */

const run = Date.now().toString(36);
let store: Store;
let member: Membership;
let other: Store;
let product: { id: string; handle: string };
let foreign: { id: string };
let page: string;
let category: string;
let tag: string;

async function makeStore(name: string) {
  const [request] = await db().execute<Row>(sql`insert into commerce.access_requests (email, name, store_name) values (${`${name}@example.com`}, 'F', 'Typer') returning id`);
  await db().execute<Row>(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${name}, 'Typer', null)`);
  const [owner] = await db().execute<Row>(sql`select id, email from commerce.accounts where email = ${`${name}@example.com`}`);
  await db().execute(sql`update commerce.stores set locales = array['nb-NO', 'sv-SE'] where slug = ${name}`);
  const found = (await getStore(name))!;
  return { store: found, member: { account: { id: String(owner.id), email: String(owner.email), name: "F", platformAdmin: false }, role: "owner", store: found } as Membership };
}

beforeAll(async () => {
  ({ store, member } = await makeStore(`types-${run}`));
  other = (await makeStore(`types-other-${run}`)).store;
  const [mine] = await db().execute<Row>(sql`select id, handle from commerce.products where store_id = ${store.id}::uuid and status = 'active' order by handle limit 1`);
  product = { id: String(mine.id), handle: String(mine.handle) };
  const [theirs] = await db().execute<Row>(sql`select id from commerce.products where store_id = ${other.id}::uuid limit 1`);
  foreign = { id: String(theirs.id) };
  const [p] = await db().execute<Row>(sql`
    insert into commerce.pages (store_id, slug, draft, published, published_at)
    values (${store.id}::uuid, 'typer-side', '{}', '{"title": "Om oss", "categories": [], "tags": []}', now()) returning id`);
  page = String(p.id);
  const term = async (kind: string, name: string, slug: string) =>
    String((await db().execute<Row>(sql`insert into commerce.terms (store_id, content_type, kind, name, slug) values (${store.id}::uuid, 'product', ${kind}, ${name}, ${slug}) returning id`))[0].id);
  category = await term("category", "Kjøkken", "kjokken");
  tag = await term("tag", "Nytt", "nytt");
});

afterAll(async () => {
  await closeDb();
});

const pub = (over: Partial<FieldDef> & { type: FieldDef["type"] }): FieldDef => ({ ...newField(over.type), access: "public", ...over });
const saveGroup = async (input: Partial<FieldGroupInput> & { fields: FieldDef[] }) => {
  const result = await fields.saveFieldGroup(member, { ...emptyGroup(), name: "G", slug: `g-${Math.random().toString(36).slice(2, 8)}`, ...input });
  expect(result, JSON.stringify(result)).toMatchObject({ ok: true });
};
const write = async (entity: "product" | "page", entityId: string, raw: unknown) => {
  const facts = entity === "product" ? await fields.productFacts(db(), store.id, entityId) : await fields.pageFacts(db(), store.id, entityId, "draft");
  return db().transaction((tx) =>
    fields.saveFieldData(tx, store.id, entity, entityId, raw, { facts: facts!, locales: ["nb-NO", "sv-SE"], main: "nb-NO", requireAll: false }),
  );
};

describe("a repeater and a group on a product", () => {
  const title = { ...newField("text"), name: "title", label: "Title" };
  const amount = { ...newField("number"), name: "amount", label: "Amount" };
  const repeater = pub({ type: "repeater", name: "nutrients", label: "Nutrients", subFields: [title, amount], maxRows: 5, buttonLabel: "Add" });
  const size = pub({ type: "group", name: "size", label: "Size", subFields: [{ ...newField("text"), name: "label", label: "Label" }, { ...newField("number"), name: "cm", label: "Centimetres" }] });
  const [label, cm] = size.subFields!;
  const r1 = newRowId();
  const r2 = newRowId();

  beforeAll(async () => {
    await saveGroup({ name: "Details", slug: "details", fields: [repeater, size] });
  });

  it("are kept with their rows shared and their words by language, and shown row by row", async () => {
    const changes: FieldChanges = {
      values: {
        [repeater.id]: [{ id: r1, [amount.id]: 10 }, { id: r2, [amount.id]: 3 }],
        [size.id]: { [cm.id]: 40 },
      },
      translations: {
        "nb-NO": { [repeater.id]: { [r1]: { [title.id]: "Protein" }, [r2]: { [title.id]: "Salt" } }, [size.id]: { [label.id]: "Stor" } },
        "sv-SE": { [repeater.id]: { [r1]: { [title.id]: "Protein (sv)" } } },
      },
    } as never;
    expect(await write("product", product.id, changes)).toEqual([]);

    const data = await fields.getFieldData(store.id, "product", product.id);
    expect(data.values[repeater.id]).toEqual([{ id: r1, [amount.id]: 10 }, { id: r2, [amount.id]: 3 }]);
    expect(data.translations["sv-SE"][repeater.id]).toEqual({ [r1]: { [title.id]: "Protein (sv)" } });

    const nb = await fields.shownFieldsFor(store.id, "product", product.id, "nb-NO", "nb", "no");
    const rows = nb[0].fields.find((f) => f.name === "nutrients")!.rows!;
    expect(rows.map((row) => row.map((f) => f.text))).toEqual([["Protein", "10"], ["Salt", "3"]]);
    expect(nb[0].fields.find((f) => f.name === "size")!.children!.map((f) => f.text)).toEqual(["Stor", "40"]);

    // In Swedish: the words it has, the Norwegian for the rest, the same numbers.
    const sv = await fields.shownFieldsFor(store.id, "product", product.id, "sv-SE", "sv", "se");
    expect(sv[0].fields.find((f) => f.name === "nutrients")!.rows!.map((row) => row[0].text)).toEqual(["Protein (sv)", "Salt"]);
  });

  it("refuse too many rows and a row without an id, and keep what was there", async () => {
    const before = await fields.getFieldData(store.id, "product", product.id);
    const tooMany = Array.from({ length: 6 }, () => ({ id: newRowId() }));
    expect(await write("product", product.id, { values: { [repeater.id]: tooMany } })).toEqual([expect.stringContaining("at most 5")]);
    expect(await write("product", product.id, { values: { [repeater.id]: [{ [amount.id]: 1 }] } })).toHaveLength(1);
    expect(await fields.getFieldData(store.id, "product", product.id)).toEqual(before);
  });

  it("go away with their rows when the editor sends none", async () => {
    expect(await write("product", product.id, { values: { [repeater.id]: null, [size.id]: null }, translations: { "nb-NO": { [repeater.id]: null, [size.id]: null }, "sv-SE": { [repeater.id]: null } } })).toEqual([]);
    expect(await fields.getFieldData(store.id, "product", product.id)).toEqual({ values: {}, translations: {} });
    expect(await fields.shownFieldsFor(store.id, "product", product.id, "nb-NO", "nb", "no")).toEqual([]);
  });
});

describe("links and relations", () => {
  const related = pub({ type: "product", name: "related", label: "Related", multiple: true });
  const read = pub({ type: "page", name: "read", label: "Read more" });
  const where = pub({ type: "term", name: "where", label: "Where", multiple: true });
  const more = pub({ type: "link", name: "more", label: "More" });
  const off = pub({ type: "link", name: "off", label: "Elsewhere" });

  beforeAll(async () => {
    await saveGroup({ name: "Related", slug: "related", fields: [related, read, where, more, off] });
  });

  it("show what they point at, in the shopper's market, with words", async () => {
    const changes = {
      values: { [related.id]: [product.id], [read.id]: page, [where.id]: [category, tag] },
      translations: {
        "nb-NO": {
          [more.id]: { kind: "category", ref: category, label: "Se kjøkken" },
          [off.id]: { kind: "url", ref: "https://example.com/x", label: "Ekstern", newTab: true },
        },
      },
    };
    expect(await write("product", product.id, changes)).toEqual([]);
    const groups = await fields.shownFieldsFor(store.id, "product", product.id, "nb-NO", "nb", "no");
    const byName = Object.fromEntries(groups[0].fields.map((f) => [f.name, f]));
    const base = `/s/${store.slug}/no`;
    expect(byName.related.links).toEqual([expect.objectContaining({ href: `${base}/p/${product.handle}` })]);
    expect(byName.read.links).toEqual([expect.objectContaining({ label: "Om oss", href: `${base}/typer-side` })]);
    expect(byName.where.links!.map((l) => [l.label, l.href])).toEqual([["Kjøkken", `${base}/category/kjokken`], ["Nytt", `${base}/tag/nytt`]]);
    // A link's own words win over the title of what it points at.
    expect(byName.more.links).toEqual([{ label: "Se kjøkken", href: `${base}/category/kjokken` }]);
    expect(byName.off.links).toEqual([{ label: "Ekstern", href: "https://example.com/x", newTab: true }]);
  });

  it("are checked against the store's own things: another store's product, a deleted page and a stranger's link go", async () => {
    const changes = {
      values: { [related.id]: [foreign.id, product.id], [read.id]: crypto.randomUUID(), [where.id]: [category] },
      translations: { "nb-NO": { [more.id]: { kind: "product", ref: foreign.id, label: "Peek" } } },
    };
    expect(await write("product", product.id, changes)).toEqual([]);
    const data = await fields.getFieldData(store.id, "product", product.id);
    expect(data.values[related.id]).toEqual([product.id]);
    expect(data.values[read.id]).toBeUndefined();
    expect(data.translations["nb-NO"]?.[more.id]).toBeUndefined();
  });

  it("leave the field out when what they point at is gone from the site", async () => {
    expect(await write("product", product.id, { values: { [related.id]: [product.id], [read.id]: page, [where.id]: [category] } })).toEqual([]);
    await db().execute(sql`update commerce.pages set published = null, published_at = null where id = ${page}::uuid`);
    await db().execute(sql`delete from commerce.terms where id = ${category}::uuid`).catch(() => {});
    const shown = await fields.shownFieldsFor(store.id, "product", product.id, "nb-NO", "nb", "no");
    const names = shown[0]?.fields.map((f) => f.name) ?? [];
    expect(names).toContain("related");
    expect(names).not.toContain("read");
    await db().execute(sql`update commerce.pages set published = '{"title": "Om oss", "categories": [], "tags": []}', published_at = now() where id = ${page}::uuid`);
  });
});

describe("files", () => {
  const sheet = pub({ type: "file", name: "sheet", label: "Data sheet" });
  const own = () => ({ url: `https://files.example/field-files/${store.id}/abc-datablad.pdf`, name: "datablad.pdf", size: 1000, contentType: "application/pdf" });

  beforeAll(async () => {
    await saveGroup({ name: "Files", slug: "files", fields: [sheet] });
  });

  it("are kept when they are in the store's own folder, and dropped from anywhere else", async () => {
    expect(await write("product", product.id, { values: { [sheet.id]: own() } })).toEqual([]);
    expect((await fields.getFieldData(store.id, "product", product.id)).values[sheet.id]).toEqual(own());
    const shown = await fields.shownFieldsFor(store.id, "product", product.id, "nb-NO", "nb", "no");
    expect(shown.at(-1)!.fields[0].links).toEqual([expect.objectContaining({ label: "datablad.pdf", href: own().url, newTab: true, contentType: "application/pdf" })]);

    expect(await write("product", product.id, { values: { [sheet.id]: { ...own(), url: `https://files.example/field-files/${other.id}/steal.pdf` } } })).toEqual([]);
    expect((await fields.getFieldData(store.id, "product", product.id)).values[sheet.id]).toBeUndefined();
    expect(await write("product", product.id, { values: { [sheet.id]: { ...own(), url: "https://evil.example/x.pdf" } } })).toEqual([]);
    expect((await fields.getFieldData(store.id, "product", product.id)).values[sheet.id]).toBeUndefined();
  });

  it("are refused when the value is not a file", async () => {
    expect(await write("product", product.id, { values: { [sheet.id]: { url: "javascript:1", name: "x", size: 1, contentType: "text/plain" } } })).toHaveLength(1);
  });
});

describe("the editor's lists", () => {
  it("hold the store's own products, published pages and categories and tags, and only when a field needs them", async () => {
    const lookups = await fields.fieldLookups(store.id);
    expect(lookups.products.some((p) => p.id === product.id)).toBe(true);
    expect(lookups.products.some((p) => p.id === foreign.id)).toBe(false);
    expect(lookups.pages.map((p) => p.id)).toContain(page);
    expect(lookups.terms.map((t) => t.id)).toContain(tag);

    const withPointer = await fields.fieldsForEditor(store.id, "product", product.id);
    expect(withPointer.lookups.products.length).toBeGreaterThan(0);
    const plain = await fields.fieldsForEditor(other.id, "product", null);
    expect(plain.lookups).toEqual({ products: [], pages: [], terms: [] });
  });
});
