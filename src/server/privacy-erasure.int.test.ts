import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }) }));
// A document's HTML is the surface's; the retention run only needs the files' storage to answer.
vi.mock("./document-html", () => ({ documentHtml: () => "<html></html>" }));

/** A stand-in for Stripe on the store's account: it keeps what it is told and records each call; it can be made to fail. */
const stripe = vi.hoisted(() => {
  const state = {
    cancelled: [] as string[],
    detached: [] as { id: string; account?: string }[],
    failCancel: false,
    failDetach: false,
    goneDetach: false,
    /** What Stripe says of a Checkout session (open and unpaid unless set), and which ones were expired. */
    sessions: {} as Record<string, { status: string; payment_status: string }>,
    expired: [] as string[],
  };
  const client = {
    checkout: {
      sessions: {
        retrieve: async (id: string) => ({ id, ...(state.sessions[id] ?? { status: "open", payment_status: "unpaid" }) }),
        expire: async (id: string) => {
          state.expired.push(id);
          return { id, status: "expired" };
        },
      },
    },
    subscriptions: {
      cancel: async (id: string) => {
        if (state.failCancel) throw new Error("Stripe is down");
        state.cancelled.push(id);
        return { id, status: "canceled", ended_at: Math.floor(Date.now() / 1000), metadata: {}, items: { data: [] }, cancel_at_period_end: false, cancel_at: null, pause_collection: null, trial_end: null };
      },
      update: async () => {
        throw new Error("not used");
      },
    },
    paymentMethods: {
      detach: async (id: string, _params: unknown, options: { stripeAccount?: string }) => {
        if (state.failDetach) throw new Error("Stripe is down");
        if (state.goneDetach) throw Object.assign(new Error("No such PaymentMethod"), { code: "resource_missing" });
        state.detached.push({ id, account: options?.stripeAccount });
        return { id };
      },
    },
  };
  return { state, client };
});
vi.mock("./stripe", () => ({ platformStripe: () => stripe.client, WEBHOOK_EVENTS: [] }));

const fx = await import("./invoice-test-fixture");
const { buildSubject, ageOrder } = await import("./privacy-fixture");
const { eraseSubject, planErasure, resumeErasures, STRIPE_DID_NOT_ANSWER } = await import("./privacy-erasure");
const { resolveSubject } = await import("./privacy-subject");
const { runRetention } = await import("./retention");
const { sendEmail } = await import("./email");
const { auditRows } = await import("./trust-fixtures");
const customers = await import("./customers");
const admin = await import("./customer-admin");
const { CUSTOMER_JOIN, CUSTOMER_KEY, HAS_CUSTOMER, PAID } = await import("./analytics-sql");

type Row = Record<string, unknown>;

/**
 * Erasing a person (D162, G6 to G10): the account and what no law needs go, a sale the bookkeeping duty keeps is restricted (cut loose from the
 * person, never deleted, used for nothing) and anonymised when the seller's country's period ends, the outside world is reached first and a
 * failure there changes nothing, a retry or two runs at once finish one request, and one store's erasure never touches another's.
 */

let store: Awaited<ReturnType<typeof fx.makeStore>>;
let foreign: Awaited<ReturnType<typeof fx.makeStore>>;

beforeAll(async () => {
  store = await fx.makeStore("erase");
  foreign = await fx.makeStore("erase-foreign");
}, 60_000);

afterAll(async () => {
  await closeDb();
});

const count = async (query: ReturnType<typeof sql>): Promise<number> => Number((await db().execute<Row>(sql`select count(*)::int as n from (${query}) t`))[0].n);
const ordersOf = (ids: string[]) =>
  db().execute<Row>(sql`select id, number, status, currency, total_minor, tax_minor, subtotal_minor, shipping_minor, discount_minor, vat_kind, placed_at, email, billing_address, shipping_address, customer_id, restricted_at, anonymised_at, company_name from commerce.orders where id = any(${`{${ids.join(",")}}`}::uuid[]) order by number`);
const money = (r: Row) => ({ number: r.number, status: r.status, currency: r.currency, total: r.total_minor, tax: r.tax_minor, subtotal: r.subtotal_minor, shipping: r.shipping_minor, discount: r.discount_minor, vat: r.vat_kind });

