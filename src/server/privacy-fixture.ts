// Test support for the integration tests of GDPR export, erasure and retention (D162): a person with one of every kind of data in a store, and
// sentinel strings planted where a leak would show (another store's data, a password hash, a client secret). Not imported by the app.
import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { emptyGroup, newField, type FieldDef } from "@/lib/custom-fields";
import { sha256 } from "./customers";

import type { Membership } from "./auth";
import { sendEmail } from "./email";
import { saveStaffFields } from "./field-entities";
import { saveFieldGroup } from "./custom-fields";
import { noInEuro, paidOrder, unique, type Fixture, type Placed } from "./invoice-test-fixture";

type Row = Record<string, unknown>;

/** Strings that must never reach a file, the log or an email: planted in columns the export deliberately leaves out. */
export const SECRETS = {
  passwordHash: "scrypt$16384$8$1$SECRETSALT$SECRETHASH-1g",
  clientSecret: "pi_secret_SECRET-CLIENT-1g",
  manageToken: "SECRET-MANAGE-TOKEN-1g",
  downloadToken: "SECRET-DOWNLOAD-TOKEN-1g",
  providerAccount: "acct_SECRET_PROVIDER_1g",
  costNote: "SECRET-COST-1g",
};

export type Subject = {
  fx: Fixture;
  email: string;
  customerId: string;
  /** Every id inserted, by kind, for the round trip of the counts. */
  ids: {
    orders: string[];
    signedInOrder: Placed;
    guestOrder: Placed;
    otherEmailOrder: Placed;
    unpaidOrder: Placed;
    euroOrder: Placed;
    copiedOrder: string;
    hostOrder: string;
    renewalOrder: string;
    subscription: string;
    standingOrder: string;
    wishlist: string;
    return: string;
    withdrawal: string;
    cart: string;
    optOut: string;
    formSignUp: string;
    invoice: string;
    creditNote: string;
  };
  /** The email the guest orders and the order placed signed in under another address were made with. */
  otherEmail: string;
};

const j = (v: unknown) => JSON.stringify(v);

async function owner(fx: Fixture): Promise<Membership> {
  const { ownerOf } = await import("./invoice-test-fixture");
  return ownerOf(fx);
}

/**
 * A person in a store with one of every kind of data: an account (with a picture path, a password and a company), orders (signed in, guest under
 * the same email, signed in under another email, never paid, in euro, copied from another store, a host's, a subscription's renewal), a booking,
 * an invoice and a credit note, a return and a withdrawal, a subscription, a standing list with a saved card and a delivery, a wishlist and what
 * was added to a cart from it, bonus credits, a referral code and a reward, emails, an abandoned checkout, an opt-out, a newsletter sign-up, a
 * company invitation and custom fields on the customer and on an order.
 */
