import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { recordQuery, type RecordKind, type RecordQuery } from "@/lib/finder-records";

import { addMember, makeAccount, makeStore, run } from "./trust-fixtures";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));

const { accountScopes, findRecords, memberScope } = await import("./finder-records");
const { ensurePipeline } = await import("./deals");
const { ensureDesk } = await import("./support");
const { systemDesk } = await import("./support-desk");

type Row = Record<string, unknown>;

/**
 * The page finder's records (ecosystem plan E2.2, D713) against a real database: each kind found by what its own list searches, only in the
 * stores and kinds a person may read; another store's rows never appear, a member without `customers:read` gets no customers (nor deals),
 * deals only while Deals (`sales`) are on, an erased order is never found by its address, and across stores each store's own role,
 * features and second step decide.
 */

const tok = `fz${run}`.toLowerCase();
let a: Awaited<ReturnType<typeof makeStore>>;
let b: Awaited<ReturnType<typeof makeStore>>;
let n = 0;
const ids: Record<string, string> = {};

const q = (text: string): RecordQuery => recordQuery(text)!;
const one = (storeId: string, kinds: readonly RecordKind[]) => [{ storeId, kinds }];
const ALL: RecordKind[] = ["order", "customer", "conversation", "deal", "product"];
const keysOf = (found: Awaited<ReturnType<typeof findRecords>>, kind: RecordKind) => found.filter((r) => r.kind === kind).map((r) => r.key);

async function order(storeId: string, o: { number: string; email: string; customerId?: string | null; name?: string; erased?: boolean; at?: string }): Promise<string> {
  n += 1;
  const [row] = await db().execute<Row>(sql`
    insert into commerce.orders (store_id, number, market_code, currency, locale, email, customer_id, status, subtotal_minor, shipping_minor, discount_minor,
      tax_minor, total_minor, billing_address, shipping_address, placed_at, restricted_at)
    values (${storeId}::uuid, ${o.number}, 'NO', 'NOK', 'nb-NO', ${o.email}, ${o.customerId ?? null}::uuid, 'paid', 12950, 0, 0, 0, 12950, '{}'::jsonb,
      ${JSON.stringify(o.name ? { name: o.name } : {})}::jsonb, ${o.at ?? `2026-10-${String(10 + n).padStart(2, "0")}T10:00:00Z`}::timestamptz,
      ${o.erased ? sql`now()` : sql`null`})
    returning id
  `);
  return String(row.id);
}

async function seed(storeId: string, label: string) {
  const [customer] = await db().execute<Row>(sql`
    insert into commerce.customers (store_id, email, name) values (${storeId}::uuid, ${`kari-${tok}@example.com`}, ${`Kari ${tok}`}) returning id
  `);
  ids[`${label}.customer`] = String(customer.id);
  ids[`${label}.order`] = await order(storeId, { number: `${tok.toUpperCase()}-101`, email: `kari-${tok}@example.com`, customerId: String(customer.id), name: `Kari ${tok}` });
  // A desk answered by people, so a conversation starts in the queue.
  await ensureDesk(systemDesk(storeId));
  await db().execute(sql`update commerce.support_settings set mode = 'people' where store_id = ${storeId}::uuid`);
  const [conversation] = await db().execute<Row>(sql`
    insert into commerce.support_conversations (store_id, source, handler, token_hash, locale, contact_name, contact_email)
    values (${storeId}::uuid, 'site', 'queue', ${`h-${tok}-${label}`}, 'nb-NO', ${`Ola ${tok}`}, ${`ola-${tok}@example.com`}) returning id
  `);
  ids[`${label}.conversation`] = String(conversation.id);
  const [pipeline] = await ensurePipeline(storeId, { name: "Sales", stages: [{ name: "New" }] });
  const [deal] = await db().execute<Row>(sql`
    insert into commerce.deals (store_id, title, pipeline_id, stage_id, currency, customer_id)
    values (${storeId}::uuid, ${`Fair order ${tok}`}, ${pipeline.id}::uuid, ${pipeline.stages[0].id}::uuid, 'NOK', ${String(customer.id)}::uuid) returning id
  `);
  ids[`${label}.deal`] = String(deal.id);
  const [product] = await db().execute<Row>(sql`
    insert into commerce.products (store_id, handle, tax_code, status) values (${storeId}::uuid, ${`lamp-${tok}-${label}`}, 'txcd_99999999', 'draft') returning id
  `);
  ids[`${label}.product`] = String(product.id);
  await db().execute(sql`
    insert into commerce.product_translations (store_id, product_id, locale, title) values (${storeId}::uuid, ${String(product.id)}::uuid, 'nb-NO', ${`Lamp ${tok}`})
  `);
  await db().execute(sql`
    insert into commerce.product_variants (store_id, product_id, sku) values (${storeId}::uuid, ${String(product.id)}::uuid, ${`SKU-${tok}-${label}`.toUpperCase()})
  `);
}

