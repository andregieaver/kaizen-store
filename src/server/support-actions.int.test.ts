import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

type Row = Record<string, unknown>;

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, getAll: () => [], set: () => {}, delete: () => {} }) }));
vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), connection: async () => {}, after: () => {} }));

const { getStore } = await import("./stores");
const support = await import("./support");
const actions = await import("./support-actions");
const { sendRequestDecisionEmail } = await import("./support-email");
const { systemDesk } = await import("./support-desk");
type Staff = import("./support-desk").StaffDesk;
type ActionContext = import("./support-actions").ActionContext;

/**
 * Actions and requests (D216, step 10; docs/support.md C13, C14): a proposal runs only on the customer's own Confirm, checked again at
 * that moment, once, and not after it expires or from another conversation; each kind refuses what is not the customer's or not
 * allowed now; a staff request's decision reaches the customer in the chat and by email when away, and is in the activity log.
 */

const run = Date.now().toString(36);
let storeId: string;
let site: ActionContext["site"];
let owner: Staff;
const ana = { id: "", email: `ana-act-${run}@example.com` };
const bo = { id: "", email: `bo-act-${run}@example.com` };
let anaOrder = "";
let anaLine = "";
let boOrder = "";
let serial = 0;

async function customer(email: string): Promise<string> {
  const [row] = await db().execute<Row>(sql`insert into commerce.customers (store_id, email, email_verified_at, name) values (${storeId}::uuid, ${email}, now(), 'Ana') returning id`);
  return String(row.id);
}

async function paidOrder(customerId: string, email: string): Promise<{ number: string; lineId: string }> {
  serial += 1;
  const number = `SA-${run}-${serial}`;
  const [order] = await db().execute<Row>(sql`
    insert into commerce.orders (store_id, number, market_code, currency, locale, email, status, subtotal_minor, shipping_minor, discount_minor,
      tax_minor, total_minor, billing_address, shipping_address, placed_at, customer_id)
    values (${storeId}::uuid, ${number}, 'NO', 'EUR', 'nb-NO', ${email}, 'paid', 5000, 0, 0, 0, 5000, '{}'::jsonb, '{}'::jsonb, now() - interval '2 days', ${customerId}::uuid)
    returning id
  `);
  const [line] = await db().execute<Row>(sql`
    insert into commerce.order_lines (store_id, order_id, sku, title, quantity, unit_price_minor, discount_minor, total_minor, tax_minor, tax_rate, tax_code, delivery)
    values (${storeId}::uuid, ${String(order.id)}::uuid, ${`SKU-${serial}`}, 'Teapot', 1, 5000, 0, 5000, 0, 0, 'txcd_99999999', 'physical'::commerce.delivery)
    returning id
  `);
  await db().execute(sql`
    insert into commerce.payments (store_id, order_id, provider, provider_reference, provider_account, amount_minor, currency, status)
    values (${storeId}::uuid, ${String(order.id)}::uuid, 'stripe', ${`pi_sa_${run}_${serial}`}, 'acct_sa', 5000, 'EUR', 'captured'::commerce.payment_status)
  `);
  await db().execute(sql`
    insert into commerce.shipments (store_id, order_id, carrier, tracking_number, created_at, legacy)
    values (${storeId}::uuid, ${String(order.id)}::uuid, 'Bring', ${`TS-${run}-${serial}`}, now() - interval '1 day', true)
  `);
  return { number, lineId: String(line.id) };
}

/** A conversation of the customer's (or of nobody's), to propose in. */
async function conversation(customerId: string | null): Promise<{ id: string; customerId: string | null }> {
  const [c] = await db().execute<Row>(sql`
    insert into commerce.support_conversations (store_id, source, handler, token_hash, locale, customer_id)
    values (${storeId}::uuid, 'site', 'ai', ${`sa-${Math.random()}`}, 'nb-NO', ${customerId}::uuid) returning id
  `);
  return { id: String(c.id), customerId };
}

