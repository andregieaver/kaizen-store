import "server-only";

import { randomBytes } from "node:crypto";

import { sql, type SQL } from "drizzle-orm";
import { after } from "next/server";
import type Stripe from "stripe";

import { db } from "@/db/client";
import { formatClock, formatRangeDates, parseRentalPeriod, rangeEndsAt } from "@/lib/booking-ranges";
import { formatBookingTime } from "@/lib/booking-slots";
import { companyRequired, parseProductAudience, parseStoreAudience } from "@/lib/b2b";
import { CHECKOUT_MINUTES, lineWithdrawal, vatIncluded } from "@/lib/checkout";
import { isNative, shown, type Market } from "@/lib/markets";
import { marketPath, storeOrigin } from "@/lib/paths";
import { shownOptions, t } from "@/lib/i18n";
import { parsePaymentMode, venuePart } from "@/lib/pay-later";
import { GENERAL_TAX_CODE, parseDelivery, variantLabel, type Delivery } from "@/lib/product-input";
import { campaignLabel, memberOffAfterCampaign } from "@/lib/campaigns";
import type { OrderVatTreatment, VatKind } from "@/lib/vat-treatment";
import { applyDiscount } from "@/lib/discounts";
import { basketShipping, planPrice, sameRhythm, type PlanInterval } from "@/lib/subscriptions";

import type { PaymentModeName } from "@/lib/stripe-account";
import { shownMeasureFromColumns } from "@/lib/unit-price-rules";
import { giftOfRow, NO_GIFT, type GiftFields } from "@/lib/gift";