export async function buildSubject(fx: Fixture, label = "subject", opts: { email?: string; sentinel?: string } = {}): Promise<Subject> {
  const email = opts.email ?? `${unique(label)}@example.com`;
  const mark = opts.sentinel ?? "";
  const otherEmail = `${unique("other")}@example.com`;
  const s = fx.storeId;
  const member = await owner(fx);

  // The account.
  const [tier] = await db().execute<Row>(sql`insert into commerce.customer_tiers (store_id, name, percent) values (${s}::uuid, ${unique("Friends")}, 5) returning id`);
  const [company] = await db().execute<Row>(sql`insert into commerce.customer_companies (store_id, name, organisation_number, tier_id) values (${s}::uuid, ${unique("Fjord")}, '912345678', ${String(tier.id)}::uuid) returning id`);
  const [c] = await db().execute<Row>(sql`
    insert into commerce.customers (store_id, email, email_verified_at, name, phone, address, locale, password_hash, avatar_path, tier_id, company_id, company_role, company_name, organisation_number, last_sign_in_at)
    values (${s}::uuid, ${email}, now(), ${`Kari Nordmann ${mark}`}, '+4799999999', ${j({ name: `Kari Nordmann ${mark}`, line1: "Kirkeveien 5", postalCode: "0368", city: "Oslo", country: "NO" })}::jsonb,
            'nb-NO', ${SECRETS.passwordHash}, ${`${s}/avatar-1g.webp`}, ${String(tier.id)}::uuid, ${String(company.id)}::uuid, 'employee', 'Fjord Mat AS', '912345678', now())
    returning id`);
  const customerId = String(c.id);
  await db().execute(sql`insert into commerce.customer_sessions (store_id, customer_id, token_hash, expires_at) values (${s}::uuid, ${customerId}::uuid, ${sha256(`session-${customerId}`)}, now() + interval '30 days')`);
  await db().execute(sql`insert into commerce.customer_codes (store_id, email, code_hash, expires_at) values (${s}::uuid, ${email}, 'codehash', now() + interval '10 minutes')`);

  // Orders.
  const signedInOrder = await paidOrder(fx, [["DEMO-MUG-WHITE", 2]], { email, customerId, company: { name: "Fjord Mat AS", number: "912345678" } });
  const guestOrder = await paidOrder(fx, [["DEMO-MUG-WHITE", 1]], { email });
  const otherEmailOrder = await paidOrder(fx, [["DEMO-MUG-WHITE", 1]], { email: otherEmail, customerId });
  const unpaidOrder = await paidOrder(fx, [["DEMO-MUG-WHITE", 1]], { email, pay: false });
  const euroOrder = await paidOrder(fx, [["DEMO-MUG-WHITE", 3]], { email, market: noInEuro });
  // Planted in columns the file leaves out.
  await db().execute(sql`update commerce.payments set client_secret = ${SECRETS.clientSecret}, provider_account = ${SECRETS.providerAccount} where order_id = ${signedInOrder.orderId}::uuid`);
  await db().execute(sql`update commerce.order_lines set unit_cost_minor = 777 where order_id = ${signedInOrder.orderId}::uuid`);
  await db().execute(sql`insert into commerce.shipments (store_id, order_id, carrier, tracking_number, tracking_url) values (${s}::uuid, ${signedInOrder.orderId}::uuid, 'Bring', 'TRACK-1g', 'https://track.example/1g')`);
  const [file] = await db().execute<Row>(sql`select id from commerce.product_files where store_id = ${s}::uuid limit 1`);
  if (file) await db().execute(sql`insert into commerce.order_downloads (store_id, order_id, file_id, token, expires_at) values (${s}::uuid, ${signedInOrder.orderId}::uuid, ${String(file.id)}::uuid, ${`${SECRETS.downloadToken}-${unique("d")}`}, now() + interval '30 days')`);

  // Copied history (D129): a paid order that came from another store.
  const [copied] = await db().execute<Row>(sql`
    insert into commerce.orders (store_id, number, market_code, currency, locale, email, customer_id, status, subtotal_minor, shipping_minor, discount_minor, tax_minor, total_minor, billing_address, shipping_address, copied_from)
    values (${s}::uuid, ${`C-${unique("c")}`}, 'NO', 'NOK', 'nb-NO', ${email}, ${customerId}::uuid, 'paid', 5000, 0, 0, 1000, 5000, ${j({ name: "Kari Nordmann", line1: "Gamleveien 1" })}::jsonb, '{}', gen_random_uuid()) returning id`);

  // A host's order (D71).
  const [hostAccount] = await db().execute<Row>(sql`insert into commerce.accounts (email, name) values (${`${unique("host")}@example.com`}, 'Host') returning id`);
  const [host] = await db().execute<Row>(sql`insert into commerce.hosts (store_id, account_id, name, commission_bps) values (${s}::uuid, ${String(hostAccount.id)}::uuid, 'Host', 1000) returning id`);
  const hostPlaced = await paidOrder(fx, [["DEMO-MUG-WHITE", 1]], { email });
  await db().execute(sql`update commerce.orders set host_id = ${String(host.id)}::uuid where id = ${hostPlaced.orderId}::uuid`);

  // A subscription and its renewal order.
  const renewal = await paidOrder(fx, [["DEMO-MUG-WHITE", 1]], { email, customerId });
  const [sub] = await db().execute<Row>(sql`
    insert into commerce.subscriptions (store_id, number, status, market_code, currency, locale, email, shipping_address, interval, interval_count, subtotal_minor, shipping_minor, total_minor, tax_minor, first_order_id, provider, provider_reference, provider_account, manage_token, customer_id)
    values (${s}::uuid, ${`S-${unique("s")}`}, 'active', 'NO', 'NOK', 'nb-NO', ${email}, ${j({ name: "Kari Nordmann", line1: "Kirkeveien 5", postalCode: "0368", city: "Oslo", country: "NO" })}::jsonb, 'month', 1, 10000, 0, 10000, 2000, ${renewal.orderId}::uuid, 'stripe', ${`sub_${unique("x")}`}, ${fx.account}, ${`${SECRETS.manageToken}-${unique("m")}`}, ${customerId}::uuid) returning id`);
  const [variant] = await db().execute<Row>(sql`select id, sku from commerce.product_variants where store_id = ${s}::uuid and sku = 'DEMO-MUG-WHITE'`);
  await db().execute(sql`insert into commerce.subscription_lines (store_id, subscription_id, variant_id, sku, title, quantity, unit_price_minor, total_minor, tax_rate, tax_code) values (${s}::uuid, ${String(sub.id)}::uuid, ${String(variant.id)}::uuid, 'DEMO-MUG-WHITE', 'Mug', 1, 10000, 10000, 0.25, 'general')`);
  await db().execute(sql`update commerce.orders set subscription_id = ${String(sub.id)}::uuid where id = ${renewal.orderId}::uuid`);

  // A standing list with a saved card and a delivery (D102).
  const [schedule] = await db().execute<Row>(sql`insert into commerce.delivery_schedules (store_id, market_code, currency, name, delivery_weekday) values (${s}::uuid, 'NO', 'NOK', 'Thursdays', 4) returning id`);
  const [standing] = await db().execute<Row>(sql`
    insert into commerce.standing_orders (store_id, customer_id, schedule_id, status, shipping_address, stripe_account, mode, stripe_customer, payment_method, card_label, consent_at, skip_dates)
    values (${s}::uuid, ${customerId}::uuid, ${String(schedule.id)}::uuid, 'active', ${j({ name: "Kari Nordmann", line1: "Kirkeveien 5" })}::jsonb, ${fx.account}, 'test', 'cus_1g', 'pm_1g', 'Visa ••4242', now(), array['2026-12-24'::date]) returning id`);
  await db().execute(sql`insert into commerce.standing_order_lines (store_id, standing_order_id, variant_id, quantity) values (${s}::uuid, ${String(standing.id)}::uuid, ${String(variant.id)}::uuid, 2)`);
  await db().execute(sql`insert into commerce.standing_deliveries (store_id, standing_order_id, delivery_date, outcome, order_id) values (${s}::uuid, ${String(standing.id)}::uuid, '2026-11-05', 'ordered', ${guestOrder.orderId}::uuid)`);

  // A wishlist, and what was added to a cart from it.
  const [product] = await db().execute<Row>(sql`select product_id from commerce.product_variants where id = ${String(variant.id)}::uuid`);
  const [wishlist] = await db().execute<Row>(sql`insert into commerce.wishlists (store_id, customer_id, name) values (${s}::uuid, ${customerId}::uuid, 'Christmas') returning id`);
  await db().execute(sql`insert into commerce.wishlist_items (store_id, wishlist_id, product_id, variant_id, quantity) values (${s}::uuid, ${String(wishlist.id)}::uuid, ${String(product.product_id)}::uuid, ${String(variant.id)}::uuid, 1)`);
  const [cartRow] = await db().execute<Row>(sql`select cart_id from commerce.orders where id = ${signedInOrder.orderId}::uuid`);
  const cart = String(cartRow.cart_id);
  await db().execute(sql`update commerce.carts set customer_id = ${customerId}::uuid, vat_number = null where id = ${cart}::uuid`);
  await db().execute(sql`
    insert into commerce.wishlist_cart_adds (store_id, wishlist_id, wishlist_name, customer_id, cart_id, product_id, variant_id, title, sku, quantity, currency, unit_price_minor)
    values (${s}::uuid, ${String(wishlist.id)}::uuid, 'Christmas', ${customerId}::uuid, ${cart}::uuid, ${String(product.product_id)}::uuid, ${String(variant.id)}::uuid, 'Mug', 'DEMO-MUG-WHITE', 1, 'NOK', 10000)`);

  // Bonus credits and a referral.
  await db().execute(sql`insert into commerce.bonus_settings (store_id, enabled, earn_bps, currency) values (${s}::uuid, true, 500, 'NOK') on conflict (store_id) do update set enabled = true`);
  await db().execute(sql`select commerce.bonus_grant(${s}::uuid, ${customerId}::uuid, 'adjust', 4000, null, null, now(), null, 'goodwill', null, ${`grant-${customerId}`})`);
  await db().execute(sql`insert into commerce.affiliates (store_id, customer_id, code) values (${s}::uuid, ${customerId}::uuid, ${`ref${customerId.replace(/-/g, "").slice(0, 8)}`})`);
  await db().execute(sql`insert into commerce.affiliate_attributions (store_id, order_id, affiliate_customer_id, code, discount_minor, reward_minor, status) values (${s}::uuid, ${guestOrder.orderId}::uuid, ${customerId}::uuid, 'X', 500, 300, 'rewarded')`);

  // A return and a withdrawal on the signed-in order.
  const [line] = await db().execute<Row>(sql`select id from commerce.order_lines where order_id = ${signedInOrder.orderId}::uuid limit 1`);
  const [ret] = await db().execute<Row>(sql`
    insert into commerce.returns (store_id, order_id, number, kind, status, reason, reason_note, staff_note, decision_note)
    values (${s}::uuid, ${signedInOrder.orderId}::uuid, ${`R-${unique("r")}`}, 'return', 'requested', 'too_small', ${`Too small, call me on 99999999 ${mark}`}, 'Difficult customer', null) returning id`);
  await db().execute(sql`insert into commerce.return_lines (store_id, return_id, order_line_id, quantity, decision) values (${s}::uuid, ${String(ret.id)}::uuid, ${String(line.id)}::uuid, 1, 'accept')`);
  const [withdrawal] = await db().execute<Row>(sql`
    insert into commerce.withdrawal_requests (store_id, order_id, name, email, channel, status, expires_at)
    values (${s}::uuid, ${guestOrder.orderId}::uuid, 'Kari Nordmann', ${email}, 'form', 'pending', now() + interval '1 day') returning id`);
  const [guestLine] = await db().execute<Row>(sql`select id from commerce.order_lines where order_id = ${guestOrder.orderId}::uuid limit 1`);
  await db().execute(sql`insert into commerce.withdrawal_request_lines (store_id, withdrawal_request_id, order_line_id, quantity) values (${s}::uuid, ${String(withdrawal.id)}::uuid, ${String(guestLine.id)}::uuid, 1)`);
  await db().execute(sql`update commerce.withdrawal_requests set status = 'confirmed', confirmed_at = now() where id = ${String(withdrawal.id)}::uuid`);
  await db().execute(sql`update commerce.withdrawal_requests set acknowledged_at = now() where id = ${String(withdrawal.id)}::uuid`);

  // A booking on the signed-in order's line (staff and room names are another person's data).
  const [resource] = await db().execute<Row>(sql`insert into commerce.booking_resources (store_id, name, hours) values (${s}::uuid, 'Room Secret Staff Name 1g', '{}'::jsonb) returning id`);
  await db().execute(sql`
    insert into commerce.bookings (store_id, product_id, variant_id, resource_id, starts_at, ends_at, blocked_from, blocked_to, status, order_id, order_line_id)
    values (${s}::uuid, ${String(product.product_id)}::uuid, ${String(variant.id)}::uuid, ${String(resource.id)}::uuid, now() + interval '10 days', now() + interval '10 days 1 hour', now() + interval '10 days', now() + interval '10 days 1 hour', 'confirmed', ${signedInOrder.orderId}::uuid, ${String(line.id)}::uuid)`);

  // Emails, an abandoned checkout, an opt-out, a sign-up, a company invitation.
  await sendEmail({ storeId: s, kind: "order.confirmation", to: email, orderId: signedInOrder.orderId, email: { subject: `Order confirmation Kari ${mark}`, html: `<p>Hi Kari Nordmann ${mark}</p>`, text: `Hi Kari Nordmann ${mark}` }, fromName: "Shop", idempotencyKey: `conf-${signedInOrder.orderId}` });
  await sendEmail({ storeId: s, kind: "account.code", to: email, email: { subject: "Your code", html: "<p>123456</p>", text: "Your code 123456" }, fromName: "Shop", idempotencyKey: `code-${customerId}` });
  await sendEmail({ storeId: s, kind: "return.acknowledgement", to: email, orderId: guestOrder.orderId, email: { subject: "We received your withdrawal", html: "<p>Withdrawal</p>", text: "Withdrawal" }, fromName: "Shop", idempotencyKey: `ack-${guestOrder.orderId}` });
  await db().execute(sql`
    insert into commerce.abandoned_checkouts (store_id, cart_id, email, market_code, locale, currency, lines, subtotal_minor, token, reminders_sent)
    values (${s}::uuid, ${cart}::uuid, ${email}, 'NO', 'nb-NO', 'NOK', ${j([{ title: "Mug" }])}::jsonb, 10000, ${`abandon-${unique("t")}`}, 1)`).catch(() => undefined);
  const [optOut] = await db().execute<Row>(sql`insert into commerce.email_opt_outs (store_id, email, source) values (${s}::uuid, ${email}, 'unsubscribe') returning id`);
  const [form] = await db().execute<Row>(sql`
    insert into commerce.form_submissions (store_id, block_id, kind, visitor, status, email, token_hash, payload, path, locale)
    values (${s}::uuid, 'b1', 'subscription', 'v1', 'sent', ${email}, ${sha256(unique("f"))}, '{"name":"Kari"}'::jsonb, '/', 'nb-NO') returning id`);
  await db().execute(sql`insert into commerce.company_invites (store_id, company_id, email, token_hash, status, expires_at) values (${s}::uuid, ${String(company.id)}::uuid, ${email}, ${`inv-${unique("i")}`}, 'pending', now() + interval '3 days')`);

  // Custom fields on the customer and an order, entered by staff.
  const note: FieldDef = { ...newField("text"), access: "private", name: "note", label: "Staff note" };
  const group = await saveFieldGroup(member, { ...emptyGroup(), name: "Notes", slug: unique("notes"), entities: ["customer", "order"], fields: [note] });
  if (!group.ok) throw new Error(`field group: ${JSON.stringify(group)}`);
  const savedCustomer = await saveStaffFields(member, "customer", customerId, { values: {}, translations: { "nb-NO": { [note.id]: `Prefers small packages ${mark}` } } });
  const savedOrder = await saveStaffFields(member, "order", signedInOrder.orderId, { values: {}, translations: { "nb-NO": { [note.id]: "Gift wrap please" } } });
  if (!savedCustomer.ok || !savedOrder.ok) throw new Error(`staff fields: ${JSON.stringify([savedCustomer, savedOrder])}`);

  // Documents: the invoice was issued by the payment; a refund gets a credit note.
  const { invoiceOf } = await import("./invoice-test-fixture");
  const { issueMissingCreditNotes } = await import("./invoice-issue");
  const invoice = (await invoiceOf(s, signedInOrder.orderId))!;
  const [payment] = await db().execute<Row>(sql`select id from commerce.payments where order_id = ${signedInOrder.orderId}::uuid and status = 'captured' limit 1`);
  await db().execute(sql`insert into commerce.refunds (store_id, payment_id, amount_minor, reason, status, provider_reference) values (${s}::uuid, ${String(payment.id)}::uuid, 1000, 'requested_by_customer', 'succeeded', ${`re_${unique("r")}`})`);
  await issueMissingCreditNotes(s);
  const [note1] = await db().execute<Row>(sql`select c.id from commerce.credit_notes c join commerce.invoices i on i.id = c.invoice_id where i.order_id = ${signedInOrder.orderId}::uuid limit 1`);

  const orders = [signedInOrder.orderId, guestOrder.orderId, otherEmailOrder.orderId, unpaidOrder.orderId, euroOrder.orderId, String(copied.id), hostPlaced.orderId, renewal.orderId];
  return {
    fx,
    email,
    otherEmail,
    customerId,
    ids: {
      orders,
      signedInOrder,
      guestOrder,
      otherEmailOrder,
      unpaidOrder,
      euroOrder,
      copiedOrder: String(copied.id),
      hostOrder: hostPlaced.orderId,
      renewalOrder: renewal.orderId,
      subscription: String(sub.id),
      standingOrder: String(standing.id),
      wishlist: String(wishlist.id),
      return: String(ret.id),
      withdrawal: String(withdrawal.id),
      cart,
      optOut: String(optOut.id),
      formSignUp: String(form.id),
      invoice: invoice.id,
      creditNote: note1 ? String(note1.id) : "",
    },
  };
}

