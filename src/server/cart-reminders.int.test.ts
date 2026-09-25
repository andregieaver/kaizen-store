import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { toMarket } from "@/lib/markets";
import { EMPTY_NAVIGATION } from "@/lib/navigation";
import { parseStoreSeo } from "@/lib/seo";

import type { Membership } from "./auth";

type Row = Record<string, unknown>;

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }) }));

const { placeOrder } = await import("./checkout");
const reminders = await import("./cart-reminders");

const run = Date.now().toString(36);
const slug = `remind-${run}`;
const no = toMarket({ code: "NO", currency: "NOK", defaultLocale: "nb-NO" });
const se = toMarket({ code: "SE", currency: "SEK", defaultLocale: "sv-SE" });
let storeId: string;
let member: Membership;

beforeAll(async () => {
  const [request] = await db().execute<Row>(sql`
    insert into commerce.access_requests (email, name, store_name)
    values (${`${slug}@example.com`}, 'Test', 'Test') returning id
  `);
  const [store] = await db().execute<Row>(sql`
    select commerce.approve_access_request(${String(request.id)}::uuid, ${slug}, 'Test', null) as id
  `);
  storeId = String(store.id);
  const [account] = await db().execute<Row>(sql`
    insert into commerce.accounts (email, name) values (${`owner-${slug}@example.com`}, 'Owner') returning id
  `);
  member = {
    account: { id: String(account.id), email: `owner-${slug}@example.com`, name: "Owner", platformAdmin: false },
    role: "owner",
    store: {
      id: storeId,
      slug,
      name: "Test",
      status: "active",
      isTemplate: false,
      setupCompletedAt: null,
      paymentsOn: true,
      paymentsTest: true,
      details: { legalName: null, organisationNumber: null, contactEmail: null, postalAddress: null, country: "NO" },
      markets: [no, se],
      seo: parseStoreSeo({}),
      navigation: EMPTY_NAVIGATION,
    },
  } as Membership;
});

afterAll(async () => {
  await closeDb();
});

/** A cart with a tote bag, and the order placed from it, as when checkout opens. */
async function checkout(quantity = 2): Promise<{ cartId: string; orderId: string }> {
  const [cart] = await db().execute<Row>(sql`
    insert into commerce.carts (store_id, market_code, currency, locale, expires_at)
    values (${storeId}::uuid, 'NO', 'NOK', 'nb-NO', now() + interval '1 day') returning id
  `);
  const cartId = String(cart.id);
  await db().execute(sql`
    insert into commerce.cart_lines (store_id, cart_id, variant_id, quantity)
    select ${storeId}::uuid, ${cartId}::uuid, id, ${quantity} from commerce.product_variants
    where store_id = ${storeId}::uuid and sku = 'DEMO-TOTE'
  `);
  const placed = await placeOrder({ storeId, market: no }, cartId);
  if (!placed.ok) throw new Error(placed.problem);
  return { cartId, orderId: placed.order.orderId };
}

async function checkoutRow(cartId: string) {
  const [row] = await db().execute<Row>(sql`
    select id, email, lines, subtotal_minor, token, opted_out_at, reminders_sent, last_delay_minutes, recovered_at
    from commerce.abandoned_checkouts where store_id = ${storeId}::uuid and cart_id = ${cartId}::uuid
  `);
  return row;
}

async function typedAgo(cartId: string, interval: string) {
  await db().execute(sql`
    update commerce.abandoned_checkouts set captured_at = now() - ${interval}::interval
    where store_id = ${storeId}::uuid and cart_id = ${cartId}::uuid
  `);
}

async function remindersTo(email: string) {
  return db().execute<Row>(sql`
    select subject, html, text, status from commerce.email_messages
    where store_id = ${storeId}::uuid and kind = 'cart_reminder' and to_address = ${email}
    order by created_at
  `);
}

