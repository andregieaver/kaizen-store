import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), connection: async () => {}, after: () => {} }));

/** Stripe, scripted: every refund succeeds, and how much each asked for is kept. */
const fake = vi.hoisted(() => {
  const asked: number[] = [];
  return {
    asked,
    client: {
      checkout: { sessions: { retrieve: async (id: string) => ({ id, payment_intent: `pi_for_${id}`, invoice: null }) } },
      refunds: {
        create: async (input: { amount?: number }) => {
          asked.push(Number(input.amount ?? 0));
          return { id: `re_${Math.random().toString(36).slice(2)}`, status: "succeeded" };
        },
      },
    },
  };
});
vi.mock("./stripe", () => ({ platformStripe: () => fake.client, platformPublishableKey: () => "pk_test_x", platformModes: () => ["test"], WEBHOOK_EVENTS: [] }));
vi.mock("./stripe-keys", () => ({ platformModes: () => ["test"], platformPublishableKey: () => "pk_test_x", platformSecretKey: () => "sk_test_x" }));

const { closeDb, db } = await import("@/db/client");
const carry = await import("./support-carry-out");
const { memberDesk } = await import("./support-desk");
const { newStore } = await import("./inventory-test-support");

type Row = Record<string, unknown>;

/**
 * Staff act from the conversation (ecosystem plan E2.7, D713) on a real store: carrying out a cancellation and an address change changes
 * the order through the order page's own functions and marks the request done with the customer's line; a refund never goes past what is
 * left to refund, nor past what the person was shown; a person who may not change orders is refused and nothing changes.
 */

let store: Awaited<ReturnType<typeof newStore>>;
const tag = Date.now().toString(36);
let serial = 0;
let ana = "";
const email = () => `ana-${tag}@example.com`;
const ADDRESS = { name: "Ana Berg", line1: "Nygata 5", postalCode: "0150", city: "Oslo" };
const WHOLE = (expectMinor: number) => ({ amount: null, expectMinor, toCredit: false });
const PART = (amount: string) => ({ amount, expectMinor: null, toCredit: false });

/** A paid order of Ana's, 50 NOK through Stripe, with one teapot to send. */
async function order(): Promise<{ id: string; number: string }> {
  serial += 1;
  const number = `E27-${tag}-${serial}`;
  const [o] = await db().execute<Row>(sql`
    insert into commerce.orders (store_id, number, market_code, currency, locale, email, status, subtotal_minor, shipping_minor, discount_minor,
      tax_minor, total_minor, billing_address, shipping_address, placed_at, customer_id)
    values (${store.storeId}::uuid, ${number}, 'NO', 'NOK', 'nb-NO', ${email()}, 'paid', 5000, 0, 0, 1000, 5000, '{}'::jsonb,
      '{"name": "Ana Berg", "line1": "Storgata 1", "postalCode": "0155", "city": "Oslo"}'::jsonb, now() - interval '1 day', ${ana}::uuid)
    returning id
  `);
  await db().execute(sql`
    insert into commerce.order_lines (store_id, order_id, sku, title, quantity, unit_price_minor, discount_minor, total_minor, tax_minor, tax_rate, tax_code, delivery)
    values (${store.storeId}::uuid, ${String(o.id)}::uuid, ${`E27-${serial}`}, 'Teapot', 1, 5000, 0, 5000, 1000, 0.25, 'txcd_99999999', 'physical'::commerce.delivery)
  `);
  await db().execute(sql`
    insert into commerce.payments (store_id, order_id, provider, provider_reference, provider_account, amount_minor, currency, status)
    values (${store.storeId}::uuid, ${String(o.id)}::uuid, 'stripe', ${`pi_e27_${tag}_${serial}`}, ${store.account}, 5000, 'NOK', 'captured')
  `);
  return { id: String(o.id), number };
}

let conversation = "";

/** A request to staff in Ana's signed-in chat. */
async function request(kind: "change_address" | "cancel_order" | "refund" | "exception", args: Record<string, unknown>): Promise<string> {
  const [a] = await db().execute<Row>(sql`
    insert into commerce.support_actions (conversation_id, store_id, kind, confirmer, args, summary, details)
    values (${conversation}::uuid, ${store.storeId}::uuid, ${kind}, 'staff', ${JSON.stringify(args)}::jsonb, 'A request', 'The customer asks.')
    returning id
  `);
  return String(a.id);
}

