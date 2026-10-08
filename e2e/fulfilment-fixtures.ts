import { createHash, randomBytes } from "node:crypto";

import { testDb, testStore } from "./db";

/**
 * Rows for the storefront's side of wave 3 run 3 (D174, `docs/wave-3-fulfilment.md` 5.3): a change's pay link (`order-change.spec.ts`) and an order sent in parcels
 * (`partial-shipment.spec.ts`). Staff's screens need a signed-in admin, which the end-to-end tests do not have, so the rows are written with SQL the way the server writes them:
 * a change under the edit context (`kaizen.order_edit`), its lines in the same transaction, and a paid change with its captured payment of exactly the difference (the database
 * checks that at commit); parcels with their lines (`shipment_lines`) and `commerce.refresh_fulfilment()` after each. Held elsewhere: the money, the webhook and the documents
 * (integration tests with the fake Stripe).
 */

const MARKETS = {
  NO: { slug: "no", currency: "NOK", locale: "nb-NO" },
  SE: { slug: "se", currency: "SEK", locale: "sv-SE" },
  DK: { slug: "dk", currency: "DKK", locale: "da-DK" },
} as const;

export type ChangeFixture = { slug: string; storeId: string; orderId: string; editId: string; token: string; number: string; key: string };

export type ChangeOptions = {
  /** `awaiting_payment` (the default), `applied` (paid), `cancelled` or `expired`: where the change is. */
  state?: "awaiting_payment" | "applied" | "cancelled" | "expired";
  /** The link ran out an hour ago, though the job has not marked the change. */
  lapsed?: boolean;
  /** Payments are switched off for the store. */
  paymentsOff?: boolean;
  /** The seller has no contact address. */
  noContact?: boolean;
  /** The market the order was placed in (the link opens only under its own country's address); Norway when left out. */
  market?: keyof typeof MARKETS;
};

