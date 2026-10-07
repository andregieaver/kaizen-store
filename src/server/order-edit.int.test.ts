import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { vatIncluded } from "@/lib/checkout";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
const jar = vi.hoisted(() => new Map<string, string>());
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    set: (name: string, value: string) => void jar.set(name, value),
    delete: (name: string) => void jar.delete(name),
  }),
  headers: async () => new Headers(),
}));

/** Kaizen's platform Stripe client, faked: refunds and hosted Checkout sessions, recorded. */
const fake = vi.hoisted(() => {
  const refunds: { params: Record<string, unknown>; options: Record<string, unknown> }[] = [];
  const created: { params: Record<string, unknown>; options: Record<string, unknown> }[] = [];
  const sessions = new Map<string, Record<string, unknown>>();
  const state = { failRefunds: 0 };
  let next = 0;
  const client = {
    refunds: {
      create: async (params: Record<string, unknown>, options: Record<string, unknown>) => {
        refunds.push({ params, options });
        if (state.failRefunds > 0) {
          state.failRefunds -= 1;
          throw Object.assign(new Error("Your card was declined."), { type: "StripeCardError" });
        }
        return { id: `re_edit_${refunds.length}`, status: "succeeded" };
      },
    },
    coupons: { create: async () => ({ id: "co_x" }) },
    checkout: {
      sessions: {
        create: async (params: Record<string, unknown>, options: Record<string, unknown>) => {
          created.push({ params, options });
          const id = `cs_edit_${++next}`;
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
const { markSent, getOrderAdmin } = await import("./order-admin");
const { changeLine, getCart } = await import("./cart");
const { cartSummary } = await import("./cart-summary");
const { getStore } = await import("./stores");
const { staffActor } = await import("./order-actor");
const w = await import("./withdrawals");
const { fxStore, paidOrder, readOrder, lineOf, variantOf, onHand, mailsOf, eventsOf, NO, NO_EUR } = await import("./fulfilment-test-fixture");

type Row = Record<string, unknown>;
type Market = typeof NO;

/**
 * Changing an order after purchase against a real database (wave 3, run 3, D174, `docs/wave-3-fulfilment.md` 2.2, 4.3 to 4.6, E1 to E6): the three changes on one
 * order in kroner and in a euro view, the added lines equal to `cartSummary()` of the same goods; the kept lines keep their sold amounts; the stock follows; a
 * lower total is refunded through `refundOrder()` with the change in one transaction (a refused refund writes nothing); a higher one is applied only when the
 * customer pays through the link (once, however often the webhook comes) or staff record it as paid outside Kaizen; an expired link releases the held units; a
 * payment for a change that can no longer be applied is given back in full; every refusal is named; another store sees nothing; the number never changes.
 */

let store: Awaited<ReturnType<typeof fxStore>>;
let other: Awaited<ReturnType<typeof fxStore>>;
let actor: ReturnType<typeof staffActor>;
const origin = "https://kaizen.test";

beforeAll(async () => {
  store = await fxStore("edit", { invoicing: true, live: true });
  other = await fxStore("edit-other");
  actor = staffActor(store.accountId);
});
beforeEach(() => {
  fake.state.failRefunds = 0;
});
afterAll(async () => {
  await closeDb();
});

const orderRow = async (orderId: string) =>
  (await db().execute<Row>(sql`select number, status, subtotal_minor, shipping_minor, discount_minor, tax_minor, total_minor, edited_at from commerce.orders where id = ${orderId}::uuid`))[0];
const editRow = async (editId: string) => (await db().execute<Row>(sql`select * from commerce.order_edits where id = ${editId}::uuid`))[0];

/** The order's own checks: the total adds up, and its VAT is its lines' and its shipping's. */
async function expectConsistent(orderId: string) {
  const o = await orderRow(orderId);
  expect(Number(o.total_minor)).toBe(Number(o.subtotal_minor) + Number(o.shipping_minor) - Number(o.discount_minor));
  const [lines] = await db().execute<Row>(sql`select coalesce(sum(unit_price_minor * quantity), 0)::bigint as goods, coalesce(sum(tax_minor), 0)::bigint as tax from commerce.order_lines where order_id = ${orderId}::uuid`);
  expect(Number(lines.goods)).toBe(Number(o.subtotal_minor));
  expect(Number(o.tax_minor)).toBe(Number(lines.tax) + vatIncluded(Number(o.shipping_minor), 0.25));
}

/** What `cartSummary()` gives a cart of these goods in this market's view, with no code, campaign, group discount or credit: per unit, the line and its VAT. */
async function cartOf(market: Market, sku: string, quantity: number) {
  jar.clear();
  const shop = { storeId: store.storeId, market };
  const added = await changeLine(shop, await variantOf(store, sku), quantity, "add");
  expect(added).toMatchObject({ outcome: "added" });
  const cart = await getCart(shop);
  const summary = await cartSummary(shop, cart);
  const line = summary.payable[0];
  return { unitPriceMinor: Number(line.unitPriceMinor), totalMinor: Number(line.unitPriceMinor) * quantity, taxMinor: summary.vat - vatIncluded(summary.shipping ?? 0, 0.25), currency: cart.currency };
}

describe("a lower total: applied at once and refunded through refundOrder() (E1, E2, E3, E5)", () => {
  for (const market of [NO, NO_EUR]) {
    it(`takes a line off, lowers one and adds goods priced as the checkout prices them (${market.currency})`, async () => {
      const order = await paidOrder(store, [["DEMO-TOTE", 3], ["DEMO-MUG-WHITE", 1], ["DEMO-LAMP", 1]], { market });
      const before = await orderRow(order.orderId);
      const tote = lineOf(order, "DEMO-TOTE");
      const mug = lineOf(order, "DEMO-MUG-WHITE");
      const lamp = lineOf(order, "DEMO-LAMP");
      const stock = { tote: await onHand(store, "DEMO-TOTE"), mug: await onHand(store, "DEMO-MUG-WHITE"), lamp: await onHand(store, "DEMO-LAMP"), notebook: await onHand(store, "DEMO-NOTEBOOK-LINED") };
      const raw = {
        quantities: { [tote.id]: 1, [mug.id]: 0 },
        added: [{ variantId: await variantOf(store, "DEMO-NOTEBOOK-LINED"), quantity: 2 }],
        reason: "customer_request",
        note: "Kari called on Tuesday",
        restock: true,
        noRestock: [await variantOf(store, "DEMO-MUG-WHITE")],
      };
      const preview = await edits.previewOrderEdit(store.storeId, order.orderId, raw);
      if (!preview || !("priced" in preview)) throw new Error(JSON.stringify(preview));
      expect(preview.problems).toEqual([]);
      expect(preview.money).toBe("refund");
      expect(preview.sentences.money).toMatch(/refunded to the customer's card/);
      expect(preview.sentences.documents).toMatch(/credit note .* additional invoice/);
      // The added line is what the cart would show for the same goods, in the same view.
      const cart = await cartOf(market, "DEMO-NOTEBOOK-LINED", 2);
      expect(cart.currency).toBe(market.currency);
      const addedLine = preview.priced!.added[0];
      expect({ unit: addedLine.unitPriceMinor, total: addedLine.totalMinor, tax: addedLine.taxMinor }).toEqual({ unit: cart.unitPriceMinor, total: cart.totalMinor, tax: cart.taxMinor });

      const done = await edits.applyOrderEdit(store.storeId, order.orderId, { ...raw, base: preview.base }, actor);
      if (!done.ok) throw new Error(JSON.stringify(done.problems));
      expect(done).toMatchObject({ label: "E1", money: "refund" });
      expect(done.differenceMinor).toBe(preview.differenceMinor);
      // One Stripe refund of the difference, with the change's own key.
      const refund = fake.refunds.at(-1)!;
      expect(refund.params).toMatchObject({ amount: -preview.differenceMinor, refund_application_fee: true });
      expect(refund.options).toMatchObject({ idempotencyKey: `order-edit-refund:${done.editId}`, stripeAccount: store.stripeAccount });
      // The order as changed: the number kept, the kept line's sold amounts kept, the added line, the sums.
      const after = await orderRow(order.orderId);
      expect(after.number).toBe(before.number);
      expect(Number(after.total_minor)).toBe(Number(before.total_minor) + preview.differenceMinor);
      expect(after.edited_at).not.toBeNull();
      await expectConsistent(order.orderId);
      const now = await readOrder(store, order.orderId);
      expect(now.lines.map((l) => [l.sku, l.quantity]).sort()).toEqual([["DEMO-LAMP", 1], ["DEMO-NOTEBOOK-LINED", 2], ["DEMO-TOTE", 1]]);
      expect(lineOf(now, "DEMO-LAMP")).toMatchObject({ totalMinor: lamp.totalMinor, taxMinor: lamp.taxMinor });
      expect(lineOf(now, "DEMO-TOTE").totalMinor).toBe(Math.floor(tote.totalMinor / 3));
      expect(lineOf(now, "DEMO-NOTEBOOK-LINED")).toMatchObject({ totalMinor: cart.totalMinor, taxMinor: cart.taxMinor });
      // The stock: two totes back where they came from, the mug left out (damaged), two notebooks drawn.
      expect(await onHand(store, "DEMO-TOTE")).toBe(stock.tote + 2);
      expect(await onHand(store, "DEMO-MUG-WHITE")).toBe(stock.mug);
      expect(await onHand(store, "DEMO-NOTEBOOK-LINED")).toBe(stock.notebook - 2);
      const movements = await db().execute<Row>(sql`select reason, source from commerce.inventory_movements where order_id = ${order.orderId}::uuid and source = 'order_edit' order by id`);
      expect(movements.map((m) => `${m.reason}/${m.source}`).sort()).toEqual(["order_restock/order_edit", "sale/order_edit"]);
      // The change: applied, its refund named, its lines kept; one history event with before and after, staff's note only there.
      const edit = await editRow(done.editId);
      expect(edit).toMatchObject({ status: "applied", seq: 1, difference_minor: String(preview.differenceMinor) === String(edit.difference_minor) ? edit.difference_minor : preview.differenceMinor });
      expect(edit.refund_id).not.toBeNull();
      const [linked] = await db().execute<Row>(sql`select order_edit_id from commerce.refunds where id = ${String(edit.refund_id)}::uuid`);
      expect(String(linked.order_edit_id)).toBe(done.editId);
      const applied = await eventsOf(order.orderId, "order.edit_applied");
      expect(applied).toHaveLength(1);
      expect(applied[0].data).toMatchObject({ edit: done.editId, seq: 1, note: "Kari called on Tuesday", difference: preview.differenceMinor });
      // One email: the change, to the order's own address, with the refund and never the note; no separate refund email.
      const changed = await mailsOf(order.orderId, "order.changed");
      expect(changed).toHaveLength(1);
      expect(changed[0].to_address).toBe(order.email);
      expect(String(changed[0].text)).toContain("Vi har refundert");
      expect(String(changed[0].text)).not.toContain("Kari called");
      expect(await mailsOf(order.orderId, "order.refunded")).toHaveLength(0);
      // The order's number sequence is untouched.
      const [audit] = await db().execute<Row>(sql`select ok, missing from commerce.order_number_audit(${store.storeId}::uuid)`);
      expect(audit).toMatchObject({ ok: true });
      expect(Number(audit.missing)).toBe(0);
      // An audit entry with the amount, never the note.
      const [entry] = await db().execute<Row>(sql`select details from commerce.audit_log where store_id = ${store.storeId}::uuid and action = 'order.edit_applied' order by id desc limit 1`);
      expect(JSON.stringify(entry.details)).not.toContain("Kari");
    });
  }

  it("issues a credit note and an additional invoice referring to the original, never changing it (E6), and the refund gets none of its own", async () => {
    const order = await paidOrder(store, [["DEMO-TOTE", 2], ["DEMO-MUG-WHITE", 1]]);
    const [original] = await db().execute<Row>(sql`select id, document_number, total_minor from commerce.invoices where order_id = ${order.orderId}::uuid and kind = 'order'`);
    expect(original).toBeTruthy();
    const done = await edits.applyOrderEdit(
      store.storeId,
      order.orderId,
      { quantities: { [lineOf(order, "DEMO-MUG-WHITE").id]: 0 }, added: [{ variantId: await variantOf(store, "DEMO-NOTEBOOK-DOTTED"), quantity: 1 }], reason: "customer_request" },
      actor,
    );
    if (!done.ok) throw new Error(JSON.stringify(done.problems));
    expect((await editRow(done.editId)).documents).toBe("issued");
    const [still] = await db().execute<Row>(sql`select total_minor from commerce.invoices where id = ${String(original.id)}::uuid`);
    expect(still.total_minor).toEqual(original.total_minor);
    const notes = await db().execute<Row>(sql`select source, order_edit_id, total_minor from commerce.credit_notes c where c.invoice_id = ${String(original.id)}::uuid`);
    expect(notes.map((n) => n.source)).toEqual(["order_edit"]);
    const extra = await db().execute<Row>(sql`select kind, order_edit_id from commerce.invoices where order_id = ${order.orderId}::uuid and kind = 'order_edit'`);
    expect(extra).toHaveLength(1);
    expect(await eventsOf(order.orderId, "credit_note.covered_by_edit")).toHaveLength(1);
    // Per rate, the documents add up to the order as it now is.
    const [sums] = await db().execute<Row>(sql`
      select (select coalesce(sum(total_minor), 0) from commerce.invoices where order_id = ${order.orderId}::uuid)
           - (select coalesce(sum(c.total_minor), 0) from commerce.credit_notes c join commerce.invoices i on i.id = c.invoice_id where i.order_id = ${order.orderId}::uuid) as net,
             (select total_minor from commerce.orders where id = ${order.orderId}::uuid) as total
    `);
    expect(Number(sums.net)).toBe(Number(sums.total));
    // A later refund is credited against the order's documents taken together, its credit note naming the original invoice.
    const { refundOrder } = await import("./order-admin");
    const later = await refundOrder(store.storeId, order.orderId, { amountMinor: 5_000, reason: "Goodwill", restock: [] }, store.accountId);
    expect(later).toMatchObject({ ok: true });
    const [note] = await db().execute<Row>(sql`select c.invoice_id, c.total_minor from commerce.credit_notes c where c.refund_id = ${later.ok ? later.refundId : ""}::uuid`);
    expect(String(note.invoice_id)).toBe(String(original.id));
    expect(Number(note.total_minor)).toBe(5_000);
  });

  it("writes nothing when Stripe refuses the refund", async () => {
    const order = await paidOrder(store, [["DEMO-TOTE", 2]]);
    const before = await orderRow(order.orderId);
    fake.state.failRefunds = 1;
    const done = await edits.applyOrderEdit(store.storeId, order.orderId, { quantities: { [lineOf(order, "DEMO-TOTE").id]: 1 }, reason: "out_of_stock" }, actor);
    expect(done).toMatchObject({ ok: false, problems: [{ code: "refund_failed" }] });
    expect(await orderRow(order.orderId)).toEqual(before);
    const [count] = await db().execute<Row>(sql`select count(*)::int as n from commerce.order_edits where order_id = ${order.orderId}::uuid`);
    expect(Number(count.n)).toBe(0);
  });

  it("refuses when the order moved since the preview, and a variant that stops at zero without stock, writing nothing", async () => {
    const order = await paidOrder(store, [["DEMO-TOTE", 3]]);
    const tote = lineOf(order, "DEMO-TOTE");
    const preview = await edits.previewOrderEdit(store.storeId, order.orderId, { quantities: { [tote.id]: 2 }, reason: "customer_request" });
    if (!preview || !("base" in preview)) throw new Error("no preview");
    await edits.applyOrderEdit(store.storeId, order.orderId, { quantities: { [tote.id]: 2 }, reason: "customer_request" }, actor);
    expect(await edits.applyOrderEdit(store.storeId, order.orderId, { quantities: { [tote.id]: 1 }, reason: "customer_request", base: preview.base }, actor)).toMatchObject({ ok: false, problems: [{ code: "changed" }] });
    // A variant that stops at zero: only 1 left.
    const lamp = await variantOf(store, "DEMO-LAMP");
    const have = await onHand(store, "DEMO-LAMP");
    const short = await edits.previewOrderEdit(store.storeId, order.orderId, { added: [{ variantId: lamp, quantity: have + 1 }], reason: "customer_request" });
    expect(short && "problems" in short && short.problems.map((p) => p.code)).toContain("stock");
  });
});

describe("a higher total: a pay link, applied only when paid (E2, CRD Art. 22)", () => {
  it("holds the added units, leaves the order unchanged, emails the link once, and applies the change once when the session completes", async () => {
    const order = await paidOrder(store, [["DEMO-TOTE", 1]]);
    const before = await orderRow(order.orderId);
    const lamp = await variantOf(store, "DEMO-LAMP");
    const stock = await onHand(store, "DEMO-LAMP");
    const sent = await edits.sendOrderEdit(store.storeId, order.orderId, { added: [{ variantId: lamp, quantity: 1 }], reason: "customer_request" }, actor, { email: true });
    if (!sent.ok) throw new Error(JSON.stringify(sent.problems));
    expect(sent.link).toMatch(/\/account\/change\/[A-Za-z0-9_-]{43}$/);
    const token = sent.link.split("/").at(-1)!;
    expect(await orderRow(order.orderId)).toEqual(before);
    const edit = await editRow(sent.editId);
    expect(edit).toMatchObject({ status: "awaiting_payment", pay_token_hash: edits.hashEditToken(token) });
    const [held] = await db().execute<Row>(sql`select coalesce(sum(quantity), 0)::int as n from commerce.inventory_reservations where order_edit_id = ${sent.editId}::uuid and released_at is null`);
    expect(Number(held.n)).toBe(1);
    expect(await mailsOf(order.orderId, "order.changed")).toHaveLength(1);
    // While it waits, nothing is sent and no other change is made.
    expect(await markSent(store.storeId, order.orderId, { carrier: "posten", trackingNumber: "", trackingUrl: null }, null)).toEqual({ ok: false, reason: "edit_pending" });
    const { runBulk } = await import("./order-bulk");
    expect(await runBulk(store.storeId, actor, { action: "mark_sent", selection: { kind: "ids", ids: [order.orderId] } })).toMatchObject({ ok: true, result: { applied: 0, refused: [{ reason: "edit_pending" }] } });
    const { refundOrder: refund } = await import("./order-admin");
    expect(await refund(store.storeId, order.orderId, { amountMinor: 100, reason: "x", restock: [] }, store.accountId)).toMatchObject({ ok: false });
    expect(await edits.previewOrderEdit(store.storeId, order.orderId, { quantities: {}, added: [{ variantId: lamp, quantity: 1 }], reason: "customer_request" })).toMatchObject({ ok: false, problems: [{ code: "edit_pending" }] });
    // The pay page, under the order's own country only.
    const shop = { store: (await getStore(store.slug))!, market: NO };
    const page = await pay.changePageFor(shop, token);
    expect(page).toMatchObject({ state: "ready", toPayMinor: Number(edit.difference_minor) });
    expect((await pay.changePageFor(shop, "x".repeat(43))).state).toBe("not_found");
    // The press: one hosted session of one line of the difference, Kaizen's fee on it, the change named, never the token.
    const started = await pay.startEditPayment(shop, token, { origin });
    expect(started).toMatchObject({ ok: true });
    const session = fake.created.at(-1)!;
    expect(session.params).toMatchObject({ mode: "payment", line_items: [{ quantity: 1, price_data: { unit_amount: Number(edit.difference_minor) } }], metadata: { order_edit_id: sent.editId } });
    expect(JSON.stringify((session.params as { metadata: unknown }).metadata)).not.toContain(token);
    expect(session.options).toMatchObject({ idempotencyKey: `order-edit-pay-${sent.editId}-0`, stripeAccount: store.stripeAccount });
    const [payment] = await db().execute<Row>(sql`select provider_reference, status from commerce.payments where order_edit_id = ${sent.editId}::uuid`);
    expect(payment.status).toBe("pending");
    // Stripe says it was paid: applied once, however often the webhook comes; the order is never completed twice.
    const sessionId = String(payment.provider_reference);
    fake.sessions.set(sessionId, { status: "complete", payment_status: "paid" });
    const completed = { id: sessionId, status: "complete", payment_status: "paid" } as never;
    await applySession(store.storeId, completed, "checkout.session.completed");
    await applySession(store.storeId, completed, "checkout.session.completed");
    expect(await editRow(sent.editId)).toMatchObject({ status: "applied" });
    expect(await eventsOf(order.orderId, "order.edit_applied")).toHaveLength(1);
    expect(await eventsOf(order.orderId, "order.paid")).toHaveLength(1);
    const after = await orderRow(order.orderId);
    expect(Number(after.total_minor)).toBe(Number(before.total_minor) + Number(edit.difference_minor));
    await expectConsistent(order.orderId);
    expect(await onHand(store, "DEMO-LAMP")).toBe(stock - 1);
    expect((await pay.changePageFor(shop, token)).state).toBe("paid");
    // The additional invoice says it was paid online.
    const [extra] = await db().execute<Row>(sql`select snapshot -> 'payments' -> 0 ->> 'kind' as kind, snapshot -> 'refersTo' as refers from commerce.invoices where order_id = ${order.orderId}::uuid and kind = 'order_edit'`);
    expect(extra?.kind).toBe("paid_online");
    expect(extra?.refers).toBeTruthy();
  });

  it("expires at the link's end: its session closed, its units released, the order as it was", async () => {
    const order = await paidOrder(store, [["DEMO-TOTE", 1]]);
    const sent = await edits.sendOrderEdit(store.storeId, order.orderId, { added: [{ variantId: await variantOf(store, "DEMO-THERMOS"), quantity: 1 }], reason: "customer_request" }, actor, { email: false });
    if (!sent.ok) throw new Error(JSON.stringify(sent.problems));
    expect(await mailsOf(order.orderId, "order.changed")).toHaveLength(0);
    await pay.startEditPayment({ store: (await getStore(store.slug))!, market: NO }, sent.link.split("/").at(-1)!, { origin });
    const run = await edits.expireOrderEdits(new Date(Date.now() + 8 * 86_400_000));
    expect(run.expired).toBeGreaterThanOrEqual(1);
    expect(await editRow(sent.editId)).toMatchObject({ status: "expired" });
    const [held] = await db().execute<Row>(sql`select count(*)::int as n from commerce.inventory_reservations where order_edit_id = ${sent.editId}::uuid and released_at is null`);
    expect(Number(held.n)).toBe(0);
    const [payment] = await db().execute<Row>(sql`select status from commerce.payments where order_edit_id = ${sent.editId}::uuid`);
    expect(payment.status).toBe("cancelled");
    expect(await eventsOf(order.orderId, "order.edit_expired")).toHaveLength(1);
  });

  it("refunds in full a payment that arrives for a change that was cancelled meanwhile", async () => {
    const order = await paidOrder(store, [["DEMO-TOTE", 1]]);
    const sent = await edits.sendOrderEdit(store.storeId, order.orderId, { added: [{ variantId: await variantOf(store, "DEMO-LAMP"), quantity: 1 }], reason: "customer_request" }, actor, { email: false });
    if (!sent.ok) throw new Error(JSON.stringify(sent.problems));
    await pay.startEditPayment({ store: (await getStore(store.slug))!, market: NO }, sent.link.split("/").at(-1)!, { origin });
    const [payment] = await db().execute<Row>(sql`select provider_reference, amount_minor from commerce.payments where order_edit_id = ${sent.editId}::uuid`);
    // Cancelled while Stripe was still processing (its session could not be closed): the cancel waits unless forced, as the closing store does.
    fake.sessions.set(String(payment.provider_reference), { status: "complete", payment_status: "unpaid" });
    expect(await edits.cancelOrderEdit(store.storeId, sent.editId, actor)).toEqual({ ok: false, problem: "processing" });
    await edits.endOrderEdit(store.storeId, sent.editId, "cancelled", actor, { force: true });
    fake.sessions.set(String(payment.provider_reference), { status: "complete", payment_status: "paid" });
    const before = await orderRow(order.orderId);
    await applySession(store.storeId, { id: String(payment.provider_reference), status: "complete", payment_status: "paid" } as never, "checkout.session.completed");
    expect(await orderRow(order.orderId)).toEqual(before);
    expect(fake.refunds.at(-1)!.params).toMatchObject({ amount: Number(payment.amount_minor) });
    expect(await eventsOf(order.orderId, "order.edit_payment_refunded")).toHaveLength(1);
  });

  it("records a change as paid outside Kaizen (the owner), applied at once with a manual payment of the difference", async () => {
    const order = await paidOrder(store, [["DEMO-TOTE", 1]]);
    const raw = { added: [{ variantId: await variantOf(store, "DEMO-MUG-BLACK"), quantity: 2 }], reason: "customer_request" };
    expect(await edits.recordEditPaidOutside(store.storeId, { orderId: order.orderId, raw }, { method: "cash" }, staffActor(other.accountId))).toMatchObject({ ok: false, problems: [{ code: "not_allowed" }] });
    const done = await edits.recordEditPaidOutside(store.storeId, { orderId: order.orderId, raw }, { method: "bank_transfer", reference: "Bank ref 42" }, actor);
    if (!done.ok) throw new Error(JSON.stringify(done.problems));
    const edit = await editRow(done.editId);
    expect(edit.status).toBe("applied");
    const [payment] = await db().execute<Row>(sql`select provider, amount_minor, status, method from commerce.payments where id = ${String(edit.payment_id)}::uuid`);
    expect(payment).toMatchObject({ provider: "manual", status: "captured", method: "bank_transfer" });
    expect(Number(payment.amount_minor)).toBe(Number(edit.difference_minor));
    expect((await eventsOf(order.orderId, "order.edit_paid_outside"))[0].data).toMatchObject({ note: "Bank ref 42" });
    await expectConsistent(order.orderId);
  });

  it("cancels a change waiting for payment when the customer withdraws, never refusing the withdrawal", async () => {
    const order = await paidOrder(store, [["DEMO-TOTE", 2]]);
    const sent = await edits.sendOrderEdit(store.storeId, order.orderId, { added: [{ variantId: await variantOf(store, "DEMO-LAMP"), quantity: 1 }], reason: "customer_request" }, actor, { email: false });
    if (!sent.ok) throw new Error(JSON.stringify(sent.problems));
    const started = await w.startWithdrawal(store.storeId, { orderNumber: order.number, email: order.email, name: "K N", lines: [{ lineId: lineOf(order, "DEMO-TOTE").id, quantity: 1 }] }, { floorMs: 0 });
    if (!started.ok || !started.matched || !started.request) throw new Error(JSON.stringify(started));
    expect(await w.confirmWithdrawal(store.storeId, { requestId: started.request.id })).toMatchObject({ ok: true });
    expect(await editRow(sent.editId)).toMatchObject({ status: "cancelled" });
  });
});

describe("which orders can be changed (E4)", () => {
  it("refuses a sent, a partly sent, a cancelled and another store's order, each with its reason, and writes nothing", async () => {
    const sent = await paidOrder(store, [["DEMO-TOTE", 2]]);
    await markSent(store.storeId, sent.orderId, { carrier: "posten", trackingNumber: "", trackingUrl: null }, null, null, { lines: [{ lineId: lineOf(sent, "DEMO-TOTE").id, quantity: 1 }] });
    const raw = { quantities: { [lineOf(sent, "DEMO-TOTE").id]: 1 }, reason: "customer_request" };
    expect(await edits.applyOrderEdit(store.storeId, sent.orderId, raw, actor)).toMatchObject({ ok: false, problems: [{ code: "sent" }] });
    expect(await edits.previewOrderEdit(other.storeId, sent.orderId, raw)).toBeNull();
    expect(await edits.applyOrderEdit(other.storeId, sent.orderId, raw, actor)).toMatchObject({ ok: false, problems: [{ code: "not_found" }] });
    const restricted = await paidOrder(store, [["DEMO-TOTE", 2]]);
    await db().execute(sql`update commerce.orders set restricted_at = now() where id = ${restricted.orderId}::uuid`);
    expect(await edits.applyOrderEdit(store.storeId, restricted.orderId, { quantities: { [lineOf(restricted, "DEMO-TOTE").id]: 1 }, reason: "customer_request" }, actor)).toMatchObject({ ok: false, problems: [{ code: "restricted" }] });
    // Every line taken off is cancelling, not a change; a kept line never grows.
    const whole = await paidOrder(store, [["DEMO-TOTE", 2]]);
    expect(await edits.previewOrderEdit(store.storeId, whole.orderId, { quantities: { [lineOf(whole, "DEMO-TOTE").id]: 0 }, reason: "customer_request" })).toMatchObject({ ok: false, problems: [{ code: "nothing_left" }] });
    expect(await edits.previewOrderEdit(store.storeId, whole.orderId, { quantities: { [lineOf(whole, "DEMO-TOTE").id]: 3 }, reason: "customer_request" })).toMatchObject({ ok: false, problems: [{ code: "only_down" }] });
    const [count] = await db().execute<Row>(sql`select count(*)::int as n from commerce.order_edits where order_id in (${sent.orderId}::uuid, ${restricted.orderId}::uuid, ${whole.orderId}::uuid)`);
    expect(Number(count.n)).toBe(0);
  });

  it("refuses a store that is not open, and shows the reason on the staff page", async () => {
    const closing = await fxStore("edit-closed");
    const order = await paidOrder(closing, [["DEMO-TOTE", 2]]);
    await db().execute(sql`update commerce.stores set status = 'suspended' where id = ${closing.storeId}::uuid`);
    expect(await edits.applyOrderEdit(closing.storeId, order.orderId, { quantities: { [lineOf(order, "DEMO-TOTE").id]: 1 }, reason: "customer_request" }, staffActor(closing.accountId))).toMatchObject({
      ok: false,
      problems: [{ code: "store_closed" }],
    });
    expect(await edits.orderEditability(closing.storeId, order.orderId)).toMatchObject({ block: "store_closed" });
    expect((await getOrderAdmin(closing.storeId, order.orderId))?.edits).toEqual([]);
  });
});

describe("a staff-made order (D173) with a staff discount", () => {
  it("keeps the discount on the units kept and takes the share of the units taken off, its name kept; paid outside, so the refund is recorded", async () => {
    const { createDraft, saveDraft, recordDraftPaidOutside } = await import("./draft-orders");
    const made = await createDraft(store.storeId, actor, { marketSlug: "no" });
    if (!made.ok) throw new Error(made.problem);
    const saved = await saveDraft(store.storeId, actor, made.draft.id, {
      version: made.draft.version,
      marketSlug: "no",
      email: "draft-buyer@example.com",
      shippingAddress: { name: "Kari Nordmann", line1: "Storgata 1", postalCode: "0155", city: "Oslo", country: "NO" },
      billingAddress: {},
      tags: [],
      discount: { kind: "percent", value: "10", label: "Friends" },
      shipping: { kind: "rate" },
      lines: [{ kind: "goods", variantId: await variantOf(store, "DEMO-MUG-WHITE"), quantity: 4 }],
    });
    if (!saved.ok) throw new Error(saved.problem);
    const member = { account: { id: store.accountId }, store: { id: store.storeId, slug: store.slug }, role: "owner", kind: "staff", permissions: null } as never;
    const paid = await recordDraftPaidOutside(member, made.draft.id, { version: saved.draft.version, method: "bank_transfer" });
    if (!paid.ok) throw new Error(paid.problem);
    const order = await readOrder(store, paid.orderId);
    const mug = lineOf(order, "DEMO-MUG-WHITE");
    const [sold] = await db().execute<Row>(sql`select staff_discount_minor from commerce.order_lines where id = ${mug.id}::uuid`);
    const done = await edits.applyOrderEdit(store.storeId, order.orderId, { quantities: { [mug.id]: 3 }, reason: "customer_request" }, actor);
    if (!done.ok) throw new Error(JSON.stringify(done.problems));
    const [kept] = await db().execute<Row>(sql`select quantity, total_minor, discount_minor, staff_discount_minor from commerce.order_lines where id = ${mug.id}::uuid`);
    expect(Number(kept.quantity)).toBe(3);
    expect(Number(kept.staff_discount_minor)).toBeLessThan(Number(sold.staff_discount_minor));
    expect(Number(kept.staff_discount_minor)).toBeGreaterThan(0);
    const [o] = await db().execute<Row>(sql`select staff_discount_minor, staff_discount_label from commerce.orders where id = ${order.orderId}::uuid`);
    expect(o).toMatchObject({ staff_discount_label: "Friends" });
    expect(Number(o.staff_discount_minor)).toBe(Number(kept.staff_discount_minor));
    await expectConsistent(order.orderId);
    // Money taken outside Kaizen is paid back by the store: recorded, no Stripe call, and the email says the store pays it back.
    const [refund] = await db().execute<Row>(sql`select r.status, r.provider_reference from commerce.refunds r where r.order_edit_id = ${done.editId}::uuid`);
    expect(refund).toMatchObject({ status: "succeeded" });
    expect(String(refund.provider_reference)).toMatch(/^manual_refund_/);
    expect(String((await mailsOf(order.orderId, "order.changed"))[0].text)).toMatch(/betaler .* tilbake til deg/);
  });
});