beforeAll(async () => {
  a = await makeStore("finder-a");
  b = await makeStore("finder-b");
  await db().execute(sql`update commerce.stores set features = array['shop', 'sales'] where id = any(array[${a.id}::uuid, ${b.id}::uuid])`);
  await seed(a.id, "a");
  await seed(b.id, "b");
  // A guest of store a (no account), and an order whose person's data is restricted (D162): its address is still in the row, never searched.
  ids["a.guest1"] = await order(a.id, { number: `G${tok}-1`.toUpperCase(), email: `guest-${tok}@example.com`, name: "Per Gjest", at: "2026-09-01T10:00:00Z" });
  ids["a.guest2"] = await order(a.id, { number: `G${tok}-2`.toUpperCase(), email: `Guest-${tok}@Example.com`, at: "2026-09-05T10:00:00Z" });
  ids["a.erased"] = await order(a.id, { number: `E${tok}-1`.toUpperCase(), email: `erased-${tok}@example.com`, erased: true });
}, 120_000);

afterAll(async () => {
  await closeDb();
});

describe("finding a store's records (E2.2)", () => {
  it("finds each kind by what its own list searches, and never another store's", async () => {
    const found = await findRecords(one(a.id, ALL), q(tok));
    expect(keysOf(found, "customer")).toEqual([ids["a.customer"]]);
    expect(keysOf(found, "conversation")).toEqual([ids["a.conversation"]]);
    expect(keysOf(found, "deal")).toEqual([ids["a.deal"]]);
    expect(keysOf(found, "product")).toEqual([ids["a.product"]]);
    expect(found.every((r) => r.storeId === a.id)).toBe(true);
    const everything = Object.entries(ids).filter(([k]) => k.startsWith("b.")).map(([, id]) => id);
    expect(found.some((r) => everything.includes(r.key))).toBe(false);
  });

  it("finds an order by the start of its number (with or without #, in any case) or its exact email, never by other words", async () => {
    const byNumber = await findRecords(one(a.id, ["order"]), q(`#${tok}-1`));
    expect(keysOf(byNumber, "order")).toEqual([ids["a.order"]]);
    expect(byNumber[0]).toMatchObject({ title: `${tok.toUpperCase()}-101`, detail: `Kari ${tok}`, rank: 1, minor: 12950, currency: "NOK" });
    expect((await findRecords(one(a.id, ["order"]), q(`${tok}-101`)))[0].rank).toBe(0);
    expect(keysOf(await findRecords(one(a.id, ["order"]), q(`kari-${tok}@example.com`)), "order")).toEqual([ids["a.order"]]);
    // A name is no order search: orders are found by their number or address only, which the indexes serve.
    expect(await findRecords(one(a.id, ["order"]), q(`Kari ${tok}`))).toEqual([]);
  });

  it("never finds an erased order by its address, nor names its person; its number still finds it", async () => {
    expect(await findRecords(one(a.id, ["order"]), q(`erased-${tok}@example.com`))).toEqual([]);
    const [byNumber] = await findRecords(one(a.id, ["order"]), q(`E${tok}-1`));
    expect(byNumber).toMatchObject({ key: ids["a.erased"], detail: null });
  });

  it("finds a guest by their exact email, keyed by their latest order as the customers list keys them", async () => {
    const found = await findRecords(one(a.id, ["customer"]), q(`GUEST-${tok}@example.com`));
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ key: ids["a.guest2"], rank: 0 });
    // Part of a guest's address finds nobody: only accounts are searched inside their words.
    expect(await findRecords(one(a.id, ["customer"]), q(`guest-${tok}`))).toEqual([]);
  });

  it("finds a product by its SKU, exactly first", async () => {
    const [product] = await findRecords(one(a.id, ["product"]), q(`sku-${tok}-a`));
    expect(product).toMatchObject({ key: ids["a.product"], title: `Lamp ${tok}`, detail: `SKU-${tok}-A`.toUpperCase(), rank: 0 });
  });

  it("gives a member without customers:read no customers and no deals", async () => {
    const scope = memberScope({ role: "admin", kind: "staff", permissions: ["orders:read", "support:read", "products:read"], store: { id: a.id, status: "active", features: ["shop", "sales"] } });
    expect(scope.kinds).toEqual(["order", "conversation", "product"]);
    const found = await findRecords([scope], q(tok));
    expect(found.some((r) => r.kind === "customer" || r.kind === "deal")).toBe(false);
    expect(keysOf(found, "conversation")).toEqual([ids["a.conversation"]]);
  });

  it("offers no deals while Deals are off, and only what a closed store still lets its members read", async () => {
    const owner = { role: "owner" as const, kind: "staff" as const, permissions: null };
    const off = memberScope({ ...owner, store: { id: a.id, status: "active", features: ["shop"] } });
    expect(off.kinds).not.toContain("deal");
    expect((await findRecords([off], q(tok))).some((r) => r.kind === "deal")).toBe(false);
    const closed = memberScope({ ...owner, store: { id: a.id, status: "closed", features: ["shop", "sales"] } });
    expect(closed.kinds).toContain("order");
    expect(closed.kinds).not.toContain("product");
  });

  it("reads nothing for no kinds", async () => {
    expect(await findRecords([{ storeId: a.id, kinds: [] }], q(tok))).toEqual([]);
  });
});

