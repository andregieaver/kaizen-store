import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
  headers: async () => new Headers(),
}));

/**
 * Security review of wave 3 run 2 (draft orders). Stripe is faked like in draft-orders.int.test.ts, but this fake models what the real API does with an
 * idempotency key: the same key with other parameters is an error, and the same key with the same parameters gives back the first session.
 */
const fake = vi.hoisted(() => {
  const sessions = new Map<string, Record<string, unknown>>();
  const byKey = new Map<string, { params: string; id: string }>();
  /** What a test may do to Stripe: make a look-up fail with this error, run something while a session is being made, remember the last session's parameters. */
  const hooks: { failRetrieve: Error | null; onCreate: (() => Promise<void>) | null; onRetrieve: (() => Promise<void>) | null; lastParams: { shipping_address_collection?: { allowed_countries?: string[] } } | null } = { failRetrieve: null, onCreate: null, onRetrieve: null, lastParams: null };
  let next = 0;
  const client = {
    refunds: { create: async () => ({ id: `re_${++next}`, status: "succeeded" }) },
    coupons: { create: async () => ({ id: `coupon_${++next}` }) },
    checkout: {
      sessions: {
        create: async (params: Record<string, unknown>, options: { idempotencyKey?: string }) => {
          hooks.lastParams = params as typeof hooks.lastParams;
          const key = options.idempotencyKey;
          const body = JSON.stringify(params);
          if (key) {
            const seen = byKey.get(key);
            if (seen && seen.params !== body) {
              throw Object.assign(new Error("Keys for idempotent requests can only be used with the same parameters they were first used with."), { type: "StripeIdempotencyError" });
            }
            if (seen) return { id: seen.id, url: `https://checkout.stripe.test/${seen.id}`, client_secret: null, payment_method_types: ["card"] };
          }
          const id = `cs_draft_${++next}`;
          sessions.set(id, { status: "open", payment_status: "unpaid", mode: params.mode, metadata: params.metadata, payment_intent: null });
          if (key) byKey.set(key, { params: body, id });
          if (hooks.onCreate) {
            const run = hooks.onCreate;
            hooks.onCreate = null;
            await run();
          }
          return { id, url: `https://checkout.stripe.test/${id}`, client_secret: `${id}_secret_test`, payment_method_types: ["card"] };
        },
        retrieve: async (id: string) => {
          if (hooks.failRetrieve) throw hooks.failRetrieve;
          if (hooks.onRetrieve) {
            const run = hooks.onRetrieve;
            hooks.onRetrieve = null;
            await run();
          }
          return { id, ...sessions.get(id) };
        },
        expire: async (id: string) => {
          const found = sessions.get(id);
          if (found) found.status = "expired";
          return { id };
        },
      },
    },
  };
  return { client, sessions, hooks };
});
vi.mock("./stripe", () => ({
  platformStripe: () => fake.client,
  platformPublishableKey: () => "pk_test_drafts",
  platformModes: () => ["test"],
  WEBHOOK_EVENTS: [],
}));

const { createDraft, expireDrafts, getDraft, recordDraftPaidOutside, saveDraft, sendDraft } = await import("./draft-orders");
const { payPageFor, startDraftPayment } = await import("./draft-pay");
const support = await import("./inventory-test-support");
const { newPlainStore } = await import("./order-ops-fixture");
const { staffActor } = await import("./order-actor");
const { refundOrder } = await import("./order-admin");
const { storeById } = await import("./shopper-emails");

type TestStore = Awaited<ReturnType<typeof support.newStore>>;

afterAll(async () => {
  await closeDb();
});
beforeEach(() => {
  fake.sessions.clear();
  fake.hooks.failRetrieve = null;
  fake.hooks.onCreate = null;
  fake.hooks.onRetrieve = null;
  fake.hooks.lastParams = null;
});

async function paymentsStore(label: string): Promise<TestStore> {
  const store = await newPlainStore(label);
  await db().execute(sql`update commerce.payment_providers set enabled = true, active_mode = 'test' where store_id = ${store.storeId}::uuid`);
  await db().execute(sql`update commerce.inventory_levels set on_hand = on_hand + 500 where store_id = ${store.storeId}::uuid`);
  return store;
}

async function draftOf(store: TestStore) {
  const actor = staffActor(store.accountId);
  const made = await createDraft(store.storeId, actor, { marketSlug: "no" });
  if (!made.ok) throw new Error(made.problem);
  const saved = await saveDraft(store.storeId, actor, made.draft.id, {
    version: made.draft.version,
    marketSlug: "no",
    email: "buyer@example.com",
    shippingAddress: { name: "Kari Nordmann", line1: "Storgata 1", postalCode: "0155", city: "Oslo", country: "NO" },
    billingAddress: {},
    tags: [],
    discount: null,
    shipping: { kind: "rate" },
    lines: [{ kind: "goods", variantId: await support.variantId(store.storeId, "DEMO-MUG-WHITE"), quantity: 2 }],
  });
  if (!saved.ok) throw new Error(`save: ${saved.problem}`);
  return saved.draft;
}