/** Two sweaters at 625,00 and shipping of 99,00 (1 349,00 paid); the change takes one sweater off (−625,00) and adds two scarves at 387,00 (+774,00): 149,00 more to pay. */
export async function changeLink(options: ChangeOptions = {}): Promise<ChangeFixture> {
  const state = options.state ?? "awaiting_payment";
  const market = options.market ?? "NO";
  const m = MARKETS[market];
  const store = await testStore("endring", ["countries"]);
  const db = testDb();
  const token = randomBytes(32).toString("base64url");
  const hash = createHash("sha256").update(token).digest("base64url");
  const number = `EC-${Date.now().toString(36).toUpperCase()}`;
  const key = `cs_e2e_${number.toLowerCase()}`;
  try {
    await db`
      update commerce.stores set legal_name = 'Endringsbutikken AS', organisation_number = '923456789', postal_address = 'Storgata 1, 0182 Oslo',
        contact_email = ${options.noContact ? null : "hei@endringsbutikken.test"}
      where id = ${store.id}`;
    if (!options.paymentsOff) {
      // Live mode with an active account: payments are on without Kaizen's own Stripe keys, which the end-to-end server has none of.
      await db`
        insert into commerce.payment_providers (store_id, provider, enabled, active_mode) values (${store.id}, 'stripe', true, 'live')
        on conflict (store_id, provider) do update set enabled = true, active_mode = 'live'`;
      await db`
        insert into commerce.stripe_accounts (store_id, mode, account_id, card_payments, requirements_due)
        values (${store.id}, 'live', ${`acct_E2E${Date.now()}`}, 'active', false)
        on conflict (store_id, mode) do update set card_payments = 'active', requirements_due = false`;
    } else {
      await db`delete from commerce.payment_providers where store_id = ${store.id}`;
    }
    const [account] = await db`select account_id from commerce.store_members where store_id = ${store.id} limit 1`;
    // The added scarves are one of the store's own goods variants (an added line always names its variant).
    const [scarf] = await db`
      select v.id from commerce.product_variants v join commerce.products p on p.store_id = v.store_id and p.id = v.product_id
      where v.store_id = ${store.id} and p.kind = 'goods' and v.delivery = 'physical' order by v.sku limit 1`;

    const address = db.json({ name: "Kari Nordmann", line1: "Storgata 5", line2: null, postalCode: "0182", city: "Oslo", country: market });
    const [order] = await db`
      insert into commerce.orders (store_id, number, market_code, currency, locale, email, status, subtotal_minor, shipping_minor, discount_minor, tax_minor, total_minor,
        billing_address, shipping_address, shipping_tax_rate)
      values (${store.id}, ${number}, ${market}, ${m.currency}, ${m.locale}, 'kari@example.com', 'paid', 125000, 9900, 0, 26980, 134900, ${address}, ${address}, 0.25)
      returning id`;
    const [line] = await db`
      insert into commerce.order_lines (store_id, order_id, sku, title, quantity, unit_price_minor, discount_minor, total_minor, tax_minor, tax_rate, tax_code, delivery)
      values (${store.id}, ${order.id}, ${`E2E-${number}`}, 'Ullgenser', 2, 62500, 0, 125000, 25000, 0.25, 'txcd_99999999', 'physical')
      returning id`;
    await db`
      insert into commerce.payments (store_id, order_id, provider, provider_reference, amount_minor, currency, status)
      values (${store.id}, ${order.id}, 'stripe', ${key}, 134900, ${m.currency}, 'captured')`;

    const expiresAt = options.lapsed ? new Date(Date.now() - 3_600_000) : new Date(Date.now() + 5 * 86_400_000);
    let editId = "";
    // The change and its lines are written in one transaction, as the server writes them.
    await db.begin(async (tx) => {
      await tx`select set_config('kaizen.order_edit', ${order.id}, true)`;
      const [edit] = await tx`
        insert into commerce.order_edits (store_id, order_id, status, reason, notify, restock, currency, base, total_before, total_after, subtotal_delta, shipping_before,
          shipping_after, discount_delta, tax_delta, difference_minor, made_by, pay_token_hash, expires_at)
        values (${store.id}, ${order.id}, 'awaiting_payment', 'customer_request', true, true, ${m.currency}, ${tx.json({ lines: [] })}, 134900, 149800, 14900, 9900, 9900, 0, 2980, 14900,
          ${account.account_id}, ${hash}, ${expiresAt})
        returning id`;
      editId = edit.id;
      await tx`
        insert into commerce.order_edit_lines (store_id, order_edit_id, n, kind, order_line_id, variant_id, sku, title, quantity, unit_price_minor, list_price_minor, total_minor,
          discount_minor, tax_minor, tax_rate, parts, before)
        values
          (${store.id}, ${edit.id}, 1, 'reduce', ${line.id}, null, ${`E2E-${number}`}, 'Ullgenser', 1, 62500, null, 62500, 0, 12500, 0.25, ${tx.json({})},
            ${tx.json({ id: line.id, quantity: 2, unit_price_minor: 62500, total_minor: 125000, tax_minor: 25000 })}),
          (${store.id}, ${edit.id}, 2, 'add', null, ${scarf.id}, 'E2E-SCARF', 'Skjerf', 2, 38700, 38700, 77400, 0, 15480, 0.25, ${tx.json({})}, null)`;
    });
    if (state === "applied") {
      // Paid through the link: the payment of exactly the difference, the order as changed, and the change applied, in one transaction (the database checks the money at commit).
      await db.begin(async (tx) => {
        await tx`select set_config('kaizen.order_edit', ${order.id}, true)`;
        const [payment] = await tx`
          insert into commerce.payments (store_id, order_id, provider, provider_reference, amount_minor, currency, status, order_edit_id)
          values (${store.id}, ${order.id}, 'stripe', ${`${key}_edit`}, 14900, ${m.currency}, 'captured', ${editId})
          returning id`;
        await tx`update commerce.order_lines set quantity = 1, total_minor = 62500, tax_minor = 12500 where id = ${line.id}`;
        const [added] = await tx`
          insert into commerce.order_lines (store_id, order_id, variant_id, sku, title, quantity, unit_price_minor, discount_minor, total_minor, tax_minor, tax_rate, tax_code, delivery, order_edit_id)
          values (${store.id}, ${order.id}, ${scarf.id}, 'E2E-SCARF', 'Skjerf', 2, 38700, 0, 77400, 15480, 0.25, 'txcd_99999999', 'physical', ${editId})
          returning id`;
        await tx`update commerce.order_edit_lines set order_line_id = ${added.id} where order_edit_id = ${editId} and n = 2`;
        await tx`update commerce.orders set subtotal_minor = 139900, tax_minor = 29960, total_minor = 149800, edited_at = now() where id = ${order.id}`;
        await tx`update commerce.order_edits set status = 'applied', payment_id = ${payment.id} where id = ${editId}`;
      });
    }
    if (state === "cancelled" || state === "expired") await db`update commerce.order_edits set status = ${state} where id = ${editId}`;
    return { slug: store.slug, storeId: store.id, orderId: order.id, editId, token, number, key };
  } finally {
    await db.end();
  }
}

export type ParcelFixture = { slug: string; storeId: string; orderId: string; key: string; number: string; lines: { sweater: string; mug: string } };

