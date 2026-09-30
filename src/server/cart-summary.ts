import "server-only";

import { cartSubtotal } from "@/lib/cart";
import { memberOffAfterCampaign } from "@/lib/campaigns";
import { vatIncluded } from "@/lib/checkout";
import { venuePart } from "@/lib/pay-later";
import { basketShipping, planPrice } from "@/lib/subscriptions";

import { db } from "@/db/client";

import { bonusProgram, cartBonusOf, creditState, planFor } from "./bonus";
import { readCartId, type Cart, type CartLine, type Shop } from "./cart";
import { evaluateCampaigns } from "./campaigns";
import { memberDiscountFor } from "./customer-tiers";
import { getCustomer } from "./customers";
import { previewCartDiscount } from "./discounts";
import { getCheckoutInfo } from "./orders";

/**
 * What the cart page (and the slide-out cart, D64) shows a basket to cost:
 * items, sign-up fees, shipping, the discount code, VAT, and what is paid
 * now and at the venue (D66), worked out as `placeOrder()` will. Kept apart
 * from the page so tests can hold it against the order checkout places.
 */
export async function cartSummary(
  shop: Shop,
  cart: Cart,
  /** The buyer and the cart whose credits count, when the caller knows them; else the signed-in customer and the cookie's cart. */
  who: { customerId?: string | null; cartId?: string | null } = {},
) {
  const { storeId, market } = shop;
  const payable = cart.lines.filter(
    (line): line is CartLine & { unitPriceMinor: number } =>
      line.status !== "unavailable" && line.unitPriceMinor !== null,
  );
  const blocked = cart.lines.some((line) => line.status !== "ok");
  const checkout = await getCheckoutInfo(storeId, market.code, market);
  const plan = payable.find((line) => line.plan)?.plan ?? null;
  // In a free trial, what renews costs nothing today (D29).
  const trial = (plan?.trialDays ?? 0) > 0;
  const today = (line: CartLine & { unitPriceMinor: number }) => (trial && line.plan ? 0 : line.unitPriceMinor * line.quantity);
  // One sign-up fee per purchase option (D29).
  const fees = [
    ...new Map(
      payable
        .filter((l) => l.plan && l.plan.signupFeeMinor > 0)
        .map((l) => [l.plan!.id, { amount: l.plan!.signupFeeMinor, rate: l.vatRate }]),
    ).values(),
  ];
  const feeMinor = fees.reduce((sum, fee) => sum + fee.amount, 0);
  const subtotal = cartSubtotal(payable.map((line) => ({ unitPriceMinor: today(line), quantity: 1 })));
  // Downloads alone need no shipping (D24); a subscription pays it per delivery (D25).
  const ships = cart.lines.some((line) => line.delivery === "physical");
  const digital = cart.lines.some((line) => line.delivery === "digital");
  const basket = basketShipping(
    payable.map((line) => ({
      totalMinor: line.unitPriceMinor * line.quantity,
      delivery: line.delivery,
      recurring: line.plan !== null,
    })),
    checkout.shipping,
    { trial },
  );
  const shipping = !ships ? 0 : checkout.shipping ? basket.first : null;
  // The buyer's group or company discount (D108), off what is bought once, before any code, as checkout takes it.
  const customerId = who.customerId !== undefined ? who.customerId : ((await getCustomer(storeId))?.id ?? null);
  const member = await memberDiscountFor(db(), storeId, customerId);
  // Campaigns (D114) come first: reductions on goods bought once, and the free products the basket has earned.
  const campaigns = await evaluateCampaigns(
    db(),
    { storeId, market },
    payable.map((line, i) => ({
      key: String(i),
      productId: line.productId,
      unitMinor: line.unitPriceMinor,
      quantity: line.quantity,
      discountable: !line.plan && !line.booking && line.unitPriceMinor > 0,
      valueMinor: today(line),
    })),
    { ships, customerId },
  );
  const campaignOff = payable.map((_, i) => campaigns.result.lineOff[String(i)] ?? 0);
  const campaignDiscountMinor = campaignOff.reduce((sum, off) => sum + off, 0);
  const memberOff = payable.map((line, i) =>
    member && !line.plan && line.unitPriceMinor > 0 ? memberOffAfterCampaign(line.unitPriceMinor, line.quantity, campaignOff[i], member.percent) : 0,
  );
  const memberDiscountMinor = memberOff.reduce((sum, off) => sum + off, 0);
  // The discount code, checked against this basket as checkout will (D31).
  const code = await previewCartDiscount(
    { storeId, market },
    {
      lines: payable.map((line, i) => ({
        key: String(i),
        productId: line.productId,
        // What the code is taken off: the price after the group's discount for what is bought once.
        unitMinor: member && !line.plan ? planPrice(line.unitPriceMinor, member.percent) : line.unitPriceMinor,
        quantity: line.quantity,
        todayMinor: today(line) - campaignOff[i] - memberOff[i],
        recurring: line.plan !== null,
      })),
      shippingMinor: shipping ?? 0,
    },
  );
  const applied = code?.ok ? code.applied : null;
  const codeDiscountMinor = applied?.totalMinor ?? 0;
  const discountMinor = codeDiscountMinor + memberDiscountMinor + campaignDiscountMinor;
  // A recurring percentage lowers what each renewal costs, and so its shipping.
  const renewUnit = (line: (typeof payable)[number], i: number) => applied?.renewalUnits[String(i)] ?? line.unitPriceMinor;
  const renewing = payable
    .map((line, i) => ({ line, i }))
    .filter(({ line }) => line.plan)
    .reduce((sum, { line, i }) => sum + renewUnit(line, i) * line.quantity, 0);
  const renewalShipping =
    applied && Object.keys(applied.renewalUnits).length > 0
      ? basketShipping(
          payable.map((line, i) => ({
            totalMinor: renewUnit(line, i) * line.quantity,
            delivery: line.delivery,
            recurring: line.plan !== null,
          })),
          checkout.shipping,
          { trial },
        ).renewal
      : basket.renewal;
  const renewal = plan ? renewing + renewalShipping : null;
  const codeLine = (i: number) => applied?.lines[String(i)] ?? 0;
  const memberLine = (i: number) => memberOff[i] ?? 0;
  const campaignLine = (i: number) => campaignOff[i] ?? 0;
  const lineDiscount = (i: number) => codeLine(i) + memberLine(i) + campaignLine(i);
  // Appointments paid at the venue, or the rest after a deposit (D66), as checkout will work it out.
  const venueOf = payable.map((line, i) => venuePart(today(line) - lineDiscount(i), line.payment));
  const balance = venueOf.reduce((sum, part) => sum + part, 0);
  // Bonus credits (D130) come last, off goods bought once that are still to pay online: after campaigns, the group's
  // discount and codes, and never off a subscription, the part left for a venue, sign-up fees or shipping.
  const program = await bonusProgram(db(), storeId);
  const sellerIsHost = payable.some((line) => line.hostId);
  const credits = sellerIsHost ? null : await creditState(db(), shop, customerId, who.cartId !== undefined ? who.cartId : await readCartId(shop), program);
  const eligible = payable.map((line, i) => (line.plan || line.unitPriceMinor <= 0 ? 0 : Math.max(0, today(line) - lineDiscount(i) - venueOf[i])));
  const dueBeforeCredits = subtotal + feeMinor + (shipping ?? 0) - discountMinor - balance;
  const creditPlan = planFor(credits, eligible, dueBeforeCredits);
  const bonusMinor = creditPlan.usingMinor;
  const bonusLine = (i: number) => creditPlan.lines[i] ?? 0;
  const total = subtotal + feeMinor + (shipping ?? 0) - discountMinor - bonusMinor;
  const vat =
    payable.reduce((sum, line, i) => sum + vatIncluded(today(line) - lineDiscount(i) - bonusLine(i), line.vatRate), 0) +
    fees.reduce((sum, fee) => sum + vatIncluded(fee.amount, fee.rate), 0) +
    vatIncluded((shipping ?? 0) - (applied?.shippingMinor ?? 0), checkout.vatRate);
  // What this order will earn: what is paid online for goods and fees once credits are off, as the database counts it.
  const paidOnlineGoods = payable.reduce((sum, line, i) => sum + today(line) - lineDiscount(i) - bonusLine(i) - venueOf[i], 0) + feeMinor;
  const bonus = cartBonusOf(shop.market, program, credits, creditPlan, customerId !== null, paidOnlineGoods, !sellerIsHost);
  // Nothing to pay online: the shopper tells who books instead of Stripe asking.
  const atVenueOnly = balance > 0 && balance === total;
  return {
    payable,
    blocked,
    checkout,
    plan,
    trial,
    today,
    fees,
    feeMinor,
    subtotal,
    ships,
    digital,
    basket,
    shipping,
    code,
    applied,
    discountMinor,
    /** What the buyer's group or company gives, its name and percent, and what a code gives: `discountMinor` is both. */
    member,
    memberDiscountMinor,
    codeDiscountMinor,
    /** What campaigns give (D114): the names of those that reduced something, the amount, and the free products earned. */
    campaignDiscountMinor,
    campaignNames: campaigns.result.applied.map((a) => a.name),
    campaignLine,
    gifts: campaigns.gifts,
    renewal,
    lineDiscount,
    codeLine,
    memberLine,
    /** Bonus credits used (D130), in the currency shown: off the goods last, part of the order's discount; `discountMinor` leaves them out. */
    bonusMinor,
    bonusLine,
    bonus,
    total,
    vat,
    balance,
    atVenueOnly,
    /** What Stripe is asked for: all but the part left for the venue. */
    dueNowMinor: total - balance,
  };
}
