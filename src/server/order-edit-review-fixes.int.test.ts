import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { emailText } from "@/lib/email-text";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }), headers: async () => new Headers() }));

/**
 * Kaizen's platform Stripe client, faked as Stripe behaves: a refund is recorded with the PaymentIntent it names and its idempotency key (the same key gives
 * back the same refund and moves no money twice), and may be answered `pending` (a bank method); hosted Checkout sessions are recorded with their params.
 */
const fake = vi.hoisted(() => {
  const refunds: { params: Record<string, unknown>; options: Record<string, unknown> }[] = [];
  const created: { params: Record<string, unknown>; options: Record<string, unknown> }[] = [];
  const byKey = new Map<string, { id: string; status: string }>();
  const sessions = new Map<string, Record<string, unknown>>();
  const state = { refundStatus: "succeeded", delayMs: 0 };
  let next = 0;
  const client = {
    refunds: {
      create: async (params: Record<string, unknown>, options: Record<string, unknown>) => {
        if (state.delayMs > 0) await new Promise((resolve) => setTimeout(resolve, state.delayMs));
        const key = String(options.idempotencyKey);
        const known = byKey.get(key);
        if (known) return known;
        refunds.push({ params, options });
        const made = { id: `re_fix_${refunds.length}_${Math.random().toString(36).slice(2, 6)}`, status: state.refundStatus };
        byKey.set(key, made);
        return made;
      },
      retrieve: async (id: string) => ({ id, status: "failed" }),
    },
    coupons: { create: async () => ({ id: "co_x" }) },
    checkout: {
      sessions: {
        create: async (params: Record<string, unknown>, options: Record<string, unknown>) => {
          created.push({ params, options });
          const id = `cs_fix_${++next}_${Math.random().toString(36).slice(2, 8)}`;
          sessions.set(id, { status: "open", payment_status: "unpaid", payment_intent: `pi_${id}` });
          return { id, url: `https://checkout.stripe.test/${id}`, payment_method_types: ["card"] };
        },
        retrieve: async (id: string) => ({ id, payment_intent: `pi_for_${id}`, invoice: null, ...(sessions.get(id) ?? { status: "complete", payment_status: "paid" }) }),
        expire: async (id: string) => {
          sessions.set(id, { ...(sessions.get(id) ?? {}), status: "expired" });
          return { id };
        },
      },
    },
  };
  return { client, refunds, created, sessions, state };
});
vi.mock("./stripe", () => ({ platformStripe: () => fake.client, platformPublishableKey: () => "pk_test_x", platformModes: () => ["test"], WEBHOOK_EVENTS: [] }));

const edits = await import("./order-edits");
const pay = await import("./order-edit-pay");
const { applySession } = await import("./stripe-webhooks");
const { applyStripeRefund } = await import("./stripe-refunds");
const { getOrderAdmin, markSent, refundOrder } = await import("./order-admin");
const { sendShipped } = await import("./shopper-emails");
const { invoiceCheckupFindings } = await import("./invoices");
const { getStore } = await import("./stores");
const { staffActor } = await import("./order-actor");
const { fxStore, paidOrder, lineOf, variantOf, onHand, mailsOf, eventsOf, NO, NO_EUR } = await import("./fulfilment-test-fixture");

type Row = Record<string, unknown>;
const origin = "https://kaizen.test";
const nb = emailText("nb");

/**
 * The fixes of the adversarial review of wave 3 run 3 (D174), each held at its cause: the pay-link email says a change is proposed, not made (CRD Art. 22); a
 * business buyer is never told of a statutory right of withdrawal (CRD Art. 2(1)); the added goods' withdrawal sentence counts from the last parcel; a
 * lower-total change is claimed before Stripe is asked (stock and races cannot refuse after money moved); a change refund that later fails is said; a B2B
 * return of a received unit does not stop the units still owed being sent; and the change's pay link works in a euro view.
 */
let store: Awaited<ReturnType<typeof fxStore>>;
beforeAll(async () => {
  store = await fxStore("edit-fix");
});
afterAll(async () => {
  await closeDb();
});