/**
 * A paid order of 3 × Ullgenser and 2 × Krus in the store's own catalogue (physical lines with variants), with a captured payment the order page is opened with. No parcel yet:
 * `sendParcel()` records them.
 */
export async function paidGoodsOrder(market: keyof typeof MARKETS = "NO"): Promise<ParcelFixture> {
  const m = MARKETS[market];
  const store = await testStore("pakker", ["countries"]);
  const db = testDb();
  const number = `PS-${Date.now().toString(36).toUpperCase()}`;
  const key = `cs_e2e_${number.toLowerCase()}`;
  try {
    const variants = await db`
      select v.id, v.sku from commerce.product_variants v join commerce.products p on p.store_id = v.store_id and p.id = v.product_id
      where v.store_id = ${store.id} and p.kind = 'goods' and v.delivery = 'physical' order by v.sku limit 2`;
    if (variants.length < 2) throw new Error("the store's catalogue has fewer than two goods variants");
    const address = db.json({ name: "Kari Nordmann", line1: "Storgata 5", line2: null, postalCode: "0182", city: "Oslo", country: market });
    const [order] = await db`
      insert into commerce.orders (store_id, number, market_code, currency, locale, email, status, subtotal_minor, shipping_minor, discount_minor, tax_minor, total_minor,
        billing_address, shipping_address, shipping_tax_rate)
      values (${store.id}, ${number}, ${market}, ${m.currency}, ${m.locale}, 'kari@example.com', 'paid', 50000, 0, 0, 10000, 50000, ${address}, ${address}, 0.25)
      returning id`;
    const [sweater] = await db`
      insert into commerce.order_lines (store_id, order_id, variant_id, sku, title, quantity, unit_price_minor, discount_minor, total_minor, tax_minor, tax_rate, tax_code, delivery)
      values (${store.id}, ${order.id}, ${variants[0].id}, ${variants[0].sku}, 'Ullgenser', 3, 10000, 0, 30000, 6000, 0.25, 'txcd_99999999', 'physical')
      returning id`;
    const [mug] = await db`
      insert into commerce.order_lines (store_id, order_id, variant_id, sku, title, quantity, unit_price_minor, discount_minor, total_minor, tax_minor, tax_rate, tax_code, delivery)
      values (${store.id}, ${order.id}, ${variants[1].id}, ${variants[1].sku}, 'Krus', 2, 10000, 0, 20000, 4000, 0.25, 'txcd_99999999', 'physical')
      returning id`;
    await db`
      insert into commerce.payments (store_id, order_id, provider, provider_reference, amount_minor, currency, status)
      values (${store.id}, ${order.id}, 'stripe', ${key}, 50000, ${m.currency}, 'captured')`;
    return { slug: store.slug, storeId: store.id, orderId: order.id, key, number, lines: { sweater: sweater.id, mug: mug.id } };
  } finally {
    await db.end();
  }
}

/** One parcel of the order with these lines and quantities, as `markSent()` records it (the shipment, its lines, then the order's state), a day apart from the one before. */
export async function sendParcel(f: ParcelFixture, parcel: { carrier: string; tracking: string; url?: string | null; lines: { lineId: string; quantity: number }[]; daysAgo: number }) {
  const db = testDb();
  try {
    await db.begin(async (tx) => {
      const [shipment] = await tx`
        insert into commerce.shipments (store_id, order_id, carrier, tracking_number, tracking_url, created_at)
        values (${f.storeId}, ${f.orderId}, ${parcel.carrier}, ${parcel.tracking}, ${parcel.url ?? null}, now() - make_interval(days => ${parcel.daysAgo}))
        returning id`;
      for (const line of parcel.lines) {
        await tx`insert into commerce.shipment_lines (store_id, shipment_id, order_line_id, quantity) values (${f.storeId}, ${shipment.id}, ${line.lineId}, ${line.quantity})`;
      }
      await tx`select commerce.refresh_fulfilment(${f.storeId}::uuid, ${f.orderId}::uuid)`;
    });
  } finally {
    await db.end();
  }
}

/** The order's status, as the database has it. */
export async function orderStatus(orderId: string): Promise<string> {
  const db = testDb();
  try {
    const [row] = await db`select status from commerce.orders where id = ${orderId}`;
    return String(row.status);
  } finally {
    await db.end();
  }
}

/** The change's status, as the database has it. */
export async function changeStatus(editId: string): Promise<string> {
  const db = testDb();
  try {
    const [row] = await db`select status from commerce.order_edits where id = ${editId}`;
    return String(row.status);
  } finally {
    await db.end();
  }
}
