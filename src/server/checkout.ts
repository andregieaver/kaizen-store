import "server-only";

import { randomBytes } from "node:crypto";

import { sql, type SQL } from "drizzle-orm";
import { after } from "next/server";
import type Stripe from "stripe";

import { db } from "@/db/client";
import { formatClock, formatRangeDates, parseRentalPeriod, rangeEndsAt } from "@/lib/booking-ranges";
import { formatBookingTime } from "@/lib/booking-slots";
import { companyRequired, parseProductAudience, parseStoreAudience } from "@/lib/b2b";
import { CHECKOUT_MINUTES, lineWithdrawal, stripeLocale, vatIncluded } from "@/lib/checkout";
import { isNative, shown, type Market } from "@/lib/markets";
import { formatMoney } from "@/lib/money";
import { marketPath, storeOrigin } from "@/lib/paths";
import { shownOptions, t } from "@/lib/i18n";
import { parsePaymentMode, venuePart } from "@/lib/pay-later";
import { GENERAL_TAX_CODE, parseDelivery, variantLabel, type Delivery } from "@/lib/product-input";
import { campaignLabel, memberOffAfterCampaign } from "@/lib/campaigns";
import { applyDiscount } from "@/lib/discounts";
import { basketShipping, planPrice, sameRhythm, type PlanInterval } from "@/lib/subscriptions";

import { saleFee, type PaymentModeName } from "@/lib/stripe-account";

import { holdAppointment } from "./appointments";
import { holdRange, linePrice, rangePricing } from "./ranges";
import { storeFeeBps } from "./billing";
import { sendBookingStaffNotices, sendOrderConfirmation } from "./shopper-emails";
import { bookable } from "./cart";
import { ensurePaymentDomain, ensureStorePaymentMethods, ensureTestAccount, getCheckoutUi } from "./connect";
import { evaluateCampaigns } from "./campaigns";
import { memberDiscountFor } from "./customer-tiers";
import { chosenDelivery } from "./delivery-options";
import { friendState, rememberAffiliate, welcomeFor } from "./affiliates";
import { bonusProgram, creditState, debitFor, planFor } from "./bonus";
import { findUsableDiscount } from "./discounts";
import { commissionOf, hostCheckoutAccount } from "./host-payments";
import { getCheckoutAccount } from "./settings";
import { ensureSubscriptionEvents } from "./subscriptions";
import { platformStripe } from "./stripe";

type Row = Record<string, unknown>;
type Tx = Parameters<Parameters<ReturnType<typeof db>["transaction"]>[0]>[0];

export type CheckoutShop = { storeId: string; storeSlug: string; market: Market };

