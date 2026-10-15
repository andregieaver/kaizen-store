import { createHash, randomBytes } from "node:crypto";

import { testDb, testStore } from "./db";

/**
 * Rows for the shopper's side of exchanges and return labels (wave 3, D239, `docs/wave-3-exchanges.md` 5.3): the exchange page (`exchange.spec.ts`) and the
 * return's status page with a booked label (`return-label.spec.ts`). Staff's builder is the admin's (its own signed-in spec), so the rows are written with SQL the
 * way the server writes them: a paid order of one sweater, an approved voluntary return of it, and a proposal of another sweater inserted together with its line
 * in one transaction (the database checks a proposal has lines at commit), its token kept only as a SHA-256 hash. Held elsewhere: the money, processing, the pay
 * step's Stripe session and the documents (integration tests with the fake Stripe), and the label's fetch from the carrier (`return-labels.int.test.ts`).
 */

export type ExchangeFixture = { slug: string; storeId: string; orderId: string; returnId: string; exchangeId: string; token: string; returnToken: string; number: string; returnNumber: string };

export type ExchangeOptions = {
  /** Where the proposal is: `proposed` (the default), `expired`, `cancelled` or `superseded`. */
  state?: "proposed" | "expired" | "cancelled" | "superseded";
  /** The replacement's price: above the credit (the customer pays the difference, the default), equal, or below (a refund is due). */
  difference?: "to_pay" | "even" | "refund_due";
  /** The store shows its terms with a tick box at checkout (and so on the exchange page). */
  termsCheckbox?: boolean;
  /** No proposal at all: the return as it is before staff propose anything (the wish, the label). */
  noProposal?: boolean;
};

const SWEATER = 59900;

/**
 * A store selling in several countries (so its addresses keep the country), payments on in live mode, the seller's details; a paid and sent order of one
 * sweater at 599,00 (no shipping), an approved voluntary return of it (credit 599,00), and a proposal of another sweater at 649,00 (or 599,00 or 499,00).
 */
export async function exchangeFixture(options: ExchangeOptions = {}): Promise<ExchangeFixture> {
  const store = await testStore("bytte", ["countries"]);
  const db = testDb();
  const token = randomBytes(32).toString("base64url");
  const hash = createHash("sha256").update(token).digest("base64url");
  const number = `EX-${Date.now().toString(36).toUpperCase()}`;
  const key = `cs_e2e_${number.toLowerCase()}`;
  const price = options.difference === "even" ? SWEATER : options.difference === "refund_due" ? 49900 : 64900;
  try {
    await db`
      update commerce.stores set legal_name = 'Byttebutikken AS', organisation_number = '923456789', postal_address = 'Storgata 1, 0182 Oslo',
        contact_email = 'hei@byttebutikken.test', terms_at_checkout = ${options.termsCheckbox ? "checkbox" : "link"}
      where id = ${store.id}`;
    await db`
      insert into commerce.payment_providers (store_id, provider, enabled, active_mode) values (${store.id}, 'stripe', true, 'live')
      on conflict (store_id, provider) do update set enabled = true, active_mode = 'live'`;
    const stripeAccount = `acct_E2E${Date.now()}`;
    await db`
      insert into commerce.stripe_accounts (store_id, mode, account_id, card_payments, requirements_due)
      values (${store.id}, 'live', ${stripeAccount}, 'active', false)
      on conflict (store_id, mode) do update set account_id = ${stripeAccount}, card_payments = 'active', requirements_due = false`;
    const [account] = await db`select account_id from commerce.store_members where store_id = ${store.id} limit 1`;
    const variants = await db`
      select v.id, v.sku from commerce.product_variants v join commerce.products p on p.store_id = v.store_id and p.id = v.product_id
      where v.store_id = ${store.id} and p.kind = 'goods' and v.delivery = 'physical' and p.status = 'active' order by v.sku limit 2`;
    if (variants.length < 2) throw new Error("the store's catalogue has fewer than two goods variants");

    const address = db.json({ name: "Kari Nordmann", line1: "Storgata 5", line2: null, postalCode: "0182", city: "Oslo", country: "NO" });
    const [order] = await db`
      insert into commerce.orders (store_id, number, market_code, currency, locale, email, status, subtotal_minor, shipping_minor, discount_minor, tax_minor, total_minor,
        billing_address, shipping_address, shipping_tax_rate, return_cost_payer)
      values (${store.id}, ${number}, 'NO', 'NOK', 'nb-NO', 'kari@example.com', 'paid', ${SWEATER}, 0, 0, 11980, ${SWEATER}, ${address}, ${address}, 0.25, 'shopper')
      returning id`;
    const [line] = await db`
      insert into commerce.order_lines (store_id, order_id, variant_id, sku, title, quantity, unit_price_minor, discount_minor, total_minor, tax_minor, tax_rate, tax_code, delivery)
      values (${store.id}, ${order.id}, ${variants[0].id}, ${variants[0].sku}, 'Ullgenser – S', 1, ${SWEATER}, 0, ${SWEATER}, 11980, 0.25, 'txcd_99999999', 'physical')
      returning id`;
    await db`
      insert into commerce.payments (store_id, order_id, provider, provider_reference, provider_account, amount_minor, currency, status)
      values (${store.id}, ${order.id}, 'stripe', ${key}, ${stripeAccount}, ${SWEATER}, 'NOK', 'captured')`;

    const [ret] = await db`
      insert into commerce.returns (store_id, order_id, kind, status) values (${store.id}, ${order.id}, 'return', 'approved') returning id, number, public_token`;
    await db`
      insert into commerce.return_lines (store_id, return_id, order_line_id, quantity, decision) values (${store.id}, ${ret.id}, ${line.id}, 1, 'accept')`;

    const expiresAt = new Date(Date.now() + 5 * 86_400_000);
    let exchangeId = "";
    if (options.noProposal) {
      return { slug: store.slug, storeId: store.id, orderId: order.id, returnId: ret.id, exchangeId, token, returnToken: ret.public_token, number, returnNumber: ret.number };
    }
    // The proposal and its line in one transaction, as the server writes them (a proposal needs a line at commit).
    await db.begin(async (tx) => {
      const [x] = await tx`
        insert into commerce.return_exchanges (store_id, return_id, order_id, seq, status, currency, market_slug, shipping_kind, shipping_minor, delivery_address,
          credit_minor, total_minor, difference_minor, token_hash, expires_at, made_by)
        values (${store.id}, ${ret.id}, ${order.id}, 0, 'proposed', 'NOK', 'no', 'free', 0, ${tx.json({ name: "Kari Nordmann", street: "Storgata 5", postalCode: "0182", city: "Oslo", country: "NO" })},
          ${SWEATER}, ${price}, ${price - SWEATER}, ${hash}, ${expiresAt}, ${account.account_id})
        returning id`;
      exchangeId = x.id;
      await tx`
        insert into commerce.return_exchange_lines (store_id, exchange_id, n, variant_id, sku, title, quantity, list_price_minor, unit_price_minor)
        values (${store.id}, ${x.id}, 1, ${variants[1].id}, ${variants[1].sku}, 'Ullgenser – M', 1, ${Math.max(price, 64900)}, ${price})`;
    });
    if (options.state && options.state !== "proposed") await db`update commerce.return_exchanges set status = ${options.state} where id = ${exchangeId}`;
    return { slug: store.slug, storeId: store.id, orderId: order.id, returnId: ret.id, exchangeId, token, returnToken: ret.public_token, number, returnNumber: ret.number };
  } finally {
    await db.end();
  }
}

