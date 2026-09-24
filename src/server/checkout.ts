import "server-only";

import { sql } from "drizzle-orm";
import { after } from "next/server";
import type Stripe from "stripe";

import { db } from "@/db/client";
import { CHECKOUT_MINUTES, lineWithdrawal, stripeLocale, vatIncluded } from "@/lib/checkout";
import type { Market } from "@/lib/markets";
import { formatMoney } from "@/lib/money";
import { marketPath } from "@/lib/paths";
import { t } from "@/lib/i18n";
import { GENERAL_TAX_CODE, variantLabel, type Delivery } from "@/lib/product-input";
import { applyDiscount } from "@/lib/discounts";
import { basketShipping, planPrice, sameRhythm, type PlanInterval } from "@/lib/subscriptions";

import { saleFee, type PaymentModeName } from "@/lib/stripe-account";

import { storeFeeBps } from "./billing";
import { ensurePaymentDomain, ensureStorePaymentMethods, ensureTestAccount, getCheckoutUi } from "./connect";
import { findUsableDiscount } from "./discounts";
import { getCheckoutAccount } from "./settings";
import { ensureSubscriptionEvents } from "./subscriptions";
import { platformStripe } from "./stripe";

type Row = Record<string, unknown>;

export type CheckoutShop = { storeId: string; storeSlug: string; market: Market };

export type PlacedOrder = {
  orderId: string;
  number: string;
  currency: string;
  lines: { title: string; unitPriceMinor: number; quantity: number; recurring: boolean }[];
  /** Something to ship: false for downloads only (D24). */
  ships: boolean;
  /** The subscription this order starts (D25): how often it renews, and its shipping each time. */
  subscription: {
    id: string;
    interval: PlanInterval;
    intervalCount: number;
    /** Days free before Stripe first charges what renews (D29). */
    trialDays: number;
    shippingMinor: number;
  } | null;
  /** Shipping before any discount code, and what the code takes off it (D31). */
  shippingMinor: number;
  shippingDiscountMinor: number;
  /** The VAT included in the total. */
  taxMinor: number;
  totalMinor: number;
  /** The discount code, and what Stripe takes off as a one-time coupon. */
  discount: { code: string; couponMinor: number } | null;
};

export type CheckoutProblem =
  | "empty"
  | "unavailable"
  | "stock"
  | "no_shipping"
  | "payments_off"
  | "payment_error"
  | "already_paid"
  | "processing"
  | "consent"
  | "subscription_consent"
  | "discount"
  | "plans";

export type PlaceResult = { ok: true; order: PlacedOrder } | { ok: false; problem: CheckoutProblem };

/**
 * What the shopper agreed to on the way to payment. Downloads start at once,
 * so buying one needs the shopper's express consent to that and their
 * acknowledgement that the right of withdrawal then ends (D24).
 */
export type CheckoutConsent = { digital?: boolean; subscription?: boolean };

/**
 * Turns an open cart into an order waiting for payment, at today's prices,
 * and holds its stock for the length of a Stripe Checkout session. Stock is
 * checked under row locks, so two shoppers cannot both get the last item.
 * Downloads need no stock and no shipping. Nothing is written unless
 * everything succeeds.
 */