import { holdAppointment } from "./appointments";
import { allocateStock, insertOrder, insertOrderLine, reserveStock, type StockHold } from "./order-insert";
import { holdRange, linePrice, rangePricing } from "./ranges";
import { recordExperimentCart } from "./experiments";
import { sendBookingStaffNotices, sendOrderConfirmation } from "./shopper-emails";
import { decideTax, loadTaxFacts } from "./tax-treatment";
import { refreshStaleCartCheck } from "./vat-checks";
import { bookable } from "./cart";
import { ensureStorePaymentMethods, getCheckoutUi } from "./connect";
import { evaluateCampaigns } from "./campaigns";
import { memberDiscountFor } from "./customer-tiers";
import { chosenDelivery } from "./delivery-options";
import { friendState, rememberAffiliate, welcomeFor } from "./affiliates";
import { bonusProgram, creditState, debitFor, planFor } from "./bonus";
import { findUsableDiscount } from "./discounts";
import { openPaymentSession, paymentConnection } from "./payment-session";

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
  /** The VAT included in the total (0 with reverse charge). */
  taxMinor: number;
  /**
   * Which VAT the order carries (D157): `standard`, `reverse_charge` (the VAT not charged, `vatReliefMinor`, is part of the
   * order's discount, and the lines and the total are net) or `ioss`; `shippingReliefMinor` is the shipping's part of the
   * relief. `treatment` is what the order keeps (both VAT numbers, the VIES answer), null for a host's order.
   */
  vatKind: VatKind;
  vatReliefMinor: number;
  shippingReliefMinor: number;
  treatment: OrderVatTreatment | null;
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
        p.kind, aps.check_in_time, aps.check_out_time, v.rental_period, p.host_id, v.cost_minor,
        v.measure_amount, v.measure_unit, v.measure_base, v.stock_policy, v.backorder_days,
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
  {
    customerId = null,
    noBackorder = false,
  }: {
    customerId?: string | null;
    /** Never sells past stock, whatever a variant's policy says: a weekly box is filled from free stock only (wave 3, D172). */
    noBackorder?: boolean;
  } = {},
): Promise<PlaceResult> {
  const { storeId, market } = shop;
  return inTransaction(async (tx): Promise<PlaceResult> => {
    const [cart] = await tx.execute<Row>(sql`
      select c.id, c.discount_code, c.company_name, c.organisation_number, s.audience as store_audience, s.time_zone,
        c.bonus_request_minor, c.affiliate_code, c.is_gift, c.gift_to, c.gift_from, c.gift_message,
        coalesce((select os.gift_messages from commerce.order_settings os where os.store_id = c.store_id), false) as gift_on
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
    // Which VAT the order carries (D157) rests on facts read here, with the cart's stored check of its VAT number: VIES is
    // never asked while an order is placed. Each line takes its product's rate (D65); a fee without one, the standard rate.
    const taxFacts = await loadTaxFacts(tx, { storeId, market, cartId });
    const vatRate = taxFacts.standardRate;

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
        /** The part of the discount that is VAT not charged (reverse charge, D157), taken off after everything else. */
        relief: 0,
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
    const gifted = new Set<Row>();
    for (const gift of outcome.gifts) {
      const [row] = await orderLineRows(
        tx,
        market,
        sql`(values (${storeId}::uuid, ${gift.variantId}::uuid, ${gift.quantity}::int, null::uuid, null::timestamptz, null::uuid)) as cl (store_id, variant_id, quantity, selling_plan_id, starts_at, resource_id)`,
        sql`true`,
      );
      if (!row || !row.sellable || !row.plan_ok || row.amount_minor === null) continue;
      lines.push(row);
      gifted.add(row);
      const p = price(row);
      const whole = p.unit * p.quantity;
      priced.push({ ...p, gift: true, campaign: whole, campaignId: gift.campaignId, parts: [{ campaignId: gift.campaignId, name: gift.campaignName, minor: whole }], discount: whole, total: 0 });
    }

    // Where the units come from (D172, `docs/wave-3-inventory.md` 2.5). The level rows of every variant being bought are locked
    // first, in the one order every writer uses (variant, location), so two checkouts cannot deadlock; then the free units are
    // counted (on hand minus live holds) and `allocate()` applies the stated rule. A variant that keeps selling on backorder takes
    // the units beyond its stock too, at the location the rule names; one that stops at zero fails the order with `stock`.
    const toShip = lines.filter((l) => l.delivery === "physical");
    // The units of each variant that are backordered at placement, given to its lines (paid ones first, a gift last), and kept on the
    // reservation (`backorder_quantity`): the rest of the hold is the order's own physical claim, which a checkout started later and paid
    // first cannot take (`commerce.draw_order_stock()`), so what the shopper was told stays true; the draw settles the figure at payment.
    const backorderOfLine = new Map<number, number>();
    let allocations: StockHold[] = [];
    if (toShip.length > 0) {
      const keeps = noBackorder ? [] : [...new Set(toShip.filter((l) => l.stock_policy === "continue").map((l) => String(l.variant_id)))];
      const plan = await allocateStock(
        tx,
        storeId,
        // The same variant can be bought once and subscribed to: it is one want. A free gift is never backordered: it makes its variant's want a `deny` one.
        toShip.map((l) => ({
          variantId: String(l.variant_id),
          quantity: Number(l.quantity),
          policy: l.stock_policy === "continue" && !gifted.has(l) && !noBackorder ? ("continue" as const) : ("deny" as const),
        })),
        keeps,
      );
      if (!plan.ok) return { ok: false, problem: "stock" };
      allocations = plan.holds;
      const behind = new Map(plan.behind);
      // Paid lines first (in the order of the lines), then gifts.
      const order = priced.map((p, i) => ({ p, i })).filter(({ p }) => p.delivery === "physical" && !p.startsAt).sort((x, y) => Number(x.p.gift) - Number(y.p.gift) || x.i - y.i);
      for (const { p, i } of order) {
        const variantId = String(p.line.variant_id);
        const left = behind.get(variantId) ?? 0;
        const give = Math.min(left, p.quantity);
        if (give > 0) backorderOfLine.set(i, give);
        behind.set(variantId, left - give);
      }
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
    const shippingWith = (offer: typeof shippingRate) =>
      basketShipping(
        priced.filter((p) => !p.gift).map((p) => ({ totalMinor: p.renewUnit * p.quantity, delivery: p.delivery, recurring: p.recurring })),
        offer,
        { trial },
      );
    const shippingFor = () => shippingWith(shippingRate);
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
    // The cheapest standard delivery on offer, kept with the order (D153): a withdrawal of the whole order gives back no
    // more delivery than this (CRD Art. 13(1)), whatever a carrier's dearer service the shopper chose cost. It is the
    // market's flat rate, free over its limit judged on the basket before discounts, as shown in the order's currency.
    const standardShipping = chosen
      ? rate
        ? shippingWith({
            amountMinor: shown(market, Number(rate.amount_minor)),
            freeOverMinor: rate.free_over_minor === null ? null : shown(market, Number(rate.free_over_minor)),
          }).first
        : null
      : shipping;
    // Who pays for sending a withdrawn item back, as the store's setting stands now: the shopper is told of it before buying.
    const [returnRules] = await tx.execute<Row>(sql`select who_pays_return from commerce.return_settings where store_id = ${storeId}::uuid`);
    const returnCostPayer = returnRules?.who_pays_return === "store" ? "store" : "shopper";
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
    // Which VAT the order carries (D157): the same decision the cart page made (`cartSummary()`), on what is left to pay
    // after every discount and credit. With reverse charge the VAT not charged is the last part of each line's discount
    // (and of the shipping's), so the lines and the total are net and the database's sums still add up.
    const taxed = priced.map((p, i) => ({ p, i })).filter(({ p }) => !p.gift);
    const taxOutcome = decideTax(taxFacts, {
      lines: taxed.map(({ p, i }) => ({
        key: String(i),
        totalMinor: p.total,
        rate: p.rate,
        booking: p.line.kind !== "goods",
        physical: p.delivery === "physical",
        recurring: p.recurring,
        host: Boolean(p.line.host_id),
      })),
      shippingMinor: shipping - shippingDiscount,
      fees: fees.map((fee) => ({ amountMinor: fee.amount, rate: fee.rate })),
      currency: market.currency,
    });
    const taxOfLine = new Map(taxOutcome.result.lines.map((line) => [line.key, line]));
    priced.forEach((p, i) => {
      const relief = taxOfLine.get(String(i))?.reliefMinor ?? 0;
      p.relief = relief;
      p.discount += relief;
      p.total -= relief;
    });
    const shippingRelief = taxOutcome.result.shipping.reliefMinor;
    const discountAll = discountTotal + creditTotal + taxOutcome.reliefMinor;
    // discountTotal already holds the welcome discount: it is part of each line's discount.
    const tax = taxOutcome.taxMinor;
    const total = subtotal + shipping - discountAll;

    // The order is numbered and written in `insertOrder()`, the one place that does (D141, `src/server/order-insert.ts`). The buyer's
    // gift (D173) is copied from the cart when the store has gift messages on; a store with the switch off ignores whatever the cart holds.
    const gift: GiftFields = cart.gift_on ? giftOfRow(cart) : NO_GIFT;
    const { orderId, number: orderNumber } = await insertOrder(tx, {
      storeId,
      marketCode: market.code,
      currency: market.currency,
      locale: market.locale,
      cartId,
      subtotalMinor: subtotal,
      shippingMinor: shipping,
      discountMinor: discountAll,
      taxMinor: tax,
      totalMinor: total,
      digitalConsentAt: digital ? "now" : null,
      customerId,
      discountCodeId: discount?.id ?? null,
      discountCode: discount?.code ?? null,
      companyName: company?.name ?? null,
      organisationNumber: company?.number ?? null,
      balanceMinor: balance,
      hostId,
      memberDiscountMinor: memberTotal,
      memberLabel: memberTotal > 0 ? member!.label : null,
      memberPercent: memberTotal > 0 ? member!.percent : null,
      campaignDiscountMinor: campaignTotal,
      campaignLabel: campaignTotal > 0 ? campaignText : null,
      creditMinor: creditTotal,
      referralDiscountMinor: referralTotal,
      delivery: chosen ? chosen.delivery : null,
      standardShippingMinor: standardShipping,
      returnCostPayer,
      vatKind: taxOutcome.decision.kind,
      vatReliefMinor: taxOutcome.reliefMinor,
      shippingTaxRate: taxOutcome.shippingRate,
      vatTreatment: taxOutcome.treatment,
      vatCheckId: taxFacts.buyerCheck?.id ?? null,
      gift,
    });

    for (const [i, p] of priced.entries()) {
      // What the variant holds when it is sold (D160), with the base in effect in this market: frozen on the line, so the
      // order page and its emails say what the order said. A booking has none; it changes no money.
      const snapshot = p.startsAt ? null : shownMeasureFromColumns(p.line.measure_amount, p.line.measure_unit, p.line.measure_base, market.code);
      const orderLineId = await insertOrderLine(tx, storeId, orderId, {
        variantId: String(p.line.variant_id),
        sku: String(p.line.sku),
        title: p.title,
        quantity: p.quantity,
        unitPriceMinor: p.unit,
        discountMinor: p.discount,
        memberDiscountMinor: p.member,
        totalMinor: p.total,
        taxMinor: taxOfLine.get(String(i))?.taxMinor ?? 0,
        taxRate: p.rate,
        taxCode: String(p.line.tax_code),
        withdrawalExclusion: lineWithdrawal(p.delivery, String(p.line.withdrawal_exclusion)),
        delivery: p.delivery,
        sellingPlanId: p.recurring ? String(p.line.selling_plan_id) : null,
        planInterval: p.recurring ? String(p.line.interval) : null,
        planIntervalCount: p.recurring ? Number(p.line.interval_count) : null,
        venueMinor: venue[i],
        bookedCount: p.range && p.startsAt ? p.count : null,
        campaignDiscountMinor: p.campaign,
        campaignId: p.campaignId,
        campaignParts: p.parts.map((part) => ({ id: part.campaignId, name: part.name, minor: part.minor })),
        gift: p.gift,
        bonusDiscountMinor: p.bonus,
        referralDiscountMinor: p.referral,
        unitCostMinor: p.line.cost_minor === null || p.line.cost_minor === undefined ? null : Number(p.line.cost_minor),
        vatReliefMinor: p.relief,
        measure: snapshot ? { amount: snapshot.amount, unit: snapshot.unit, base: snapshot.base } : null,
        backorderQuantity: backorderOfLine.get(i) ?? 0,
        backorderDays: backorderOfLine.has(i) && p.line.backorder_days !== null && p.line.backorder_days !== undefined ? Number(p.line.backorder_days) : null,
      });
      // The appointment's time (or the stay's or rental's nights or days, D67) is held as long as
      // its stock would be; taken meanwhile, nothing is placed.
      if (p.startsAt) {
        const hold = {
          productId: String(p.line.product_id),
          variantId: String(p.line.variant_id),
          startsAt: p.startsAt,
          resourceId: p.line.resource_id ? String(p.line.resource_id) : null,
          orderId,
          orderLineId,
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
        renewing.reduce((sum, p) => sum + vatIncluded(p.renewUnit * p.quantity, p.rate), 0) + vatIncluded(basket.renewal, taxOutcome.shippingRate);
      const [row] = await tx.execute<Row>(sql`
        insert into commerce.subscriptions (
          store_id, number, market_code, currency, locale, interval, interval_count, min_cycles,
          subtotal_minor, shipping_minor, total_minor, tax_minor, first_order_id, manage_token, customer_id
        ) values (
          ${storeId}::uuid, ${orderNumber}, ${market.code}, ${market.currency}, ${market.locale},
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
    await reserveStock(tx, storeId, orderId, allocations, { minutes: CHECKOUT_MINUTES + 5 });
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
        number: orderNumber,
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
        vatKind: taxOutcome.decision.kind,
        vatReliefMinor: taxOutcome.reliefMinor,
        shippingReliefMinor: shippingRelief,
        treatment: taxOutcome.treatment,
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
                  priced.reduce((sum, p, i) => sum + (lowered.has(i) ? 0 : p.discount - p.relief), 0) +
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

// The shipping lines of a subscription's session now live with the session itself (`payment-session.ts`); checkout's tests still reach them here.
export { subscriptionShipping } from "./payment-session";

export type CheckoutStart = { ok: true; url: string } | { ok: false; problem: CheckoutProblem; orderId?: string };

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
  const connected = await paymentConnection(shop.storeId);
  if (!connected) return { ok: false, problem: "payments_off" };
  const { connection, stripe } = connected;
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

  // A VAT number checked more than 24 hours ago (or that VIES could not answer) is asked again here, before the order is
  // placed, and never while it is (D157); a failure only means VAT is charged. Never stops the checkout.
  await refreshStaleCartCheck({ storeId: shop.storeId, market: shop.market }, cartId);
  const placed = await placeOrder(shop, cartId, consent, { customerId });
  if (!placed.ok) return placed;
  const { order } = placed;
  // A checkout of an enrolled visitor (D148): counted in the tests they were shown; never fails the checkout.
  await recordExperimentCart(shop.storeId, cartId, "checkout");
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
  const opened = await openPaymentSession(shop, order, origin, shippingLabel, { connection, ui, stripe });
  if (opened.ok) return { ok: true, url: opened.url };
  // The session could not be made: nothing was paid and nothing will be, so the order waiting for it is cancelled and its stock goes back.
  await cancelUnpaidOrder(order.orderId, opened.problem === "host_payments_off" ? "the host cannot take payments" : "stripe session could not be created");
  return { ok: false, problem: opened.problem };
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
         is distinct from o.credit_minor
      -- So does checking or changing the VAT number (D157): the order's VAT follows the check it was placed with.
      or (select c.vat_check_id from commerce.carts c where c.store_id = o.store_id and c.id = o.cart_id)
         is distinct from o.vat_check_id
      -- So does a gift message (D173): the order holds the gift as the cart had it when it was placed, and a store with the switch off holds none.
      or (select case when coalesce((select os.gift_messages from commerce.order_settings os where os.store_id = c.store_id), false)
                      then row(c.is_gift, c.gift_to, c.gift_from, c.gift_message)
                      else row(false, null::text, null::text, null::text) end
            from commerce.carts c where c.store_id = o.store_id and c.id = o.cart_id)
         is distinct from row(o.is_gift, o.gift_to, o.gift_from, o.gift_message) as changed,
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
export async function closeSession(
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
