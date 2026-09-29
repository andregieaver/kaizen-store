import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import {
  changesFrom,
  emptyGroup,
  exportGroups,
  groupFromPreset,
  newField,
  type FieldDef,
  type FieldGroupInput,
} from "@/lib/custom-fields";
import { productInput, type ProductInput } from "@/lib/product-input";

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
const { getEditorContext, emptyProduct, getProductForEdit, saveProduct } = await import("./products");
const { getStore } = await import("./stores");

/**
 * A store's custom fields (D118): groups and what is entered in them for its
 * products and pages, on their way through the same transaction as the rest,
 * and what the site shows of them.
 */

const run = Date.now().toString(36);
const slug = `fields-${run}`;
const otherSlug = `fields-other-${run}`;
let store: Store;
let member: Membership;
let other: Membership;

async function makeStore(name: string): Promise<{ store: Store; member: Membership }> {
  const [request] = await db().execute<Row>(
    sql`insert into commerce.access_requests (email, name, store_name) values (${`${name}@example.com`}, 'F', 'Felt') returning id`,
  );
  await db().execute<Row>(
    sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${name}, 'Felt', null)`,
  );
  const [owner] = await db().execute<Row>(
    sql`select id, email from commerce.accounts where email = ${`${name}@example.com`}`,
  );
  // Norwegian first, then Swedish: the languages the texts below are written in.
  await db().execute(sql`update commerce.stores set locales = array['nb-NO', 'sv-SE'] where slug = ${name}`);
  const found = (await getStore(name))!;
  return {
    store: found,
    member: {
      account: { id: String(owner.id), email: String(owner.email), name: "F", platformAdmin: false },
      role: "owner",
      store: found,
    },
  };
}

beforeAll(async () => {
  ({ store, member } = await makeStore(slug));
  ({ member: other } = await makeStore(otherSlug));
});

afterAll(async () => {
  await closeDb();
});

const group = (over: Partial<FieldGroupInput> & { fields?: FieldDef[] } = {}): FieldGroupInput => ({
  ...emptyGroup(),
  name: "Specs",
  slug: "specs",
  ...over,
});

const text = (name: string, over: Partial<FieldDef> = {}): FieldDef => ({
  ...newField("text", []),
  name,
  label: name,
  access: "public",
  ...over,
});
const saved = async (input: FieldGroupInput, who = member) => {
  const result = await fields.saveFieldGroup(who, input);
  expect(result, JSON.stringify(result)).toMatchObject({ ok: true });
  return (result as { id: string }).id;
};

describe("groups", () => {
  it("are saved, listed in order and kept apart from other stores'", async () => {
    const material = text("material");
    const id = await saved(group({ fields: [material] }));
    await saved(group({ name: "Warranty", slug: "warranty", fields: [text("months")] }), other);
    const mine = await fields.listFieldGroups(store.id);
    expect(mine.map((g) => g.slug)).toEqual(["specs"]);
    expect(mine[0].fields[0]).toMatchObject({ id: material.id, name: "material", access: "public" });
    expect(await fields.getFieldGroup(store.id, id)).toMatchObject({ name: "Specs", active: true, position: "main" });
    // Another store's group is not ours to read, change or delete.
    const foreign = (await fields.listFieldGroups(other.store.id))[0];
    expect(await fields.getFieldGroup(store.id, foreign.id)).toBeNull();
    expect(await fields.saveFieldGroup(member, group({ id: foreign.id, slug: "x" }))).toMatchObject({ ok: false });
    await fields.deleteFieldGroup(member, foreign.id);
    expect(await fields.listFieldGroups(other.store.id)).toHaveLength(1);
  });

  it("refuse a web name another group has, and what is not valid", async () => {
    expect(await fields.saveFieldGroup(member, group())).toMatchObject({
      ok: false,
      problems: [expect.stringContaining("specs")],
    });
    expect(await fields.saveFieldGroup(member, group({ name: "", slug: "empty" }))).toMatchObject({ ok: false });
    expect(
      await fields.saveFieldGroup(member, {
        ...group({ slug: "loose" }),
        fields: [{ ...text("a"), name: "Bad Name" }],
      }),
    ).toMatchObject({ ok: false });
  });

  it("are put in the order given, switched off and moved between stores as files", async () => {
    const second = await saved(group({ name: "Second", slug: "second" }));
    const first = (await fields.listFieldGroups(store.id))[0].id;
    await fields.orderFieldGroups(member, [second, first]);
    expect((await fields.listFieldGroups(store.id)).map((g) => g.slug)).toEqual(["second", "specs"]);
    await fields.setFieldGroupActive(member, second, false);
    expect((await fields.activeFieldGroups(store.id, "product")).map((g) => g.slug)).toEqual(["specs"]);
    expect((await fields.allActiveFieldGroups(store.id)).map((g) => g.slug)).toEqual(["specs"]);

    const file = JSON.parse(JSON.stringify(await fields.exportFieldGroups(store.id)));
    expect(file).toEqual(exportGroups(await fields.listFieldGroups(store.id)));
    const imported = await fields.importFieldGroups(other, file);
    expect(imported).toMatchObject({ ok: true });
    const theirs = await fields.listFieldGroups(other.store.id);
    expect(theirs.map((g) => g.slug).sort()).toEqual(["second", "specs", "warranty"]);
    // Their fields have ids of their own.
    const specs = (await fields.listFieldGroups(store.id)).find((g) => g.slug === "specs")!;
    expect(theirs.find((g) => g.slug === "specs")!.fields[0].id).not.toBe(specs.fields[0].id);
    expect(await fields.importFieldGroups(other, { nothing: true })).toMatchObject({ ok: false });
    await fields.deleteFieldGroup(member, second);
  });
});

describe("a product's fields", () => {
  let productId: string;
  let title: FieldDef;
  let months: FieldDef;
  let note: FieldDef;
  let hidden: FieldDef;
  let colour: FieldDef;

  beforeAll(async () => {
    title = text("subtitle", { label: "Subtitle", labels: { "sv-SE": "Undertitel" } });
    months = { ...newField("number", []), name: "months", label: "Months", access: "public", unit: "months", min: 0 };
    note = text("cost_note", { label: "Cost note", access: "private" });
    hidden = text("why", {
      label: "Why",
      access: "public",
      when: [[{ field: months.id, operator: ">", value: "12" }]],
    });
    colour = {
      ...newField("select", []),
      name: "finish",
      label: "Finish",
      access: "public",
      required: true,
      choices: [
        { key: "matte", label: "Matte" },
        { key: "gloss", label: "Gloss", labels: { "sv-SE": "Glans" } },
      ],
    };
    await saved(group({ name: "Details", slug: "details", fields: [title, months, note, hidden, colour] }));
    // A group only for appointments: a mug does not get it.
    await saved(
      group({
        name: "Booking",
        slug: "booking",
        location: [[{ param: "kind", operator: "==", value: "appointment" }]],
        fields: [text("room", { label: "Room" })],
      }),
    );
  });

  const product = (over: Partial<ProductInput> = {}): ProductInput => {
    const base = emptyProduct(contextOf);
    return productInput.parse({
      ...base,
      handle: "fielded",
      translations: [
        { locale: "nb-NO", title: "Kopp", description: "En kopp.", safetyInformation: "Varm." },
        { locale: "sv-SE", title: "", description: "", safetyInformation: "" },
      ],
      media: [{ url: "https://example.com/kopp.webp", thumbnailUrl: null, alt: "" }],
      options: [],
      variants: [{ ...base.variants[0], options: {}, sku: `F-${run}`, prices: { NO: "249,00", SE: "" }, stock: 2 }],
      manufacturer: {
        new: {
          name: "Keramikk AS",
          postalAddress: "Storgata 1, 0155 Oslo",
          electronicAddress: "post@keramikk.se",
          country: "SE",
        },
      },
      responsiblePerson: null,
      status: "draft",
      ...over,
    });
  };
  let contextOf: Awaited<ReturnType<typeof getEditorContext>>;
  /** The product as stored, changed as an editor would: saving again keeps its variants. */
  const again = async (over: Partial<ProductInput> = {}): Promise<ProductInput> => {
    const { archived, ...stored } = (await getProductForEdit(store, contextOf, productId))!;
    void archived;
    return productInput.parse({ ...stored, ...over });
  };
  const send = async (defs: FieldDef[], data: Parameters<typeof changesFrom>[1]) =>
    changesFrom(defs, data, contextOf.locales);
  const all = () => [title, months, note, hidden, colour];

  beforeAll(async () => {
    contextOf = await getEditorContext(store);
  });

  it("are saved with the product, in the language of each text, and only those of groups the product gets", async () => {
    const changes = await send([...all(), text("room")], {
      values: { [months.id]: 24, [colour.id]: "gloss" },
      translations: {
        "nb-NO": { [title.id]: "Håndlaget", [note.id]: "Intern", [hidden.id]: "Lang garanti" },
        "sv-SE": { [title.id]: "Handgjord" },
      },
    });
    const result = await saveProduct(store, contextOf, null, product(), changes);
    expect(result, JSON.stringify(result)).toMatchObject({ ok: true });
    productId = (result as { productId: string }).productId;
    // The product's manufacturer now exists: later saves know it.
    contextOf = await getEditorContext(store);

    const data = await fields.getFieldData(store.id, "product", productId);
    expect(data.values).toEqual({ [months.id]: 24, [colour.id]: "gloss" });
    expect(data.translations["nb-NO"]).toEqual({
      [title.id]: "Håndlaget",
      [note.id]: "Intern",
      [hidden.id]: "Lang garanti",
    });
    expect(data.translations["sv-SE"]).toEqual({ [title.id]: "Handgjord" });
  });

  it("are what a shopper sees in their own language: the public fields with a value, and not those their logic hides", async () => {
    const nb = await fields.shownFieldsFor(store.id, "product", productId, "nb-NO", "nb", "no");
    expect(nb).toHaveLength(1);
    expect(nb[0]).toMatchObject({ name: "Details", slug: "details" });
    expect(nb[0].fields.map((f) => [f.name, f.label, f.text])).toEqual([
      ["subtitle", "Subtitle", "Håndlaget"],
      ["months", "Months", "24 months"],
      ["why", "Why", "Lang garanti"],
      ["finish", "Finish", "Gloss"],
    ]);
    const sv = await fields.shownFieldsFor(store.id, "product", productId, "sv-SE", "sv", "se");
    expect(sv[0].fields.map((f) => [f.label, f.text])).toEqual([
      ["Undertitel", "Handgjord"],
      ["Months", "24 months"],
      // No Swedish text of its own: the store's main language shows.
      ["Why", "Lang garanti"],
      ["Finish", "Glans"],
    ]);
  });

  it("leave out what the value no longer allows, and a value taken away is gone", async () => {
    const changes = await send(all(), {
      values: { [months.id]: 6, [colour.id]: "gloss" },
      translations: { "nb-NO": { [title.id]: "Håndlaget", [hidden.id]: "Lang garanti" } },
    });
    expect(await saveProduct(store, contextOf, productId, await again(), changes)).toMatchObject({ ok: true });
    const nb = await fields.shownFieldsFor(store.id, "product", productId, "nb-NO", "nb", "no");
    // Six months: the field that shows over twelve is hidden, though its value is kept.
    expect(nb[0].fields.map((f) => f.name)).toEqual(["subtitle", "months", "finish"]);
    expect((await fields.getFieldData(store.id, "product", productId)).translations["nb-NO"]?.[hidden.id]).toBe(
      "Lang garanti",
    );
    // Sent as taken away, the note and the Swedish subtitle are gone.
    const data = await fields.getFieldData(store.id, "product", productId);
    expect(data.translations["nb-NO"]?.[note.id]).toBeUndefined();
    expect(data.translations["sv-SE"]).toBeUndefined();
  });

  it("are checked: a wrong value stops the save, and a required one is asked for when the product is published", async () => {
    const wrong = await send([months], { values: { [months.id]: -1 }, translations: {} });
    expect(await saveProduct(store, contextOf, productId, await again({ handle: "fielded-2" }), wrong)).toMatchObject({
      ok: false,
      problems: [expect.stringContaining("at least 0")],
    });
    // Nothing was saved: the handle did not change.
    const [row] = await db().execute<Row>(sql`select handle from commerce.products where id = ${productId}::uuid`);
    expect(row.handle).toBe("fielded");

    const missing = await send(all(), { values: { [months.id]: 6 }, translations: {} });
    expect(await saveProduct(store, contextOf, productId, await again({ status: "active" }), missing)).toMatchObject({
      ok: false,
      problems: ["Finish is required."],
    });
    // A draft may lack it.
    expect(await saveProduct(store, contextOf, productId, await again({ status: "draft" }), missing)).toMatchObject({
      ok: true,
    });
  });

  it("are left as they are when the editor sends none, and follow the product's rules when it changes kind", async () => {
    const before = await fields.getFieldData(store.id, "product", productId);
    expect(await saveProduct(store, contextOf, productId, await again(), undefined)).toMatchObject({ ok: true });
    expect(await fields.getFieldData(store.id, "product", productId)).toEqual(before);
    // A booking group applies to appointments only: a value sent for it on a mug is dropped.
    const room = (await fields.listFieldGroups(store.id)).find((g) => g.slug === "booking")!.fields[0];
    const dropped = { values: {}, translations: { "nb-NO": { [room.id]: "Rom 1" } } };
    expect(await saveProduct(store, contextOf, productId, await again(), dropped)).toMatchObject({ ok: true });
    expect(
      (await fields.getFieldData(store.id, "product", productId)).translations["nb-NO"]?.[room.id],
    ).toBeUndefined();
  });

  it("go with the product's categories: a rule about one applies to what is in its subcategories", async () => {
    const { createTerm } = await import("./taxonomy");
    const scope = { storeId: store.id, contentType: "product" } as const;
    const parent = (await createTerm(member.account, scope, { kind: "category", name: "Kitchen" })) as {
      ok: true;
      id: string;
    };
    const child = (await createTerm(member.account, scope, {
      kind: "category",
      name: "Mugs",
      parentId: parent.id,
    })) as { ok: true; id: string };
    await saved(
      group({
        name: "Kitchen facts",
        slug: "kitchen",
        location: [[{ param: "category", operator: "==", value: parent.id }]],
        fields: [text("dishwasher", { label: "Dishwasher safe" })],
      }),
    );
    await db().execute(
      sql`insert into commerce.product_terms (store_id, product_id, term_id) values (${store.id}::uuid, ${productId}::uuid, ${child.id}::uuid)`,
    );
    const facts = await fields.productFacts(db(), store.id, productId);
    expect(facts).toMatchObject({
      entity: "product",
      kind: "goods",
      categories: expect.arrayContaining([parent.id, child.id]),
    });
    const applies = (await fields.activeFieldGroups(store.id, "product")).filter(
      (g) => g.location.length === 0 || g.slug === "kitchen",
    );
    expect(applies.map((g) => g.slug)).toContain("kitchen");
  });

  it("are taken away with the group, and with a field taken out of it", async () => {
    const set = await send(all(), { values: { [months.id]: 6, [colour.id]: "gloss" }, translations: {} });
    expect(await saveProduct(store, contextOf, productId, await again(), set)).toMatchObject({ ok: true });
    const details = (await fields.listFieldGroups(store.id)).find((g) => g.slug === "details")!;
    await saved({
      ...group({
        name: details.name,
        slug: details.slug,
        fields: details.fields.filter((f) => f.id !== months.id && f.id !== hidden.id),
      }),
      id: details.id,
    });
    expect((await fields.getFieldData(store.id, "product", productId)).values[months.id]).toBeUndefined();
    expect((await fields.getFieldData(store.id, "product", productId)).values[colour.id]).toBe("gloss");
    await fields.deleteFieldGroup(member, details.id);
    expect((await fields.getFieldData(store.id, "product", productId)).values).toEqual({});
    expect(await fields.shownFieldsFor(store.id, "product", productId, "nb-NO", "nb", "no")).toEqual([]);
  });
});

describe("a page's fields", () => {
  it("are saved for the page and shown by its own rules: its categories and the special page it is", async () => {
    const subtitle = text("subtitle", { label: "Subtitle" });
    await saved(
      group({ name: "Page details", slug: "page-details", entities: ["page", "article"], fields: [subtitle] }),
    );
    await saved(
      group({
        name: "Cart only",
        slug: "cart-only",
        entities: ["page"],
        location: [[{ param: "role", operator: "==", value: "cart" }]],
        fields: [text("banner", { label: "Banner" })],
      }),
    );
    const [page] = await db().execute<Row>(sql`
      insert into commerce.pages (store_id, slug, draft, published, published_at)
      values (${store.id}::uuid, 'fielded-page', '{"categories": [], "tags": []}', '{"categories": [], "tags": []}', now()) returning id
    `);
    const pageId = String(page.id);
    const facts = await fields.pageFacts(db(), store.id, pageId, "draft");
    expect(facts).toMatchObject({ entity: "page", roles: [] });
    const problems = await db().transaction((tx) =>
      fields.saveFieldData(
        tx,
        store.id,
        "page",
        pageId,
        { values: {}, translations: { "nb-NO": { [subtitle.id]: "Om oss" } } },
        { facts: facts!, locales: ["nb-NO"], main: "nb-NO", requireAll: false },
      ),
    );
    expect(problems).toEqual([]);
    const shown = await fields.shownFieldsFor(store.id, "page", pageId, "nb-NO", "nb", "no");
    expect(shown.map((g) => g.slug)).toEqual(["page-details"]);
    expect(shown[0].fields[0]).toMatchObject({ label: "Subtitle", text: "Om oss" });

    // Chosen as the store's cart page, the page gets the cart group too.
    await db().execute(
      sql`insert into commerce.page_roles (store_id, role, page_id) values (${store.id}::uuid, 'cart', ${pageId}::uuid)`,
    );
    expect(await fields.pageFacts(db(), store.id, pageId, "draft")).toMatchObject({ roles: ["cart"] });
    // A page's fields go with the page.
    await db().execute(sql`delete from commerce.page_roles where page_id = ${pageId}::uuid`);
    await db().execute(sql`delete from commerce.pages where id = ${pageId}::uuid`);
    expect(await fields.getFieldData(store.id, "page", pageId)).toEqual({ values: {}, translations: {} });
  });

  it("are not offered for a thing that is not a page or a product", async () => {
    const [layout] = await db().execute<Row>(
      sql`insert into commerce.pages (store_id, type, slug, draft) values (${store.id}::uuid, 'header', 'a-header', '{}') returning id`,
    );
    expect(await fields.pageFacts(db(), store.id, String(layout.id), "draft")).toBeNull();
    expect(await fields.productFacts(db(), store.id, crypto.randomUUID())).toBeNull();
  });
});

describe("a store made from the template", () => {
  it("has the template's groups and what was entered, and none of another store's", async () => {
    const preset = groupFromPreset("specifications", [])!;
    expect(preset.fields.length).toBeGreaterThan(1);
    expect(await fields.listFieldGroups(other.store.id)).not.toHaveLength(0);
    expect((await fields.listFieldGroups(store.id)).every((g) => g.fields.every((f) => f.id.startsWith("f_")))).toBe(
      true,
    );
  });
});