const actor = () => staffActor(store.accountId);
const asCompany = async (orderId: string) => {
  await db().execute(sql`update commerce.orders set company_name = 'Firma AS', organisation_number = '923456780' where id = ${orderId}::uuid`);
};

describe("the pay-link email proposes the change; it does not say it was made (CRD Art. 22)", () => {
  it("has its own subject, heading and intro, and the applied change's email says 'changed' only once it is paid", async () => {
    const order = await paidOrder(store, [["DEMO-TOTE", 1]]);
    const sent = await edits.sendOrderEdit(store.storeId, order.orderId, { added: [{ variantId: await variantOf(store, "DEMO-LAMP"), quantity: 1 }], reason: "customer_request" }, actor(), { email: true });
    if (!sent.ok) throw new Error(JSON.stringify(sent.problems));
    const [mail] = await mailsOf(order.orderId, "order.changed");
    const storeName = (await getStore(store.slug))!.name;
    expect(String(mail.subject)).toBe(nb.orderChanged.proposedSubject(storeName, order.number));
    expect(String(mail.subject)).not.toContain(nb.orderChanged.subject("", order.number).slice(2));
    expect(String(mail.text)).toContain(nb.orderChanged.proposedHeading);
    expect(String(mail.text)).toContain(nb.orderChanged.proposedIntro(order.number));
    expect(String(mail.text)).not.toContain(nb.orderChanged.heading);
    expect(String(mail.text)).not.toContain(nb.orderChanged.intro(order.number));
    // The added goods' withdrawal sentence counts from the last parcel of the order (CRD Art. 9(2)(b)), as the parcel email does.
    expect(String(mail.text)).toContain(nb.orderChanged.withdrawal);
    expect(nb.orderChanged.withdrawal).toContain("siste pakken");

    // Paid: now the order is changed, and its email says so.
    const started = await pay.startEditPayment({ store: (await getStore(store.slug))!, market: NO }, sent.link.split("/").at(-1)!, { origin });
    if (!started.ok) throw new Error(JSON.stringify(started));
    const [payment] = await db().execute<Row>(sql`select provider_reference from commerce.payments where order_edit_id = ${sent.editId}::uuid`);
    fake.sessions.set(String(payment.provider_reference), { status: "complete", payment_status: "paid" });
    await applySession(store.storeId, { id: String(payment.provider_reference), status: "complete", payment_status: "paid" } as never, "checkout.session.completed");
    const mails = await mailsOf(order.orderId, "order.changed");
    expect(mails).toHaveLength(2);
    expect(String(mails[1].subject)).toContain(nb.orderChanged.subject("", order.number).slice(2));
    expect(String(mails[1].text)).toContain(nb.orderChanged.heading);
  });
});

