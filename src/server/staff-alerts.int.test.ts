import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { formatMoney } from "@/lib/money";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }), headers: async () => new Headers() }));
vi.mock("./stripe", () => ({ platformStripe: () => ({}), platformPublishableKey: () => "pk_test_x", platformModes: () => ["test"], WEBHOOK_EVENTS: [] }));

const alerts = await import("./staff-alerts");
const { saveRule } = await import("./order-rules");
const { sendRefundOverdueReminder } = await import("./return-emails");
const { completeOrderPayment, placeOrder } = await import("./checkout");
const { fxStore, paidOrder, NO, NO_EUR } = await import("./fulfilment-test-fixture");

type Row = Record<string, unknown>;
type Fx = Awaited<ReturnType<typeof fxStore>>;

/**
 * Staff alerts (wave 3, D238, `docs/wave-3-notifications.md` 2.4, 2.8, 4.7, 4.8 and 6.3), against a real database: each paid order's store event (queued by
 * the trigger in the paying transaction) emails the owners by default once, with its number, total and link; a retried payment or a second run sends nothing
 * more; recipients are only members whose role may read the email, checked at sending; a return asked for emails the return's recipients; the summary goes
 * at the store's hour once per period; and no staff email names the buyer, their address, phone, company or gift message.
 */

let store: Fx;
let ownerEmail: string;

const staffMails = async (storeId: string, kind: string) =>
  db().execute<Row>(sql`select to_address, subject, html, text, idempotency_key from commerce.email_messages where store_id = ${storeId}::uuid and kind = ${kind} order by created_at, id`);
/** Works through the due store events of the stores this file made (the queue is shared with every other test file). */
const mine = new Set<string>();
const newStore = async (label: string) => {
  const fx = await fxStore(label);
  mine.add(fx.storeId);
  return fx;
};
const drain = async () => {
  for (let i = 0; i < 20; i++) {
    const run = await alerts.processStoreEvents({ limit: 200, storeIds: [...mine] });
    if (run.claimed < 200) return;
  }
};
const member = async (fx: Fx, label: string, permissions: string[] | null, extra: { kind?: string; expiresAt?: string } = {}) => {
  const email = `${label}-${fx.slug}@example.com`;
  const [account] = await db().execute<Row>(sql`insert into commerce.accounts (email, name) values (${email}, ${label}) returning id`);
  let roleId: string | null = null;
  if (permissions) {
    const [role] = await db().execute<Row>(sql`
      insert into commerce.store_roles (store_id, name, permissions) values (${fx.storeId}::uuid, ${`${label} ${Date.now()}`}, ${`{${permissions.join(",")}}`}::text[]) returning id
    `);
    roleId = String(role.id);
  }
  await db().execute(sql`
    insert into commerce.store_members (store_id, account_id, role, role_id, kind, expires_at)
    values (${fx.storeId}::uuid, ${String(account.id)}::uuid, 'admin', ${roleId}::uuid, ${extra.kind ?? "staff"}, ${extra.expiresAt ?? null}::timestamptz)
  `);
  return { id: String(account.id), email, roleId };
};

beforeAll(async () => {
  store = await newStore("alerts");
  const [o] = await db().execute<Row>(sql`select email from commerce.accounts where id = ${store.accountId}::uuid`);
  ownerEmail = String(o.email);
});
afterAll(async () => {
  await closeDb();
});

