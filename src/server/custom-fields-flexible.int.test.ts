import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { emptyGroup, newField, newRowId, type FieldDef, type FieldGroupInput } from "@/lib/custom-fields";

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
// Files are kept in Storage, which is not here: an address in the store's own folder is what counts.
vi.mock("./media", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./media")>()),
  isOwnFieldFile: (storeId: string, url: string) => url.startsWith(`https://files.example/field-files/${storeId}/`),
}));

const fields = await import("./custom-fields");
const { getStore } = await import("./stores");

/**
 * Flexible content (D120): rows of layouts the owner defined, kept like a
 * repeater's (structure shared, words by row id per language), checked against
 * the row's own layout, and drawn for a shopper block by block.
 */

const run = Date.now().toString(36);
const LOCALES = ["nb-NO", "sv-SE"];
let store: Store;
let member: Membership;
let other: Store;
let product: { id: string; handle: string };
let foreign: { id: string };

async function makeStore(name: string) {
  const [request] = await db().execute<Row>(
    sql`insert into commerce.access_requests (email, name, store_name) values (${`${name}@example.com`}, 'F', 'Fleksibel') returning id`,
  );
  await db().execute<Row>(
    sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${name}, 'Fleksibel', null)`,
  );
  const [owner] = await db().execute<Row>(
    sql`select id, email from commerce.accounts where email = ${`${name}@example.com`}`,
  );
  await db().execute(sql`update commerce.stores set locales = array['nb-NO', 'sv-SE'] where slug = ${name}`);
  const found = (await getStore(name))!;
  return {
    store: found,
    member: {
      account: { id: String(owner.id), email: String(owner.email), name: "F", platformAdmin: false },
      role: "owner",
      store: found,
    } as Membership,
  };
}

beforeAll(async () => {
  ({ store, member } = await makeStore(`flex-${run}`));
  other = (await makeStore(`flex-other-${run}`)).store;
  const [mine] = await db().execute<Row>(
    sql`select id, handle from commerce.products where store_id = ${store.id}::uuid and status = 'active' order by handle limit 1`,
  );
  product = { id: String(mine.id), handle: String(mine.handle) };
  const [theirs] = await db().execute<Row>(
    sql`select id from commerce.products where store_id = ${other.id}::uuid limit 1`,
  );
  foreign = { id: String(theirs.id) };
});

afterAll(async () => {
  await closeDb();
});

const cell = (type: FieldDef["type"], id: string, label: string, over: Partial<FieldDef> = {}): FieldDef => ({
  ...newField(type),
  id,
  name: label.toLowerCase().replace(/\s+/g, "_"),
  label,
  ...over,
});
const heading = cell("text", "f_heading00001", "Heading");
const body = cell("textarea", "f_body0000001", "Body");
const quote = cell("textarea", "f_quote000001", "Quote");
const author = cell("text", "f_author00001", "Author");
const stars = cell("number", "f_stars000001", "Stars");
const related = cell("product", "f_related0001", "Related");
const sheet = cell("file", "f_sheet0000001", "Data sheet");

const flexible: FieldDef = {
  ...newField("flexible"),
  id: "f_flexible0001",
  name: "content",
  label: "Content",
  access: "public",
  layouts: [
    { key: "text", label: "Text block", labels: { "sv-SE": "Textblock" }, subFields: [heading, body] },
    { key: "quote", label: "Quote", subFields: [quote, author, stars] },
    { key: "more", label: "More", subFields: [related, sheet] },
  ],
};

const saveGroup = async (input: Partial<FieldGroupInput> & { fields: FieldDef[] }) =>
  fields.saveFieldGroup(member, { ...emptyGroup(), name: "Content", slug: "content", ...input });
const write = async (raw: unknown, requireAll = false) => {
  const facts = (await fields.productFacts(db(), store.id, product.id))!;
  return db().transaction((tx) =>
    fields.saveFieldData(tx, store.id, "product", product.id, raw, {
      facts,
      locales: LOCALES,
      main: "nb-NO",
      requireAll,
    }),
  );
};
const shown = async (locale: string, lang: string, market: string) =>
  (await fields.shownFieldsFor(store.id, "product", product.id, locale, lang, market)).flatMap((g) => g.fields);
const rowA = newRowId();
const rowB = newRowId();
const rowC = newRowId();

describe("flexible content with two layouts in two languages", () => {
  let groupId: string;

  beforeAll(async () => {
    const saved = await saveGroup({ fields: [flexible] });
    expect(saved, JSON.stringify(saved)).toMatchObject({ ok: true });
    groupId = (saved as { id: string }).id;
  });

  it("is saved with the structure shared and each language's words by row", async () => {
    const problems = await write({
      values: {
        [flexible.id]: [
          { id: rowA, layout: "text" },
          { id: rowB, layout: "quote", [stars.id]: 5, [heading.id]: "not this layout's" },
        ],
      },
      translations: {
        "nb-NO": {
          [flexible.id]: {
            [rowA]: { [heading.id]: "Vevd for hånd", [body.id]: "Fra Voss" },
            [rowB]: { [quote.id]: "Mindre er mer", [author.id]: "Ola" },
          },
        },
        "sv-SE": {
          [flexible.id]: { [rowA]: { [heading.id]: "Vävd för hand" }, [rowB]: { [quote.id]: "Mindre är mer" } },
        },
      },
    });
    expect(problems).toEqual([]);

    const data = await fields.getFieldData(store.id, "product", product.id);
    expect(data.values[flexible.id]).toEqual([
      { id: rowA, layout: "text" },
      { id: rowB, layout: "quote", [stars.id]: 5 },
    ]);
    expect(data.translations["nb-NO"][flexible.id]).toEqual({
      [rowA]: { [heading.id]: "Vevd for hånd", [body.id]: "Fra Voss" },
      [rowB]: { [quote.id]: "Mindre er mer", [author.id]: "Ola" },
    });
    expect(data.translations["sv-SE"][flexible.id]).toEqual({
      [rowA]: { [heading.id]: "Vävd för hand" },
      [rowB]: { [quote.id]: "Mindre är mer" },
    });
  });

  it("is read block by block in the shopper's language, the main language's words where there are none", async () => {
    const [inSwedish] = await shown("sv-SE", "sv", "se");
    expect(inSwedish.type).toBe("flexible");
    expect(inSwedish.blocks?.map((b) => [b.layout, b.label, b.fields.map((f) => f.text)])).toEqual([
      ["text", "Textblock", ["Vävd för hand", "Fra Voss"]],
      ["quote", "Quote", ["Mindre är mer", "Ola", "5"]],
    ]);
    const [inNorwegian] = await shown("nb-NO", "nb", "no");
    expect(inNorwegian.blocks?.map((b) => [b.label, b.fields[0].text])).toEqual([
      ["Text block", "Vevd for hånd"],
      ["Quote", "Mindre er mer"],
    ]);
  });

  it("follows a row that is moved, and drops the words of one that is taken away", async () => {
    const problems = await write({
      values: {
        [flexible.id]: [
          { id: rowB, layout: "quote", [stars.id]: 5 },
          { id: rowA, layout: "text" },
        ],
      },
      translations: {},
    });
    expect(problems).toEqual([]);
    const [inSwedish] = await shown("sv-SE", "sv", "se");
    expect(inSwedish.blocks?.map((b) => b.fields[0].text)).toEqual(["Mindre är mer", "Vävd för hand"]);

    expect(await write({ values: { [flexible.id]: [{ id: rowA, layout: "text" }] }, translations: {} })).toEqual([]);
    const data = await fields.getFieldData(store.id, "product", product.id);
    expect(Object.keys(data.translations["sv-SE"][flexible.id] as object)).toEqual([rowA]);
    expect(Object.keys(data.translations["nb-NO"][flexible.id] as object)).toEqual([rowA]);
  });

  it("checks what a row points at against the store's own things, by its layout's fields", async () => {
    const own = `https://files.example/field-files/${store.id}/sheet.pdf`;
    const foreignFile = `https://files.example/field-files/${other.id}/sheet.pdf`;
    const rows = (url: string, item: string) => [
      { id: rowA, layout: "text" },
      {
        id: rowC,
        layout: "more",
        [related.id]: item,
        [sheet.id]: { url, name: "sheet.pdf", size: 10, contentType: "application/pdf" },
      },
    ];
    expect(await write({ values: { [flexible.id]: rows(foreignFile, foreign.id) }, translations: {} })).toEqual([]);
    let data = await fields.getFieldData(store.id, "product", product.id);
    // Another store's product and file are taken out of the row; nothing else of it is lost.
    expect(data.values[flexible.id]).toEqual([
      { id: rowA, layout: "text" },
      { id: rowC, layout: "more" },
    ]);

    expect(await write({ values: { [flexible.id]: rows(own, product.id) }, translations: {} })).toEqual([]);
    data = await fields.getFieldData(store.id, "product", product.id);
    expect(data.values[flexible.id]).toEqual([
      { id: rowA, layout: "text" },
      {
        id: rowC,
        layout: "more",
        [related.id]: product.id,
        [sheet.id]: { url: own, name: "sheet.pdf", size: 10, contentType: "application/pdf" },
      },
    ]);
    const [field] = await shown("nb-NO", "nb", "no");
    const more = field.blocks?.find((b) => b.layout === "more");
    expect(more?.fields.map((f) => f.type)).toEqual(["product", "file"]);
    expect(more?.fields[0].links?.[0].href).toContain(`/p/${product.handle}`);
    expect(more?.fields[1].links?.[0].href).toBe(own);
  });

  it("leaves out a layout taken away: its rows are dropped on the next save and never break reading", async () => {
    expect(
      await write({
        values: {
          [flexible.id]: [
            { id: rowA, layout: "text" },
            { id: rowB, layout: "quote", [stars.id]: 3 },
          ],
        },
        translations: {
          "nb-NO": { [flexible.id]: { [rowA]: { [heading.id]: "Første" }, [rowB]: { [quote.id]: "Sitat" } } },
        },
      }),
    ).toEqual([]);
    const withoutQuote: FieldDef = { ...flexible, layouts: flexible.layouts?.filter((l) => l.key !== "quote") };
    expect(await saveGroup({ id: groupId, fields: [withoutQuote] })).toMatchObject({ ok: true });

    // Reading skips the row of the layout that is gone.
    const [field] = await shown("nb-NO", "nb", "no");
    expect(field.blocks?.map((b) => b.layout)).toEqual(["text"]);

    // The next save takes it out of what is kept, with its words in every language.
    expect(
      await write({
        values: {
          [flexible.id]: [
            { id: rowA, layout: "text" },
            { id: rowB, layout: "quote", [stars.id]: 3 },
          ],
        },
        translations: {
          "nb-NO": { [flexible.id]: { [rowA]: { [heading.id]: "Første" }, [rowB]: { [quote.id]: "Sitat" } } },
        },
      }),
    ).toEqual([]);
    const data = await fields.getFieldData(store.id, "product", product.id);
    expect(data.values[flexible.id]).toEqual([{ id: rowA, layout: "text" }]);
    expect(data.translations["nb-NO"][flexible.id]).toEqual({ [rowA]: { [heading.id]: "Første" } });
    // Swedish keeps its words for the row that is left, and has none for the row that went.
    expect(data.translations["sv-SE"][flexible.id]).toEqual({ [rowA]: { [heading.id]: "Vävd för hand" } });
    await saveGroup({ id: groupId, fields: [flexible] });
  });

  it("asks for its fewest rows and its required fields when the product is saved as active", async () => {
    const strict: FieldDef = {
      ...flexible,
      minRows: 2,
      layouts: [
        { key: "text", label: "Text block", subFields: [{ ...heading, required: true }, body] },
        ...(flexible.layouts?.slice(1) ?? []),
      ],
    };
    expect(await saveGroup({ id: groupId, fields: [strict] })).toMatchObject({ ok: true });
    const once = await write({ values: { [flexible.id]: [{ id: rowA, layout: "text" }] }, translations: {} }, true);
    expect(once).toEqual(["Content needs at least 2 rows."]);
    const twice = await write(
      {
        values: {
          [flexible.id]: [
            { id: rowA, layout: "text" },
            { id: rowB, layout: "text" },
          ],
        },
        translations: { "nb-NO": { [flexible.id]: { [rowA]: { [heading.id]: "En" } } } },
      },
      true,
    );
    expect(twice).toEqual(["Content, row 2: Heading is required."]);
    expect(await saveGroup({ id: groupId, fields: [flexible] })).toMatchObject({ ok: true });
  });

  it("is refused when it does not fit its layout, and nothing is written", async () => {
    const before = await fields.getFieldData(store.id, "product", product.id);
    const problems = await write({
      values: { [flexible.id]: [{ id: rowB, layout: "quote", [stars.id]: "many" }] },
      translations: {},
    });
    expect(problems.join(" ")).toContain("Content: Stars: Write a number.");
    const noId = await write({ values: { [flexible.id]: [{ layout: "text" }] }, translations: {} });
    expect(noId).toEqual(["Content: A row could not be read."]);
    expect(await fields.getFieldData(store.id, "product", product.id)).toEqual(before);
  });

  it("is a private field for staff only until the owner makes it public", async () => {
    expect(await saveGroup({ id: groupId, fields: [{ ...flexible, access: "private" }] })).toMatchObject({ ok: true });
    expect(await shown("nb-NO", "nb", "no")).toEqual([]);
    expect(await saveGroup({ id: groupId, fields: [flexible] })).toMatchObject({ ok: true });
  });
});
