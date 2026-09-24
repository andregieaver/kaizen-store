import "server-only";

import { sql } from "drizzle-orm";
import type Stripe from "stripe";

import { db } from "@/db/client";
import { CHECKOUT_MINUTES, shippingCost, stripeLocale, vatIncluded } from "@/lib/checkout";
import type { Market } from "@/lib/markets";
import { marketPath } from "@/lib/paths";
import { variantLabel } from "@/lib/product-input";

import { getActiveStripeSecret } from "./settings";
import { stripeFor } from "./stripe";

type Row = Record<string, unknown>;

export type CheckoutShop = { storeId: string; storeSlug: string; market: Market };

export type PlacedOrder = {
  orderId: string;
  number: string;
  currency: string;
  lines: { title: string; unitPriceMinor: number; quantity: number }[];
  shippingMinor: number;
  totalMinor: number;
};

export type CheckoutProblem =
  | "empty"
  | "unavailable"
  | "stock"
  | "no_shipping"
  | "payments_off"
  | "payment_error"
  | "already_paid"
  | "processing";

export type PlaceResult = { ok: true; order: PlacedOrder } | { ok: false; problem: CheckoutProblem };

/**
 * Turns an open cart into an order waiting for payment, at today's prices,
 * and holds its stock for the length of a Stripe Checkout session. Stock is
 * checked under row locks, so two shoppers cannot both get the last item.
 * Nothing is written unless everything succeeds.
 */