describe("new orders (6.3 C1)", () => {
  it("emails the owners once per paid order, with its number, total and a link; a retried payment and a second run send nothing more", async () => {
    const order = await paidOrder(store, [["DEMO-TOTE", 2]]);
    const [event] = await db().execute<Row>(sql`select * from commerce.store_events where store_id = ${store.storeId}::uuid and subject_id = ${order.orderId}::uuid`);
    expect(event).toMatchObject({ event: "order.paid" });
    await drain();
    let mails = (await staffMails(store.storeId, "staff.new_order")).filter((m) => String(m.idempotency_key).includes(order.orderId));
    expect(mails).toHaveLength(1);
    expect(mails[0].to_address).toBe(ownerEmail);
    expect(mails[0].idempotency_key).toBe(`staff-order:${order.orderId}:${store.accountId}`);
    expect(String(mails[0].subject)).toBe(`New order ${order.number}: ${formatMoney(order.totalMinor, "NOK", "nb-NO")}`);
    expect(String(mails[0].text)).toContain(`/admin/${store.slug}/orders/${order.orderId}`);
    // A retried webhook: the payment completed again, and the queue and the emails run again.
    await completeOrderPayment(order.orderId, `cs_${order.orderId}`).catch(() => null);
    await db().execute(sql`select commerce.queue_store_event(${store.storeId}::uuid, 'order.paid', ${order.orderId}::uuid)`);
    await drain();
    expect(await db().execute(sql`select 1 from commerce.store_events where store_id = ${store.storeId}::uuid and subject_id = ${order.orderId}::uuid`)).toHaveLength(1);
    mails = (await staffMails(store.storeId, "staff.new_order")).filter((m) => String(m.idempotency_key).includes(order.orderId));
    expect(mails).toHaveLength(1);
    const [done] = await db().execute<Row>(sql`select alerts_done_at, rules_done_at from commerce.store_events where store_id = ${store.storeId}::uuid and subject_id = ${order.orderId}::uuid`);
    expect(done.alerts_done_at).not.toBeNull();
    expect(done.rules_done_at).not.toBeNull();
  });

  it("says the total in the order's own currency for a euro order", async () => {
    const order = await paidOrder(store, [["DEMO-TOTE", 1]], { market: NO_EUR });
    await drain();
    const [mail] = (await staffMails(store.storeId, "staff.new_order")).filter((m) => String(m.idempotency_key).includes(order.orderId));
    expect(String(mail.subject)).toBe(`New order ${order.number}: ${formatMoney(order.totalMinor, "EUR", "nb-NO")}`);
  });

  it("says what was charged now and what is due at the venue for an appointment paid at the venue or by a deposit, in euro too", async () => {
    // A venue or deposit appointment's order keeps its full total with the part left for the venue in balance_minor (D66), set when it is placed.
    const placeWithBalance = async (market: typeof NO, balanceOf: (total: number) => number) => {
      const [cart] = await db().execute<Row>(sql`
        insert into commerce.carts (store_id, market_code, currency, locale, expires_at)
        values (${store.storeId}::uuid, ${market.code}, ${market.currency}, ${market.locale}, now() + interval '1 day') returning id
      `);
      await db().execute(sql`
        insert into commerce.cart_lines (store_id, cart_id, variant_id, quantity)
        select ${store.storeId}::uuid, ${String(cart.id)}::uuid, id, 1 from commerce.product_variants where store_id = ${store.storeId}::uuid and sku = 'DEMO-TOTE'
      `);
      const placed = await placeOrder({ storeId: store.storeId, market }, String(cart.id), {}, { customerId: null });
      if (!placed.ok) throw new Error(placed.problem);
      const id = placed.order.orderId;
      const [o] = await db().execute<Row>(sql`select total_minor, number from commerce.orders where id = ${id}::uuid`);
      const total = Number(o.total_minor);
      await db().execute(sql`update commerce.orders set balance_minor = ${balanceOf(total)} where store_id = ${store.storeId}::uuid and id = ${id}::uuid`);
      expect(await completeOrderPayment(id, `cs_${id}`)).toBe(true);
      return { id, total, number: String(o.number), currency: market.currency };
    };
    const venue = await placeWithBalance(NO_EUR, (total) => total);
    const deposit = await placeWithBalance(NO, (total) => Math.floor(total / 2));
    await drain();
    const mailOf = async (id: string) => (await staffMails(store.storeId, "staff.new_order")).find((m) => String(m.idempotency_key).includes(id))!;
    const money = (minor: number, currency: string) => formatMoney(minor, currency, "nb-NO");
    const venueText = String((await mailOf(venue.id)).text);
    expect(venueText).not.toContain("Total charged");
    expect(venueText).toContain(`Order total`);
    expect(venueText).toContain(`${money(0, "EUR")} charged now, ${money(venue.total, "EUR")} due at the venue`);
    const depositText = String((await mailOf(deposit.id)).text);
    expect(depositText).toContain(`${money(deposit.total - Math.floor(deposit.total / 2), "NOK")} charged now, ${money(Math.floor(deposit.total / 2), "NOK")} due at the venue`);
    expect(depositText).not.toContain("Total charged");
  });

  it("a store that is not open has its events marked done and sends nothing", async () => {
    const shut = await newStore("alerts-shut");
    const order = await paidOrder(shut, [["DEMO-TOTE", 1]]);
    await db().execute(sql`update commerce.stores set status = 'suspended' where id = ${shut.storeId}::uuid`);
    await drain();
    expect(await staffMails(shut.storeId, "staff.new_order")).toHaveLength(0);
    const [event] = await db().execute<Row>(sql`select alerts_done_at from commerce.store_events where store_id = ${shut.storeId}::uuid and subject_id = ${order.orderId}::uuid`);
    expect(event.alerts_done_at).not.toBeNull();
  });
});