describe("setting up cart reminders (D33)", () => {
  it("keep nothing until the store turns them on, which starts it with three in each language", async () => {
    expect(await reminders.cartRemindersOn(storeId)).toBe(false);
    const { cartId, orderId } = await checkout();
    expect(await reminders.captureCheckout(storeId, no, cartId, orderId, "early@example.com")).toBe(false);
    expect(await checkoutRow(cartId)).toBeUndefined();

    await reminders.setCartRemindersEnabled(member, true);
    const { enabled, steps } = await reminders.getCartReminderSettings(storeId);
    expect(enabled).toBe(true);
    expect(steps.map((s) => s.delayMinutes)).toEqual([60, 1440, 4320]);
    expect(Object.keys(steps[0].content).sort()).toEqual(["nb-NO", "sv-SE"]);
    expect(steps[0].content["nb-NO"].subject).toBe("Glemte du noe hos {store}?");
    expect(await reminders.cartRemindersOn(storeId)).toBe(true);

    // Turning off and on again keeps the store's own reminders.
    await reminders.setCartRemindersEnabled(member, false);
    await reminders.setCartRemindersEnabled(member, true);
    expect((await reminders.getCartReminderSettings(storeId)).steps).toHaveLength(3);
  });

  it("check what the owner writes", async () => {
    const text = { subject: "Hei", heading: "Hei", body: "Hei", button: "Kjøp" };
    expect(await reminders.saveCartReminderStep(member, null, { delayMinutes: 10, content: { "nb-NO": text, "sv-SE": text } })).toEqual({
      ok: false,
      problems: ["Wait at least 30 minutes: the shopper may still be paying."],
    });
    expect(await reminders.saveCartReminderStep(member, null, { delayMinutes: 120, content: { "nb-NO": text } })).toEqual({
      ok: false,
      problems: ["Write the reminder in every language the store sells in."],
    });
  });
});

describe("a cart left at checkout (D33)", () => {
  it("is kept with the email typed, and gets each reminder once, in order, with a way back and a way out", async () => {
    const { cartId, orderId } = await checkout(2);
    expect(await reminders.captureCheckout(storeId, no, cartId, orderId, " Kari.Reminder@Example.com ")).toBe(true);
    const row = await checkoutRow(cartId);
    expect(row).toMatchObject({ email: "kari.reminder@example.com", subtotal_minor: "39800", reminders_sent: 0 });
    expect(row.lines).toEqual([expect.objectContaining({ quantity: 2, unitPriceMinor: 19900, sellingPlanId: null })]);

    // Not yet: the shopper may still be paying.
    await reminders.sendDueCartReminders();
    expect(await remindersTo("kari.reminder@example.com")).toHaveLength(0);

    await typedAgo(cartId, "2 hours");
    await reminders.sendDueCartReminders();
    await reminders.sendDueCartReminders();
    const first = await remindersTo("kari.reminder@example.com");
    expect(first).toHaveLength(1);
    expect(first[0].subject).toBe("Glemte du noe hos Test?");
    expect(String(first[0].html)).toContain(`/s/${slug}/no/cart/restore/${row.token}`);
    expect(String(first[0].html)).toContain(`/s/${slug}/no/unsubscribe/${row.token}`);
    expect(String(first[0].text)).toContain("2 × ");

    // Days late: only the latest reminder due goes, not every one missed.
    await typedAgo(cartId, "5 days");
    await reminders.sendDueCartReminders();
    const all = await remindersTo("kari.reminder@example.com");
    expect(all.map((r) => r.subject)).toEqual(["Glemte du noe hos Test?", "Siste påminnelse om handlekurven din"]);
    expect(await checkoutRow(cartId)).toMatchObject({ reminders_sent: 2, last_delay_minutes: 4320 });
  });

  it("brings the cart back from the link, and notes the click", async () => {
    const { cartId, orderId } = await checkout(3);
    await reminders.captureCheckout(storeId, no, cartId, orderId, "link@example.com");
    const { token } = await checkoutRow(cartId);
    const opened = await reminders.openReminderLink(storeId, String(token));
    expect(opened?.lines).toEqual([expect.objectContaining({ quantity: 3 })]);
    expect(await reminders.openReminderLink(storeId, "no-such-token")).toBeNull();
    const [clicked] = await db().execute<Row>(sql`select clicked_at from commerce.abandoned_checkouts where token = ${String(token)}`);
    expect(clicked.clicked_at).not.toBeNull();
  });

  it("gets no reminders once paid, or once the same email has bought since", async () => {
    const paid = await checkout();
    await reminders.captureCheckout(storeId, no, paid.cartId, paid.orderId, "paid@example.com");
    await db().execute(sql`update commerce.orders set status = 'paid', email = 'paid@example.com' where id = ${paid.orderId}::uuid`);
    await reminders.markCheckoutRecovered(storeId, paid.orderId);
    expect((await checkoutRow(paid.cartId)).recovered_at).not.toBeNull();

    const other = await checkout();
    await reminders.captureCheckout(storeId, no, other.cartId, other.orderId, "bought@example.com");
    await typedAgo(other.cartId, "2 hours");
    const later = await checkout();
    await db().execute(sql`update commerce.orders set status = 'paid', email = 'bought@example.com' where id = ${later.orderId}::uuid`);
    await db().execute(sql`
      insert into commerce.payments (store_id, order_id, provider, provider_reference, amount_minor, currency, status)
      values (${storeId}::uuid, ${later.orderId}::uuid, 'stripe', ${`cs_${run}_later`}, 100, 'NOK', 'captured')
    `);
    await reminders.sendDueCartReminders();
    expect(await remindersTo("bought@example.com")).toHaveLength(0);
    expect(await checkoutRow(other.cartId)).toMatchObject({ reminders_sent: 0 });
    expect((await checkoutRow(other.cartId)).recovered_at).not.toBeNull();
  });
});