describe("a business buyer is never told of a statutory right of withdrawal (CRD Art. 2(1))", () => {
  it("the change emails leave the withdrawal sentence out for a company's order and keep it for a consumer's", async () => {
    const company = await paidOrder(store, [["DEMO-TOTE", 1]], { beforePaid: asCompany });
    const sent = await edits.sendOrderEdit(store.storeId, company.orderId, { added: [{ variantId: await variantOf(store, "DEMO-LAMP"), quantity: 1 }], reason: "customer_request" }, actor(), { email: true });
    if (!sent.ok) throw new Error(JSON.stringify(sent.problems));
    const [proposal] = await mailsOf(company.orderId, "order.changed");
    expect(String(proposal.text)).not.toContain(nb.orderChanged.withdrawal);
    // Applied (paid outside Kaizen): the applied email leaves it out too.
    await edits.recordEditPaidOutside(store.storeId, { editId: sent.editId }, { method: "bank_transfer" }, actor());
    const mails = await mailsOf(company.orderId, "order.changed");
    expect(mails).toHaveLength(2);
    expect(String(mails[1].text)).not.toContain(nb.orderChanged.withdrawal);

    const consumer = await paidOrder(store, [["DEMO-TOTE", 1]]);
    const own = await edits.sendOrderEdit(store.storeId, consumer.orderId, { added: [{ variantId: await variantOf(store, "DEMO-LAMP"), quantity: 1 }], reason: "customer_request" }, actor(), { email: true });
    if (!own.ok) throw new Error(JSON.stringify(own.problems));
    await edits.recordEditPaidOutside(store.storeId, { editId: own.editId }, { method: "bank_transfer" }, actor());
    const theirs = await mailsOf(consumer.orderId, "order.changed");
    expect(theirs.map((m) => String(m.text).includes(nb.orderChanged.withdrawal))).toEqual([true, true]);
  });

  it("the parcel email of a company's order sent in parts says the rest follows, without the receipt sentence about the 14 days", async () => {
    const company = await paidOrder(store, [["DEMO-TOTE", 2]], { beforePaid: asCompany });
    const tote = lineOf(company, "DEMO-TOTE");
    const first = await markSent(store.storeId, company.orderId, { carrier: "posten", trackingNumber: "C1", trackingUrl: null }, store.accountId, null, { lines: [{ lineId: tote.id, quantity: 1 }] });
    if (!first.ok) throw new Error(first.reason);
    await sendShipped(store.storeId, company.orderId, { id: first.shipment.id, carrier: "posten", trackingNumber: "C1", trackingUrl: null });
    const [mail] = await mailsOf(company.orderId, "order.sent");
    expect(String(mail.text)).toContain(nb.shippedPart.restFollows);
    expect(String(mail.text)).not.toContain(nb.shippedPart.receipt);

    const consumer = await paidOrder(store, [["DEMO-TOTE", 2]]);
    const line = lineOf(consumer, "DEMO-TOTE");
    const part = await markSent(store.storeId, consumer.orderId, { carrier: "posten", trackingNumber: "K1", trackingUrl: null }, store.accountId, null, { lines: [{ lineId: line.id, quantity: 1 }] });
    if (!part.ok) throw new Error(part.reason);
    await sendShipped(store.storeId, consumer.orderId, { id: part.shipment.id, carrier: "posten", trackingNumber: "K1", trackingUrl: null });
    const [theirs] = await mailsOf(consumer.orderId, "order.sent");
    expect(String(theirs.text)).toContain(nb.shippedPart.receipt);
  });
});