describe("recipients (6.3 C2)", () => {
  it("only an owner saves the page; a member whose role cannot read orders cannot be chosen; the choices then hold", async () => {
    const fx = await newStore("alerts-pick");
    const reader = await member(fx, "reader", ["orders:read"]);
    const stocker = await member(fx, "stocker", ["products:read"]);
    const base = { contactEvents: [], summary: "off", summaryWeekday: 1, summaryHour: 8 };
    expect(await alerts.saveStaffAlerts(fx.storeId, { ...base, recipients: [] }, reader.id)).toMatchObject({ ok: false, problem: "not_owner" });
    expect(await alerts.saveStaffAlerts(fx.storeId, { ...base, recipients: [{ accountId: stocker.id, events: ["new_order"] }] }, fx.accountId)).toMatchObject({
      ok: false,
      problem: "not_allowed",
    });
    expect(
      await alerts.saveStaffAlerts(fx.storeId, { ...base, recipients: [{ accountId: reader.id, events: ["new_order"] }, { accountId: stocker.id, events: ["low_stock"] }] }, fx.accountId),
    ).toEqual({ ok: true });
    const order = await paidOrder(fx, [["DEMO-TOTE", 1]]);
    await drain();
    const mails = await staffMails(fx.storeId, "staff.new_order");
    // The owner chose others: the owner is no longer a default recipient.
    expect(mails.map((m) => m.to_address)).toEqual([reader.email]);
    expect(mails[0].idempotency_key).toBe(`staff-order:${order.orderId}:${reader.id}`);
    const view = await alerts.staffAlertsView(fx.storeId);
    expect(view.configured).toBe(true);
    expect(view.members.find((m) => m.accountId === stocker.id)?.may.new_order).toBe(false);
    const [entry] = await db().execute<Row>(sql`select details from commerce.audit_log where store_id = ${fx.storeId}::uuid and action = 'notification.staff_saved'`);
    expect(JSON.stringify(entry.details)).not.toContain("@");
  });

  it("checks the role at sending: a recipient whose role lost orders, or whose access ended, gets nothing", async () => {
    const fx = await newStore("alerts-lose");
    const reader = await member(fx, "reader", ["orders:read"]);
    const visitor = await member(fx, "collab", ["orders:read"], { kind: "collaborator", expiresAt: new Date(Date.now() + 3_600_000).toISOString() });
    const base = { contactEvents: [], summary: "off", summaryWeekday: 1, summaryHour: 8 };
    expect(
      await alerts.saveStaffAlerts(fx.storeId, { ...base, recipients: [{ accountId: reader.id, events: ["new_order"] }, { accountId: visitor.id, events: ["new_order"] }] }, fx.accountId),
    ).toEqual({ ok: true });
    await db().execute(sql`update commerce.store_roles set permissions = array['products:read'] where store_id = ${fx.storeId}::uuid and id = ${reader.roleId}::uuid`);
    await db().execute(sql`update commerce.store_members set expires_at = now() - interval '1 minute' where store_id = ${fx.storeId}::uuid and account_id = ${visitor.id}::uuid`);
    await paidOrder(fx, [["DEMO-TOTE", 1]]);
    await drain();
    expect(await staffMails(fx.storeId, "staff.new_order")).toHaveLength(0);
  });

  it("the contact address can receive an event; refund overdue keeps today's key for it", async () => {
    const fx = await newStore("alerts-contact");
    const order = await paidOrder(fx, [["DEMO-TOTE", 1]]);
    const [ret] = await db().execute<Row>(sql`
      insert into commerce.returns (store_id, order_id, kind, status, refund_deadline) values (${fx.storeId}::uuid, ${order.orderId}::uuid, 'return', 'requested', now() - interval '1 day') returning id
    `);
    // The defaults: the contact address.
    await sendRefundOverdueReminder(fx.storeId, String(ret.id));
    const overdue = await staffMails(fx.storeId, "return.overdue");
    expect(overdue).toHaveLength(1);
    expect(overdue[0].to_address).toBe(`butikk-${fx.slug}@example.com`);
    expect(overdue[0].idempotency_key).toBe(`return.${String(ret.id)}.overdue`);
    // The owner's choice: the owner gets it too, by a key of their own.
    expect(
      await alerts.saveStaffAlerts(fx.storeId, { recipients: [{ accountId: fx.accountId, events: ["refund_overdue"] }], contactEvents: ["refund_overdue"], summary: "off", summaryWeekday: 1, summaryHour: 8 }, fx.accountId),
    ).toEqual({ ok: true });
    await sendRefundOverdueReminder(fx.storeId, String(ret.id));
    const after = await staffMails(fx.storeId, "return.overdue");
    expect(after.map((m) => m.idempotency_key).sort()).toEqual([`return.${String(ret.id)}.overdue`, `return.${String(ret.id)}.overdue:${fx.accountId}`].sort());
  });

  it("a requested return emails the recipients of Return requested once, with its lines", async () => {
    const fx = await newStore("alerts-return");
    const order = await paidOrder(fx, [["DEMO-TOTE", 2]]);
    await drain();
    const [line] = await db().execute<Row>(sql`select id from commerce.order_lines where order_id = ${order.orderId}::uuid`);
    const [ret] = await db().transaction(async (tx) => {
      const made = await tx.execute<Row>(sql`insert into commerce.returns (store_id, order_id, kind, status) values (${fx.storeId}::uuid, ${order.orderId}::uuid, 'return', 'requested') returning id, number`);
      await tx.execute(sql`insert into commerce.return_lines (store_id, return_id, order_line_id, quantity) values (${fx.storeId}::uuid, ${String(made[0].id)}::uuid, ${String(line.id)}::uuid, 1)`);
      return made;
    });
    await drain();
    await drain();
    const mails = await staffMails(fx.storeId, "staff.return_requested");
    expect(mails).toHaveLength(1);
    expect(mails[0].idempotency_key).toBe(`staff-return:${String(ret.id)}:${fx.accountId}`);
    expect(String(mails[0].text)).toContain("1 × ");
    expect(String(mails[0].text)).toContain(`/admin/${fx.slug}/returns/${String(ret.id)}`);
  });
});