export async function placeOrder(
  shop: Pick<CheckoutShop, "storeId" | "market">,
  cartId: string,
  consent: CheckoutConsent = {},
  { customerId = null }: { customerId?: string | null } = {},
): Promise<PlaceResult> {
  const { storeId, market } = shop;
  return db().transaction(async (tx): Promise<PlaceResult> => {
    const [cart] = await tx.execute<Row>(sql`
      select id, discount_code from commerce.carts
      where store_id = ${storeId}::uuid and id = ${cartId}::uuid and market_code = ${market.code}
        and status = 'open' and expires_at > now()
      for update
    `);
    if (!cart) return { ok: false, problem: "empty" };

    const lines = await tx.execute<Row>(sql`
      select
        cl.variant_id, cl.quantity, v.sku, v.options, v.delivery, p.id as product_id,
        cl.selling_plan_id, sp.interval, sp.interval_count, sp.discount_percent, sp.trial_days, sp.min_cycles,
        coalesce((sp.signup_fee ->> ${market.code})::bigint, 0) as signup_fee,
        (case when cl.selling_plan_id is null then not p.subscription_only else coalesce(sp.active, false) end) as plan_ok,
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
      left join commerce.selling_plans sp
        on sp.store_id = cl.store_id and sp.id = cl.selling_plan_id and sp.product_id = p.id
      where cl.store_id = ${storeId}::uuid and cl.cart_id = ${cartId}::uuid
      order by p.handle, v.sku, cl.selling_plan_id nulls first
    `);
    if (lines.length === 0) return { ok: false, problem: "empty" };
    if (lines.some((l) => !l.sellable || !l.plan_ok || l.amount_minor === null)) {
      return { ok: false, problem: "unavailable" };
    }
    // One checkout starts at most one subscription, renewing on one schedule (D25).
    const planned = lines.filter((l) => l.selling_plan_id !== null);
    const termsOf = (l: Row) => ({
      interval: l.interval as PlanInterval,
      intervalCount: Number(l.interval_count),
      trialDays: Number(l.trial_days),
    });
    const rhythm = planned[0] && termsOf(planned[0]);
    if (rhythm && planned.some((l) => !sameRhythm(rhythm, termsOf(l)))) {
      return { ok: false, problem: "plans" };
    }
    // In a free trial, what renews costs nothing now (D29); commitments take the longest option's.
    const trial = Boolean(rhythm && rhythm.trialDays > 0);
    const minCycles = Math.max(0, ...planned.map((l) => Number(l.min_cycles)));
    if (rhythm && !consent.subscription) return { ok: false, problem: "subscription_consent" };
    const physical = lines.filter((l) => l.delivery === "physical");
    const digital = physical.length < lines.length;
    if (digital && !consent.digital) return { ok: false, problem: "consent" };

    // Lock the stock rows, then count what is free: on hand minus live holds.
    const variantIds = sql.join(
      [sql`null::uuid`, ...physical.map((l) => sql`${String(l.variant_id)}::uuid`)],
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
    // The same variant can be bought once and subscribed to: count it together.
    const wantedByVariant = new Map<string, number>();
    for (const line of physical) {
      const id = String(line.variant_id);
      wantedByVariant.set(id, (wantedByVariant.get(id) ?? 0) + Number(line.quantity));
    }
    for (const [variantId, quantity] of wantedByVariant) {
      const line = { variant_id: variantId };
      let wanted = quantity;
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
    const ships = physical.length > 0;
    if (ships && !rate) return { ok: false, problem: "no_shipping" };
    const [country] = await tx.execute<Row>(sql`
      select standard_vat_rate from commerce.countries where code = ${market.code}
    `);
    const vatRate = Number(country?.standard_vat_rate ?? 0);

    const priced = lines.map((line) => {
      const quantity = Number(line.quantity);
      const recurring = line.selling_plan_id !== null;
      // The subscriber's price on each renewal, and what is charged now.
      const renewUnit = planPrice(Number(line.amount_minor), recurring ? Number(line.discount_percent) : 0);
      const unit = recurring && trial ? 0 : renewUnit;
      const options = (line.options ?? {}) as Record<string, string>;
      const title =
        Object.keys(options).length > 0 ? `${line.title} (${variantLabel(options)})` : String(line.title);
      const delivery: Delivery = line.delivery === "digital" ? "digital" : "physical";
      return { line, quantity, unit, renewUnit, discount: 0, total: unit * quantity, title, recurring, delivery };
    });
    // One sign-up fee per purchase option, charged now with the first order (D29).
    const fees = [
      ...new Map(
        planned
          .filter((l) => Number(l.signup_fee) > 0)
          .map((l) => [String(l.selling_plan_id), { planId: String(l.selling_plan_id), amount: Number(l.signup_fee), title: String(l.title) }]),
      ).values(),
    ];
    const feeTotal = fees.reduce((sum, fee) => sum + fee.amount, 0);
    // Before any discount code: what the items and fees come to.
    const subtotal = priced.reduce((sum, p) => sum + p.unit * p.quantity, 0) + feeTotal;
    const shippingRate = rate
      ? {
          amountMinor: Number(rate.amount_minor),
          freeOverMinor: rate.free_over_minor === null ? null : Number(rate.free_over_minor),
        }
      : null;
    // Free shipping counts the whole basket, downloads included; a
    // subscription pays shipping on each delivery (D25).
    const shippingFor = () =>
      basketShipping(
        priced.map((p) => ({ totalMinor: p.renewUnit * p.quantity, delivery: p.delivery, recurring: p.recurring })),
        shippingRate,
        { trial },
      );
    let basket = shippingFor();

    // The cart's discount code (D31), checked again here under a lock, so
    // two checkouts cannot both take a code's last use.
    let discount: { id: string; code: string } | null = null;
    let shippingDiscount = 0;
    const lowered = new Set<number>();
    if (cart.discount_code) {
      const found = await findUsableDiscount(tx, storeId, String(cart.discount_code), {
        market,
        customerId,
        lock: true,
      });
      const result = found.ok
        ? applyDiscount(found.discount, {
            marketCode: market.code,
            lines: priced.map((p, i) => ({
              key: String(i),
              productId: String(p.line.product_id),
              unitMinor: p.renewUnit,
              quantity: p.quantity,
              todayMinor: p.total,
              recurring: p.recurring,
            })),
            shippingMinor: basket.first,
          })
        : null;
      if (!found.ok || !result?.ok) return { ok: false, problem: "discount" };
      const { applied } = result;
      priced.forEach((p, i) => {
        // A recurring percentage lowers the subscriber's price for good.
        const renewal = applied.renewalUnits[String(i)];
        if (renewal !== undefined) {
          p.renewUnit = renewal;
          lowered.add(i);
        }
        p.discount = applied.lines[String(i)] ?? 0;
        p.total = p.unit * p.quantity - p.discount;
      });
      if (lowered.size > 0) basket = shippingFor();
      shippingDiscount = applied.shippingMinor;
      discount = { id: found.discount.id, code: found.discount.code };
    }
    const shipping = basket.first;
    const discountTotal = priced.reduce((sum, p) => sum + p.discount, 0) + shippingDiscount;
    const tax =
      priced.reduce((sum, p) => sum + vatIncluded(p.total, vatRate), 0) +
      fees.reduce((sum, fee) => sum + vatIncluded(fee.amount, vatRate), 0) +
      vatIncluded(shipping - shippingDiscount, vatRate);
    const total = subtotal + shipping - discountTotal;

    const [numbered] = await tx.execute<Row>(sql`
      select s.prefix || commerce.next_document_number(${storeId}::uuid, 'order')::text as number
      from commerce.document_series s
      where s.store_id = ${storeId}::uuid and s.series = 'order'
    `);
    const [order] = await tx.execute<Row>(sql`
      insert into commerce.orders (
        store_id, number, market_code, currency, locale, cart_id, email, status,
        subtotal_minor, shipping_minor, discount_minor, tax_minor, total_minor,
        billing_address, shipping_address, digital_consent_at, customer_id, discount_code_id, discount_code
      ) values (
        ${storeId}::uuid, ${String(numbered.number)}, ${market.code}, ${market.currency}, ${market.locale},
        ${cartId}::uuid, '', 'pending_payment',
        ${subtotal}, ${shipping}, ${discountTotal}, ${tax}, ${total}, '{}'::jsonb, '{}'::jsonb,
        ${digital ? sql`now()` : sql`null`}, ${customerId}::uuid, ${discount?.id ?? null}::uuid, ${discount?.code ?? null}
      )
      returning id
    `);
    const orderId = String(order.id);

    for (const p of priced) {
      await tx.execute(sql`
        insert into commerce.order_lines (
          store_id, order_id, variant_id, sku, title, quantity, unit_price_minor, discount_minor,
          total_minor, tax_minor, tax_rate, tax_code, withdrawal_exclusion, delivery,
          selling_plan_id, plan_interval, plan_interval_count
        ) values (
          ${storeId}::uuid, ${orderId}::uuid, ${String(p.line.variant_id)}::uuid, ${String(p.line.sku)},
          ${p.title}, ${p.quantity}, ${p.unit}, ${p.discount}, ${p.total}, ${vatIncluded(p.total, vatRate)},
          ${vatRate}, ${String(p.line.tax_code)},
          ${lineWithdrawal(p.delivery, String(p.line.withdrawal_exclusion))}, ${p.delivery},
          ${p.recurring ? String(p.line.selling_plan_id) : null}::uuid,
          ${p.recurring ? String(p.line.interval) : null}::commerce.plan_interval,
          ${p.recurring ? Number(p.line.interval_count) : null}
        )
      `);
    }

    const feeTitle = t(market.lang).signupFee;
    for (const fee of fees) {
      await tx.execute(sql`
        insert into commerce.order_lines (
          store_id, order_id, variant_id, sku, title, quantity, unit_price_minor, discount_minor,
          total_minor, tax_minor, tax_rate, tax_code, withdrawal_exclusion, delivery, selling_plan_id
        ) values (
          ${storeId}::uuid, ${orderId}::uuid, null, 'SIGNUP-FEE', ${`${feeTitle}: ${fee.title}`}, 1, ${fee.amount}, 0,
          ${fee.amount}, ${vatIncluded(fee.amount, vatRate)}, ${vatRate}, ${GENERAL_TAX_CODE}, 'none', 'digital',
          ${fee.planId}::uuid
        )
      `);
    }

    // The subscription waits for the first payment, with what each renewal holds.
    let subscription: PlacedOrder["subscription"] = null;
    if (rhythm) {
      const renewing = priced.filter((p) => p.recurring);
      const renewalSubtotal = renewing.reduce((sum, p) => sum + p.renewUnit * p.quantity, 0);
      const renewalTax =
        renewing.reduce((sum, p) => sum + vatIncluded(p.renewUnit * p.quantity, vatRate), 0) + vatIncluded(basket.renewal, vatRate);
      const [row] = await tx.execute<Row>(sql`
        insert into commerce.subscriptions (
          store_id, number, market_code, currency, locale, interval, interval_count, min_cycles,
          subtotal_minor, shipping_minor, total_minor, tax_minor, first_order_id, manage_token
        ) values (
          ${storeId}::uuid, ${String(numbered.number)}, ${market.code}, ${market.currency}, ${market.locale},
          ${rhythm.interval}, ${rhythm.intervalCount}, ${minCycles}, ${renewalSubtotal}, ${basket.renewal},
          ${renewalSubtotal + basket.renewal}, ${renewalTax}, ${orderId}::uuid,
          replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')
        )
        returning id
      `);
      const subscriptionId = String(row.id);
      for (const p of renewing) {
        await tx.execute(sql`
          insert into commerce.subscription_lines (
            store_id, subscription_id, variant_id, selling_plan_id, sku, title, quantity,
            unit_price_minor, total_minor, tax_rate, tax_code, delivery
          ) values (
            ${storeId}::uuid, ${subscriptionId}::uuid, ${String(p.line.variant_id)}::uuid,
            ${String(p.line.selling_plan_id)}::uuid, ${String(p.line.sku)}, ${p.title}, ${p.quantity},
            ${p.renewUnit}, ${p.renewUnit * p.quantity}, ${vatRate}, ${String(p.line.tax_code)}, ${p.delivery}
          )
        `);
      }
      await tx.execute(sql`
        update commerce.orders set subscription_id = ${subscriptionId}::uuid
        where store_id = ${storeId}::uuid and id = ${orderId}::uuid
      `);
      subscription = { id: subscriptionId, ...rhythm, shippingMinor: basket.renewal };
    }
    for (const a of allocations) {
      await tx.execute(sql`
        insert into commerce.inventory_reservations (store_id, variant_id, location_id, quantity, order_id, expires_at)
        values (${storeId}::uuid, ${a.variantId}::uuid, ${a.locationId}::uuid, ${a.quantity}, ${orderId}::uuid,
                now() + make_interval(mins => ${CHECKOUT_MINUTES + 5}))
      `);
    }
    // The consent is kept with the order as evidence (D24).
    await tx.execute(sql`
      insert into commerce.order_events (store_id, order_id, type, data, actor)
      values (${storeId}::uuid, ${orderId}::uuid, 'order.placed',
              ${JSON.stringify({ ...(digital && { digitalConsent: true }), ...(rhythm && { subscriptionConsent: true }) })}::jsonb,
              'shopper')
    `);

    return {
      ok: true,
      order: {
        orderId,
        number: String(numbered.number),
        currency: market.currency,
        lines: [
          ...priced.map((p) => ({
            title: p.title,
            // What renews is charged at its full price by Stripe, after any free trial.
            unitPriceMinor: p.recurring ? p.renewUnit : p.unit,
            quantity: p.quantity,
            recurring: p.recurring,
          })),
          ...fees.map((fee) => ({
            title: `${feeTitle}: ${fee.title}`,
            unitPriceMinor: fee.amount,
            quantity: 1,
            recurring: false,
          })),
        ],
        ships,
        subscription,
        shippingMinor: shipping,
        shippingDiscountMinor: shippingDiscount,
        taxMinor: tax,
        totalMinor: total,
        // Stripe takes it as a one-time coupon: everything off today that is
        // not already in a lowered subscriber's price. In a subscription,
        // shipping is a line, so free shipping is in the coupon too.
        discount: discount && {
          code: discount.code,
          couponMinor:
            priced.reduce((sum, p, i) => sum + (lowered.has(i) ? 0 : p.discount), 0) +
            (rhythm ? shippingDiscount : 0),
        },
      },
    };
  });
}

/** How often a subscription's lines renew, as Stripe takes it. */
function recurring(plan: { interval: PlanInterval; intervalCount: number }) {
  return { interval: plan.interval, interval_count: plan.intervalCount };
}

/**
 * Shipping as lines of a subscription checkout, which takes no shipping
 * options: what renews with each delivery, and what the first delivery
 * costs on top (items bought once when the subscription itself ships nothing).
 */
export function subscriptionShipping(
  order: Pick<PlacedOrder, "subscription" | "shippingMinor">,
  currency: string,
  label: string,
): Stripe.Checkout.SessionCreateParams.LineItem[] {
  if (!order.subscription) return [];
  const renewing = order.subscription.shippingMinor;
  // In a free trial, the renewing line is not charged now (D29).
  const once = order.shippingMinor - (order.subscription.trialDays > 0 ? 0 : renewing);
  const line = (amount: number, renews: boolean) => ({
    quantity: 1,
    price_data: {
      currency,
      unit_amount: amount,
      product_data: { name: label },
      ...(renews && order.subscription && { recurring: recurring(order.subscription) }),
    },
  });
  return [...(renewing > 0 ? [line(renewing, true)] : []), ...(once > 0 ? [line(once, false)] : [])];
}

/** Cancels an unpaid order and releases its stock. */
export async function cancelUnpaidOrder(orderId: string, reason: string): Promise<boolean> {
  const [row] = await db().execute<Row>(sql`
    select commerce.cancel_unpaid_order(${orderId}::uuid, ${reason}) as cancelled
  `);
  // A subscription that never got its first payment never started (D25).
  await db().execute(sql`
    update commerce.subscriptions set status = 'expired', updated_at = now()
    where first_order_id = ${orderId}::uuid and status = 'pending'
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

/** Tags Kaizen's storefront sessions in the Stripe Dashboard (Stripe asks for 8 random letters). */
const INTEGRATION_IDENTIFIER = "kaizen-storefront-qhwmzrtd";

/** "Of which VAT" on the order invoice, in the shopper's language. */
const VAT_LABELS: Record<string, string> = { nb: "Herav mva", sv: "Varav moms", da: "Heraf moms" };

/**
 * From cart to payment: closes any earlier unpaid checkout for the same
 * cart, places the order, and opens a Stripe Checkout session for it on the
 * store's own Stripe account (a direct charge: the store is the seller, and
 * Kaizen's fee, if any, is taken as an application fee). The shopper then
 * pays on Kaizen's checkout page with Stripe's form (D22), or on Stripe's
 * own page when the platform is switched to that fallback. The returned
 * address is where to send the shopper.
 */
export async function startCheckout(
  shop: CheckoutShop,
  cartId: string,
  origin: string,
  shippingLabel: string,
  consent: CheckoutConsent = {},
  { customerId = null }: { customerId?: string | null } = {},
): Promise<CheckoutStart> {
  const found = await getCheckoutAccount(shop.storeId);
  const stripe = found && platformStripe(found.mode);
  if (!found || !stripe) return { ok: false, problem: "payments_off" };
  let accountId = found.accountId;
  if (!accountId) {
    // Test mode, and the store's test account was not ready when last
    // seen: ask Stripe again, as it checks Kaizen's test values within a
    // minute or two (the account is made when the owner opens the admin).
    const test = await ensureTestAccount(shop.storeId);
    if (!test.ok || !test.ready) return { ok: false, problem: "payments_off" };
    accountId = test.accountId;
  }
  const connection = { ...found, accountId };
  const ui = await getCheckoutUi();
  // Payment methods added since the account was made, for the next shopper (D23).
  try {
    after(() => ensureStorePaymentMethods(shop.storeId));
  } catch {
    // Not in a request (scripts, tests).
  }

  // A shopper who went back from Stripe and checks out again: the earlier
  // session is closed first, so the same basket cannot be paid twice.
  const earlier = await db().execute<Row>(sql`
    select o.id, pay.provider_reference, pay.provider_account
    from commerce.orders o
    left join commerce.payments pay on pay.order_id = o.id and pay.provider = 'stripe'
    where o.store_id = ${shop.storeId}::uuid and o.cart_id = ${cartId}::uuid and o.status = 'pending_payment'
  `);
  for (const row of earlier) {
    const orderId = String(row.id);
    if (row.provider_reference && row.provider_account) {
      const outcome = await closeSession(stripe, String(row.provider_account), String(row.provider_reference));
      if (outcome === "paid") {
        await completeOrderPayment(orderId, String(row.provider_reference));
        return { ok: false, problem: "already_paid", orderId };
      }
      if (outcome === "processing") return { ok: false, problem: "processing", orderId };
    }
    await cancelUnpaidOrder(orderId, "replaced by a new checkout");
  }

  const placed = await placeOrder(shop, cartId, consent, { customerId });
  if (!placed.ok) return placed;
  const { order } = placed;
  // Renewals arrive as webhook events that older platform webhooks were not sent (D25).
  if (order.subscription) await ensureSubscriptionEvents(connection.mode);

  const [store] = await db().execute<Row>(sql`
    select legal_name, organisation_number from commerce.stores where id = ${shop.storeId}::uuid
  `);
  const feeBps = await storeFeeBps(shop.storeId);
  const fee = saleFee(order.totalMinor, feeBps);
  const base = `${origin}${marketPath(shop.storeSlug, shop.market.slug)}`;
  const currency = order.currency.toLowerCase();
  const metadata = { order_id: order.orderId, order_number: order.number, store_id: shop.storeId };
  const seller = [store?.legal_name, store?.organisation_number && `Org.nr. ${store.organisation_number}`]
    .filter(Boolean)
    .join(" · ");
  const returnUrl = `${base}/order/${order.orderId}?session_id={CHECKOUT_SESSION_ID}`;
  // Wallets, Link and Klarna show in Stripe's form only on registered domains.
  if (ui === "custom" && origin.startsWith("https://")) {
    await ensurePaymentDomain(shop.storeId, connection.mode, connection.accountId, new URL(origin).hostname);
  }

  let session: Stripe.Checkout.Session;
  try {
    // A discount code (D31) reaches Stripe as a coupon for this checkout alone.
    const coupon =
      order.discount && order.discount.couponMinor > 0
        ? await stripe.coupons.create(
            {
              amount_off: order.discount.couponMinor,
              currency,
              duration: "once",
              max_redemptions: 1,
              name: order.discount.code.slice(0, 40),
              metadata,
            },
            { stripeAccount: connection.accountId, idempotencyKey: `coupon-${order.orderId}` },
          )
        : null;
    session = await stripe.checkout.sessions.create(
      {
        client_reference_id: order.orderId,
        metadata,
        ...(coupon && { discounts: [{ coupon: coupon.id }] }),
        integration_identifier: INTEGRATION_IDENTIFIER,
        line_items: [
          ...order.lines.map((line) => ({
            quantity: line.quantity,
            price_data: {
              currency,
              unit_amount: line.unitPriceMinor,
              product_data: { name: line.title },
              ...(line.recurring && order.subscription && { recurring: recurring(order.subscription) }),
            },
          })),
          ...subscriptionShipping(order, currency, shippingLabel),
        ],
        ...(order.subscription
          ? // A subscription (D25): Stripe Billing on the store's account charges
            // each renewal. Shipping can only be a line here: the part that
            // renews, and any extra for items bought once.
            {
              mode: "subscription" as const,
              subscription_data: {
                metadata: { ...metadata, subscription_id: order.subscription.id },
                description: `Subscription ${order.number}`,
                ...(order.subscription.trialDays > 0 && { trial_period_days: order.subscription.trialDays }),
                ...(feeBps > 0 && { application_fee_percent: Math.round(feeBps) / 100 }),
              },
            }
          : {
              mode: "payment" as const,
              payment_intent_data: {
                metadata,
                description: `Order ${order.number}`,
                ...(fee !== null && { application_fee_amount: fee }),
              },
            }),
        ...(order.ships && {
          shipping_address_collection: {
            allowed_countries: [
              shop.market.code as Stripe.Checkout.SessionCreateParams.ShippingAddressCollection.AllowedCountry,
            ],
          },
        }),
        // Downloads only: no address to ask for and nothing to ship (D24).
        ...(order.ships &&
          !order.subscription && {
            shipping_options: [
              {
                shipping_rate_data: {
                  type: "fixed_amount",
                  display_name: shippingLabel,
                  fixed_amount: { amount: order.shippingMinor - order.shippingDiscountMinor, currency },
                },
              },
            ],
          }),
        // No payment_method_types: Stripe shows the methods the store has
        // turned on in its Stripe Dashboard that suit the shopper.
        // Subscriptions always get Stripe invoices; this is for single payments.
        ...(connection.orderInvoices &&
          !order.subscription && {
          invoice_creation: {
            enabled: true,
            invoice_data: {
              description: `Order ${order.number}`,
              metadata,
              ...(seller && { footer: seller }),
              custom_fields: [
                {
                  name: VAT_LABELS[shop.market.lang] ?? "Incl. VAT",
                  value: formatMoney(order.taxMinor, order.currency, shop.market.locale),
                },
              ],
            },
          },
        }),
        ...(ui === "custom"
          ? // Stripe's form on Kaizen's page; its language is set in the browser.
            { ui_mode: "elements" as const, return_url: returnUrl }
          : {
              locale: stripeLocale(shop.market.lang) as Stripe.Checkout.SessionCreateParams.Locale,
              success_url: returnUrl,
              cancel_url: `${base}/cart`,
            }),
        expires_at: Math.floor(Date.now() / 1000) + CHECKOUT_MINUTES * 60 + 60,
      },
      { stripeAccount: connection.accountId, idempotencyKey: `checkout-${order.orderId}` },
    );
  } catch {
    await cancelUnpaidOrder(order.orderId, "stripe session could not be created");
    return { ok: false, problem: "payment_error" };
  }

  // Which payment methods Stripe offers this shopper, for support questions.
  await db().execute(sql`
    insert into commerce.order_events (store_id, order_id, type, data, actor)
    values (${shop.storeId}::uuid, ${order.orderId}::uuid, 'payment.started',
            ${JSON.stringify({ ui, methods: session.payment_method_types ?? [] })}::jsonb, 'system')
  `);
  await db().execute(sql`
    insert into commerce.payments (
      store_id, order_id, provider, provider_reference, provider_account, client_secret, amount_minor, currency, status
    ) values (
      ${shop.storeId}::uuid, ${order.orderId}::uuid, 'stripe', ${session.id}, ${connection.accountId},
      ${ui === "custom" ? session.client_secret : null}, ${order.totalMinor}, ${order.currency}, 'pending'
    )
  `);
  if (ui === "custom") return session.client_secret ? { ok: true, url: `${base}/checkout` } : { ok: false, problem: "payment_error" };
  if (!session.url) return { ok: false, problem: "payment_error" };
  return { ok: true, url: session.url };
}

export type OpenCheckout = {
  orderId: string;
  sessionId: string;
  clientSecret: string;
  accountId: string;
  mode: PaymentModeName;
  /** Stripe has closed the session: the shopper starts again. */
  expired: boolean;
  /** The cart was changed after the order was placed: the shopper starts again. */
  changed: boolean;
  /** The order has something to ship, so the form asks for an address. */
  ships: boolean;
  /** The order has downloads, so starting again needs the shopper's consent. */
  digital: boolean;
  /** The order starts a subscription: its schedule and what each renewal costs (D25). */
  subscription: { interval: PlanInterval; intervalCount: number; totalMinor: number } | null;
};

/**
 * The cart's order waiting for payment on Kaizen's checkout page, with what
 * the page needs to show Stripe's form. Null when there is none: the
 * shopper goes back to the cart. Only the cart's own browser (its cookie)
 * gets here, so no one else sees the order or its client secret.
 */
export async function getOpenCheckout(storeId: string, cartId: string): Promise<OpenCheckout | null> {
  const [row] = await db().execute<Row>(sql`
    select o.id, pay.provider_reference, pay.provider_account, pay.client_secret, a.mode,
      o.placed_at < now() - make_interval(mins => ${CHECKOUT_MINUTES}) as expired,
      (select coalesce(jsonb_agg(jsonb_build_array(cl.variant_id, cl.selling_plan_id, cl.quantity)
                                 order by cl.variant_id, cl.selling_plan_id), '[]'::jsonb)
         from commerce.cart_lines cl where cl.store_id = o.store_id and cl.cart_id = o.cart_id)
      is distinct from
      (select coalesce(jsonb_agg(jsonb_build_array(ol.variant_id, ol.selling_plan_id, ol.quantity)
                                 order by ol.variant_id, ol.selling_plan_id), '[]'::jsonb)
         from commerce.order_lines ol where ol.store_id = o.store_id and ol.order_id = o.id and ol.variant_id is not null)
      -- A code put on or taken off the cart changes the price too (D31).
      or (select c.discount_code from commerce.carts c where c.store_id = o.store_id and c.id = o.cart_id)
         is distinct from o.discount_code as changed,
      exists (select 1 from commerce.order_lines ol
               where ol.store_id = o.store_id and ol.order_id = o.id and ol.delivery = 'physical') as ships,
      exists (select 1 from commerce.order_lines ol
               where ol.store_id = o.store_id and ol.order_id = o.id and ol.delivery = 'digital' and ol.variant_id is not null) as digital,
      s.interval, s.interval_count, s.total_minor as renewal_minor
    from commerce.orders o
    join commerce.payments pay on pay.store_id = o.store_id and pay.order_id = o.id and pay.provider = 'stripe'
    join commerce.stripe_accounts a on a.store_id = pay.store_id and a.account_id = pay.provider_account
    left join commerce.subscriptions s on s.store_id = o.store_id and s.id = o.subscription_id
    where o.store_id = ${storeId}::uuid and o.cart_id = ${cartId}::uuid and o.status = 'pending_payment'
      and pay.client_secret is not null
    order by o.placed_at desc
    limit 1
  `);
  return row
    ? {
        orderId: String(row.id),
        sessionId: String(row.provider_reference),
        clientSecret: String(row.client_secret),
        accountId: String(row.provider_account),
        mode: row.mode as PaymentModeName,
        expired: Boolean(row.expired),
        changed: Boolean(row.changed),
        ships: Boolean(row.ships),
        digital: Boolean(row.digital),
        subscription: row.interval
          ? {
              interval: row.interval as PlanInterval,
              intervalCount: Number(row.interval_count),
              totalMinor: Number(row.renewal_minor),
            }
          : null,
      }
    : null;
}

/**
 * Expires an open Stripe session. Reports "paid" if it was paid meanwhile,
 * and "processing" if the shopper finished but the payment (e.g. a bank
 * transfer) has not arrived yet: that order must not be replaced.
 */
async function closeSession(
  stripe: Stripe,
  stripeAccount: string,
  sessionId: string,
): Promise<"closed" | "paid" | "processing"> {
  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId, {}, { stripeAccount });
    if (session.status === "complete") return session.payment_status === "unpaid" ? "processing" : "paid";
    if (session.status === "open") await stripe.checkout.sessions.expire(sessionId, {}, { stripeAccount });
  } catch {
    // An unknown or already expired session is closed either way.
  }
  return "closed";
}