describe("a lower-total change is claimed before any money moves", () => {
  it("two presses of the same change refund once through Stripe and apply once", async () => {
    const order = await paidOrder(store, [["DEMO-TOTE", 3]]);
    const tote = lineOf(order, "DEMO-TOTE");
    const raw = { quantities: { [tote.id]: 2 }, reason: "customer_request" };
    const preview = await edits.previewOrderEdit(store.storeId, order.orderId, raw);
    if (!preview || !("base" in preview)) throw new Error("no preview");
    const before = fake.refunds.length;
    fake.state.delayMs = 150;
    const results = await Promise.all([
      edits.applyOrderEdit(store.storeId, order.orderId, { ...raw, base: preview.base }, actor()),
      edits.applyOrderEdit(store.storeId, order.orderId, { ...raw, base: preview.base }, actor()),
    ]).finally(() => {
      fake.state.delayMs = 0;
    });
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(fake.refunds.length - before).toBe(1);
    const [n] = await db().execute<Row>(sql`select count(*)::int as n from commerce.refunds r join commerce.payments p on p.id = r.payment_id where p.order_id = ${order.orderId}::uuid`);
    expect(Number(n.n)).toBe(1);
    const applied = await db().execute<Row>(sql`select status from commerce.order_edits where order_id = ${order.orderId}::uuid order by seq`);
    expect(applied.filter((e) => e.status === "applied")).toHaveLength(1);
    // The refused press left no change waiting and no units held.
    expect(applied.some((e) => e.status === "awaiting_payment")).toBe(false);
  });

  it("a stock shortage found at the claim refuses before Stripe is asked; every Stripe refund has its row and its applied change", async () => {
    // A variant that stops at zero with exactly one unit left: a swap on one order (a lower total) and a change on another that wants the same unit.
    const thermos = await variantOf(store, "DEMO-THERMOS");
    const have = await onHand(store, "DEMO-THERMOS");
    const [held] = await db().execute<Row>(sql`select coalesce(sum(quantity), 0)::int as n from commerce.inventory_reservations where variant_id = ${thermos}::uuid and released_at is null and expires_at > now()`);
    const free = have - Number(held.n);
    await db().execute(sql`update commerce.product_variants set stock_policy = 'deny', backorder_days = null where id = ${thermos}::uuid`);
    await db().execute(sql`update commerce.inventory_levels set on_hand = on_hand - ${free - 1} where store_id = ${store.storeId}::uuid and variant_id = ${thermos}::uuid and on_hand >= ${free - 1}`);
    const swap = await paidOrder(store, [["DEMO-LAMP", 3]]);
    const lamp = lineOf(swap, "DEMO-LAMP");
    const other = await paidOrder(store, [["DEMO-TOTE", 1]]);
    const before = fake.refunds.length;
    fake.state.delayMs = 100;
    const [a, b] = await Promise.all([
      edits.applyOrderEdit(store.storeId, swap.orderId, { quantities: { [lamp.id]: 1 }, added: [{ variantId: thermos, quantity: 1 }], reason: "customer_request" }, actor()),
      edits.sendOrderEdit(store.storeId, other.orderId, { added: [{ variantId: thermos, quantity: 1 }], reason: "customer_request" }, actor(), { email: false }),
    ]).finally(() => {
      fake.state.delayMs = 0;
    });
    // At most one of the two got the unit.
    expect([a.ok, b.ok].filter(Boolean).length).toBeLessThanOrEqual(1);
    const made = fake.refunds.length - before;
    expect(made).toBe(a.ok ? 1 : 0);
    // No refund was made in Stripe that Kaizen did not record with its applied change.
    const rows = await db().execute<Row>(sql`
      select r.provider_reference, e.status from commerce.refunds r join commerce.payments p on p.id = r.payment_id
      left join commerce.order_edits e on e.id = r.order_edit_id where p.order_id = ${swap.orderId}::uuid
    `);
    expect(rows).toHaveLength(made);
    for (const r of rows) expect(r.status).toBe("applied");
  });
});

describe("a refund of an order that carries a paid change is split over its payments (review fix)", () => {
  it("a goodwill refund above what the order's own payment has left takes the rest from the change's payment, each part within its charge", async () => {
    const order = await paidOrder(store, [["DEMO-TOTE", 1]]);
    const sent = await edits.sendOrderEdit(store.storeId, order.orderId, { added: [{ variantId: await variantOf(store, "DEMO-LAMP"), quantity: 1 }], reason: "customer_request" }, actor(), { email: false });
    if (!sent.ok) throw new Error(JSON.stringify(sent.problems));
    await pay.startEditPayment({ store: (await getStore(store.slug))!, market: NO }, sent.link.split("/").at(-1)!, { origin });
    const [payment] = await db().execute<Row>(sql`select provider_reference, amount_minor from commerce.payments where order_edit_id = ${sent.editId}::uuid`);
    const change = { reference: String(payment.provider_reference), amount: Number(payment.amount_minor) };
    fake.sessions.set(change.reference, { status: "complete", payment_status: "paid", payment_intent: `pi_${change.reference}` });
    await applySession(store.storeId, { id: change.reference, status: "complete", payment_status: "paid" } as never, "checkout.session.completed");
    // A first goodwill refund leaves 100 on the order's own payment; the next one of 500 needs 400 from the change's payment.
    expect(await refundOrder(store.storeId, order.orderId, { amountMinor: order.totalMinor - 100, reason: "Goodwill", restock: [] }, store.accountId)).toMatchObject({ ok: true });
    const before = fake.refunds.length;
    const split = await refundOrder(store.storeId, order.orderId, { amountMinor: 500, reason: "Goodwill again", restock: [] }, store.accountId);
    expect(split).toMatchObject({ ok: true, amountMinor: 500 });
    expect((split as { refundIds?: string[] }).refundIds).toHaveLength(2);
    const asked = fake.refunds.slice(before).map((r) => ({ intent: String(r.params.payment_intent), amount: Number(r.params.amount) }));
    expect(asked).toEqual([
      { intent: `pi_for_cs_${order.orderId}`, amount: 100 },
      { intent: `pi_${change.reference}`, amount: 400 },
    ]);
    // Nothing more than was paid can be refunded, in all.
    const admin = await getOrderAdmin(store.storeId, order.orderId);
    expect(admin?.refundableMinor).toBe(change.amount - 400);
    expect(await refundOrder(store.storeId, order.orderId, { amountMinor: change.amount - 399, reason: "Too much", restock: [] }, store.accountId)).toMatchObject({ ok: false });
  });
});