describe("the summary (2.8, 4.7)", () => {
  it("sends daily at the store's hour, once per period; weekly only on its day", async () => {
    const fx = await newStore("alerts-summary");
    await paidOrder(fx, [["DEMO-TOTE", 1]]);
    expect(
      await alerts.saveStaffAlerts(fx.storeId, { recipients: [{ accountId: fx.accountId, events: ["summary"] }], contactEvents: [], summary: "daily", summaryWeekday: 1, summaryHour: 8 }, fx.accountId),
    ).toEqual({ ok: true });
    // 06:30 UTC is 07:30 or 08:30 in Oslo: use a winter date (UTC+1) so the hour is known.
    const before = new Date("2031-01-15T06:30:00Z"); // 07:30 Oslo
    const after = new Date("2031-01-15T07:30:00Z"); // 08:30 Oslo
    await alerts.sendDueSummaries({ now: before });
    expect(await staffMails(fx.storeId, "staff.summary")).toHaveLength(0);
    await alerts.sendDueSummaries({ now: after });
    await alerts.sendDueSummaries({ now: new Date("2031-01-15T09:00:00Z") });
    const daily = await staffMails(fx.storeId, "staff.summary");
    expect(daily).toHaveLength(1);
    expect(daily[0].idempotency_key).toBe(`staff-summary:${fx.storeId}:daily:2031-01-14:${fx.accountId}`);
    expect(String(daily[0].text)).toContain("No orders yesterday");

    await alerts.saveStaffAlerts(fx.storeId, { recipients: [{ accountId: fx.accountId, events: ["summary"] }], contactEvents: [], summary: "weekly", summaryWeekday: 1, summaryHour: 8 }, fx.accountId);
    await alerts.sendDueSummaries({ now: new Date("2031-01-16T08:00:00Z") }); // a Thursday
    expect(await staffMails(fx.storeId, "staff.summary")).toHaveLength(1);
    await alerts.sendDueSummaries({ now: new Date("2031-01-20T08:00:00Z") }); // Monday 09:00 Oslo
    const weekly = await staffMails(fx.storeId, "staff.summary");
    expect(weekly).toHaveLength(2);
    expect(weekly[1].idempotency_key).toBe(`staff-summary:${fx.storeId}:weekly:2031-01-19:${fx.accountId}`);
  });
});