/** Makes an order old for the schedule: placed, its payments and its documents move to a year, so the retention clock can be tested with data instead of a clock in the future. */
export async function ageOrder(orderId: string, isoDay: string): Promise<void> {
  await db().transaction(async (tx) => {
    await tx.execute(sql`alter table commerce.invoices disable trigger invoices_append_only`);
    await tx.execute(sql`update commerce.orders set placed_at = ${`${isoDay}T12:00:00Z`}::timestamptz where id = ${orderId}::uuid`);
    await tx.execute(sql`update commerce.payments set updated_at = ${`${isoDay}T12:00:00Z`}::timestamptz, created_at = ${`${isoDay}T12:00:00Z`}::timestamptz where order_id = ${orderId}::uuid`);
    await tx.execute(sql`update commerce.invoices set issued_on = ${isoDay}::date, issued_at = ${`${isoDay}T12:00:00Z`}::timestamptz where order_id = ${orderId}::uuid`);
    await tx.execute(sql`alter table commerce.invoices enable trigger invoices_append_only`);
    await tx.execute(sql`alter table commerce.credit_notes disable trigger credit_notes_append_only`);
    await tx.execute(sql`update commerce.credit_notes set issued_on = ${isoDay}::date, issued_at = ${`${isoDay}T12:00:00Z`}::timestamptz where invoice_id in (select id from commerce.invoices where order_id = ${orderId}::uuid)`);
    await tx.execute(sql`alter table commerce.credit_notes enable trigger credit_notes_append_only`);
    await tx.execute(sql`update commerce.refunds set created_at = ${`${isoDay}T12:00:00Z`}::timestamptz where payment_id in (select id from commerce.payments where order_id = ${orderId}::uuid)`);
  });
}