describe("erasing a person with one of every kind of data (G6)", () => {
  let subject: Awaited<ReturnType<typeof buildSubject>>;
  let before: Row[];
  let result: Awaited<ReturnType<typeof eraseSubject>>;

  beforeAll(async () => {
    subject = await buildSubject(store, "gone", { sentinel: "GIRAFFE-1g" });
    before = await ordersOf(subject.ids.orders);
  }, 120_000);

  it("previews exactly what the run does: restricted sales, orders anonymised now, subscriptions, cards and credits", async () => {
    const resolved = (await resolveSubject(store.storeId, { customerId: subject.customerId }, { channel: "staff" }))!;
    const plan = (await planErasure(resolved))!;
    const restricted = plan.plan.rows.find((r) => r.table === "orders" && r.action === "restricted")!;
    const anonymised = plan.plan.rows.find((r) => r.table === "orders" && r.action === "anonymised")!;
    // Six sales are kept (signed in, guest, another email, euro, the host's, the renewal); the unpaid one and the copied one go at once.
    expect(restricted.count).toBe(6);
    expect(anonymised.count).toBe(2);
    expect(restricted.keptUntil!.first).toMatch(/^20(31|32)-01-01$/);
    expect(plan.plan.alsoHappens).toMatchObject({ subscriptionsCancelled: 1, emailOptOutKept: true });
    expect(plan.plan.alsoHappens.savedCardsDetached).toBe(1);
    expect(plan.plan.alsoHappens.bonusForfeited).toEqual([{ currency: "NOK", amountMinor: 4000 }]);
    // Restricted totals are per currency, never summed across them (the euro-view order is charged in euro).
    const currencies = plan.plan.alsoHappens.restrictedTotals.map((t) => t.currency).sort();
    expect(currencies).toEqual([...new Set(currencies)]);
    expect(currencies.length).toBe(2);
    // Counts and dates only: the summary that goes in the request holds no value.
    expect(JSON.stringify(plan.summary)).not.toContain(subject.email);
  });

  it("deletes the account and what no law needs, restricts the sales and anonymises the rest, and cancels the subscription first", async () => {
    stripe.state.cancelled.length = 0;
    stripe.state.detached.length = 0;
    result = await eraseSubject(store.storeId, { customerId: subject.customerId }, { channel: "staff", accountId: store.ownerId });
    expect(result).toMatchObject({ ok: true, outcome: "erased" });
    // The outside world: the subscription ended (no refund), the saved card detached on the store's own account.
    expect(stripe.state.cancelled).toHaveLength(1);
    expect(stripe.state.detached).toEqual([{ id: "pm_1g", account: store.account }]);

    const s = store.storeId;
    const c = subject.customerId;
    expect(await count(sql`select 1 from commerce.customers where id = ${c}::uuid`)).toBe(0);
    for (const table of ["customer_sessions", "wishlists", "standing_orders", "bonus_entries", "affiliates", "customer_sign_in_links", "checkout_accounts"]) {
      expect(await count(sql`select 1 from ${sql.raw(`commerce.${table}`)} where store_id = ${s}::uuid and customer_id = ${c}::uuid`), table).toBe(0);
    }
    expect(await count(sql`select 1 from commerce.customer_codes where store_id = ${s}::uuid and lower(email) = ${subject.email}`)).toBe(0);
    expect(await count(sql`select 1 from commerce.form_submissions where store_id = ${s}::uuid and lower(email) = ${subject.email}`)).toBe(0);
    expect(await count(sql`select 1 from commerce.company_invites where store_id = ${s}::uuid and lower(email) = ${subject.email}`)).toBe(0);
    expect(await count(sql`select 1 from commerce.field_values where store_id = ${s}::uuid and entity = 'customer' and entity_id = ${c}::uuid`)).toBe(0);
    expect(await count(sql`select 1 from commerce.standing_deliveries where store_id = ${s}::uuid and standing_order_id = ${subject.ids.standingOrder}::uuid`)).toBe(0);
    // Carts keep the row and lose the person and the company; the wishlist's cart additions lose the person and the list's name.
    const [cart] = await db().execute<Row>(sql`select customer_id, company_name, organisation_number, vat_number from commerce.carts where id = ${subject.ids.cart}::uuid`);
    expect(cart).toMatchObject({ customer_id: null, company_name: null, organisation_number: null, vat_number: null });
    const [add] = await db().execute<Row>(sql`select customer_id, wishlist_name from commerce.wishlist_cart_adds where cart_id = ${subject.ids.cart}::uuid`);
    expect(add).toMatchObject({ customer_id: null, wishlist_name: "" });
    const [reminder] = await db().execute<Row>(sql`select email, lines, opted_out_at from commerce.abandoned_checkouts where cart_id = ${subject.ids.cart}::uuid`);
    expect(reminder).toMatchObject({ email: null, lines: [] });
  });

  it("restricts a sale (cut loose, still there for the books) and anonymises an unpaid or copied order at once, deleting none and changing no amount", async () => {
    const after = await ordersOf(subject.ids.orders);
    expect(after).toHaveLength(subject.ids.orders.length);
    // No amount changes; the one order still waiting for payment is cancelled (not a sale, its checkout closed), every other status is as it was.
    const cancelledNow = (r: Row) => (r.number === before.find((b) => b.id === subject.ids.unpaidOrder.orderId)?.number ? { ...money(r), status: "pending_payment" } : money(r));
    expect(after.map(cancelledNow)).toEqual(before.map(money));
    expect(after.find((o) => o.id === subject.ids.unpaidOrder.orderId)?.status).toBe("cancelled");
    const byId = new Map(after.map((o) => [String(o.id), o]));
    const sales = [subject.ids.signedInOrder.orderId, subject.ids.guestOrder.orderId, subject.ids.otherEmailOrder.orderId, subject.ids.euroOrder.orderId, subject.ids.hostOrder, subject.ids.renewalOrder];
    for (const id of sales) {
      const o = byId.get(id)!;
      expect(o.restricted_at, id).not.toBeNull();
      expect(o.anonymised_at, id).toBeNull();
      expect(o.customer_id).toBeNull();
      // Kept for the bookkeeping duty: the personal fields are still there until the period ends.
      expect(String(o.email)).not.toBe("[removed]");
      expect(o.billing_address).not.toEqual({});
    }
    for (const id of [subject.ids.unpaidOrder.orderId, subject.ids.copiedOrder]) {
      const o = byId.get(id)!;
      expect(o.anonymised_at, id).not.toBeNull();
      expect(o).toMatchObject({ email: "[removed]", billing_address: {}, shipping_address: {}, customer_id: null, company_name: null });
    }
    const restrictedEvents = await db().execute<Row>(sql`select order_id, data from commerce.order_events where type = 'order.restricted' and order_id = any(${`{${sales.join(",")}}`}::uuid[])`);
    expect(restrictedEvents).toHaveLength(sales.length);
    expect(JSON.stringify(restrictedEvents.map((e) => e.data))).not.toContain(subject.email);
    // The unpaid order's history says so; a copied order has no events of its own.
    expect(await count(sql`select 1 from commerce.order_events where order_id = ${subject.ids.unpaidOrder.orderId}::uuid and type = 'order.anonymised'`)).toBe(1);
    expect(await count(sql`select 1 from commerce.order_events where order_id = ${subject.ids.copiedOrder}::uuid`)).toBe(0);
    // A host's order is kept under its own, longer period: the plan said so and the database agrees (ten years from the end of the sale's year).
    const [host] = await db().execute<Row>(sql`select commerce.order_anonymisable_on(${subject.ids.hostOrder}::uuid)::text as d, commerce.order_anonymisable_on(${subject.ids.guestOrder.orderId}::uuid)::text as g`);
    expect(String(host.d).slice(0, 4)).toBe(String(Number(String(host.g).slice(0, 4)) + 5));
  });

  it("leaves the invoice and credit note exactly as issued, and the sale's lines, payments and numbers", async () => {
    const [invoice] = await db().execute<Row>(sql`select anonymised_at, snapshot from commerce.invoices where id = ${subject.ids.invoice}::uuid`);
    expect(invoice.anonymised_at).toBeNull();
    expect(JSON.stringify(invoice.snapshot)).toContain(subject.email);
    expect(await count(sql`select 1 from commerce.credit_notes where id = ${subject.ids.creditNote}::uuid and anonymised_at is null`)).toBe(1);
    expect(await count(sql`select 1 from commerce.order_lines where order_id = ${subject.ids.signedInOrder.orderId}::uuid`)).toBeGreaterThan(0);
    expect(await count(sql`select 1 from commerce.payments where order_id = ${subject.ids.signedInOrder.orderId}::uuid and status = 'captured'`)).toBe(1);
  });

  it("anonymises the subscription (its renewal order is restricted as an order), revokes the download link and keeps the order's fields until it is anonymised", async () => {
    const [sub] = await db().execute<Row>(sql`select email, shipping_address, manage_token, customer_id, status from commerce.subscriptions where id = ${subject.ids.subscription}::uuid`);
    expect(sub).toMatchObject({ email: "[removed]", shipping_address: {}, customer_id: null, status: "cancelled" });
    expect(String(sub.manage_token)).not.toContain("SECRET");
    expect(await count(sql`select 1 from commerce.order_downloads where order_id = ${subject.ids.signedInOrder.orderId}::uuid and expires_at > now()`)).toBe(0);
    expect(await count(sql`select 1 from commerce.field_values where entity = 'order' and entity_id = ${subject.ids.signedInOrder.orderId}::uuid`)).toBe(1);
  });

  it("blanks the emails (the rows stay for their keys), keeps the withdrawal acknowledgement with its order, and keeps the opt-out", async () => {
    const mail = await db().execute<Row>(sql`select kind, to_address, subject, html, text, idempotency_key from commerce.email_messages where store_id = ${store.storeId}::uuid and order_id = any(${`{${subject.ids.orders.join(",")}}`}::uuid[]) and kind in ('order.confirmation', 'return.acknowledgement')`);
    const confirmation = mail.find((m) => m.kind === "order.confirmation")!;
    expect(confirmation).toMatchObject({ to_address: "[removed]", subject: "[removed]", html: "", text: "" });
    expect(String(confirmation.idempotency_key)).toContain(subject.ids.signedInOrder.orderId);
    const evidence = mail.find((m) => m.kind === "return.acknowledgement")!;
    expect(String(evidence.to_address)).toBe(subject.email);
    expect(await count(sql`select 1 from commerce.email_messages where store_id = ${store.storeId}::uuid and kind = 'account.code' and to_address <> '[removed]' and idempotency_key = ${`code-${subject.customerId}`}`)).toBe(0);
    expect(await count(sql`select 1 from commerce.email_opt_outs where store_id = ${store.storeId}::uuid and lower(email) = ${subject.email}`)).toBe(1);
  });

  it("sends the confirmation once, with no address in the log, completes the request with no email, and writes the log without a name", async () => {
    const [request] = await db().execute<Row>(sql`select id, status, outcome, subject_email, plan_summary, steps, completed_at from commerce.privacy_requests where id = ${(result as { requestId: string }).requestId}::uuid`);
    expect(request).toMatchObject({ status: "done", outcome: "erased", subject_email: null });
    expect(JSON.stringify(request.plan_summary)).not.toContain(subject.email);
    expect(request.steps).toMatchObject({ external: "done", database: "done", files: expect.any(String), email: "sent" });
    const confirmations = await db().execute<Row>(sql`select to_address, subject, html, text, status from commerce.email_messages where store_id = ${store.storeId}::uuid and kind = 'privacy.erased'`);
    expect(confirmations).toHaveLength(1);
    expect(confirmations[0]).toMatchObject({ to_address: "[removed]", subject: expect.not.stringContaining("Kari") });
    expect(String(confirmations[0].html) + String(confirmations[0].text)).not.toContain(subject.email);
    const entries = await auditRows(store.storeId, "customer.erased");
    const entry = entries.find((e) => (e.details as { request?: string }).request === (result as { requestId: string }).requestId)!;
    expect(entry).toMatchObject({ area: "customers", account_id: store.ownerId });
    expect(JSON.stringify(entry.details)).not.toContain(subject.email);
    expect(JSON.stringify(entry.details)).not.toContain("Kari");
    expect((entry.details as { counts: { ordersRestricted: number; ordersAnonymised: number } }).counts).toMatchObject({ ordersRestricted: 6, ordersAnonymised: 2 });
    const notices = await db().execute<Row>(sql`select to_address, subject, text from commerce.email_messages where store_id = ${store.storeId}::uuid and kind = 'privacy.owners_notice' and subject like '%erased%'`);
    expect(notices.length).toBeGreaterThan(0);
    expect(JSON.stringify(notices)).not.toContain(subject.email);
  });

  it("uses a restricted order for nothing: not relinked when the same email signs up again, not a purchase, not in the customer list, not found by its id, never emailed", async () => {
    // Before anyone signs up the address has no history: the restricted orders are not a purchase.
    expect(await customers.emailHistory(store.storeId, subject.email)).toBeNull();
    const code = await customers.createSignInCode(store.storeId, subject.email);
    const comeBack = (await customers.verifySignInCode(store.storeId, subject.email, code!))!;
    expect(comeBack).not.toBe(subject.customerId);
    expect(await customers.listCustomerOrders(store.storeId, comeBack)).toEqual([]);
    const restricted = (await db().execute<Row>(sql`select customer_id from commerce.orders where id = ${subject.ids.guestOrder.orderId}::uuid`))[0];
    expect(restricted.customer_id).toBeNull();
    // Not in the customers list or detail, and a restricted order's id is nobody's.
    expect((await admin.listCustomers(store.storeId, { q: subject.email })).filter((c) => c.orders > 0)).toEqual([]);
    expect(await admin.findCustomer(store.storeId, subject.ids.guestOrder.orderId)).toBeNull();
    // An email about it is suppressed: nothing sent, a row with nothing in it, so a retried webhook asks no more.
    const outcome = await sendEmail({ storeId: store.storeId, kind: "order.shipped", to: subject.email, orderId: subject.ids.guestOrder.orderId, email: { subject: "Shipped to Kari", html: "<p>Kari</p>", text: "Kari" }, fromName: "Shop", idempotencyKey: `shipped-${subject.ids.guestOrder.orderId}` });
    expect(outcome).toBe("suppressed");
    const [row] = await db().execute<Row>(sql`select to_address, subject, html, status, error from commerce.email_messages where idempotency_key = ${`shipped-${subject.ids.guestOrder.orderId}`}`);
    expect(row).toMatchObject({ to_address: "[removed]", subject: "[removed]", html: "", status: "failed" });
    // The withdrawal acknowledgement is the person's own right and is never held back.
    expect(await sendEmail({ storeId: store.storeId, kind: "return.acknowledgement", to: subject.email, orderId: subject.ids.guestOrder.orderId, email: { subject: "Received", html: "<p>x</p>", text: "x" }, fromName: "Shop", idempotencyKey: `ack2-${subject.ids.guestOrder.orderId}` })).not.toBe("suppressed");
  });

  it("counts a restricted order in revenue as its own anonymous customer, never joined to the person's other orders (analytics key)", async () => {
    const rows = await db().execute<Row>(sql`
      select o.id, ${CUSTOMER_KEY} as k, ${PAID} as paid, o.total_minor
      from commerce.orders o ${CUSTOMER_JOIN}
      where o.store_id = ${store.storeId}::uuid and o.id = any(${`{${subject.ids.orders.join(",")}}`}::uuid[]) and ${HAS_CUSTOMER}`);
    const keyOf = new Map(rows.map((r) => [String(r.id), String(r.k)]));
    const sales = [subject.ids.signedInOrder.orderId, subject.ids.guestOrder.orderId, subject.ids.otherEmailOrder.orderId, subject.ids.euroOrder.orderId, subject.ids.renewalOrder];
    // Each restricted sale is a customer of its own (revenue and VAT are unchanged: the key is only who it counts as), and the key holds no email.
    expect(new Set(sales.map((id) => keyOf.get(id))).size).toBe(sales.length);
    for (const id of sales) expect(keyOf.get(id)).toBe(`order:${id}`);
    expect([...keyOf.values()].some((k) => k.includes("@"))).toBe(false);
    // An ordinary customer keeps the email as the key.
    const ordinary = await fx.paidOrder(store, [["DEMO-MUG-WHITE", 1]], { email: `plain-${fx.unique("p")}@example.com` });
    const [plain] = await db().execute<Row>(sql`select ${CUSTOMER_KEY} as k from commerce.orders o ${CUSTOMER_JOIN} where o.id = ${ordinary.orderId}::uuid`);
    expect(plain.k).toBe(ordinary.email);
  });

  it("anonymises the sales when the seller's country's period ends: the order, its documents, its withdrawal, its return notes and its VAT check, with every amount unchanged and nothing deleted", async () => {
    // The clock is a fixed day and the data is made old: the schedule judges by the database's own clock, which never runs ahead.
    const old = [subject.ids.guestOrder.orderId, subject.ids.signedInOrder.orderId];
    for (const id of old) await ageOrder(id, "2015-06-01");
    const young = await ordersOf([subject.ids.euroOrder.orderId]);
    const first = await runRetention(new Date());
    expect(first.errors).toEqual([]);
    expect(first.counts.orders).toBeGreaterThanOrEqual(2);
    const after = await ordersOf(old);
    for (const o of after) {
      expect(o.anonymised_at).not.toBeNull();
      expect(o).toMatchObject({ email: "[removed]", billing_address: {}, shipping_address: {}, company_name: null, customer_id: null });
    }
    expect(after.map(money)).toEqual(before.filter((b) => old.includes(String(b.id))).map(money));
    // Documents first: the invoice and credit note of the old order are anonymised too, numbers and amounts unchanged.
    const [invoice] = await db().execute<Row>(sql`select anonymised_at, document_number, total_minor, snapshot from commerce.invoices where id = ${subject.ids.invoice}::uuid`);
    expect(invoice.anonymised_at).not.toBeNull();
    expect(JSON.stringify(invoice.snapshot)).not.toContain(subject.email);
    // Its withdrawal request, return notes and the evidence email follow.
    const [withdrawal] = await db().execute<Row>(sql`select name, email from commerce.withdrawal_requests where id = ${subject.ids.withdrawal}::uuid`);
    expect(withdrawal).toEqual({ name: "[removed]", email: "[removed]" });
    const [ret] = await db().execute<Row>(sql`select reason_note, staff_note from commerce.returns where id = ${subject.ids.return}::uuid`);
    expect(ret).toEqual({ reason_note: "[removed]", staff_note: "[removed]" });
    const [ack] = await db().execute<Row>(sql`select to_address, html from commerce.email_messages where idempotency_key = ${`ack-${subject.ids.guestOrder.orderId}`}`);
    expect(ack).toMatchObject({ to_address: "[removed]", html: "" });
    // The staff-entered order fields go with the order.
    expect(await count(sql`select 1 from commerce.field_values where entity = 'order' and entity_id = ${subject.ids.signedInOrder.orderId}::uuid`)).toBe(0);
    // A younger sale keeps its restriction (its period has not ended); a second run changes nothing.
    const youngAfter = await ordersOf([subject.ids.euroOrder.orderId]);
    expect(youngAfter[0].restricted_at).not.toBeNull();
    expect(youngAfter[0].anonymised_at).toBeNull();
    expect(youngAfter.map(money)).toEqual(young.map(money));
    const second = await runRetention(new Date());
    expect(second.counts.orders).toBe(0);
    expect(second.counts.documents).toBe(0);
    expect(await count(sql`select 1 from commerce.orders where id = any(${`{${subject.ids.orders.join(",")}}`}::uuid[])`)).toBe(subject.ids.orders.length);
  });
});