export async function placeOrder(
  shop: Pick<CheckoutShop, "storeId" | "market">,
  cartId: string,
): Promise<PlaceResult> {
  const { storeId, market } = shop;
  return db().transaction(async (tx): Promise<PlaceResult> => {
    const [cart] = await tx.execute<Row>(sql`
      select id from commerce.carts
      where store_id = ${storeId}::uuid and id = ${cartId}::uuid and market_code = ${market.code}
        and status = 'open' and expires_at > now()
      for update
    `);
    if (!cart) return { ok: false, problem: "empty" };

    const lines = await tx.execute<Row>(sql`
      select
        cl.variant_id, cl.quantity, v.sku, v.options,
        coalesce(v.tax_code, p.tax_code) as tax_code, p.withdrawal_exclusion,
        coalesce(tl.title, tf.title, p.handle) as title,
        cp.amount_minor,
        (p.status = 'active' and v.active) as sellable
      from commerce.cart_lines cl
      join commerce.product_variants v on v.store_id = cl.store_id and v.id = cl.variant_id
      join commerce.products p on p.store_id = v.store_id and p.id = v.product_id
      left join commerce.product_translations tl on tl.product_id = p.id and tl.locale = ${market.locale}
      left join lateral (
        select title from commerce.product_translations where product_id = p.id order by locale limit 1
      ) tf on true
      left join commerce.current_prices cp on cp.variant_id = v.id and cp.market_code = ${market.code}
      where cl.store_id = ${storeId}::uuid and cl.cart_id = ${cartId}::uuid
      order by p.handle, v.sku
    `);
    if (lines.length === 0) return { ok: false, problem: "empty" };
    if (lines.some((l) => !l.sellable || l.amount_minor === null)) {
      return { ok: false, problem: "unavailable" };
    }

    // Lock the stock rows, then count what is free: on hand minus live holds.
    const variantIds = sql.join(
      lines.map((l) => sql`${String(l.variant_id)}::uuid`),
      sql`, `,
    );
    const levels = await tx.execute<Row>(sql`
      select l.variant_id, l.location_id, l.on_hand
      from commerce.inventory_levels l
      join commerce.inventory_locations loc on loc.id = l.location_id and loc.active
      where l.store_id = ${storeId}::uuid and l.variant_id in (${variantIds})
      order by loc.created_at
      for update of l
    `);
    const holds = await tx.execute<Row>(sql`
      select variant_id, location_id, sum(quantity)::int as held
      from commerce.inventory_reservations
      where store_id = ${storeId}::uuid and variant_id in (${variantIds})
        and released_at is null and expires_at > now()
      group by variant_id, location_id
    `);
    const heldAt = new Map(holds.map((h) => [`${h.variant_id}:${h.location_id}`, Number(h.held)]));

    const allocations: { variantId: string; locationId: string; quantity: number }[] = [];
    for (const line of lines) {
      let wanted = Number(line.quantity);
      for (const level of levels.filter((l) => l.variant_id === line.variant_id)) {
        const free = Number(level.on_hand) - (heldAt.get(`${level.variant_id}:${level.location_id}`) ?? 0);
        const take = Math.min(Math.max(free, 0), wanted);
        if (take > 0) {
          allocations.push({ variantId: String(line.variant_id), locationId: String(level.location_id), quantity: take });
          wanted -= take;
        }
      }
      if (wanted > 0) return { ok: false, problem: "stock" };
    }

    const [rate] = await tx.execute<Row>(sql`
      select amount_minor, free_over_minor from commerce.shipping_rates
      where store_id = ${storeId}::uuid and market_code = ${market.code}
    `);
    if (!rate) return { ok: false, problem: "no_shipping" };
    const [country] = await tx.execute<Row>(sql`
      select standard_vat_rate from commerce.countries where code = ${market.code}
    `);
    const vatRate = Number(country?.standard_vat_rate ?? 0);

    const priced = lines.map((line) => {
      const quantity = Number(line.quantity);
      const unit = Number(line.amount_minor);
      const options = (line.options ?? {}) as Record<string, string>;
      const title =
        Object.keys(options).length > 0 ? `${line.title} (${variantLabel(options)})` : String(line.title);
      return { line, quantity, unit, total: unit * quantity, title };
    });
    const subtotal = priced.reduce((sum, p) => sum + p.total, 0);
    const shipping = shippingCost(subtotal, {
      amountMinor: Number(rate.amount_minor),
      freeOverMinor: rate.free_over_minor === null ? null : Number(rate.free_over_minor),
    });
    const tax = priced.reduce((sum, p) => sum + vatIncluded(p.total, vatRate), 0) + vatIncluded(shipping, vatRate);
    const total = subtotal + shipping;

    const [numbered] = await tx.execute<Row>(sql`
      select s.prefix || commerce.next_document_number(${storeId}::uuid, 'order')::text as number
      from commerce.document_series s
      where s.store_id = ${storeId}::uuid and s.series = 'order'
    `);
    const [order] = await tx.execute<Row>(sql`
      insert into commerce.orders (
        store_id, number, market_code, currency, locale, cart_id, email, status,
        subtotal_minor, shipping_minor, discount_minor, tax_minor, total_minor,
        billing_address, shipping_address
      ) values (
        ${storeId}::uuid, ${String(numbered.number)}, ${market.code}, ${market.currency}, ${market.locale},
        ${cartId}::uuid, '', 'pending_payment',
        ${subtotal}, ${shipping}, 0, ${tax}, ${total}, '{}'::jsonb, '{}'::jsonb
      )
      returning id
    `);
    const orderId = String(order.id);

    for (const p of priced) {
      await tx.execute(sql`
        insert into commerce.order_lines (
          store_id, order_id, variant_id, sku, title, quantity, unit_price_minor, discount_minor,
          total_minor, tax_minor, tax_rate, tax_code, withdrawal_exclusion
        ) values (
          ${storeId}::uuid, ${orderId}::uuid, ${String(p.line.variant_id)}::uuid, ${String(p.line.sku)},
          ${p.title}, ${p.quantity}, ${p.unit}, 0, ${p.total}, ${vatIncluded(p.total, vatRate)},
          ${vatRate}, ${String(p.line.tax_code)}, ${String(p.line.withdrawal_exclusion)}
        )
      `);
    }
    for (const a of allocations) {
      await tx.execute(sql`
        insert into commerce.inventory_reservations (store_id, variant_id, location_id, quantity, order_id, expires_at)
        values (${storeId}::uuid, ${a.variantId}::uuid, ${a.locationId}::uuid, ${a.quantity}, ${orderId}::uuid,
                now() + make_interval(mins => ${CHECKOUT_MINUTES + 5}))
      `);
    }
    await tx.execute(sql`
      insert into commerce.order_events (store_id, order_id, type, data, actor)
      values (${storeId}::uuid, ${orderId}::uuid, 'order.placed', '{}'::jsonb, 'shopper')
    `);

    return {
      ok: true,
      order: {
        orderId,
        number: String(numbered.number),
        currency: market.currency,
        lines: priced.map((p) => ({ title: p.title, unitPriceMinor: p.unit, quantity: p.quantity })),
        shippingMinor: shipping,
        totalMinor: total,
      },
    };
  });
}

/** Cancels an unpaid order and releases its stock. */
export async function cancelUnpaidOrder(orderId: string, reason: string): Promise<boolean> {
  const [row] = await db().execute<Row>(sql`
    select commerce.cancel_unpaid_order(${orderId}::uuid, ${reason}) as cancelled
  `);
  return Boolean(row?.cancelled);
}

/** Marks an order paid and draws its items from stock. False if it already was. */
export async function completeOrderPayment(orderId: string, reference: string): Promise<boolean> {
  const [row] = await db().execute<Row>(sql`
    select commerce.complete_order_payment(${orderId}::uuid, ${reference}) as completed
  `);
  return Boolean(row?.completed);
}

