import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import {
  changesFrom,
  emptyGroup,
  newField,
  type FieldChanges,
  type FieldDef,
  type FieldGroupInput,
} from "@/lib/custom-fields";
import { hasStoreBindings } from "@/lib/field-binding";
import { newPageContent, type PageContent } from "@/lib/page-content";

import type { Membership } from "./auth";
import type { Store } from "./stores";

type Row = Record<string, unknown>;

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }) }));
vi.mock("next/cache", () => ({
  cacheLife: () => {},
  cacheTag: () => {},
  updateTag: () => {},
  revalidateTag: () => {},
  refresh: () => {},
}));

const fields = await import("./custom-fields");
const entities = await import("./field-entities");
const binding = await import("./field-binding");
const customers = await import("./customers");
const ownerTools = await import("./owner-tools");
const { getStore } = await import("./stores");

/**
 * Custom fields on the store itself, on customers and on orders (D120): the
 * store's public fields are shown through the site's reads and bound blocks;
 * a customer's and an order's are for staff only, whatever the data says, and
 * go with the customer.
 */

const run = Date.now().toString(36);
let store: Store;
let member: Membership;
let other: { store: Store; customerId: string };

const setupStore = async (name: string) => {
  const [request] = await db().execute<Row>(
    sql`insert into commerce.access_requests (email, name, store_name) values (${`${name}@example.com`}, 'F', 'Butikk') returning id`,
  );
  await db().execute<Row>(
    sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${name}, 'Butikk', null)`,
  );
  const [owner] = await db().execute<Row>(
    sql`select id, email from commerce.accounts where email = ${`${name}@example.com`}`,
  );
  await db().execute(sql`update commerce.stores set locales = array['nb-NO', 'sv-SE'], features = features || array['countries', 'languages', 'currencies'] where slug = ${name}`);
  const made = (await getStore(name))!;
  return {
    store: made,
    member: {
      account: { id: String(owner.id), email: String(owner.email), name: "F", platformAdmin: false },
      role: "owner",
      store: made,
    } as Membership,
  };
};

const newCustomer = async (storeId: string, email: string) =>
  String(
    (
      await db().execute<Row>(
        sql`insert into commerce.customers (store_id, email) values (${storeId}::uuid, ${email}) returning id`,
      )
    )[0].id,
  );
const newOrder = async (storeId: string, number: string) =>
  String(
    (
      await db().execute<Row>(sql`
        insert into commerce.orders (store_id, number, market_code, currency, locale, email, status,
          subtotal_minor, shipping_minor, tax_minor, total_minor, billing_address, shipping_address)
        values (${storeId}::uuid, ${number}, 'NO', 'NOK', 'nb-NO', 'guest@example.com', 'paid', 10000, 0, 2000, 10000, '{}', '{}')
        returning id`)
    )[0].id,
  );

beforeAll(async () => {
  const mine = await setupStore(`store-fields-${run}`);
  store = mine.store;
  member = mine.member;
  const theirs = await setupStore(`store-fields-b-${run}`);
  other = { store: theirs.store, customerId: await newCustomer(theirs.store.id, "someone@example.com") };
});

afterAll(async () => {
  await closeDb();
});

const pub = (over: Partial<FieldDef> & { type: FieldDef["type"] }): FieldDef => ({
  ...newField(over.type),
  access: "public",
  ...over,
});
const priv = (over: Partial<FieldDef> & { type: FieldDef["type"] }): FieldDef => ({
  ...newField(over.type),
  access: "private",
  ...over,
});
const saveGroup = async (input: Partial<FieldGroupInput> & { fields: FieldDef[] }) => {
  const result = await fields.saveFieldGroup(member, {
    ...emptyGroup(),
    name: "G",
    slug: `g-${Math.random().toString(36).slice(2, 8)}`,
    ...input,
  });
  return result;
};

describe("the store's own fields", () => {
  const hours = pub({ type: "text", name: "hours", label: "Opening hours" });
  const story = pub({ type: "textarea", name: "story", label: "Brand story" });
  const contact = priv({ type: "text", name: "contact", label: "Private contact" });
  const open = pub({ type: "boolean", name: "open_sundays", label: "Open on Sundays" });

  beforeAll(async () => {
    const saved = await saveGroup({ name: "About us", slug: "about-us", entities: ["store"], fields: [hours, story, contact, open] });
    expect(saved, JSON.stringify(saved)).toMatchObject({ ok: true });
  });

  it("are edited with the groups on the store, none for a store that has none", async () => {
    const editor = await entities.storeFieldsForEditor(store.id);
    expect(editor.groups.map((g) => g.slug)).toEqual(["about-us"]);
    expect(await entities.hasFieldGroupsFor(store.id, "store")).toBe(true);
    expect((await entities.storeFieldsForEditor(other.store.id)).groups).toEqual([]);
    expect(await entities.hasFieldGroupsFor(other.store.id, "customer")).toBe(false);
  });

  it("are saved per language, and shown in the shopper's, public fields only", async () => {
    const changes: FieldChanges = {
      values: { [open.id]: true },
      translations: {
        "nb-NO": { [hours.id]: "Man–fre 9–17", [story.id]: "Vi brenner kaffe.", [contact.id]: "Kari 900 00 000" },
        "sv-SE": { [hours.id]: "Mån–fre 9–17" },
      },
    } as never;
    expect(await entities.saveStoreFields(member, changes)).toEqual({ ok: true });

    const sv = await fields.shownFieldsFor(store.id, "store", store.id, "sv-SE", "sv", "se");
    const texts = sv.flatMap((g) => g.fields.map((f) => [f.label, f.text]));
    // Swedish where written, Norwegian (the main language) where not; the private field is never shown.
    expect(texts).toEqual([
      ["Opening hours", "Mån–fre 9–17"],
      ["Brand story", "Vi brenner kaffe."],
      ["Open on Sundays", expect.any(String)],
    ]);
    expect(JSON.stringify(sv)).not.toContain("Kari 900");
    // What is saved is checked against the definitions: a text for a yes-or-no field is refused.
    const wrong = await entities.saveStoreFields(member, { values: { [open.id]: "maybe" }, translations: {} });
    expect(wrong).toMatchObject({ ok: false });
  });

  it("belong to the store: another id, or another store's, shows nothing", async () => {
    expect(await fields.shownFieldsFor(store.id, "store", crypto.randomUUID(), "nb-NO", "nb", "no")).toEqual([]);
    expect(await fields.shownFieldsFor(other.store.id, "store", other.store.id, "nb-NO", "nb", "no")).toEqual([]);
    // Another store's values are never read for this one.
    expect(await fields.shownFieldsFor(other.store.id, "store", store.id, "nb-NO", "nb", "no")).toEqual([]);
  });

  it("are read back for the editor, and the changes it sends keep what was not touched", async () => {
    const editor = await entities.storeFieldsForEditor(store.id);
    expect(editor.data.translations["nb-NO"][hours.id]).toBe("Man–fre 9–17");
    const sent = changesFrom(editor.groups.flatMap((g) => g.fields), editor.data, ["nb-NO", "sv-SE"]);
    sent.translations["nb-NO"][story.id] = "Vi brenner kaffe hver dag.";
    expect(await entities.saveStoreFields(member, sent)).toEqual({ ok: true });
    const again = await entities.storeFieldsForEditor(store.id);
    expect(again.data.translations["nb-NO"][story.id]).toBe("Vi brenner kaffe hver dag.");
    expect(again.data.translations["sv-SE"][hours.id]).toBe("Mån–fre 9–17");
    expect(again.data.values[open.id]).toBe(true);
  });

  it("are shown through blocks bound to them, in a header or a page", async () => {
    const market = store.markets.find((m) => m.locale === "nb-NO") ?? store.markets[0];
    const content: PageContent = {
      ...newPageContent(),
      rows: [
        {
          id: "row1",
          type: "row",
          layout: "1",
          columns: [
            {
              id: "col1",
              blocks: [
                { id: "h1", type: "heading", text: "Own", level: 2, bind: { fieldId: hours.id, source: "store" } },
                // A field of the page's own, in a header: there is none, so the block is left out.
                { id: "h2", type: "heading", text: "Page's", level: 2, bind: { fieldId: hours.id } },
                // A private field of the store: never used.
                { id: "h3", type: "heading", text: "Private", level: 2, bind: { fieldId: contact.id, source: "store" } },
              ],
            },
          ],
        },
      ],
    };
    expect(hasStoreBindings(content)).toBe(true);
    const bound = await binding.bindStoreFields(content, store, market);
    const blocks = bound.rows[0].columns[0].blocks;
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ id: "h1", text: expect.stringContaining("9") });
    // No binding, no read: the content is returned as it is.
    const plain = { ...content, rows: [{ ...content.rows[0], columns: [{ id: "c", blocks: [] }] }] };
    expect(await binding.bindStoreFields(plain, store, market)).toBe(plain);
  });

  it("are asked for by the AI manager, without an item", async () => {
    const ctx = { account: member.account, store, invalidate: () => {} };
    const read = (await ownerTools.runOwnerTool(ctx, "get_fields", { entity: "store" })) as {
      groups: { group: string; fields: { name: string; value: unknown }[] }[];
    };
    expect(read.groups.map((g) => g.group)).toEqual(["About us"]);
    expect(read.groups[0].fields.find((f) => f.name === "hours")?.value).toBe("Man–fre 9–17");
    // A product still needs its item.
    await expect(ownerTools.runOwnerTool(ctx, "get_fields", { entity: "product" })).rejects.toThrow(/item/);
  });

  it("are in the translation worklist as one unit of the store", async () => {
    const { fieldWork } = await import("./field-translate");
    const units = await fieldWork(store.id, "nb-NO", "sv-SE", "missing");
    const unit = units.find((u) => u.id === `fieldval:store:${store.id}`);
    // Swedish is missing for the brand story only; the public text fields are the store's.
    expect(unit?.kind).toBe("Store fields");
    expect(unit?.items.map((i) => i.label)).toEqual(["Brand story"]);
    const { writeFieldUnit } = await import("./field-translate");
    expect(await writeFieldUnit(member, unit!.id, "sv-SE", { [story.id]: "Vi rostar kaffe." })).toBe(true);
    const sv = await fields.shownFieldsFor(store.id, "store", store.id, "sv-SE", "sv", "se");
    expect(sv.flatMap((g) => g.fields.map((f) => f.text))).toContain("Vi rostar kaffe.");
  });
});

describe("a customer's fields are for staff only", () => {
  const vip = priv({ type: "boolean", name: "vip", label: "VIP" });
  const note = priv({ type: "textarea", name: "note", label: "Note" });
  let customerId: string;

  beforeAll(async () => {
    customerId = await newCustomer(store.id, `vip-${run}@example.com`);
    const saved = await saveGroup({ name: "Customer notes", slug: "customer-notes", entities: ["customer"], fields: [vip, note] });
    expect(saved, JSON.stringify(saved)).toMatchObject({ ok: true });
    // A group on customers cannot be made with a public field, or with anything else on it.
    expect(await saveGroup({ name: "Bad", slug: "bad-1", entities: ["customer"], fields: [pub({ type: "text", name: "t", label: "T" })] })).toMatchObject({ ok: false });
    expect(await saveGroup({ name: "Bad", slug: "bad-2", entities: ["customer", "product"], fields: [priv({ type: "text", name: "t", label: "T" })] })).toMatchObject({ ok: false });
  });

  it("are edited on the customer's page and saved for the customer", async () => {
    const editor = await entities.staffFieldsForEditor(store.id, "customer", customerId);
    expect(editor?.groups.map((g) => g.slug)).toEqual(["customer-notes"]);
    const saved = await entities.saveStaffFields(member, "customer", customerId, {
      values: { [vip.id]: true },
      translations: { "nb-NO": { [note.id]: "Vil ha bønner malt grovt" } },
    });
    expect(saved).toEqual({ ok: true });
    const again = await entities.staffFieldsForEditor(store.id, "customer", customerId);
    expect(again?.data.values[vip.id]).toBe(true);
    expect(again?.data.translations["nb-NO"][note.id]).toBe("Vil ha bønner malt grovt");
    const [audit] = await db().execute<Row>(
      sql`select details from commerce.audit_log where store_id = ${store.id}::uuid and action = 'customer.fields_updated' order by created_at desc limit 1`,
    );
    // The audit log names the customer, never what was written.
    expect(JSON.stringify(audit.details)).toContain(customerId);
    expect(JSON.stringify(audit.details)).not.toContain("bønner");
  });

  it("are the store's own customer only", async () => {
    expect(await entities.staffFieldsForEditor(store.id, "customer", other.customerId)).toBeNull();
    expect(await entities.saveStaffFields(member, "customer", other.customerId, { values: { [vip.id]: true }, translations: {} })).toMatchObject({ ok: false });
    expect(await entities.staffFieldsForEditor(store.id, "customer", crypto.randomUUID())).toBeNull();
    const [row] = await db().execute<Row>(sql`select count(*)::int as n from commerce.field_values where entity_id = ${other.customerId}::uuid`);
    expect(row.n).toBe(0);
  });

  it("are never read by anything the shopper or the site reaches", async () => {
    // The site's read refuses them, whatever the data and the groups say.
    for (const entity of ["customer", "order"] as const) {
      expect(await fields.shownFieldsFor(store.id, entity, customerId, "nb-NO", "nb", "no")).toEqual([]);
    }
    // Even a group that was made public behind the app's back, with a value entered in it.
    const [group] = await db().execute<Row>(sql`
      insert into commerce.field_groups (store_id, name, slug, entities, fields)
      values (${store.id}::uuid, 'Tampered', 'tampered', '["customer", "product"]'::jsonb,
        ${JSON.stringify([{ id: "f_tamper000001", name: "leak", label: "Leak", type: "text", access: "public" }])}::jsonb)
      returning id`);
    await db().execute(sql`
      insert into commerce.field_values (store_id, entity, entity_id, locale, values)
      values (${store.id}::uuid, 'customer', ${customerId}::uuid, 'nb-NO', '{"f_tamper000001": "secret"}'::jsonb)
      on conflict (store_id, entity, entity_id, locale) do update set values = commerce.field_values.values || excluded.values`);
    expect(await fields.shownFieldsFor(store.id, "customer", customerId, "nb-NO", "nb", "no")).toEqual([]);
    // A product page never reads a customer's row, and the page builder's groups leave customers' out.
    expect(JSON.stringify(await fields.shownFieldsFor(store.id, "product", customerId, "nb-NO", "nb", "no"))).not.toContain("secret");
    expect((await fields.allActiveFieldGroups(store.id)).map((g) => g.slug)).not.toContain("customer-notes");
    // Nor can such a group be filled in for a customer: it is not one for staff.
    const before = await fields.getFieldData(store.id, "customer", customerId);
    const refused = await entities.saveStaffFields(member, "customer", customerId, { values: {}, translations: { "nb-NO": { f_tamper000001: "more" } } });
    expect(refused).toEqual({ ok: true });
    expect(await fields.getFieldData(store.id, "customer", customerId)).toEqual(before);
    expect(JSON.stringify(await fields.getFieldData(store.id, "customer", customerId))).not.toContain("more");
    await db().execute(sql`delete from commerce.field_groups where id = ${String(group.id)}::uuid`);
  });

  it("are not offered to the AI manager", async () => {
    const ctx = { account: member.account, store, invalidate: () => {} };
    const listed = (await ownerTools.runOwnerTool(ctx, "list_field_groups", {})) as { groups: { slug: string }[] };
    expect(listed.groups.map((g) => g.slug)).not.toContain("customer-notes");
    // And the tool cannot be pointed at a customer.
    await expect(ownerTools.runOwnerTool(ctx, "get_fields", { entity: "customer", item: customerId })).rejects.toThrow();
  });

  it("are handed over with the customer's data, and go when the customer is deleted", async () => {
    const exported = await entities.customerFieldExport(store, customerId);
    expect(exported).toEqual([
      { group: "Customer notes", label: "VIP", value: expect.any(String) },
      { group: "Customer notes", label: "Note", value: "Vil ha bønner malt grovt" },
    ]);
    // A group that was switched off still holds what was entered: it is exported too.
    await db().execute(sql`update commerce.field_groups set active = false where store_id = ${store.id}::uuid and slug = 'customer-notes'`);
    expect((await entities.customerFieldExport(store, customerId)).length).toBe(2);
    await db().execute(sql`update commerce.field_groups set active = true where store_id = ${store.id}::uuid and slug = 'customer-notes'`);

    await customers.deleteCustomer(store.id, customerId);
    const left = await db().execute<Row>(
      sql`select 1 from commerce.field_values where store_id = ${store.id}::uuid and entity = 'customer' and entity_id = ${customerId}::uuid`,
    );
    expect(left).toHaveLength(0);
    expect(await entities.customerFieldExport(store, customerId)).toEqual([]);
  });
});

describe("an order's fields are for staff only", () => {
  const ref = priv({ type: "text", name: "purchase_order", label: "Customer's purchase order" });
  let orderId: string;

  beforeAll(async () => {
    orderId = await newOrder(store.id, `K-${run}`);
    const saved = await saveGroup({ name: "Order notes", slug: "order-notes", entities: ["order"], fields: [ref] });
    expect(saved, JSON.stringify(saved)).toMatchObject({ ok: true });
  });

  it("are saved for the order and never shown", async () => {
    expect((await entities.staffFieldsForEditor(store.id, "order", orderId))?.groups.map((g) => g.slug)).toEqual(["order-notes"]);
    expect(await entities.saveStaffFields(member, "order", orderId, { values: {}, translations: { "nb-NO": { [ref.id]: "PO-12345" } } })).toEqual({ ok: true });
    expect((await entities.staffFieldsForEditor(store.id, "order", orderId))?.data.translations["nb-NO"][ref.id]).toBe("PO-12345");
    expect(await fields.shownFieldsFor(store.id, "order", orderId, "nb-NO", "nb", "no")).toEqual([]);
    // Not another store's order.
    const foreign = await newOrder(other.store.id, `K-B-${run}`);
    expect(await entities.staffFieldsForEditor(store.id, "order", foreign)).toBeNull();
    expect(await entities.saveStaffFields(member, "order", foreign, { values: {}, translations: {} })).toMatchObject({ ok: false });
  });

  it("stay with the order (orders are kept for the books), and the group is the owner's to keep free of what is not needed", async () => {
    const [row] = await db().execute<Row>(sql`select count(*)::int as n from commerce.field_values where store_id = ${store.id}::uuid and entity = 'order'`);
    expect(row.n).toBe(1);
    // Deleting a customer never touches their orders' values.
    const [orders] = await db().execute<Row>(sql`select count(*)::int as n from commerce.field_values where entity = 'order' and entity_id = ${orderId}::uuid`);
    expect(orders.n).toBe(1);
  });
});