const ctxFor = (conv: { id: string; customerId: string | null }, who: { id: string; email: string } | null, settings: Awaited<ReturnType<typeof support.deskSettings>>) => ({
  site,
  settings: settings!,
  customer: who,
  desk: systemDesk(storeId),
  conversationId: conv.id,
  conversation: conv,
});

const settingsNow = () => support.deskSettings(systemDesk(storeId));
const lines = (id: string) => db().execute<Row>(sql`select kind, data from commerce.support_messages where conversation_id = ${id}::uuid and author = 'system' order by seq`);
const confirmations = async () =>
  Number((await db().execute<Row>(sql`select count(*)::int as n from commerce.email_messages where store_id = ${storeId}::uuid and kind = 'order.confirmation'`))[0].n);

beforeAll(async () => {
  const slug = `support-actions-${run}`;
  const [request] = await db().execute<Row>(sql`insert into commerce.access_requests (email, name, store_name) values (${`${slug}@example.com`}, 'T', 'T') returning id`);
  const [created] = await db().execute<Row>(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${slug}, 'Actions test', null) as id`);
  storeId = String(created.id);
  await db().execute(sql`update commerce.stores set status = 'active' where id = ${storeId}::uuid`);
  await db().execute(sql`insert into commerce.support_settings (store_id, mode, tone_on, summaries_on, partner) values (${storeId}::uuid, 'ai_first', false, false, false)`);
  ana.id = await customer(ana.email);
  bo.id = await customer(bo.email);
  ({ number: anaOrder, lineId: anaLine } = await paidOrder(ana.id, ana.email));
  ({ number: boOrder } = await paidOrder(bo.id, bo.email));
  const store = (await getStore(slug))!;
  site = { kind: "store", store, market: store.markets.find((m) => m.code === "NO")! };
  const [o] = await db().execute<Row>(sql`select id, email from commerce.accounts where email = ${`${slug}@example.com`}`);
  owner = { desk: systemDesk(storeId), store: { id: storeId, slug, name: "Actions test" }, account: { id: String(o.id), email: String(o.email) } as unknown as Staff["account"], canWrite: true, holder: { role: "owner" } };
});

afterAll(async () => closeDb());

describe("customer actions (C13)", () => {
  it("are kept with a summary by code and run only on the customer's own Confirm, once", async () => {
    const conv = await conversation(ana.id);
    const ctx = ctxFor(conv, ana, await settingsNow());
    const before = await confirmations();
    const kept = await actions.proposeAction(ctx, "order.resend_confirmation", { orderNumber: anaOrder });
    expect(kept.result).toMatchObject({ ok: true });
    expect(String(kept.result.summary)).toContain(anaOrder);
    // Nothing happened yet.
    expect(await confirmations()).toBe(before);
    const [row] = await db().execute<Row>(sql`select status, confirmer, expires_at from commerce.support_actions where id = ${kept.actionId!}::uuid`);
    expect(row).toMatchObject({ status: "proposed", confirmer: "customer" });

    expect(await actions.confirmAction(ctx, kept.actionId!, true)).toEqual({ ok: true, status: "done" });
    expect(await confirmations()).toBe(before + 1);
    expect((await lines(conv.id)).map((l) => l.kind)).toEqual(["action_done"]);
    // A second press changes nothing.
    expect(await actions.confirmAction(ctx, kept.actionId!, true)).toEqual({ ok: false, reason: "not_found" });
    expect(await confirmations()).toBe(before + 1);
  });

  it("are checked again at Confirm: a second resend the same day fails then", async () => {
    const conv = await conversation(ana.id);
    const ctx = ctxFor(conv, ana, await settingsNow());
    // A day's resend was already done (the first test); proposing another is refused at once.
    const again = await actions.proposeAction(ctx, "order.resend_confirmation", { orderNumber: anaOrder });
    expect(again.result.error).toBe("tooOften");
    // Kept while it was allowed, then one runs: the other fails at its Confirm.
    const shipped1 = await actions.proposeAction(ctx, "order.resend_shipped", { orderNumber: anaOrder });
    const shipped2 = await actions.proposeAction(ctx, "order.resend_shipped", { orderNumber: anaOrder });
    expect(await actions.confirmAction(ctx, shipped1.actionId!, true)).toEqual({ ok: true, status: "done" });
    expect(await actions.confirmAction(ctx, shipped2.actionId!, true)).toEqual({ ok: true, status: "failed" });
    const failed = (await lines(conv.id)).at(-1)!;
    expect(failed).toMatchObject({ kind: "action_failed", data: { why: "tooOften" } });
  });

  it("are declined by No thanks, refused after they expire and from another conversation, and run for nobody but the conversation's customer", async () => {
    const conv = await conversation(ana.id);
    const ctx = ctxFor(conv, ana, await settingsNow());
    // The day's resend is spent, so proposeAction refuses it now: these proposals are kept straight in the table, as it would.
    const keep = async (kind: string, args: Record<string, unknown>, minutes = 30) =>
      String(
        (
          await db().execute<Row>(sql`
            insert into commerce.support_actions (conversation_id, store_id, kind, confirmer, args, summary, expires_at)
            values (${conv.id}::uuid, ${storeId}::uuid, ${kind}, 'customer', ${JSON.stringify(args)}::jsonb, 'Test', now() + make_interval(mins => ${minutes}))
            returning id
          `)
        )[0].id,
      );
    const no = await keep("order.resend_confirmation", { orderNumber: anaOrder });
    expect(await actions.confirmAction(ctx, no, false)).toEqual({ ok: true, status: "declined" });
    expect((await lines(conv.id)).at(-1)!.kind).toBe("action_declined");

    const old = await keep("order.resend_confirmation", { orderNumber: anaOrder }, -1);
    expect(await actions.confirmAction(ctx, old, true)).toEqual({ ok: true, status: "expired" });
    expect(await actions.expireActions()).toBeGreaterThanOrEqual(0);

    // From another conversation: not found.
    const other = await conversation(ana.id);
    const theirs = await keep("order.resend_confirmation", { orderNumber: anaOrder });
    expect(await actions.confirmAction(ctxFor(other, ana, await settingsNow()), theirs, true)).toEqual({ ok: false, reason: "not_found" });

    // Bo signed in on the browser of Ana's conversation: it does not run.
    const bos = await keep("order.resend_confirmation", { orderNumber: anaOrder });
    expect(await actions.confirmAction(ctxFor(conv, bo, await settingsNow()), bos, true)).toEqual({ ok: true, status: "failed" });
    expect((await lines(conv.id)).at(-1)!.data).toMatchObject({ why: "notYours" });
  });

  it("refuse what is not the customer's, or not allowed now, before anything is kept", async () => {
    const conv = await conversation(ana.id);
    const ctx = ctxFor(conv, ana, await settingsNow());
    const refused = async (kind: string, args: Record<string, unknown>) => (await actions.proposeAction(ctx, kind, args)).result.error;
    expect(await refused("order.resend_confirmation", { orderNumber: boOrder })).toBe("notFound");
    expect(await refused("booking.cancel", { bookingId: crypto.randomUUID() })).toBe("notFound");
    expect(await refused("booking.move", { bookingId: crypto.randomUUID(), startsAt: new Date(Date.now() + 86_400_000).toISOString() })).toBe("notFound");
    expect(await refused("subscription.pause", { subscriptionId: crypto.randomUUID(), periods: 1 })).toBe("notFound");
    for (const kind of ["subscription.skip", "subscription.cancel", "subscription.resume", "subscription.unpause"]) {
      expect(await refused(kind, { subscriptionId: crypto.randomUUID() }), kind).toBe("notFound");
    }
    expect(await refused("box.skip", { listId: crypto.randomUUID(), date: "2030-01-01" })).toBe("notFound");
    expect(await refused("box.pause", { listId: crypto.randomUUID() })).toBe("notFound");
    expect(await refused("box.resume", { listId: crypto.randomUUID() })).toBe("notFound");
    // Inside the 14 days a line is withdrawn, never returned through the chat.
    expect(await refused("return.request", { orderNumber: anaOrder, lines: [{ lineId: anaLine, quantity: 1 }] })).toBe("notAllowed");
    expect(await refused("order.resend_confirmation", { nope: true })).toBe("invalid");
    expect(await refused("withdraw", {})).toBe("not_offered");
    // Not signed in: nothing.
    expect((await actions.proposeAction(ctxFor(conv, null, await settingsNow()), "order.resend_shipped", { orderNumber: anaOrder })).result.error).toBe("not_signed_in");
    // A kind the owner switched off is not offered.
    await db().execute(sql`update commerce.support_settings set ai_actions = '{booking.cancel}'::text[] where store_id = ${storeId}::uuid`);
    expect((await actions.proposeAction(ctxFor(conv, ana, await settingsNow()), "order.resend_shipped", { orderNumber: anaOrder })).result.error).toBe("not_offered");
    await db().execute(sql`update commerce.support_settings set ai_actions = null where store_id = ${storeId}::uuid`);
    expect(await db().execute<Row>(sql`select 1 from commerce.support_actions where conversation_id = ${conv.id}::uuid`)).toHaveLength(0);
  });
});

describe("staff requests (C14)", () => {
  it("are listed for the desk, decided once, told to the customer in the chat and by email when away, and logged", async () => {
    const conv = await conversation(ana.id);
    const ctx = ctxFor(conv, ana, await settingsNow());
    expect((await actions.requestStaffAction(ctx, "refund", undefined, "Wants money back.")).result.error).toBe("needs_order_number");
    const kept = await actions.requestStaffAction(ctx, "refund", anaOrder, "The teapot arrived broken; the customer wants a refund.");
    expect(kept.result).toMatchObject({ ok: true });
    const open = await actions.listRequests(systemDesk(storeId), "open");
    const mine = open.find((r) => r.id === kept.actionId)!;
    expect(mine).toMatchObject({ kind: "refund", orderNumber: anaOrder, details: "The teapot arrived broken; the customer wants a refund.", customer: { email: ana.email } });
    expect(mine.orderId).toBeTruthy();
    expect(await actions.openRequestCount(systemDesk(storeId))).toBeGreaterThanOrEqual(1);

    // Someone who may only read cannot decide.
    expect(await actions.decideRequest({ ...owner, canWrite: false }, kept.actionId!, "done", null)).toMatchObject({ ok: false });
    const decided = await actions.decideRequest(owner, kept.actionId!, "done", "Refunded in full today.");
    expect(decided).toEqual({ ok: true, conversationId: conv.id });
    expect(await actions.decideRequest(owner, kept.actionId!, "declined", null)).toMatchObject({ ok: false });

    const feed = await support.visitorFeed(systemDesk(storeId), conv.id, 0);
    expect(feed.at(-1)).toMatchObject({ author: "system", kind: "request_done", data: { note: "Refunded in full today." } });
    const [log] = await db().execute<Row>(sql`select action, details as data, area from commerce.audit_log where store_id = ${storeId}::uuid and action = 'support.request_decided' order by created_at desc limit 1`);
    expect(log.data).toMatchObject({ kind: "refund", decision: "done", note: true });

    // Away (never looked): the email goes to the signed-in customer's own address, once.
    expect(await sendRequestDecisionEmail(conv.id, kept.actionId!)).toMatch(/sent|logged/);
    expect(await sendRequestDecisionEmail(conv.id, kept.actionId!)).toBe("duplicate");
    const [email] = await db().execute<Row>(sql`select to_address, text from commerce.email_messages where kind = 'support.request_done' and idempotency_key = ${`support.request_done:${kept.actionId}`}`);
    expect(email.to_address).toBe(ana.email);
    expect(String(email.text)).toContain("Refunded in full today.");

    // Looking now: no email for the next decision.
    const second = await actions.requestStaffAction(ctx, "exception", undefined, "Asks for longer to return.");
    await actions.decideRequest(owner, second.actionId!, "declined", null);
    await support.markSeen(systemDesk(storeId), conv.id);
    expect(await sendRequestDecisionEmail(conv.id, second.actionId!)).toBeNull();
    expect((await actions.listRequests(systemDesk(storeId), "decided")).map((r) => r.id)).toEqual(expect.arrayContaining([kept.actionId, second.actionId]));
  });
});