describe("a change applied on a pending refund that then fails is said (review fix)", () => {
  it("writes the event once, shows what is owed on the order page and in the checkup, and stops once staff refund it again", async () => {
    const order = await paidOrder(store, [["DEMO-TOTE", 3]]);
    const tote = lineOf(order, "DEMO-TOTE");
    fake.state.refundStatus = "pending";
    const done = await edits.applyOrderEdit(store.storeId, order.orderId, { quantities: { [tote.id]: 2 }, reason: "out_of_stock" }, actor()).finally(() => {
      fake.state.refundStatus = "succeeded";
    });
    if (!done.ok) throw new Error(JSON.stringify(done.problems));
    const [refund] = await db().execute<Row>(sql`select provider_reference, amount_minor from commerce.refunds where order_edit_id = ${done.editId}::uuid`);
    expect(Number(refund.amount_minor)).toBe(-done.differenceMinor);
    // Stripe reports it failed, twice (events come again).
    const failed = { id: String(refund.provider_reference), status: "failed", amount: Number(refund.amount_minor), currency: "nok", created: Math.floor(Date.now() / 1000), metadata: { order_id: order.orderId } };
    await applyStripeRefund(store.storeId, failed as never);
    await applyStripeRefund(store.storeId, failed as never);
    expect(await eventsOf(order.orderId, "order.edit_refund_failed")).toHaveLength(1);
    const admin = await getOrderAdmin(store.storeId, order.orderId);
    expect(admin?.edits.find((e) => e.id === done.editId)?.refundOwedMinor).toBe(-done.differenceMinor);
    expect((await invoiceCheckupFindings(store.storeId)).map((f) => f.code)).toContain("edit_refund_failed");
    // Staff refund the customer again from the order page: nothing is owed any more.
    const again = await refundOrder(store.storeId, order.orderId, { amountMinor: -done.differenceMinor, reason: "Refund of change E1 again", restock: [] }, store.accountId);
    expect(again).toMatchObject({ ok: true });
    expect((await getOrderAdmin(store.storeId, order.orderId))?.edits.find((e) => e.id === done.editId)?.refundOwedMinor).toBe(0);
    expect((await invoiceCheckupFindings(store.storeId)).map((f) => f.code)).not.toContain("edit_refund_failed");
  });
});

describe("a business return of a received unit does not stop the units still owed (review fix)", () => {
  it("partly sent, then the one received unit is returned: the other two can still be sent, and the order becomes Sent", async () => {
    const order = await paidOrder(store, [["DEMO-TOTE", 3]], { beforePaid: asCompany });
    const tote = lineOf(order, "DEMO-TOTE");
    const first = await markSent(store.storeId, order.orderId, { carrier: "posten", trackingNumber: "B1", trackingUrl: null }, store.accountId, null, { lines: [{ lineId: tote.id, quantity: 1 }] });
    if (!first.ok) throw new Error(first.reason);
    const [ret] = await db().execute<Row>(sql`insert into commerce.returns (store_id, order_id, kind, status) values (${store.storeId}::uuid, ${order.orderId}::uuid, 'return', 'requested') returning id`);
    await db().execute(sql`insert into commerce.return_lines (store_id, return_id, order_line_id, quantity, decision) values (${store.storeId}::uuid, ${String(ret.id)}::uuid, ${tote.id}::uuid, 1, 'accept')`);
    const admin = await getOrderAdmin(store.storeId, order.orderId);
    expect(admin?.fulfilment.lines.find((l) => l.lineId === tote.id)).toMatchObject({ shipped: 1, withdrawn: 0, toSend: 2 });
    const rest = await markSent(store.storeId, order.orderId, { carrier: "posten", trackingNumber: "B2", trackingUrl: null }, store.accountId);
    expect(rest).toMatchObject({ ok: true, left: 0, shipment: { lines: [{ lineId: tote.id, quantity: 2 }] } });
    const [status] = await db().execute<Row>(sql`select status from commerce.orders where id = ${order.orderId}::uuid`);
    expect(status.status).toBe("fulfilled");
  });
});