describe("a failure at Stripe changes nothing, and the run is finished by a retry (G10)", () => {
  it("stops before the database changes, leaves the request open with where it stopped, and the retry completes the same request", async () => {
    const subject = await buildSubject(store, "stripe-down");
    stripe.state.failCancel = true;
    const failed = await eraseSubject(store.storeId, { customerId: subject.customerId }, { channel: "staff", accountId: store.ownerId });
    stripe.state.failCancel = false;
    expect(failed).toMatchObject({ ok: false, problem: "stripe", message: STRIPE_DID_NOT_ANSWER });
    // Nothing was changed: the account, the orders (not restricted) and the subscription are as they were.
    expect(await count(sql`select 1 from commerce.customers where id = ${subject.customerId}::uuid`)).toBe(1);
    expect(await count(sql`select 1 from commerce.orders where id = any(${`{${subject.ids.orders.join(",")}}`}::uuid[]) and (restricted_at is not null or anonymised_at is not null)`)).toBe(0);
    const [open] = await db().execute<Row>(sql`select id, status, steps from commerce.privacy_requests where store_id = ${store.storeId}::uuid and subject_customer_id = ${subject.customerId}::uuid`);
    expect(open).toMatchObject({ status: "open", steps: { external: "failed" } });
    const retried = await eraseSubject(store.storeId, { customerId: subject.customerId }, { channel: "staff", accountId: store.ownerId });
    expect(retried).toMatchObject({ ok: true, outcome: "erased", requestId: String(open.id) });
    expect(await count(sql`select 1 from commerce.customers where id = ${subject.customerId}::uuid`)).toBe(0);
    // A card that is already gone at Stripe is not an error.
    const other = await buildSubject(store, "card-gone");
    stripe.state.goneDetach = true;
    const gone = await eraseSubject(store.storeId, { customerId: other.customerId }, { channel: "staff", accountId: store.ownerId });
    stripe.state.goneDetach = false;
    expect(gone).toMatchObject({ ok: true, outcome: "erased" });
    // A card that cannot be detached stops the run too.
    const third = await buildSubject(store, "card-stuck");
    stripe.state.failDetach = true;
    const stuck = await eraseSubject(store.storeId, { customerId: third.customerId }, { channel: "staff", accountId: store.ownerId });
    stripe.state.failDetach = false;
    expect(stuck).toMatchObject({ ok: false, problem: "stripe" });
    expect(await count(sql`select 1 from commerce.customers where id = ${third.customerId}::uuid`)).toBe(1);
  }, 120_000);

  it("resumes an erasure that began and did not finish, and never one nobody started", async () => {
    const begun = await buildSubject(store, "resume");
    const idle = await buildSubject(store, "idle");
    const [begunRequest] = await db().execute<Row>(sql`
      insert into commerce.privacy_requests (store_id, kind, channel, subject_email, subject_customer_id, handled_by, steps)
      values (${store.storeId}::uuid, 'erasure', 'staff', ${begun.email}, ${begun.customerId}::uuid, ${store.ownerId}::uuid, '{"startedAt":"2026-10-01T00:00:00Z","external":"done"}'::jsonb) returning id`);
    const [idleRequest] = await db().execute<Row>(sql`
      insert into commerce.privacy_requests (store_id, kind, channel, subject_email, subject_customer_id, handled_by) values (${store.storeId}::uuid, 'erasure', 'staff', ${idle.email}, ${idle.customerId}::uuid, ${store.ownerId}::uuid) returning id`);
    const run = await resumeErasures();
    expect(run.resumed).toBeGreaterThanOrEqual(1);
    const [done] = await db().execute<Row>(sql`select status, outcome, subject_email from commerce.privacy_requests where id = ${String(begunRequest.id)}::uuid`);
    expect(done).toMatchObject({ status: "done", outcome: "erased", subject_email: null });
    expect(await count(sql`select 1 from commerce.customers where id = ${begun.customerId}::uuid`)).toBe(0);
    // Staff logged the other and nobody acted on it: the schedule does not erase a person nobody decided to erase.
    const [untouched] = await db().execute<Row>(sql`select status from commerce.privacy_requests where id = ${String(idleRequest.id)}::uuid`);
    expect(untouched.status).toBe("open");
    expect(await count(sql`select 1 from commerce.customers where id = ${idle.customerId}::uuid`)).toBe(1);
  }, 120_000);

  it("retries the picture that would not go, from the answered request", async () => {
    const subject = await buildSubject(store, "picture");
    const removed: string[][] = [];
    const failing = await eraseSubject(store.storeId, { customerId: subject.customerId }, { channel: "staff", accountId: store.ownerId }, { avatarRemover: async () => { throw new Error("storage is down"); } });
    expect(failing).toMatchObject({ ok: true });
    const [request] = await db().execute<Row>(sql`select steps from commerce.privacy_requests where id = ${(failing as { requestId: string }).requestId}::uuid`);
    expect(request.steps).toMatchObject({ files: "left", avatarPath: `${store.storeId}/avatar-1g.webp` });
    const run = await resumeErasures(new Date(), { avatarRemover: async (paths) => void removed.push(paths) });
    expect(run.filesRetried).toBeGreaterThanOrEqual(1);
    expect(removed.flat()).toContain(`${store.storeId}/avatar-1g.webp`);
  }, 120_000);

  it("finishes one request when two runs go at once, with one confirmation and one log entry", async () => {
    const subject = await buildSubject(store, "twice");
    const [a, b] = await Promise.all([
      eraseSubject(store.storeId, { customerId: subject.customerId }, { channel: "staff", accountId: store.ownerId }),
      eraseSubject(store.storeId, { customerId: subject.customerId }, { channel: "staff", accountId: store.ownerId }),
    ]);
    expect([a, b].filter((r) => r.ok).length).toBeGreaterThanOrEqual(1);
    expect([a, b].every((r) => r.ok || r.problem === "closed" || r.problem === "not_found")).toBe(true);
    expect(await count(sql`select 1 from commerce.customers where id = ${subject.customerId}::uuid`)).toBe(0);
    expect(await count(sql`select 1 from commerce.privacy_requests where store_id = ${store.storeId}::uuid and kind = 'erasure' and status = 'done' and steps ->> 'language' is not null and completed_at > now() - interval '1 minute' and plan_summary::text like '%restricted%' and id = ${(a.ok ? a : b as { requestId: string }).requestId}::uuid`)).toBe(1);
    const entries = (await auditRows(store.storeId, "customer.erased")).filter((e) => (e.details as { customer?: string }).customer === subject.customerId);
    expect(entries).toHaveLength(1);
  }, 120_000);
});