async function shop(store: TestStore) {
  const found = (await storeById(store.storeId))!;
  const full = await (await import("./stores")).getStore(store.slug);
  return { store: full!, market: found.markets.find((m) => m.code === "NO") ?? found.markets[0] };
}

describe("security review: draft orders", () => {
  it("lets the buyer press Pay a second time after coming back from Stripe (the order keeps one Stripe idempotency key for every press)", async () => {
    const store = await paymentsStore("sec-press-twice");
    const draft = await draftOf(store);
    const sent = await sendDraft(store.storeId, staffActor(store.accountId), draft.id, { version: draft.version, createLink: true });
    if (!sent.ok) throw new Error(sent.problem);
    const token = sent.link!.split("/").pop()!;
    const s = await shop(store);
    const first = await startDraftPayment(s, token, { termsTicked: true, origin: "http://localhost:3000" });
    expect(first).toMatchObject({ ok: true });
    // The buyer left Stripe's page (cancel_url is the pay link) and presses Pay again: the real API refuses a reused key with other parameters.
    const second = await startDraftPayment(s, token, { termsTicked: true, origin: "http://localhost:3000" });
    expect(second).toMatchObject({ ok: true });
  });

  it("records a manual refund at most once when two staff press Refund at the same moment (nothing but a read before the write caps it)", async () => {
    const store = await paymentsStore("sec-double-refund");
    const draft = await draftOf(store);
    const owner = { ...store.member, kind: "member", permissions: [] } as unknown as Parameters<typeof recordDraftPaidOutside>[0];
    const done = await recordDraftPaidOutside(owner, draft.id, { version: draft.version, method: "bank_transfer" });
    if (!done.ok) throw new Error(done.problem);
    const [paid] = await db().execute<Record<string, unknown>>(sql`select total_minor from commerce.orders where id = ${done.orderId}::uuid`);
    const total = Number(paid.total_minor);
    const attempt = () => refundOrder(store.storeId, done.orderId, { amountMinor: total, reason: "Customer changed their mind", restock: [] }, store.accountId);
    await Promise.allSettled([attempt(), attempt()]);
    const [sum] = await db().execute<Record<string, unknown>>(sql`
      select coalesce(sum(r.amount_minor), 0)::bigint as refunded from commerce.refunds r join commerce.payments p on p.store_id = r.store_id and p.id = r.payment_id
      where p.order_id = ${done.orderId}::uuid and r.status = 'succeeded'
    `);
    expect(Number(sum.refunded)).toBeLessThanOrEqual(total);
    expect((await getDraft(store.storeId, draft.id))!.status).toBe("paid");
  });

  async function sentDraft(label: string) {
    const store = await paymentsStore(label);
    const draft = await draftOf(store);
    const sent = await sendDraft(store.storeId, staffActor(store.accountId), draft.id, { version: draft.version, createLink: true });
    if (!sent.ok) throw new Error(sent.problem);
    return { store, draft, sent, token: sent.link!.split("/").pop()!, s: await shop(store) };
  }
  const owner = (store: TestStore) => ({ ...store.member, kind: "member", permissions: [] }) as unknown as Parameters<typeof recordDraftPaidOutside>[0];
  const press = (s: Awaited<ReturnType<typeof shop>>, token: string) => startDraftPayment(s, token, { termsTicked: true, origin: "http://localhost:3000" });

  it("serves and pays a link only under its own order's country, and asks Stripe for that country's addresses, not the one in the address bar", async () => {
    const { store, token, s } = await sentDraft("sec-market");
    const found = (await storeById(store.storeId))!;
    const other = found.markets.find((m) => m.code !== "NO");
    expect(other).toBeDefined();
    const wrong = { store: s.store, market: other! };
    expect(await payPageFor(wrong, token)).toEqual({ state: "not_found" });
    expect(await startDraftPayment(wrong, token, { termsTicked: true, origin: "http://localhost:3000" })).toEqual({ ok: false, problem: "not_found" });
    expect(fake.hooks.lastParams).toBeNull();
    expect(await payPageFor(s, token)).toMatchObject({ state: "ready" });
    expect(await press(s, token)).toMatchObject({ ok: true });
    expect(fake.hooks.lastParams?.shipping_address_collection?.allowed_countries).toEqual(["NO"]);
  });

  it("never records money paid outside, expires or reopens while a session may still be payable: a failed look at Stripe is not 'closed'", async () => {
    const { store, draft, sent, token, s } = await sentDraft("sec-unknown");
    expect(await press(s, token)).toMatchObject({ ok: true });
    fake.hooks.failRetrieve = Object.assign(new Error("connection reset"), { type: "StripeConnectionError" });
    expect(await recordDraftPaidOutside(owner(store), draft.id, { version: draft.version, method: "cash" })).toEqual({ ok: false, problem: "processing" });
    // Its time has passed.
    await expireDrafts(new Date(Date.now() + 8 * 86_400_000), {});
    const [order] = await db().execute<Record<string, unknown>>(sql`select status from commerce.orders where id = ${sent.orderId}::uuid`);
    expect(order.status).toBe("pending_payment");
    const [pending] = await db().execute<Record<string, unknown>>(sql`select count(*)::int as n from commerce.payments where order_id = ${sent.orderId}::uuid and status = 'pending'`);
    expect(pending.n).toBe(1);
    // A session Stripe says does not exist is closed, and then it goes on.
    fake.hooks.failRetrieve = Object.assign(new Error("No such checkout session"), { code: "resource_missing", statusCode: 404 });
    expect(await recordDraftPaidOutside(owner(store), draft.id, { version: draft.version, method: "cash" })).toMatchObject({ ok: true });
  });

  it("closes the session a buyer's press opened when staff recorded the payment while it was being made, and tells the buyer it is paid", async () => {
    const { store, draft, sent, token, s } = await sentDraft("sec-race");
    fake.hooks.onCreate = async () => {
      const done = await recordDraftPaidOutside(owner(store), draft.id, { version: draft.version, method: "bank_transfer" });
      if (!done.ok) throw new Error(done.problem);
    };
    expect(await press(s, token)).toEqual({ ok: false, problem: "paid" });
    const sessions = await db().execute<Record<string, unknown>>(sql`select provider_reference, status from commerce.payments where order_id = ${sent.orderId}::uuid and provider = 'stripe'`);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].status).toBe("cancelled");
    expect(fake.sessions.get(String(sessions[0].provider_reference))?.status).toBe("expired");
    const captured = await db().execute<Record<string, unknown>>(sql`select provider from commerce.payments where order_id = ${sent.orderId}::uuid and status = 'captured'`);
    expect(captured.map((p) => p.provider)).toEqual(["manual"]);
  });

  it("refuses to record a payment outside when a session opened after its first look at Stripe is still pending in the transaction", async () => {
    const { store, draft, sent, token, s } = await sentDraft("sec-pending");
    expect(await press(s, token)).toMatchObject({ ok: true });
    // While staff's look closes the first session, the buyer's press writes another pending row (the order is the same).
    fake.hooks.onRetrieve = async () => {
      await db().execute(sql`
        insert into commerce.payments (store_id, order_id, provider, provider_reference, provider_account, amount_minor, currency, status)
        select store_id, order_id, 'stripe', 'cs_late_press', provider_account, amount_minor, currency, 'pending' from commerce.payments
        where order_id = ${sent.orderId}::uuid and provider = 'stripe' limit 1
      `);
    };
    expect(await recordDraftPaidOutside(owner(store), draft.id, { version: draft.version, method: "cash" })).toEqual({ ok: false, problem: "processing" });
    const [order] = await db().execute<Record<string, unknown>>(sql`select status from commerce.orders where id = ${sent.orderId}::uuid`);
    expect(order.status).toBe("pending_payment");
    expect((await getDraft(store.storeId, draft.id))!.status).toBe("sent");
  });

  it("limits the presses of one link, and a link in a loop does not use the store's budget up for other buyers", async () => {
    const { store, draft, token, s } = await sentDraft("sec-limit");
    const second = await draftOf(store);
    const sentTwo = await sendDraft(store.storeId, staffActor(store.accountId), second.id, { version: second.version, createLink: true });
    if (!sentTwo.ok) throw new Error(sentTwo.problem);
    const results: string[] = [];
    for (let i = 0; i < 22; i += 1) {
      const r = await press(s, token);
      results.push(r.ok ? "ok" : r.problem);
    }
    expect(results.filter((r) => r === "ok")).toHaveLength(20);
    expect(results.slice(20)).toEqual(["limit", "limit"]);
    // Another buyer of the same store is not locked out, and the store's own counter counted only the presses the link was allowed.
    expect(await press(s, sentTwo.link!.split("/").pop()!)).toMatchObject({ ok: true });
    const rows = await db().execute<Record<string, unknown>>(sql`select bucket, count from commerce.chat_usage where store_id = ${store.storeId}::uuid and bucket like 'draft:pay%' order by bucket`);
    const byBucket = Object.fromEntries(rows.map((r) => [String(r.bucket), Number(r.count)]));
    expect(byBucket["draft:pay"]).toBe(21);
    expect(byBucket[`draft:pay:${draft.id}`]).toBe(22);
  });
});