describe("the change's pay link in a euro view (D109: a new money read)", () => {
  it("charges the difference in the order's own currency, under either view of the country, and the additional invoice is in euros", async () => {
    const euro = await fxStore("edit-fix-eur", { invoicing: true, live: true });
    const order = await paidOrder(euro, [["DEMO-TOTE", 1]], { market: NO_EUR });
    expect(order.currency).toBe("EUR");
    const sent = await edits.sendOrderEdit(euro.storeId, order.orderId, { added: [{ variantId: await variantOf(euro, "DEMO-LAMP"), quantity: 1 }], reason: "customer_request" }, staffActor(euro.accountId), { email: false });
    if (!sent.ok) throw new Error(JSON.stringify(sent.problems));
    const token = sent.link.split("/").at(-1)!;
    // The link is made in the order's own view (euros).
    expect(sent.link).toContain("/no-eur/");
    const [edit] = await db().execute<Row>(sql`select difference_minor, trim(currency) as currency from commerce.order_edits where id = ${sent.editId}::uuid`);
    expect(edit.currency).toBe("EUR");
    const shop = { store: (await getStore(euro.slug))!, market: NO };
    // The same country in kroner reads the same change in euros: the page is the change's, never converted again.
    const page = await pay.changePageFor(shop, token);
    expect(page).toMatchObject({ state: "ready", toPayMinor: Number(edit.difference_minor), edit: { currency: "EUR" } });
    for (const market of [NO, NO_EUR]) {
      const started = await pay.startEditPayment({ store: shop.store, market }, token, { origin });
      expect(started).toMatchObject({ ok: true });
      const session = fake.created.at(-1)!;
      const line = (session.params as { line_items: { price_data: { currency: string; unit_amount: number } }[] }).line_items[0].price_data;
      expect(line).toMatchObject({ currency: "eur", unit_amount: Number(edit.difference_minor) });
    }
    const [payment] = await db().execute<Row>(sql`
      select provider_reference, amount_minor, trim(currency) as currency from commerce.payments where order_edit_id = ${sent.editId}::uuid order by created_at desc limit 1
    `);
    expect({ currency: payment.currency, amount: Number(payment.amount_minor) }).toEqual({ currency: "EUR", amount: Number(edit.difference_minor) });
    fake.sessions.set(String(payment.provider_reference), { status: "complete", payment_status: "paid" });
    await applySession(euro.storeId, { id: String(payment.provider_reference), status: "complete", payment_status: "paid" } as never, "checkout.session.completed");
    const [after] = await db().execute<Row>(sql`select total_minor, trim(currency) as currency from commerce.orders where id = ${order.orderId}::uuid`);
    expect({ currency: after.currency, total: Number(after.total_minor) }).toEqual({ currency: "EUR", total: order.totalMinor + Number(edit.difference_minor) });
    const [extra] = await db().execute<Row>(sql`select trim(currency) as currency, total_minor from commerce.invoices where order_id = ${order.orderId}::uuid and kind = 'order_edit'`);
    expect({ currency: extra?.currency, total: Number(extra?.total_minor) }).toEqual({ currency: "EUR", total: Number(edit.difference_minor) });
  });
});