describe("erasing again, and erasing across stores", () => {
  it("answers a person with nothing left as no data held, and an erased account's id as nobody's", async () => {
    const subject = await buildSubject(store, "again");
    expect(await eraseSubject(store.storeId, { customerId: subject.customerId }, { channel: "staff", accountId: store.ownerId })).toMatchObject({ ok: true, outcome: "erased" });
    expect(await eraseSubject(store.storeId, { customerId: subject.customerId }, { channel: "staff", accountId: store.ownerId })).toMatchObject({ ok: false, problem: "not_found" });
    // The address still has an opt-out: a person with only that is still a subject, and erasing does nothing more.
    const again = await eraseSubject(store.storeId, { email: subject.email }, { channel: "staff", accountId: store.ownerId });
    expect(again.ok).toBe(true);
    const nobody = await eraseSubject(store.storeId, { email: `nobody-${fx.run}@example.com` }, { channel: "staff", accountId: store.ownerId });
    expect(nobody).toMatchObject({ ok: true, outcome: "no_data" });
    const [row] = await db().execute<Row>(sql`select status, outcome, subject_email from commerce.privacy_requests where id = ${(nobody as { requestId: string }).requestId}::uuid`);
    expect(row).toMatchObject({ status: "done", outcome: "no_data", subject_email: null });
  }, 120_000);

  it("never touches another store's customer, orders, subscriptions or emails, even for the same email", async () => {
    const mine = await buildSubject(store, "tenant", { sentinel: "MINE-1g" });
    const theirs = await buildSubject(foreign, "tenant", { email: mine.email, sentinel: "THEIRS-1g" });
    // The other store's account id is nobody's in this store.
    expect(await eraseSubject(store.storeId, { customerId: theirs.customerId }, { channel: "staff", accountId: store.ownerId })).toMatchObject({ ok: false, problem: "not_found" });
    expect(await count(sql`select 1 from commerce.customers where id = ${theirs.customerId}::uuid`)).toBe(1);
    // Erasing by the shared email in this store leaves the other store whole.
    expect(await eraseSubject(store.storeId, { email: mine.email }, { channel: "staff", accountId: store.ownerId })).toMatchObject({ ok: true, outcome: "erased" });
    expect(await count(sql`select 1 from commerce.orders where id = any(${`{${theirs.ids.orders.join(",")}}`}::uuid[]) and (restricted_at is not null or anonymised_at is not null)`)).toBe(0);
    expect(await count(sql`select 1 from commerce.email_messages where store_id = ${foreign.storeId}::uuid and to_address = ${mine.email} and html like '%THEIRS-1g%'`)).toBe(1);
    expect(await count(sql`select 1 from commerce.subscriptions where id = ${theirs.ids.subscription}::uuid and email = ${mine.email}`)).toBe(1);
    expect(await count(sql`select 1 from commerce.standing_orders where id = ${theirs.ids.standingOrder}::uuid`)).toBe(1);
  }, 120_000);
});