describe("no shopper's personal field in a staff email (4.8, 6.3 C4)", () => {
  it("leaves out the canary name, email, phone, address, company and gift message of every staff email", async () => {
    const fx = await newStore("alerts-canary");
    await db().execute(sql`
      insert into commerce.order_settings (store_id, gift_messages) values (${fx.storeId}::uuid, true)
      on conflict (store_id) do update set gift_messages = true
    `);
    const canaries = ["Canaryname Zqx", "canary-email-zqx@example.com", "+47 99 88 77 66", "Canaryveien 13", "Canary Holding AS", "Canary gift words zqx", "Canarytown"];
    // A gift is frozen from the cart on (D173): the cart carries it, as a shopper's would.
    const [cart] = await db().execute<Row>(sql`
      insert into commerce.carts (store_id, market_code, currency, locale, expires_at, is_gift, gift_to, gift_from, gift_message)
      values (${fx.storeId}::uuid, 'NO', 'NOK', 'nb-NO', now() + interval '1 day', true, ${canaries[0]}, ${canaries[0]}, ${canaries[5]}) returning id
    `);
    await db().execute(sql`
      insert into commerce.cart_lines (store_id, cart_id, variant_id, quantity)
      select ${fx.storeId}::uuid, ${String(cart.id)}::uuid, id, 2 from commerce.product_variants where store_id = ${fx.storeId}::uuid and sku = 'DEMO-TOTE'
    `);
    const placed = await placeOrder({ storeId: fx.storeId, market: NO }, String(cart.id), {}, { customerId: null });
    if (!placed.ok) throw new Error(placed.problem);
    const orderId = placed.order.orderId;
    const address = JSON.stringify({ name: canaries[0], line1: canaries[3], city: canaries[6], postalCode: "0155", country: "NO", phone: canaries[2] });
    await db().execute(sql`
      update commerce.orders set shipping_address = ${address}::jsonb, billing_address = ${address}::jsonb, company_name = ${canaries[4]}, email = ${canaries[1]}
      where id = ${orderId}::uuid
    `);
    const [o] = await db().execute<Row>(sql`select total_minor from commerce.orders where id = ${orderId}::uuid`);
    await db().execute(sql`
      insert into commerce.payments (store_id, order_id, provider, provider_reference, provider_account, amount_minor, currency, status)
      values (${fx.storeId}::uuid, ${orderId}::uuid, 'stripe', ${`cs_${orderId}`}, ${fx.stripeAccount}, ${Number(o.total_minor)}, 'NOK', 'captured')
    `);
    const order = { orderId };
    await saveRule(fx.storeId, null, { name: "Tell staff", conditions: [], actions: [{ kind: "notify", note: "Look at this order" }] }, fx.accountId);
    await alerts.saveStaffAlerts(
      fx.storeId,
      { recipients: [{ accountId: fx.accountId, events: ["new_order", "return_requested", "refund_overdue", "summary", "automation"] }], contactEvents: [], summary: "daily", summaryWeekday: 1, summaryHour: 0 },
      fx.accountId,
    );
    await completeOrderPayment(orderId, `cs_${orderId}`);
    await drain();
    const [line] = await db().execute<Row>(sql`select id from commerce.order_lines where order_id = ${order.orderId}::uuid`);
    const [ret] = await db().transaction(async (tx) => {
      const made = await tx.execute<Row>(sql`
        insert into commerce.returns (store_id, order_id, kind, status, reason_note, refund_deadline)
        values (${fx.storeId}::uuid, ${order.orderId}::uuid, 'return', 'requested', 'Canary reason zqx', now() - interval '1 day') returning id
      `);
      await tx.execute(sql`insert into commerce.return_lines (store_id, return_id, order_line_id, quantity) values (${fx.storeId}::uuid, ${String(made[0].id)}::uuid, ${String(line.id)}::uuid, 1)`);
      return made;
    });
    await drain();
    await sendRefundOverdueReminder(fx.storeId, String(ret.id));
    await alerts.sendDueSummaries({ now: new Date() });
    const kinds = ["staff.new_order", "staff.return_requested", "automation.notify", "return.overdue", "staff.summary"];
    for (const kind of kinds) {
      const mails = await staffMails(fx.storeId, kind);
      expect(mails.length, kind).toBeGreaterThan(0);
      for (const m of mails) {
        const all = `${m.subject}\n${m.html}\n${m.text}`;
        for (const canary of [...canaries, "Canary reason zqx"]) expect(all, `${kind} holds ${canary}`).not.toContain(canary);
      }
    }
    const [newOrder] = await staffMails(fx.storeId, "staff.new_order");
    expect(String(newOrder.text)).toContain("Business buyer");
    expect(String(newOrder.text)).toContain("Gift");
    expect(String(newOrder.text)).toContain("Norway");
  });
});