const statusOf = async (id: string) => String((await db().execute<Row>(sql`select status from commerce.support_actions where id = ${id}::uuid`))[0].status);
const refunded = async (orderId: string) =>
  Number(
    (
      await db().execute<Row>(sql`
        select coalesce(sum(r.amount_minor), 0)::int as n from commerce.refunds r
        join commerce.payments p on p.store_id = r.store_id and p.id = r.payment_id
        where r.store_id = ${store.storeId}::uuid and p.order_id = ${orderId}::uuid and r.status::text <> 'failed'
      `)
    )[0].n,
  );
const linesOf = async () => (await db().execute<Row>(sql`select kind from commerce.support_messages where conversation_id = ${conversation}::uuid`)).map((l) => String(l.kind));
const choiceOf = async (id: string, member = store.member) => (await carry.requestChoices(store.storeId, [id], carry.memberReach(member))).get(id);

beforeAll(async () => {
  store = await newStore("support-carry-out");
  const [c] = await db().execute<Row>(sql`
    insert into commerce.customers (store_id, email, email_verified_at, name) values (${store.storeId}::uuid, ${email()}, now(), 'Ana') returning id
  `);
  ana = String(c.id);
  const [chat] = await db().execute<Row>(sql`
    insert into commerce.support_conversations (store_id, source, handler, token_hash, locale, customer_id)
    values (${store.storeId}::uuid, 'site', 'ai', ${`e27-${Math.random()}`}, 'nb-NO', ${ana}::uuid) returning id
  `);
  conversation = String(chat.id);
});

afterAll(async () => {
  await closeDb();
});