describe("an order still waiting for payment when its person is erased (review: the checkout is closed, never left to be paid)", () => {
  const waiting = async (label: string) => {
    const email = `${fx.unique(label)}@example.com`;
    const [c] = await db().execute<Row>(sql`insert into commerce.customers (store_id, email, name, email_verified_at) values (${store.storeId}::uuid, ${email}, 'Kari Waiting', now()) returning id`);
    const customerId = String(c.id);
    const placed = await fx.paidOrder(store, [["DEMO-MUG-WHITE", 1]], { email, customerId, pay: false });
    return { customerId, placed, email };
  };
  const orderOf = async (id: string) => (await db().execute<Row>(sql`select status, email, anonymised_at, restricted_at from commerce.orders where id = ${id}::uuid`))[0];

  it("expires the open session, cancels the order, gives its stock back and anonymises it", async () => {
    const { customerId, placed } = await waiting("open");
    const result = await eraseSubject(store.storeId, { customerId }, { channel: "shopper", accountId: null });
    expect(result).toMatchObject({ ok: true, counts: { ordersCancelled: 1 } });
    expect(stripe.state.expired).toContain(placed.sessionId);
    expect(await orderOf(placed.orderId)).toMatchObject({ status: "cancelled", email: "[removed]" });
    expect((await orderOf(placed.orderId)).anonymised_at).not.toBeNull();
    expect(await count(sql`select 1 from commerce.inventory_reservations where order_id = ${placed.orderId}::uuid and released_at is null`)).toBe(0);
    const [payment] = await db().execute<Row>(sql`select status from commerce.payments where provider_reference = ${placed.sessionId}`);
    expect(payment.status).toBe("cancelled");
  });

  it("completes an order whose session was paid meanwhile as the sale it is: restricted from the person, never anonymised before its day", async () => {
    const { customerId, placed } = await waiting("paid-meanwhile");
    stripe.state.sessions[placed.sessionId] = { status: "complete", payment_status: "paid" };
    const result = await eraseSubject(store.storeId, { customerId }, { channel: "shopper", accountId: null });
    expect(result).toMatchObject({ ok: true });
    const o = await orderOf(placed.orderId);
    expect(o.status).toBe("paid");
    expect(o.restricted_at).not.toBeNull();
    expect(o.anonymised_at).toBeNull();
  });

  it("stops before anything changes while a payment the shopper finished has not arrived, and goes through when it has", async () => {
    const { customerId, placed } = await waiting("processing");
    stripe.state.sessions[placed.sessionId] = { status: "complete", payment_status: "unpaid" };
    const refused = await eraseSubject(store.storeId, { customerId }, { channel: "shopper", accountId: null });
    expect(refused).toMatchObject({ ok: false, problem: "stripe" });
    expect(await count(sql`select 1 from commerce.customers where id = ${customerId}::uuid`)).toBe(1);
    expect((await orderOf(placed.orderId)).status).toBe("pending_payment");
    stripe.state.sessions[placed.sessionId] = { status: "expired", payment_status: "unpaid" };
    expect(await eraseSubject(store.storeId, { customerId }, { channel: "shopper", accountId: null })).toMatchObject({ ok: true });
    expect((await orderOf(placed.orderId)).status).toBe("cancelled");
  });
});