export type PlacedOrder = {
  orderId: string;
  number: string;
  currency: string;
  lines: {
    title: string;
    unitPriceMinor: number;
    quantity: number;
    recurring: boolean;
    /** What of the line is paid now, after its discount: less than its total when a part is paid at the venue (D66). */
    dueNowMinor: number;
    /** A deposit: part now, the rest at the venue. */
    deposit: boolean;
  }[];
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
  /** What Stripe calls the shipping when it is a carrier's service the shopper chose (D135); null for the market's flat rate. */
  deliveryLabel: string | null;
  /** The bonus credits used on it (D130), in the order's currency: part of the discount Stripe is sent as a coupon. */
  creditMinor: number;
  /** The friend's welcome discount (D131), in the order's currency: part of the same coupon. */
  referralMinor: number;
  /** The VAT included in the total. */
  taxMinor: number;
  totalMinor: number;
  /** What is paid now, and what is left to pay at the venue (D66); they add up to the total. */
  dueNowMinor: number;
  balanceMinor: number;
  /** The company it is bought for (B2B), put on the invoice. */
  company: { name: string; number: string } | null;
  /**
   * What Stripe takes off as a one-time coupon, and its name: the discount
   * code (D31), the buyer's group or company discount (D108), or both.
   */
  discount: { code: string; couponMinor: number } | null;
  /** The host whose listings these are (D71), paid on their own Stripe account; null for the store's own. */
  hostId: string | null;
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
  | "plans"
  | "company"
  | "company_number"
  | "slot_taken"
  | "contact"
  | "pay_later_mix"
  | "host_mix"
  | "host_payments_off";

export type PlaceResult = { ok: true; order: PlacedOrder } | { ok: false; problem: CheckoutProblem };

/**
 * What the shopper agreed to on the way to payment. Downloads start at once,
 * so buying one needs the shopper's express consent to that and their
 * acknowledgement that the right of withdrawal then ends (D24).
 */
export type CheckoutConsent = { digital?: boolean; subscription?: boolean };

/**
 * The rows `placeOrder()` prices, from a source that has the columns of a cart line (`store_id`,
 * `variant_id`, `quantity`, `selling_plan_id`, `starts_at`, `resource_id`): the shopper's cart lines, or
 * the free products a campaign gives (D114), which are sold like any other line.
 */
function orderLineRows(tx: Tx, market: Market, source: SQL, where: SQL) {
  return tx.execute<Row>(sql`
      select
        cl.variant_id, cl.quantity, v.sku, v.options, v.delivery, p.id as product_id, p.audience,
        cl.selling_plan_id, sp.interval, sp.interval_count, sp.discount_percent, sp.trial_days, sp.min_cycles,
        coalesce((sp.signup_fee ->> ${market.code})::bigint, 0) as signup_fee,
        (case when cl.selling_plan_id is null then not p.subscription_only else coalesce(sp.active, false) end) as plan_ok,
        coalesce(v.tax_code, p.tax_code) as tax_code, p.withdrawal_exclusion,
        commerce.vat_rate(${market.code}, p.vat_category) as vat_rate,
        coalesce(tl.title, tf.title, p.handle) as title,
        cp.amount_minor, cl.starts_at, cl.resource_id, aps.payment, aps.deposit_percent,
        p.kind, aps.check_in_time, aps.check_out_time, v.rental_period, p.host_id,
        (p.status = 'active' and v.active and ${bookable}) as sellable
      from ${source}
      join commerce.product_variants v on v.store_id = cl.store_id and v.id = cl.variant_id
      join commerce.products p on p.store_id = v.store_id and p.id = v.product_id
      left join commerce.product_translations tl on tl.product_id = p.id and tl.locale = ${market.locale}
      left join lateral (
        select title from commerce.product_translations where product_id = p.id order by locale limit 1
      ) tf on true
      left join commerce.current_prices cp on cp.variant_id = v.id and cp.market_code = ${market.code}
      left join commerce.selling_plans sp
        on sp.store_id = cl.store_id and sp.id = cl.selling_plan_id and sp.product_id = p.id
      left join commerce.appointment_settings aps on aps.store_id = p.store_id and aps.product_id = p.id
      where ${where}
      order by p.handle, v.sku, cl.selling_plan_id nulls first, cl.starts_at
  `);
}

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
  return inTransaction(async (tx): Promise<PlaceResult> => {
    const [cart] = await tx.execute<Row>(sql`
      select c.id, c.discount_code, c.company_name, c.organisation_number, s.audience as store_audience, s.time_zone,
        c.bonus_request_minor, c.affiliate_code
      from commerce.carts c
      join commerce.stores s on s.id = c.store_id
      where c.store_id = ${storeId}::uuid and c.id = ${cartId}::uuid and c.market_code = ${market.code}
        and c.status = 'open' and c.expires_at > now()
      for update of c
    `);
    if (!cart) return { ok: false, problem: "empty" };
    // Bonus credits (D130) are taken under the customer's lock, so two checkouts cannot both spend the same credits; the
    // same lock keeps a friend's first order (D131) from being placed twice with the welcome discount at once.
    if (customerId) {
      await tx.execute(sql`select id from commerce.customers where store_id = ${storeId}::uuid and id = ${customerId}::uuid for update`);
    }

    const cartLines = await orderLineRows(
      tx,
      market,
      sql`commerce.cart_lines cl`,
      sql`cl.store_id = ${storeId}::uuid and cl.cart_id = ${cartId}::uuid`,
    );
    const lines: Row[] = [...cartLines];
    if (lines.length === 0) return { ok: false, problem: "empty" };
    // A subscription is bought in the country's own currency only (D109).
    if (!isNative(market) && lines.some((l) => l.selling_plan_id !== null)) return { ok: false, problem: "unavailable" };
    if (lines.some((l) => !l.sellable || !l.plan_ok || l.amount_minor === null)) {
      return { ok: false, problem: "unavailable" };
    }
    // One checkout pays one seller (D71): a host's listings on their own, and never a subscription.
    const sellers = new Set(lines.map((l) => (l.host_id ? String(l.host_id) : null)));
    const hostId = sellers.size === 1 ? [...sellers][0] : null;
    if (sellers.size > 1 || (hostId && lines.some((l) => l.selling_plan_id !== null))) {
      return { ok: false, problem: "host_mix" };
    }
    // Businesses buy with their company's name and organisation number (B2B): in a store
    // selling only to them, and for business-only products in one selling to both.
    const company = cart.company_name && cart.organisation_number
      ? { name: String(cart.company_name), number: String(cart.organisation_number) }
      : null;
    const products = lines.map((l) => parseProductAudience(l.audience));
    if (!company && companyRequired(parseStoreAudience(cart.store_audience), products)) {
      return { ok: false, problem: "company" };
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
    const digital = lines.some((l) => l.delivery === "digital");
    if (digital && !consent.digital) return { ok: false, problem: "consent" };

    const [rate] = await tx.execute<Row>(sql`
      select amount_minor, free_over_minor from commerce.shipping_rates
      where store_id = ${storeId}::uuid and market_code = ${market.code}
    `);
    const ships = physical.length > 0;
    // The delivery the shopper chose at checkout (D135) is the shipping rate instead of the market's flat rate, as the
    // cart page has it (`cartSummary()`); a subscription pays the flat rate on each delivery (D25).
    const chosen = ships && !rhythm ? await chosenDelivery(tx, storeId, cartId, market) : null;
    if (ships && !rate && !chosen) return { ok: false, problem: "no_shipping" };
    const [country] = await tx.execute<Row>(sql`
      select standard_vat_rate from commerce.countries where code = ${market.code}
    `);
    // Shipping takes the standard rate; each line its product's (D65).
    const vatRate = Number(country?.standard_vat_rate ?? 0);

    // Stays and rentals are priced by their nights' seasons, with a fee (D70).
    const ranged = lines.filter((l) => l.starts_at && (l.kind === "stay" || l.kind === "rental"));
    const pricing = await rangePricing(tx, storeId, ranged.map((l) => String(l.product_id)), market.code, market);
    const price = (line: Row) => {
      // A stay or rental is one line at its whole price; `count` is its nights, days or hours.
      const count = Number(line.quantity);
      const isRange = Boolean(line.starts_at) && (line.kind === "stay" || line.kind === "rental");
      const quantity = isRange ? 1 : count;
      const recurring = line.selling_plan_id !== null;
      // The subscriber's price on each renewal, and what is charged now.
      // Kept in the country's own currency; the order is in the one shown (D109).
      const renewUnit = planPrice(shown(market, Number(line.amount_minor)), recurring ? Number(line.discount_percent) : 0);
      const options = (line.options ?? {}) as Record<string, string>;
      const title =
        Object.keys(options).length > 0 ? `${line.title} (${variantLabel(shownOptions(t(market.lang), options))})` : String(line.title);
      // An appointment's time (or a stay's or rental's dates) goes with it to Stripe, in the store's time zone (D65, D67).
      const startsAt = line.starts_at ? new Date(String(line.starts_at)).toISOString() : null;
      const range = line.kind === "stay" || line.kind === "rental" ? line.kind : null;
      const period = parseRentalPeriod(line.rental_period);
      const tz = String(cart.time_zone);
      const times = { checkInTime: String(line.check_in_time), checkOutTime: String(line.check_out_time) };
      const when = !startsAt
        ? null
        : range && (range === "stay" || period === "day")
          ? formatRangeDates(startsAt, rangeEndsAt(range, startsAt, count, times, tz), market.locale, tz)
          : range
            ? `${formatBookingTime(startsAt, market.locale, tz)}–${formatClock(rangeEndsAt(range, startsAt, count, times, tz, period), market.locale, tz)}`
            : formatBookingTime(startsAt, market.locale, tz);
      const unit =
        range && startsAt
          ? linePrice(
              { kind: range, period, startsAt, count, baseMinor: renewUnit, currency: market.currency, timeZone: tz },
              pricing.get(String(line.product_id)),
            ).totalMinor
          : recurring && trial
            ? 0
            : renewUnit;
      const delivery: Delivery = parseDelivery(line.delivery);
      const rate = Number(line.vat_rate ?? vatRate);
      // A stay or rental is one line at its whole price (D70): its per-night price is only where the whole starts
      // from, so discount codes and free shipping count the whole, as the cart page does.
      const lineUnit = range && startsAt ? unit : renewUnit;
      return {
        line,
        quantity,
        count,
        unit,
        renewUnit: lineUnit,
        discount: 0,
        /** The part of the discount that is the buyer's group or company discount (D108). */
        member: 0,
        /** The part of the discount that is the friend's welcome discount (D131), taken off before codes and credits. */
        referral: 0,
        /** The part of the discount that is bonus credits (D130), taken off last. */
        bonus: 0,
        /** What a campaign took off (D114), which one, and whether the line is a free product it gave. */
        campaign: 0,
        campaignId: null as string | null,
        /** Each campaign that gave something on the line, kept with the order line (D115). */
        parts: [] as { campaignId: string; name: string; minor: number }[],
        gift: false,
        total: unit * quantity,
        title,
        recurring,
        delivery,
        rate,
        startsAt,
        when,
        range,
        period,
      };
    };
    const priced = lines.map(price);

    // Campaigns (D114): reductions on goods bought once, and the free products the basket has earned,
    // before the buyer's group discount and any code, which count what is left.
    const outcome = await evaluateCampaigns(
      tx,
      { storeId, market },
      priced.map((p, i) => ({
        key: String(i),
        productId: String(p.line.product_id),
        unitMinor: p.unit,
        quantity: p.quantity,
        discountable: !p.recurring && !p.range && p.line.kind === "goods" && p.unit > 0,
        valueMinor: p.unit * p.quantity,
      })),
      { ships: physical.length > 0, customerId, lock: true },
    );
    priced.forEach((p, i) => {
      const off = outcome.result.lineOff[String(i)] ?? 0;
      if (off === 0) return;
      p.campaign = off;
      p.parts = outcome.result.lineParts[String(i)] ?? [];
      p.campaignId = p.parts[0]?.campaignId ?? null;
      p.discount = off;
      p.total = p.unit * p.quantity - off;
    });
    // A free product is a line at its list price, all of it taken off, so it is shipped, held and shown like any other.
    for (const gift of outcome.gifts) {
      const [row] = await orderLineRows(
        tx,
        market,
        sql`(values (${storeId}::uuid, ${gift.variantId}::uuid, ${gift.quantity}::int, null::uuid, null::timestamptz, null::uuid)) as cl (store_id, variant_id, quantity, selling_plan_id, starts_at, resource_id)`,
        sql`true`,
      );
      if (!row || !row.sellable || !row.plan_ok || row.amount_minor === null) continue;
      lines.push(row);
      const p = price(row);
      const whole = p.unit * p.quantity;
      priced.push({ ...p, gift: true, campaign: whole, campaignId: gift.campaignId, parts: [{ campaignId: gift.campaignId, name: gift.campaignName, minor: whole }], discount: whole, total: 0 });
    }

    // Lock the stock rows, then count what is free: on hand minus live holds.
    const toShip = lines.filter((l) => l.delivery === "physical");
    const variantIds = sql.join(
      [sql`null::uuid`, ...toShip.map((l) => sql`${String(l.variant_id)}::uuid`)],
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
    for (const line of toShip) {
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


    // One sign-up fee per purchase option, charged now with the first order (D29).
    const fees = [
      ...new Map(
        planned
          .filter((l) => Number(l.signup_fee) > 0)
          .map((l) => [
            String(l.selling_plan_id),
            { planId: String(l.selling_plan_id), amount: shown(market, Number(l.signup_fee)), title: String(l.title), rate: Number(l.vat_rate ?? vatRate) },
          ]),
      ).values(),
    ];
    const feeTotal = fees.reduce((sum, fee) => sum + fee.amount, 0);
    // Before any discount code: what the items and fees come to.
    const subtotal = priced.reduce((sum, p) => sum + p.unit * p.quantity, 0) + feeTotal;
    const shippingRate = chosen
      ? chosen.rate
      : rate
      ? {
          amountMinor: shown(market, Number(rate.amount_minor)),
          freeOverMinor: rate.free_over_minor === null ? null : shown(market, Number(rate.free_over_minor)),
        }
      : null;
    // Free shipping counts the whole basket, downloads included; a
    // subscription pays shipping on each delivery (D25).
    const shippingFor = () =>
      basketShipping(
        priced.filter((p) => !p.gift).map((p) => ({ totalMinor: p.renewUnit * p.quantity, delivery: p.delivery, recurring: p.recurring })),
        shippingRate,
        { trial },
      );
    let basket = shippingFor();

    // The buyer's group or company discount (D108): off what is bought once, before any
    // code, which then counts the lowered prices. Not off subscriptions, sign-up fees or shipping.
    const member = await memberDiscountFor(tx, storeId, customerId);
    if (member) {
      for (const p of priced) {
        if (p.gift || p.recurring || p.unit <= 0) continue;
        p.member = memberOffAfterCampaign(p.unit, p.quantity, p.campaign, member.percent);
        p.discount = p.campaign + p.member;
        p.total = p.unit * p.quantity - p.discount;
      }
    }

    // The friend's welcome discount (D131): a signed-in customer's first order, through an affiliate's link, off goods
    // bought once after campaigns and the group's discount, before any code. Never a host's order. The same arithmetic
    // as the cart page (`cartSummary()`), worked out under the customer's lock.
    const program = await bonusProgram(tx, storeId);
    const friend = hostId ? null : await friendState(tx, storeId, customerId, cart.affiliate_code ? String(cart.affiliate_code) : null, program);
    const welcome = friend
      ? welcomeFor(friend, market, priced.map((p) => (p.gift || p.recurring || p.unit <= 0 ? 0 : Math.max(0, p.total))))
      : { totalMinor: 0, lines: priced.map(() => 0) };
    priced.forEach((p, i) => {
      p.referral = welcome.lines[i] ?? 0;
      p.discount += p.referral;
      p.total -= p.referral;
    });
    const referralTotal = priced.reduce((sum, p) => sum + p.referral, 0);

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
              // What the code is taken off: the price after the group's discount for what is bought once.
              unitMinor: member && !p.recurring ? planPrice(p.unit, member.percent) : p.renewUnit,
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
        p.discount = p.campaign + p.member + p.referral + (applied.lines[String(i)] ?? 0);
        p.total = p.unit * p.quantity - p.discount;
      });
      if (lowered.size > 0) basket = shippingFor();
      shippingDiscount = applied.shippingMinor;
      discount = { id: found.discount.id, code: found.discount.code };
    }
    const shipping = basket.first;
    const discountTotal = priced.reduce((sum, p) => sum + p.discount, 0) + shippingDiscount;
    const memberTotal = priced.reduce((sum, p) => sum + p.member, 0);
    const campaignTotal = priced.reduce((sum, p) => sum + p.campaign, 0);
    const campaignText = campaignLabel(priced.flatMap((p) => p.parts.map((part) => part.name)));
    // Appointments paid at the venue, or with a deposit now (D66): the part left for the venue.
    const venue = priced.map((p) =>
      venuePart(
        p.total,
        p.line.payment ? { mode: parsePaymentMode(p.line.payment), depositPercent: Number(p.line.deposit_percent) } : null,
      ),
    );
    const balance = venue.reduce((sum, part) => sum + part, 0);
    // A subscription is paid by Stripe Billing in full, so it is ordered apart from them.
    if (rhythm && balance > 0) return { ok: false, problem: "pay_later_mix" };
    // Bonus credits (D130) come last, off goods bought once that are still to pay online: after campaigns, the group's
    // discount and codes, and not off a subscription, the part left for a venue, fees or shipping. Worked out under the
    // customer's lock from the same rules as the cart page (`cartSummary()`), and brought down to what they still have.
    const credits = hostId ? null : await creditState(tx, { storeId, market }, customerId, cartId, program);
    const creditPlan = planFor(
      credits,
      priced.map((p, i) => (p.recurring || p.gift || p.unit <= 0 ? 0 : Math.max(0, p.total - venue[i]))),
      subtotal + shipping - discountTotal - balance,
    );
    const creditDebit = credits ? debitFor(credits, market, creditPlan.usingMinor) : 0;
    if (creditPlan.usingMinor > 0 && creditDebit > 0) {
      priced.forEach((p, i) => {
        p.bonus = creditPlan.lines[i] ?? 0;
        p.discount += p.bonus;
        p.total -= p.bonus;
      });
    }
    const creditTotal = priced.reduce((sum, p) => sum + p.bonus, 0);
    const discountAll = discountTotal + creditTotal;
    // discountTotal already holds the welcome discount: it is part of each line's discount.
    const tax =
      priced.reduce((sum, p) => sum + vatIncluded(p.total, p.rate), 0) +
      fees.reduce((sum, fee) => sum + vatIncluded(fee.amount, fee.rate), 0) +
      vatIncluded(shipping - shippingDiscount, vatRate);
    const total = subtotal + shipping - discountAll;

    const [numbered] = await tx.execute<Row>(sql`
      select s.prefix || commerce.next_document_number(${storeId}::uuid, 'order')::text as number
      from commerce.document_series s
      where s.store_id = ${storeId}::uuid and s.series = 'order'
    `);
    const [order] = await tx.execute<Row>(sql`
      insert into commerce.orders (
        store_id, number, market_code, currency, locale, cart_id, email, status,
        subtotal_minor, shipping_minor, discount_minor, tax_minor, total_minor,
        billing_address, shipping_address, digital_consent_at, customer_id, discount_code_id, discount_code,
        company_name, organisation_number, balance_minor, host_id,
        member_discount_minor, member_label, member_percent, campaign_discount_minor, campaign_label, credit_minor,
        referral_discount_minor, delivery
      ) values (
        ${storeId}::uuid, ${String(numbered.number)}, ${market.code}, ${market.currency}, ${market.locale},
        ${cartId}::uuid, '', 'pending_payment',
        ${subtotal}, ${shipping}, ${discountAll}, ${tax}, ${total}, '{}'::jsonb, '{}'::jsonb,
        ${digital ? sql`now()` : sql`null`}, ${customerId}::uuid, ${discount?.id ?? null}::uuid, ${discount?.code ?? null},
        ${company?.name ?? null}, ${company?.number ?? null}, ${balance}, ${hostId}::uuid,
        ${memberTotal}, ${memberTotal > 0 ? member!.label : null}, ${memberTotal > 0 ? member!.percent : null},
        ${campaignTotal}, ${campaignTotal > 0 ? campaignText : null}, ${creditTotal}, ${referralTotal},
        ${chosen ? JSON.stringify(chosen.delivery) : null}::jsonb
      )
      returning id
    `);
    const orderId = String(order.id);

    for (const [i, p] of priced.entries()) {
      const [orderLine] = await tx.execute<Row>(sql`
        insert into commerce.order_lines (
          store_id, order_id, variant_id, sku, title, quantity, unit_price_minor, discount_minor, member_discount_minor,
          total_minor, tax_minor, tax_rate, tax_code, withdrawal_exclusion, delivery,
          selling_plan_id, plan_interval, plan_interval_count, venue_minor, booked_count,
          campaign_discount_minor, campaign_id, campaign_parts, gift, bonus_discount_minor, referral_discount_minor
        ) values (
          ${storeId}::uuid, ${orderId}::uuid, ${String(p.line.variant_id)}::uuid, ${String(p.line.sku)},
          ${p.title}, ${p.quantity}, ${p.unit}, ${p.discount}, ${p.member}, ${p.total}, ${vatIncluded(p.total, p.rate)},
          ${p.rate}, ${String(p.line.tax_code)},
          ${lineWithdrawal(p.delivery, String(p.line.withdrawal_exclusion))}, ${p.delivery},
          ${p.recurring ? String(p.line.selling_plan_id) : null}::uuid,
          ${p.recurring ? String(p.line.interval) : null}::commerce.plan_interval,
          ${p.recurring ? Number(p.line.interval_count) : null}, ${venue[i]},
          ${p.range && p.startsAt ? p.count : null},
          ${p.campaign}, ${p.campaignId}::uuid, ${JSON.stringify(p.parts.map((part) => ({ id: part.campaignId, name: part.name, minor: part.minor })))}::jsonb, ${p.gift}, ${p.bonus}, ${p.referral}
        )
        returning id
      `);
      // The appointment's time (or the stay's or rental's nights or days, D67) is held as long as
      // its stock would be; taken meanwhile, nothing is placed.
      if (p.startsAt) {
        const hold = {
          productId: String(p.line.product_id),
          variantId: String(p.line.variant_id),
          startsAt: p.startsAt,
          resourceId: p.line.resource_id ? String(p.line.resource_id) : null,
          orderId,
          orderLineId: String(orderLine.id),
          holdMinutes: CHECKOUT_MINUTES + 5,
        };
        const held = p.range
          ? await holdRange(tx, storeId, { ...hold, count: p.count, period: p.period })
          : await holdAppointment(tx, storeId, hold);
        if (!held) throw new SlotTaken();
      }
    }

    const feeTitle = t(market.lang).signupFee;
    for (const fee of fees) {
      await tx.execute(sql`
        insert into commerce.order_lines (
          store_id, order_id, variant_id, sku, title, quantity, unit_price_minor, discount_minor,
          total_minor, tax_minor, tax_rate, tax_code, withdrawal_exclusion, delivery, selling_plan_id
        ) values (
          ${storeId}::uuid, ${orderId}::uuid, null, 'SIGNUP-FEE', ${`${feeTitle}: ${fee.title}`}, 1, ${fee.amount}, 0,
          ${fee.amount}, ${vatIncluded(fee.amount, fee.rate)}, ${fee.rate}, ${GENERAL_TAX_CODE}, 'none', 'digital',
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
        renewing.reduce((sum, p) => sum + vatIncluded(p.renewUnit * p.quantity, p.rate), 0) + vatIncluded(basket.renewal, vatRate);
      const [row] = await tx.execute<Row>(sql`
        insert into commerce.subscriptions (
          store_id, number, market_code, currency, locale, interval, interval_count, min_cycles,
          subtotal_minor, shipping_minor, total_minor, tax_minor, first_order_id, manage_token, customer_id
        ) values (
          ${storeId}::uuid, ${String(numbered.number)}, ${market.code}, ${market.currency}, ${market.locale},
          ${rhythm.interval}, ${rhythm.intervalCount}, ${minCycles}, ${renewalSubtotal}, ${basket.renewal},
          ${renewalSubtotal + basket.renewal}, ${renewalTax}, ${orderId}::uuid,
          replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), ${customerId}::uuid
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
            ${p.renewUnit}, ${p.renewUnit * p.quantity}, ${p.rate}, ${String(p.line.tax_code)}, ${p.delivery}
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
    // The credits are held against the order while it waits for payment: paying keeps them used, cancelling gives them back.
    if (creditTotal > 0) {
      await tx.execute(sql`
        select commerce.bonus_redeem(${storeId}::uuid, ${customerId}::uuid, ${orderId}::uuid, ${creditDebit}, ${`redeem:${orderId}`})
      `);
    }
    // Whose friend the order is (D131): an attribution row, rejected with its reason when a guard stopped the reward,
    // else waiting for payment; the welcome discount it was given is kept with it.
    if (friend && customerId && !["off", "none", "guest"].includes(friend.verdict)) {
      await tx.execute(sql`
        select commerce.affiliate_attribute_order(${orderId}::uuid, ${cart.affiliate_code ? String(cart.affiliate_code) : null}, ${referralTotal})
      `);
    }
    // The cart now asks for what the order used, so a change to it (and only a change) asks checkout to start again.
    if (Number(cart.bonus_request_minor) > 0 || creditTotal > 0) {
      await tx.execute(sql`
        update commerce.carts set bonus_request_minor = ${creditTotal}, bonus_request_currency = ${market.currency}
        where store_id = ${storeId}::uuid and id = ${cartId}::uuid
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
          ...priced.map((p, i) => ({
            title: p.when ? `${p.title}, ${p.when}` : p.title,
            // What renews is charged at its full price by Stripe, after any free trial.
            unitPriceMinor: p.recurring ? p.renewUnit : p.unit,
            quantity: p.quantity,
            recurring: p.recurring,
            dueNowMinor: p.total - venue[i],
            deposit: venue[i] > 0 && venue[i] < p.total,
          })),
          ...fees.map((fee) => ({
            title: `${feeTitle}: ${fee.title}`,
            unitPriceMinor: fee.amount,
            quantity: 1,
            recurring: false,
            dueNowMinor: fee.amount,
            deposit: false,
          })),
        ],
        ships,
        subscription,
        shippingMinor: shipping,
        shippingDiscountMinor: shippingDiscount,
        deliveryLabel: chosen ? chosen.delivery.label : null,
        creditMinor: creditTotal,
        referralMinor: referralTotal,
        taxMinor: tax,
        totalMinor: total,
        dueNowMinor: total - balance,
        balanceMinor: balance,
        company,
        // Stripe takes it as a one-time coupon: everything off today that is
        // not already in a lowered subscriber's price. In a subscription,
        // shipping is a line, so free shipping is in the coupon too.
        discount:
          discount || memberTotal > 0 || campaignTotal > 0 || referralTotal > 0 || creditTotal > 0
            ? {
                code: [
                  discount?.code,
                  memberTotal > 0 ? member!.label : null,
                  campaignTotal > 0 ? campaignText : null,
                  referralTotal > 0 ? t(market.lang).affiliate.discountRow : null,
                  creditTotal > 0 ? t(market.lang).bonus.discountRow : null,
                ]
                  .filter(Boolean)
                  .join(" + "),
                couponMinor:
                  priced.reduce((sum, p, i) => sum + (lowered.has(i) ? 0 : p.discount), 0) +
                  (rhythm ? shippingDiscount : 0),
              }
            : null,
        hostId,
      },
    };
  });
}

/** An appointment's time was taken meanwhile (D65): everything placed so far is undone. */
class SlotTaken extends Error {}

/** Places an order in one transaction, undone as a whole when a time was taken. */
async function inTransaction(work: (tx: Tx) => Promise<PlaceResult>): Promise<PlaceResult> {
  try {
    return await db().transaction(work);
  } catch (error) {
    if (error instanceof SlotTaken) return { ok: false, problem: "slot_taken" };
    throw error;
  }
}

/** Who books an order with nothing to pay online (D66). */
export type CheckoutContact = { name: string; email: string; phone: string };

/**
 * Confirms an order paid entirely at the venue (D66): the shopper's details
 * on it, a pending payment at the venue as its record (and the key to its
 * order page, as a Stripe session's id is), paid as far as the shop is
 * concerned, so its times are booked. Returns the order page's key.
 */
async function confirmAtVenue(storeId: string, order: PlacedOrder, contact: CheckoutContact): Promise<string> {
  const token = `venue_${randomBytes(18).toString("base64url")}`;
  await db().execute(sql`
    update commerce.orders set email = ${contact.email},
      billing_address = ${JSON.stringify({ name: contact.name, phone: contact.phone })}::jsonb
    where store_id = ${storeId}::uuid and id = ${order.orderId}::uuid
  `);
  await db().execute(sql`
    insert into commerce.payments (store_id, order_id, provider, provider_reference, amount_minor, currency, status)
    values (${storeId}::uuid, ${order.orderId}::uuid, 'venue', ${token}, ${order.balanceMinor}, ${order.currency}, 'pending')
  `);
  await completeOrderPayment(order.orderId, token);
  const notify = async () => {
    await sendOrderConfirmation(storeId, order.orderId);
    await sendBookingStaffNotices(storeId, order.orderId);
  };
  try {
    after(notify);
  } catch {
    // Not in a request (scripts, tests).
    await notify();
  }
  return token;
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
const COMPANY_LABELS: Record<string, { name: string; number: string }> = {
  nb: { name: "Kjøper", number: "Org.nr." },
  sv: { name: "Köpare", number: "Org.nr" },
  da: { name: "Køber", number: "CVR-nr." },
  en: { name: "Buyer", number: "Organisation number" },
};

/**
 * From cart to payment: closes any earlier unpaid checkout for the same
 * cart, places the order, and opens a Stripe Checkout session for it on the
 * store's own Stripe account (a direct charge: the store is the seller, and
 * Kaizen's fee, if any, is taken as an application fee). The shopper then
 * pays on Kaizen's checkout page with Stripe's form (D22), or on Stripe's
 * own page when the platform is switched to that fallback. The returned
 * address is where to send the shopper. A host's listings are charged on
 * the host's account instead, the store's commission added to Kaizen's fee
 * (D71).
 */
export async function startCheckout(
  shop: CheckoutShop,
  cartId: string,
  origin: string,
  shippingLabel: string,
  consent: CheckoutConsent = {},
  {
    customerId = null,
    contact = null,
  }: {
    customerId?: string | null;
    /** Who books when nothing is paid online (D66): Stripe asks everyone else. */
    contact?: CheckoutContact | null;
  } = {},
): Promise<CheckoutStart> {
  // A referral cookie the visitor allowed (D131) is kept with the cart before the order is placed.
  await rememberAffiliate({ storeId: shop.storeId, market: shop.market }, cartId);
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
  // Everything is paid at the venue (D66): no payment now, the booking is confirmed at once.
  if (order.dueNowMinor === 0 && order.balanceMinor > 0) {
    if (!contact) {
      await cancelUnpaidOrder(order.orderId, "no contact details");
      return { ok: false, problem: "contact" };
    }
    const base = `${storeOrigin(shop.storeSlug) ?? origin}${marketPath(shop.storeSlug, shop.market.slug)}`;
    const token = await confirmAtVenue(shop.storeId, order, contact);
    return { ok: true, url: `${base}/order/${order.orderId}?session_id=${token}` };
  }
  // Renewals arrive as webhook events that older platform webhooks were not sent (D25).
  if (order.subscription) await ensureSubscriptionEvents(connection.mode);
  // A host's listings are paid on the host's own account (D71), in the store's mode.
  let seller = connection.accountId;
  let commissionBps = 0;
  if (order.hostId) {
    const hostAccount = await hostCheckoutAccount(shop.storeId, order.hostId, connection.mode);
    if (!hostAccount) {
      await cancelUnpaidOrder(order.orderId, "the host cannot take payments");
      return { ok: false, problem: "host_payments_off" };
    }
    seller = hostAccount;
    const [host] = await db().execute<Row>(sql`
      select commission_bps from commerce.hosts where store_id = ${shop.storeId}::uuid and id = ${order.hostId}::uuid
    `);
    commissionBps = Number(host?.commission_bps ?? 0);
  }

  const [store] = await db().execute<Row>(sql`
    select legal_name, organisation_number from commerce.stores where id = ${shop.storeId}::uuid
  `);
  const feeBps = await storeFeeBps(shop.storeId);
  // Kaizen's fee is on what is paid through Stripe; the rest is paid at the venue (D66).
  const kaizenFee = saleFee(order.dueNowMinor, feeBps);
  // On a host's charge, the store's commission rides in the application fee, to be sent on to the store (D71).
  const commission = commissionOf(order.dueNowMinor, commissionBps);
  const fee = commission > 0 ? Math.min(order.dueNowMinor, (kaizenFee ?? 0) + commission) : kaizenFee;
  if (commission > 0) {
    await db().execute(sql`
      update commerce.orders set commission_minor = ${(fee ?? 0) - (kaizenFee ?? 0)}
      where store_id = ${shop.storeId}::uuid and id = ${order.orderId}::uuid
    `);
  }
  const partial = order.balanceMinor > 0;
  const depositLabel = t(shop.market.lang).booking.deposit;
  // Back to the store's own host once it has one (P7), whichever host the request came from.
  const base = `${storeOrigin(shop.storeSlug) ?? origin}${marketPath(shop.storeSlug, shop.market.slug)}`;
  const currency = order.currency.toLowerCase();
  const metadata = { order_id: order.orderId, order_number: order.number, store_id: shop.storeId };
  const sellerLine = [store?.legal_name, store?.organisation_number && `Org.nr. ${store.organisation_number}`]
    .filter(Boolean)
    .join(" · ");
  const returnUrl = `${base}/order/${order.orderId}?session_id={CHECKOUT_SESSION_ID}`;
  // Wallets, Link and Klarna show in Stripe's form only on registered domains.
  if (ui === "custom" && origin.startsWith("https://")) {
    await ensurePaymentDomain(shop.storeId, connection.mode, seller, new URL(origin).hostname);
  }

  let session: Stripe.Checkout.Session;
  try {
    // A discount code (D31) reaches Stripe as a coupon for this checkout alone.
    // With a part paid at the venue, each line is sent as what is due now, discount included.
    const coupon =
      !partial && order.discount && order.discount.couponMinor > 0
        ? await stripe.coupons.create(
            {
              amount_off: order.discount.couponMinor,
              currency,
              duration: "once",
              max_redemptions: 1,
              name: order.discount.code.slice(0, 40),
              metadata,
            },
            { stripeAccount: seller, idempotencyKey: `coupon-${order.orderId}` },
          )
        : null;
    session = await stripe.checkout.sessions.create(
      {
        client_reference_id: order.orderId,
        metadata,
        ...(coupon && { discounts: [{ coupon: coupon.id }] }),
        integration_identifier: INTEGRATION_IDENTIFIER,
        line_items: partial
          ? order.lines
              .filter((line) => line.dueNowMinor > 0)
              .map((line) => ({
                quantity: 1,
                price_data: {
                  currency,
                  unit_amount: line.dueNowMinor,
                  product_data: {
                    name: `${line.quantity > 1 ? `${line.quantity} × ` : ""}${line.title}${line.deposit ? ` (${depositLabel})` : ""}`,
                  },
                },
              }))
          : [
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
                // A deposit keeps the card for a no-show fee staff may charge later (D66).
                ...(order.lines.some((line) => line.deposit) && { setup_future_usage: "off_session" as const }),
              },
              ...(order.lines.some((line) => line.deposit) && { customer_creation: "always" as const }),
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
                  display_name: order.deliveryLabel ?? shippingLabel,
                  fixed_amount: { amount: order.shippingMinor - order.shippingDiscountMinor, currency },
                },
              },
            ],
          }),
        // No payment_method_types: Stripe shows the methods the store has
        // turned on in its Stripe Dashboard that suit the shopper.
        // Subscriptions always get Stripe invoices; this is for single payments.
        // An invoice for part of an order would mislead: the store invoices the whole at the venue.
        // A host is the seller of their own bookings, so the store's invoices are not theirs (D71).
        ...(connection.orderInvoices &&
          !order.subscription &&
          !partial &&
          !order.hostId && {
          invoice_creation: {
            enabled: true,
            invoice_data: {
              description: `Order ${order.number}`,
              metadata,
              ...(sellerLine && { footer: sellerLine }),
              custom_fields: [
                {
                  name: VAT_LABELS[shop.market.lang] ?? "Incl. VAT",
                  value: formatMoney(order.taxMinor, order.currency, shop.market.locale),
                },
                // Bought for a business (B2B): whom for, as the invoice must say.
                ...(order.company
                  ? [
                      { name: (COMPANY_LABELS[shop.market.lang] ?? COMPANY_LABELS.en).name, value: order.company.name.slice(0, 140) },
                      { name: (COMPANY_LABELS[shop.market.lang] ?? COMPANY_LABELS.en).number, value: order.company.number },
                    ]
                  : []),
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
      { stripeAccount: seller, idempotencyKey: `checkout-${order.orderId}` },
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
      store_id, order_id, provider, provider_reference, provider_account, client_secret, amount_minor, currency, status,
      kaizen_fee_minor
    ) values (
      ${shop.storeId}::uuid, ${order.orderId}::uuid, 'stripe', ${session.id}, ${seller},
      ${ui === "custom" ? session.client_secret : null}, ${order.dueNowMinor}, ${order.currency}, 'pending',
      ${order.subscription ? 0 : (kaizenFee ?? 0)}
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
      (select coalesce(jsonb_agg(jsonb_build_array(cl.variant_id, cl.selling_plan_id, cl.quantity, cl.starts_at)
                                 order by cl.variant_id, cl.selling_plan_id, cl.starts_at), '[]'::jsonb)
         from commerce.cart_lines cl where cl.store_id = o.store_id and cl.cart_id = o.cart_id)
      is distinct from
      -- A stay or rental is one order line; its nights, days or hours are the cart line's quantity (D70).
      (select coalesce(jsonb_agg(jsonb_build_array(ol.variant_id, ol.selling_plan_id, coalesce(ol.booked_count, ol.quantity), b.starts_at)
                                 order by ol.variant_id, ol.selling_plan_id, b.starts_at), '[]'::jsonb)
         from commerce.order_lines ol
         -- An appointment's time is on its booking (D65).
         left join commerce.bookings b on b.store_id = ol.store_id and b.order_line_id = ol.id
         -- A free product a campaign gave (D114) is not in the cart.
         where ol.store_id = o.store_id and ol.order_id = o.id and ol.variant_id is not null and not ol.gift)
      -- A code put on or taken off the cart changes the price too (D31).
      or (select c.discount_code from commerce.carts c where c.store_id = o.store_id and c.id = o.cart_id)
         is distinct from o.discount_code
      -- So does asking for other bonus credits (D130): the cart holds what the order used until it is changed.
      or (select case when c.bonus_request_currency = o.currency then c.bonus_request_minor else 0 end
            from commerce.carts c where c.store_id = o.store_id and c.id = o.cart_id)
         is distinct from o.credit_minor as changed,
      exists (select 1 from commerce.order_lines ol
               where ol.store_id = o.store_id and ol.order_id = o.id and ol.delivery = 'physical') as ships,
      exists (select 1 from commerce.order_lines ol
               where ol.store_id = o.store_id and ol.order_id = o.id and ol.delivery = 'digital' and ol.variant_id is not null) as digital,
      s.interval, s.interval_count, s.total_minor as renewal_minor
    from commerce.orders o
    join commerce.payments pay on pay.store_id = o.store_id and pay.order_id = o.id and pay.provider = 'stripe'
    join commerce.connected_accounts a on a.store_id = pay.store_id and a.account_id = pay.provider_account
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