describe("carrying a request out from the conversation (E2.7)", () => {
  it("cancels the order through the order page's cancellation, refunds what was paid, and marks the request done", async () => {
    const o = await order();
    const id = await request("cancel_order", { orderNumber: o.number });
    expect(await choiceOf(id)).toMatchObject({ carryOut: "cancel", why: null, verified: true, money: { minor: 5000, currency: "NOK" } });

    const done = await carry.carryOutRequest(store.member, id, WHOLE(5000), "en");
    expect(done).toMatchObject({ ok: true, conversationId: conversation });
    expect(done.ok && done.message).toContain(o.number);
    const [row] = await db().execute<Row>(sql`select status::text as status from commerce.orders where id = ${o.id}::uuid`);
    expect(row.status).toBe("cancelled");
    expect(await refunded(o.id)).toBe(5000);
    expect(await statusOf(id)).toBe("done");
    expect(await linesOf()).toContain("request_done");
    // Decided once: a second press changes nothing.
    expect(await carry.carryOutRequest(store.member, id, WHOLE(5000), "en")).toMatchObject({ ok: false });
    expect(await refunded(o.id)).toBe(5000);
  });

  it("changes the address to the one the customer gave, and marks the request done", async () => {
    const o = await order();
    const id = await request("change_address", { orderNumber: o.number, address: ADDRESS });
    expect(await choiceOf(id)).toMatchObject({ carryOut: "address", address: ADDRESS });
    const done = await carry.carryOutRequest(store.member, id, WHOLE(0), "en");
    expect(done.ok).toBe(true);
    const [row] = await db().execute<Row>(sql`select shipping_address from commerce.orders where id = ${o.id}::uuid`);
    expect(row.shipping_address).toMatchObject(ADDRESS);
    expect(await statusOf(id)).toBe("done");
  });

  it("never refunds more than is left, nor a whole that moved since it was shown, and leaves a refused request open", async () => {
    const o = await order();
    const first = await request("refund", { orderNumber: o.number });
    expect(await choiceOf(first)).toMatchObject({ carryOut: "refund", money: { minor: 5000, currency: "NOK" } });
    const before = fake.asked.length;

    expect(await carry.carryOutRequest(store.member, first, PART("60,00"), "en")).toMatchObject({ ok: false, problem: expect.stringContaining("At most") });
    expect(await carry.carryOutRequest(store.member, first, PART(""), "en")).toMatchObject({ ok: false });
    expect(await carry.carryOutRequest(store.member, first, PART("-5"), "en")).toMatchObject({ ok: false });
    expect(await carry.carryOutRequest(store.member, first, WHOLE(9000), "en")).toMatchObject({ ok: false, problem: expect.stringContaining("changed") });
    expect(await carry.carryOutRequest(store.member, first, { amount: null, expectMinor: null, toCredit: false }, "en")).toMatchObject({ ok: false });
    expect(fake.asked.length).toBe(before);
    expect(await refunded(o.id)).toBe(0);
    expect(await statusOf(first)).toBe("proposed");

    // A part, then the rest as shown: what went back is what was paid, and no more.
    expect(await carry.carryOutRequest(store.member, first, PART("20,00"), "en")).toMatchObject({ ok: true });
    expect(await refunded(o.id)).toBe(2000);
    expect(await statusOf(first)).toBe("done");
    const second = await request("refund", { orderNumber: o.number });
    expect((await choiceOf(second))?.money).toEqual({ minor: 3000, currency: "NOK" });
    expect(await carry.carryOutRequest(store.member, second, WHOLE(5000), "en")).toMatchObject({ ok: false });
    expect(await carry.carryOutRequest(store.member, second, WHOLE(3000), "en")).toMatchObject({ ok: true });
    expect(await refunded(o.id)).toBe(5000);
    expect(fake.asked.slice(before)).toEqual([2000, 3000]);

    // Nothing left: not offered, and refused if pressed anyway.
    const third = await request("refund", { orderNumber: o.number });
    expect(await choiceOf(third)).toMatchObject({ carryOut: null, why: "nothingToRefund" });
    expect(await carry.carryOutRequest(store.member, third, PART("1,00"), "en")).toMatchObject({ ok: false });
    expect(await refunded(o.id)).toBe(5000);
    expect(await statusOf(third)).toBe("proposed");
  });

  it("refuses a person who may not change orders, offers them nothing, and changes nothing", async () => {
    const reader = { ...store.member, role: "admin" as const, permissions: ["support:read", "support:write", "orders:read"] as never };
    const o = await order();
    const cancel = await request("cancel_order", { orderNumber: o.number });
    const refund = await request("refund", { orderNumber: o.number });
    expect(await choiceOf(cancel, reader)).toMatchObject({ carryOut: null, why: null, money: null });
    expect(await carry.carryOutRequest(reader, cancel, WHOLE(5000), "en")).toMatchObject({ ok: false, problem: expect.stringContaining("Changing orders") });
    expect(await carry.carryOutRequest(reader, refund, PART("10,00"), "nb")).toMatchObject({ ok: false, problem: expect.stringContaining("endre ordrer") });
    const [row] = await db().execute<Row>(sql`select status::text as status from commerce.orders where id = ${o.id}::uuid`);
    expect(row.status).toBe("paid");
    expect(await refunded(o.id)).toBe(0);
    expect(await statusOf(cancel)).toBe("proposed");
    expect(await statusOf(refund)).toBe("proposed");
    // Nor may one who only reads support decide it.
    const onlyReads = { ...store.member, role: "admin" as const, permissions: ["support:read", "orders:read", "orders:write"] as never };
    expect(await carry.carryOutRequest(onlyReads, cancel, WHOLE(5000), "en")).toMatchObject({ ok: false, problem: expect.stringContaining("not decide") });
  });

  it("lists the conversation's open requests with what each offers, and an exception with Done and Decline only", async () => {
    const o = await order();
    const exception = await request("exception", { orderNumber: o.number });
    const open = await carry.conversationRequests(memberDesk(store.member), conversation);
    const listed = open.find((r) => r.id === exception);
    expect(listed).toMatchObject({ kind: "exception", orderNumber: o.number, orderId: o.id, choice: { carryOut: null, why: null } });
    expect(await carry.carryOutRequest(store.member, exception, WHOLE(0), "en")).toMatchObject({ ok: false });
    // Decided requests are not listed.
    expect(open.every((r) => r.id !== exception || r.kind === "exception")).toBe(true);
    const decided = await db().execute<Row>(sql`select id from commerce.support_actions where conversation_id = ${conversation}::uuid and status = 'done'`);
    expect(decided.length).toBeGreaterThan(0);
    for (const d of decided) expect(open.map((r) => r.id)).not.toContain(String(d.id));
  });
});