describe("the customer and order files an owner made (wave 2, D165, `storage:exports`)", () => {
  it("are deleted from storage when a person is erased, and their jobs marked purged; a product file and another store's files stay", async () => {
    const { fakeStorage } = await import("./data-test-support");
    const mine = await fx.makeStore("erase-exports");
    const other = await fx.makeStore("erase-exports-b");
    const subject = await buildSubject(mine, "exp");
    const storage = fakeStorage();
    const job = async (storeId: string, ownerId: string, kind: string, status: string, files: string[]) => {
      const list = files.map((path) => ({ path, name: "f.csv", rows: 1, bytes: 1, sha256: "a".repeat(64) }));
      for (const f of files) storage.files.set(`exports/${f}`, new TextEncoder().encode("a,b\r\n"));
      // A job lives its life: queued, then running, then done with its files (the database refuses any other start).
      const [row] = await db().execute<Row>(sql`insert into commerce.data_jobs (store_id, kind, status, phase, format, requested_by) values (${storeId}::uuid, ${kind}, 'queued', 'write', 'kaizen', ${ownerId}::uuid) returning id`);
      if (status !== "queued") await db().execute(sql`update commerce.data_jobs set status = 'running' where id = ${String(row.id)}::uuid`);
      if (status === "done") await db().execute(sql`update commerce.data_jobs set status = 'done', phase = 'assemble', files = ${JSON.stringify(list)}::jsonb, expires_at = now() + interval '7 days' where id = ${String(row.id)}::uuid`);
      return String(row.id);
    };
    const customers = await job(mine.storeId, mine.ownerId, "customer_export", "done", [`${mine.storeId}/c1/part-1.csv`]);
    const orders = await job(mine.storeId, mine.ownerId, "order_export", "done", [`${mine.storeId}/o1/part-1.csv`, `${mine.storeId}/o1/part-2.csv`]);
    const products = await job(mine.storeId, mine.ownerId, "product_export", "done", [`${mine.storeId}/p1/part-1.csv`]);
    const running = await job(mine.storeId, mine.ownerId, "order_export", "running", []);
    // Only asked for: it has read nothing, and when it runs its readers skip a person who was erased, so it is left to run.
    const queued = await job(mine.storeId, mine.ownerId, "customer_export", "queued", []);
    const elsewhere = await job(other.storeId, other.ownerId, "customer_export", "done", [`${other.storeId}/c9/part-1.csv`]);
    const result = await eraseSubject(mine.storeId, { customerId: subject.customerId }, { channel: "staff", accountId: mine.ownerId }, { avatarRemover: async () => {}, dataStorage: storage });
    expect(result).toMatchObject({ ok: true });
    const state = async (id: string) => (await db().execute<Row>(sql`select status, files, purged_at from commerce.data_jobs where id = ${id}::uuid`))[0];
    // The ready customer and order files are gone from storage and the jobs say so.
    for (const id of [customers, orders]) {
      const row = await state(id);
      expect(row).toMatchObject({ status: "expired", files: [] });
      expect(row.purged_at).not.toBeNull();
    }
    expect([...storage.files.keys()].filter((k) => k.includes(`${mine.storeId}/c1/`) || k.includes(`${mine.storeId}/o1/`))).toEqual([]);
    // One still being made is stopped: a batch with the person may be in the air.
    expect((await state(running)).status).toBe("cancelled");
    expect((await state(queued)).status).toBe("queued");
    // A product file has no person's data; another store's files are its own.
    expect((await state(products)).status).toBe("done");
    expect(storage.files.has(`exports/${mine.storeId}/p1/part-1.csv`)).toBe(true);
    expect((await state(elsewhere)).status).toBe("done");
    expect(storage.files.has(`exports/${other.storeId}/c9/part-1.csv`)).toBe(true);
  });

  it("are taken only when they can hold the person: made before they had an order or an account, or an order file for someone with no order, they stay", async () => {
    const { fakeStorage } = await import("./data-test-support");
    const mine = await fx.makeStore("erase-exports-scope");
    const subject = await buildSubject(mine, "scp");
    const storage = fakeStorage();
    const done = async (kind: string, folder: string, finishedAgo: string) => {
      const path = `${mine.storeId}/${folder}/part-1.csv`;
      storage.files.set(`exports/${path}`, new TextEncoder().encode("a\r\n"));
      const list = [{ path, name: "f.csv", rows: 1, bytes: 1, sha256: "a".repeat(64) }];
      const [row] = await db().execute<Row>(sql`insert into commerce.data_jobs (store_id, kind, status, phase, format, requested_by) values (${mine.storeId}::uuid, ${kind}, 'queued', 'write', 'kaizen', ${mine.ownerId}::uuid) returning id`);
      await db().execute(sql`update commerce.data_jobs set status = 'running' where id = ${String(row.id)}::uuid`);
      await db().execute(sql`update commerce.data_jobs set status = 'done', phase = 'assemble', files = ${JSON.stringify(list)}::jsonb, expires_at = now() + interval '7 days', finished_at = now() - ${finishedAgo}::interval where id = ${String(row.id)}::uuid`);
      return String(row.id);
    };
    // The fixture's person and orders were made just now: a file finished a year ago cannot hold them.
    const old = await done("order_export", "o-old", "1 year");
    const oldCustomers = await done("customer_export", "c-old", "1 year");
    const recent = await done("order_export", "o-new", "0 seconds");
    // A stranger who only opened an account has no order: no order file can hold them, and their account is in no file made before it.
    const [stranger] = await db().execute<Row>(sql`insert into commerce.customers (store_id, email) values (${mine.storeId}::uuid, 'only-an-account@example.test') returning id`);
    expect(await eraseSubject(mine.storeId, { customerId: String(stranger.id) }, { channel: "shopper", accountId: null }, { avatarRemover: async () => {}, dataStorage: storage })).toMatchObject({ ok: true });
    const state = async (id: string) => (await db().execute<Row>(sql`select status from commerce.data_jobs where id = ${id}::uuid`))[0].status;
    expect(await state(old)).toBe("done");
    expect(await state(oldCustomers)).toBe("done");
    expect(await state(recent)).toBe("done");
    // The person with orders: the recent order file can hold them, the one from a year ago cannot.
    expect(await eraseSubject(mine.storeId, { customerId: subject.customerId }, { channel: "staff", accountId: mine.ownerId }, { avatarRemover: async () => {}, dataStorage: storage })).toMatchObject({ ok: true });
    expect(await state(recent)).toBe("expired");
    expect(await state(old)).toBe("done");
    expect(await state(oldCustomers)).toBe("done");
    expect(storage.files.has(`exports/${mine.storeId}/o-old/part-1.csv`)).toBe(true);
    expect(storage.files.has(`exports/${mine.storeId}/o-new/part-1.csv`)).toBe(false);
  });
});