describe("saying no (D33)", () => {
  it("at checkout erases the email and cart, is remembered for the email, and can be taken back", async () => {
    const { cartId, orderId } = await checkout();
    await reminders.captureCheckout(storeId, no, cartId, orderId, "nei@example.com");
    await reminders.setCheckoutOptOut(storeId, no, cartId, true, "nei@example.com");
    expect(await checkoutRow(cartId)).toMatchObject({ email: null, lines: [], subtotal_minor: "0" });
    expect(await reminders.checkoutOptedOut(storeId, cartId)).toBe(true);

    // A new cart with the same email is not kept.
    const next = await checkout();
    expect(await reminders.captureCheckout(storeId, no, next.cartId, next.orderId, "NEI@example.com")).toBe(false);
    expect(await checkoutRow(next.cartId)).toMatchObject({ email: null });

    await reminders.setCheckoutOptOut(storeId, no, cartId, false, "nei@example.com");
    expect(await reminders.checkoutOptedOut(storeId, cartId)).toBe(false);
    expect(await reminders.captureCheckout(storeId, no, cartId, orderId, "nei@example.com")).toBe(true);
  });

  it("from a reminder's link stops every reminder to the email", async () => {
    const { cartId, orderId } = await checkout();
    await reminders.captureCheckout(storeId, no, cartId, orderId, "stopp@example.com");
    const { token } = await checkoutRow(cartId);
    expect(await reminders.unsubscribe(String(token))).toEqual({ storeId });
    expect(await checkoutRow(cartId)).toMatchObject({ email: null });
    expect(await reminders.unsubscribe("unknown")).toBeNull();
    const [optOut] = await db().execute<Row>(sql`
      select source from commerce.email_opt_outs where store_id = ${storeId}::uuid and email = 'stopp@example.com'
    `);
    expect(optOut.source).toBe("unsubscribe");
    // Taking back a checkout opt-out leaves one made from an email alone.
    await reminders.setCheckoutOptOut(storeId, no, cartId, false, "stopp@example.com");
    const [still] = await db().execute<Row>(sql`
      select count(*)::int as n from commerce.email_opt_outs where store_id = ${storeId}::uuid and email = 'stopp@example.com'
    `);
    expect(still.n).toBe(1);
  });
});

describe("the editor (D33)", () => {
  it("previews each language with a sample cart, and sends a test to the staff member", async () => {
    const languages = await reminders.reminderLanguages(storeId);
    expect(languages.map((l) => [l.locale, l.currency])).toEqual(
      expect.arrayContaining([
        ["nb-NO", "NOK"],
        ["sv-SE", "SEK"],
      ]),
    );
    expect(languages[0].sample.length).toBeGreaterThan(0);
    const { steps } = await reminders.getCartReminderSettings(storeId);
    expect(await reminders.sendTestReminder(member, steps[0].id, "sv-SE")).toBe("logged");
    const [test] = await db().execute<Row>(sql`
      select subject, to_address from commerce.email_messages where store_id = ${storeId}::uuid and kind = 'cart_reminder.test'
    `);
    expect(test).toEqual({ subject: "[Test] Glömde du något hos Test?", to_address: `owner-${slug}@example.com` });
  });
});