describe("finding records across an account's stores (E2.2)", () => {
  it("reads each store by the person's own role there, its features, and its second step", async () => {
    const person = await makeAccount("finder-person");
    const [role] = await db().execute<Row>(sql`
      insert into commerce.store_roles (store_id, name, permissions) values (${b.id}::uuid, ${`Packers ${tok}`}, array['orders:read', 'products:read']) returning id
    `);
    await addMember(a.id, person.id, "admin");
    await addMember(b.id, person.id, "admin", { roleId: String(role.id) });
    await db().execute(sql`update commerce.stores set features = array['shop'] where id = ${b.id}::uuid`);

    const scopes = await accountScopes(person.id, () => true);
    const byStore = new Map(scopes.map((s) => [s.storeId, s]));
    expect(byStore.get(a.id)!.kinds).toEqual(ALL);
    expect(byStore.get(b.id)!.kinds).toEqual(["order", "product"]);
    expect(byStore.get(b.id)!.slug).toBe(b.slug);

    const found = await findRecords(scopes, q(tok));
    // Store b's customer, conversation and deal stay out: the person's role there cannot read them.
    expect(keysOf(found, "customer")).toEqual([ids["a.customer"]]);
    expect(keysOf(found, "conversation")).toEqual([ids["a.conversation"]]);
    expect(keysOf(found, "deal")).toEqual([ids["a.deal"]]);
    expect(keysOf(found, "product").sort()).toEqual([ids["a.product"], ids["b.product"]].sort());

    // A store that asks for a second step the session has not passed is left out whole.
    await db().execute(sql`update commerce.stores set require_two_step = true where id = ${a.id}::uuid`);
    const held = await accountScopes(person.id, (requires) => !requires);
    expect(held.map((s) => s.storeId)).toEqual([b.id]);
    await db().execute(sql`update commerce.stores set require_two_step = false where id = ${a.id}::uuid`);

    // A membership switched off, and a stranger, read nothing.
    await db().execute(sql`update commerce.store_members set disabled_at = now() where store_id = ${b.id}::uuid and account_id = ${person.id}::uuid`);
    expect((await accountScopes(person.id, () => true)).map((s) => s.storeId)).toEqual([a.id]);
    const stranger = await makeAccount("finder-stranger");
    expect(await accountScopes(stranger.id, () => true)).toEqual([]);
  });
});
