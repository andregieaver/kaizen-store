import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { attentionFor } from "@/lib/control-center";

import type { Account, Membership } from "./auth";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {} }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
  headers: async () => new Headers(),
}));

const attention = await import("./return-attention");
const center = await import("./control-center");
const overview = await import("./order-returns");
const settings = await import("./return-settings");
const translate = await import("./store-translate");
const { getStore } = await import("./stores");

type Row = Record<string, unknown>;

/**
 * What the admin's returns screens read that the returns' own tests do not (D153): what waits in Returns for the control
 * center and a store's Home, what an order's page says about returns, and the instructions' translations and their place in the
 * store translation. Returns are made as the database's own rules allow, by SQL, as `src/db/returns.test.ts` does.
 */

const run = Date.now().toString(36);
let slug: string;
let storeId: string;
let otherStoreId: string;
let account: Account;
let member: Membership;
let seq = 0;

const asMember = async (): Promise<Membership> => ({ ...member, store: (await getStore(slug))! });

async function makeStore(name: string, email: string): Promise<{ id: string; slug: string }> {
  const storeSlug = `${name}-${run}`;
  const [request] = await db().execute<Row>(sql`insert into commerce.access_requests (email, name, store_name) values (${email}, 'Kari', ${name}) returning id`);
  const [store] = await db().execute<Row>(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${storeSlug}, ${name}, null) as id`);
  return { id: String(store.id), slug: storeSlug };
}

beforeAll(async () => {
  const first = await makeStore("radm", `radm-${run}@example.com`);
  slug = first.slug;
  storeId = first.id;
  otherStoreId = (await makeStore("radm2", `radm2-${run}@example.com`)).id;
  await db().execute(sql`update commerce.stores set locales = array['nb-NO', 'sv-SE', 'en-GB'] where id = ${storeId}::uuid`);
  const [row] = await db().execute<Row>(sql`select id, email from commerce.accounts where email = ${`radm-${run}@example.com`}`);
  account = { id: String(row.id), email: String(row.email), name: "Kari", platformAdmin: false };
  member = { account, role: "owner", store: (await getStore(slug))! };
});

afterAll(async () => {
  await closeDb();
});

/** A paid order with one line of 2 units, delivered two days ago. */
async function paidOrder(store = storeId): Promise<{ id: string; number: string; line: string }> {
  seq += 1;
  const number = `${run}-${seq}`;
  const [o] = await db().execute<Row>(sql`
    insert into commerce.orders (store_id, number, market_code, currency, locale, email, status, subtotal_minor, shipping_minor, discount_minor, tax_minor,
      total_minor, billing_address, shipping_address, delivered_at)
    values (${store}::uuid, ${number}, 'NO', 'NOK', 'nb-NO', 'shopper@example.com', 'paid', 20000, 0, 0, 0, 20000, '{}', '{}', now() - interval '2 days')
    returning id
  `);
  const [l] = await db().execute<Row>(sql`
    insert into commerce.order_lines (store_id, order_id, sku, title, quantity, unit_price_minor, total_minor, tax_minor, tax_rate, tax_code)
    values (${store}::uuid, ${String(o.id)}::uuid, ${`SKU-${seq}`}, 'Kopp', 2, 10000, 20000, 0, 0.25, 'txcd_99999999') returning id
  `);
  return { id: String(o.id), number, line: String(l.id) };
}

/** A confirmed withdrawal and its return, with the refund's deadline and the acknowledgement as said. */
async function withdrawal(o: { id: string; line: string }, over: { deadline?: string; acknowledged?: boolean; store?: string } = {}): Promise<string> {
  const store = over.store ?? storeId;
  const [request] = await db().execute<Row>(sql`
    insert into commerce.withdrawal_requests (store_id, order_id, name, email, channel) values (${store}::uuid, ${o.id}::uuid, 'Kari', 'shopper@example.com', 'web') returning id
  `);
  await db().execute(sql`insert into commerce.withdrawal_request_lines (store_id, withdrawal_request_id, order_line_id, quantity) values (${store}::uuid, ${String(request.id)}::uuid, ${o.line}::uuid, 1)`);
  await db().execute(sql`update commerce.withdrawal_requests set status = 'confirmed' where id = ${String(request.id)}::uuid`);
  if (over.acknowledged !== false) await db().execute(sql`update commerce.withdrawal_requests set acknowledged_at = now() where id = ${String(request.id)}::uuid`);
  const [ret] = await db().execute<Row>(sql`
    insert into commerce.returns (store_id, order_id, withdrawal_request_id, kind, status, refund_deadline)
    values (${store}::uuid, ${o.id}::uuid, ${String(request.id)}::uuid, 'withdrawal', 'approved',
            ${over.deadline ? sql`${over.deadline}::timestamptz` : sql`null`})
    returning id
  `);
  await db().execute(sql`insert into commerce.return_lines (store_id, return_id, order_line_id, quantity) values (${store}::uuid, ${String(ret.id)}::uuid, ${o.line}::uuid, 1)`);
  return String(ret.id);
}

async function voluntary(o: { id: string; line: string }): Promise<string> {
  const [ret] = await db().execute<Row>(sql`insert into commerce.returns (store_id, order_id, kind, status) values (${storeId}::uuid, ${o.id}::uuid, 'return', 'requested') returning id`);
  await db().execute(sql`insert into commerce.return_lines (store_id, return_id, order_line_id, quantity) values (${storeId}::uuid, ${String(ret.id)}::uuid, ${o.line}::uuid, 1)`);
  return String(ret.id);
}

describe("what waits in Returns", () => {
  it("is nothing for a store with no returns", async () => {
    expect((await attention.returnAttention([storeId, otherStoreId])).size).toBe(0);
    expect((await attention.returnAttention([])).size).toBe(0);
  });

  it("counts withdrawals past the legal deadline, unsent acknowledgements and return requests, for each store apart", async () => {
    // Overdue and acknowledged; in time and not acknowledged; a return request.
    await withdrawal(await paidOrder(), { deadline: new Date(Date.now() - 2 * 86_400_000).toISOString() });
    await withdrawal(await paidOrder(), { acknowledged: false });
    await voluntary(await paidOrder());
    // Another store's withdrawal, in time: never counted here.
    await withdrawal(await paidOrder(otherStoreId), { store: otherStoreId, acknowledged: false });

    const found = await attention.returnAttention([storeId, otherStoreId]);
    expect(found.get(storeId)).toEqual({ overdue: 1, unacknowledged: 1, requested: 1 });
    expect(found.get(otherStoreId)).toEqual({ overdue: 0, unacknowledged: 1, requested: 0 });
  });

  it("counts the same overdue ones the queue marks", async () => {
    const queue = await (await import("./returns")).listReturns(storeId, { overdue: true });
    expect(queue.total).toBe(1);
    expect((await (await import("./returns")).returnCounts(storeId)).overdue).toBe(1);
  });

  it("is in the control center's store figures, and from there in what needs the owner", async () => {
    const view = await center.controlCenter(account, slug);
    expect(view.stores[0].returns).toEqual({ overdue: 1, unacknowledged: 1, requested: 1 });
    const items = attentionFor(view.stores);
    const returns = items.filter((i) => i.href.includes("/returns"));
    expect(returns.map((i) => i.href)).toEqual([`/admin/${slug}/returns?overdue=1`, `/admin/${slug}/returns`, `/admin/${slug}/returns?status=requested`]);
    expect(returns.map((i) => Boolean(i.urgent))).toEqual([true, true, false]);
  });
});

describe("what an order says about returns", () => {
  it("lists its returns and where it stands in the 14 days", async () => {
    const o = await paidOrder();
    const first = await overview.orderReturnsOverview(storeId, o.id);
    expect(first).toMatchObject({ returns: [], right: "withdrawal", unitsLeft: 2, unitsBought: 2, business: false, copied: false });
    expect(first?.window).toMatchObject({ state: "statutory", basis: "delivered" });
    expect(first?.window?.daysLeft).toBeGreaterThanOrEqual(11);

    const returnId = await withdrawal(o);
    const after = await overview.orderReturnsOverview(storeId, o.id);
    expect(after?.returns.map((r) => [r.id, r.kind, r.status])).toEqual([[returnId, "withdrawal", "approved"]]);
    // One of the two units is taken by the withdrawal.
    expect(after?.unitsLeft).toBe(1);
  });

  it("has nothing to say about an order that is not the store's", async () => {
    const o = await paidOrder(otherStoreId);
    expect(await overview.orderReturnsOverview(storeId, o.id)).toBeNull();
    expect(await overview.orderReturnsOverview(storeId, "00000000-0000-4000-8000-000000000000")).toBeNull();
  });

  it("says a company has no statutory right", async () => {
    const o = await paidOrder();
    await db().execute(sql`update commerce.orders set company_name = 'Firma AS' where id = ${o.id}::uuid`);
    const view = await overview.orderReturnsOverview(storeId, o.id);
    expect(view).toMatchObject({ business: true, right: "none", unitsLeft: 0 });
  });
});

describe("the instructions in the store's other languages", () => {
  it("are saved for the languages the store offers, and read back", async () => {
    expect(await settings.getInstructionTranslations(storeId)).toEqual({});
    const saved = await settings.saveInstructionTranslations(storeId, { "sv-SE": " Packa väl. ", "en-GB": "" }, ["sv-SE", "en-GB"], account.id);
    expect(saved).toEqual({ ok: true, translations: { "sv-SE": "Packa väl." } });
    expect(await settings.getInstructionTranslations(storeId)).toEqual({ "sv-SE": "Packa väl." });
  });

  it("are refused for a language the store does not offer, or when too long, and nothing is saved", async () => {
    const wrong = await settings.saveInstructionTranslations(storeId, { "fr-FR": "Emballez." }, ["sv-SE", "en-GB"], account.id);
    expect(wrong).toMatchObject({ ok: false });
    const long = await settings.saveInstructionTranslations(storeId, { "sv-SE": "x".repeat(2001) }, ["sv-SE", "en-GB"], account.id);
    expect(long).toMatchObject({ ok: false });
    expect(await settings.getInstructionTranslations(storeId)).toEqual({ "sv-SE": "Packa väl." });
  });

  it("stay when the rules are saved, and are replaced as a whole when the translations are", async () => {
    const rules = { windowDays: 30, transitDays: 2, whoPaysReturn: "store", refundWhen: "request", acceptExcluded: false, b2bReturns: false, instructions: "Pakk godt.", returnAddress: null };
    expect(await settings.saveReturnSettings(storeId, rules, account.id)).toMatchObject({ ok: true, settings: { windowDays: 30, instructions: "Pakk godt." } });
    expect(await settings.getInstructionTranslations(storeId)).toEqual({ "sv-SE": "Packa väl." });
    await settings.saveInstructionTranslations(storeId, { "en-GB": "Pack well." }, ["sv-SE", "en-GB"], account.id);
    expect(await settings.getInstructionTranslations(storeId)).toEqual({ "en-GB": "Pack well." });
    // The rules were not touched by saving the texts.
    expect((await settings.getReturnSettings(storeId)).windowDays).toBe(30);
  });

  it("are made for a store with no settings yet, with the legal defaults for the rest", async () => {
    await settings.saveInstructionTranslations(otherStoreId, { "sv-SE": "Hej" }, ["sv-SE"], account.id);
    expect(await settings.getReturnSettings(otherStoreId)).toMatchObject({ windowDays: 14, transitDays: 3, whoPaysReturn: "shopper", refundWhen: "received" });
  });
});

describe("the store translation's return instructions", () => {
  it("finds the instructions for a language that has none, as a legal unit", async () => {
    await settings.saveInstructionTranslations(storeId, { "en-GB": "Pack well." }, ["sv-SE", "en-GB"], account.id);
    const m = await asMember();
    const swedish = await translate.translationWorklist(m, "sv-SE", ["returns"], "missing", null);
    expect(swedish.units).toHaveLength(1);
    expect(swedish.units[0]).toMatchObject({ id: "returns:instructions", scope: "returns", legal: true });
    expect(swedish.units[0].items[0].runs).toEqual(["Pakk godt."]);
    // English has it, so only "everything again" asks for it.
    expect((await translate.translationWorklist(m, "en-GB", ["returns"], "missing", null)).units).toEqual([]);
    expect((await translate.translationWorklist(m, "en-GB", ["returns"], "all", null)).units).toHaveLength(1);
    // And it is counted in what each language lacks.
    const coverage = await translate.translationCoverage(m);
    expect(coverage["sv-SE"].returns).toBe(1);
    expect(coverage["en-GB"].returns).toBe(0);
  });

  it("has nothing to find where the store has no instructions", async () => {
    const [bare] = await db().execute<Row>(sql`select id from commerce.stores where id = ${otherStoreId}::uuid`);
    expect(String(bare.id)).toBe(otherStoreId);
    await db().execute(sql`update commerce.stores set locales = array['nb-NO', 'sv-SE'] where id = ${otherStoreId}::uuid`);
    const other = { ...member, store: (await getStore(`radm2-${run}`))! };
    expect((await translate.translationWorklist(other, "sv-SE", ["returns"], "all", null)).units).toEqual([]);
  });

  it("writes what staff accepted into that language's text, keeping the others", async () => {
    const m = await asMember();
    const result = await translate.applyTranslations(m, "sv-SE", [{ unitId: "returns:instructions", values: { instructions: " Packa varan väl. " } }]);
    expect(result).toEqual({ ok: true, saved: 1, skipped: [] });
    expect(await settings.getInstructionTranslations(storeId)).toEqual({ "en-GB": "Pack well.", "sv-SE": "Packa varan väl." });
    // The main language's own text is untouched.
    expect((await settings.getReturnSettings(storeId)).instructions).toBe("Pakk godt.");
  });

  it("leaves out a suggestion that is not usable, or too long", async () => {
    const m = await asMember();
    const empty = await translate.applyTranslations(m, "sv-SE", [{ unitId: "returns:instructions", values: { instructions: "   " } }]);
    expect(empty).toMatchObject({ ok: true, saved: 0 });
    const long = await translate.applyTranslations(m, "sv-SE", [{ unitId: "returns:instructions", values: { instructions: "x".repeat(2001) } }]);
    expect(long).toMatchObject({ ok: true, saved: 0 });
    expect(await settings.getInstructionTranslations(storeId)).toMatchObject({ "sv-SE": "Packa varan väl." });
  });

  it("is refused for a language that is not one of the store's other languages", async () => {
    const m = await asMember();
    expect(await translate.applyTranslations(m, "nb-NO", [{ unitId: "returns:instructions", values: { instructions: "x" } }])).toMatchObject({ ok: false });
    expect(await translate.applyTranslations(m, "fr-FR", [{ unitId: "returns:instructions", values: { instructions: "x" } }])).toMatchObject({ ok: false });
  });
});