export type CheckoutStart = { ok: true; url: string } | { ok: false; problem: CheckoutProblem; orderId?: string };

/**
 * From cart to Stripe: closes any earlier unpaid checkout for the same cart,
 * places the order, and opens a Stripe Checkout session for it.
 */
export async function startCheckout(
  shop: CheckoutShop,
  cartId: string,
  origin: string,
  shippingLabel: string,
): Promise<CheckoutStart> {
  const stripeKeys = await getActiveStripeSecret(shop.storeId);
  if (!stripeKeys) return { ok: false, problem: "payments_off" };
  const stripe = stripeFor(stripeKeys.secretKey);

  // A shopper who went back from Stripe and checks out again: the earlier
  // session is closed first, so the same basket cannot be paid twice.
  const earlier = await db().execute<Row>(sql`
    select o.id, pay.provider_reference
    from commerce.orders o
    left join commerce.payments pay on pay.order_id = o.id and pay.provider = 'stripe'
    where o.store_id = ${shop.storeId}::uuid and o.cart_id = ${cartId}::uuid and o.status = 'pending_payment'
  `);
  for (const row of earlier) {
    const orderId = String(row.id);
    if (row.provider_reference) {
      const outcome = await closeSession(stripe, String(row.provider_reference));
      if (outcome === "paid") {
        await completeOrderPayment(orderId, String(row.provider_reference));
        return { ok: false, problem: "already_paid", orderId };
      }
      if (outcome === "processing") return { ok: false, problem: "processing", orderId };
    }
    await cancelUnpaidOrder(orderId, "replaced by a new checkout");
  }

  const placed = await placeOrder(shop, cartId);
  if (!placed.ok) return placed;
  const { order } = placed;

  const methods = await db().execute<Row>(sql`
    select method from commerce.payment_methods
    where store_id = ${shop.storeId}::uuid and market_code = ${shop.market.code} and enabled
  `);
  const base = `${origin}${marketPath(shop.storeSlug, shop.market.slug)}`;
  const currency = order.currency.toLowerCase();

  let session: Stripe.Checkout.Session;
  try {
    session = await stripe.checkout.sessions.create(
      {
        mode: "payment",
        client_reference_id: order.orderId,
        metadata: { order_id: order.orderId, store_id: shop.storeId },
        payment_intent_data: { metadata: { order_id: order.orderId, store_id: shop.storeId } },
        line_items: order.lines.map((line) => ({
          quantity: line.quantity,
          price_data: { currency, unit_amount: line.unitPriceMinor, product_data: { name: line.title } },
        })),
        shipping_options: [
          {
            shipping_rate_data: {
              type: "fixed_amount",
              display_name: shippingLabel,
              fixed_amount: { amount: order.shippingMinor, currency },
            },
          },
        ],
        shipping_address_collection: {
          allowed_countries: [shop.market.code as Stripe.Checkout.SessionCreateParams.ShippingAddressCollection.AllowedCountry],
        },
        ...(methods.length > 0 && {
          payment_method_types: methods.map(
            (m) => String(m.method) as Stripe.Checkout.SessionCreateParams.PaymentMethodType,
          ),
        }),
        locale: stripeLocale(shop.market.lang) as Stripe.Checkout.SessionCreateParams.Locale,
        success_url: `${base}/order/${order.orderId}?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${base}/cart`,
        expires_at: Math.floor(Date.now() / 1000) + CHECKOUT_MINUTES * 60 + 60,
      },
      { idempotencyKey: `checkout-${order.orderId}` },
    );
  } catch {
    await cancelUnpaidOrder(order.orderId, "stripe session could not be created");
    return { ok: false, problem: "payment_error" };
  }

  await db().execute(sql`
    insert into commerce.payments (store_id, order_id, provider, provider_reference, amount_minor, currency, status)
    values (${shop.storeId}::uuid, ${order.orderId}::uuid, 'stripe', ${session.id}, ${order.totalMinor},
            ${order.currency}, 'pending')
  `);
  if (!session.url) return { ok: false, problem: "payment_error" };
  return { ok: true, url: session.url };
}

/**
 * Expires an open Stripe session. Reports "paid" if it was paid meanwhile,
 * and "processing" if the shopper finished but the payment (e.g. a bank
 * transfer) has not arrived yet: that order must not be replaced.
 */
async function closeSession(
  stripe: Stripe,
  sessionId: string,
): Promise<"closed" | "paid" | "processing"> {
  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (session.status === "complete") return session.payment_status === "unpaid" ? "processing" : "paid";
    if (session.status === "open") await stripe.checkout.sessions.expire(sessionId);
  } catch {
    // An unknown or already expired session is closed either way.
  }
  return "closed";
}