export type LabelFixture = { slug: string; storeId: string; returnToken: string; returnNumber: string };

/**
 * An approved voluntary return with a label booked with Bring (the columns a booking writes: carrier, service, numbers, the carrier's own label address, the cost),
 * the shopper paying return shipping (89,00 taken off). The label's fetch needs Bring and the store's agreement, which the end-to-end server has neither of, so the
 * route is held here only for its refusals; its answer with a faked carrier is `return-labels.int.test.ts` and the route's own unit test.
 */
export async function bookedLabelFixture(options: { test?: boolean; storePays?: boolean } = {}): Promise<LabelFixture> {
  const f = await exchangeFixture({ noProposal: true });
  const db = testDb();
  try {
    if (options.storePays) await db`update commerce.orders set return_cost_payer = 'store' where id = ${f.orderId}`;
    await db`
      update commerce.returns set label_source = 'carrier', label_carrier_id = 'bring', label_service = '9300', label_consignment_number = '70438101',
        label_tracking_number = '370438101', label_tracking_url = 'https://tracking.bring.com/tracking/370438101',
        label_carrier_url = 'https://api.bring.com/labels/e2e-unused.pdf', label_cost_minor = 8900,
        label_cost_carrier = ${db.json({ amountMinor: 8900, currency: "NOK", vatIncluded: true })}, label_test = ${options.test ?? false}, label_booked_at = now(),
        return_shipping_minor = ${options.storePays ? 0 : 8900}
      where id = ${f.returnId}`;
    return { slug: f.slug, storeId: f.storeId, returnToken: f.returnToken, returnNumber: f.returnNumber };
  } finally {
    await db.end();
  }
}

export async function exchangeStatus(id: string): Promise<{ status: string; confirmedBy: string | null; channel: string | null }> {
  const db = testDb();
  try {
    const [row] = await db`select status, confirmed_by, confirmed_channel from commerce.return_exchanges where id = ${id}`;
    return { status: row.status, confirmedBy: row.confirmed_by, channel: row.confirmed_channel };
  } finally {
    await db.end();
  }
}

export async function wishOf(returnId: string): Promise<{ at: Date | null; note: string | null }> {
  const db = testDb();
  try {
    const [row] = await db`select exchange_wish_at, exchange_wish_note from commerce.returns where id = ${returnId}`;
    return { at: row.exchange_wish_at, note: row.exchange_wish_note };
  } finally {
    await db.end();
  }
}

/** An approved voluntary return with no proposal yet: the status page offers the exchange wish. */
export async function wishFixture(): Promise<ExchangeFixture> {
  return exchangeFixture({ noProposal: true });
}
