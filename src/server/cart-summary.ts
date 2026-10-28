import "server-only";

import { cartSubtotal } from "@/lib/cart";
import { NO_CART_AFFILIATE } from "@/lib/affiliates";
import { memberOffAfterCampaign } from "@/lib/campaigns";
import { minChargeMinor } from "@/lib/bonus";
import { NO_RULES } from "@/lib/checkout-rules";
import { giftCardsPay } from "@/lib/gift-cards";
import { venuePart } from "@/lib/pay-later";
import { basketShipping, planPrice } from "@/lib/subscriptions";

import { db } from "@/db/client";

import { cartAffiliateOf, codeInPlay, friendState, welcomeFor } from "./affiliates";
import { bonusProgram, cartBonusOf, creditState, planFor } from "./bonus";
import { readCartId, type Cart, type CartLine, type Shop } from "./cart";
import { memberDiscountFor } from "./customer-tiers";
import { resolveDelivery } from "./delivery-options";
import { checkoutRuleOutcome } from "./checkout-rules";
import { getCustomer } from "./customers";
import { getCartCodes, previewCartCodes } from "./discounts";
import { campaignsAndCodes } from "./discount-combinations";
import { cartGiftCards } from "./gift-card-cart";
import { getCheckoutInfo } from "./orders";
import { decideCustoms, loadCustomsFacts } from "./customs";
import { cartTaxOf, decideTax, loadTaxFacts } from "./tax-treatment";

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
  const linesBlocked = cart.lines.some((line) => line.status !== "ok");
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
  // Downloads (D24) ask a tick that ends the right of withdrawal; a gift card (D300) is emailed as a code and asks none.
  const digital = cart.lines.some((line) => line.delivery === "digital" && line.giftCard === null);
  // The delivery the shopper chose at checkout (D135) is the basket's shipping rate instead of the market's flat rate;
  // a subscription pays the flat rate on each delivery (D25), so there it counts for nothing.
  const cartId = who.cartId !== undefined ? who.cartId : await readCartId(shop);
  // The one reader of the cart's delivery (D237): the store's own methods priced for this basket at the delivery postal code's zone, a pickup
  // place or a local area, or the flat rate; `placeOrder()` reads the same with the same basket value (the lines' totals before discounts).
  // A gift card (D300) is money paid now to be spent later: nothing comes off it and it counts towards no threshold, as `placeOrder()` reads it.
  const voucher = (line: (typeof payable)[number]) => line.giftCard !== null;
  const basketValueMinor = payable.filter((line) => !voucher(line)).reduce((sum, line) => sum + line.unitPriceMinor * line.quantity, 0);
  const customerId = who.customerId !== undefined ? who.customerId : ((await getCustomer(storeId))?.id ?? null);
  // Checkout rules (D357): what they hide, rename or refuse for this basket, read once and handed to the delivery reader, as `placeOrder()` does.
  const rules = cartId ? await checkoutRuleOutcome(db(), storeId, cartId, market, { customerId, basketValueMinor }) : NO_RULES;
  const resolved = ships && !plan && cartId ? await resolveDelivery(db(), storeId, cartId, market, { basketValueMinor, customerId, rules }) : null;
  const chosen = resolved?.chosen ?? null;
  const rate = resolved ? resolved.rate : checkout.shipping;
  const basketLines = payable.filter((line) => !voucher(line)).map((line) => ({
    totalMinor: line.unitPriceMinor * line.quantity,
    delivery: line.delivery,
    recurring: line.plan !== null,
  }));
  const basket = basketShipping(basketLines, rate, { trial });
  /** What shipping would cost this basket at another rate (a delivery option to choose), free above its threshold. */
  const shippingAt = (other: { amountMinor: number; freeOverMinor: number | null }) => basketShipping(basketLines, other, { trial }).first;
  const shipping = !ships ? 0 : rate ? basket.first : null;
  // The buyer's group or company discount (D108), off what is bought once, before any code, as checkout takes it.
  const member = await memberDiscountFor(db(), storeId, customerId);
  // The friend's welcome discount (D131) comes after campaigns and the group's discount and before any code and the credits; only a
  // signed-in friend's first order, and never a host's.
  const program = await bonusProgram(db(), storeId);
  const sellerIsHost = payable.some((line) => line.hostId);
  const friend = sellerIsHost ? null : await friendState(db(), storeId, customerId, await codeInPlay(db(), storeId, cartId), program);
  /** The group's discount on each line after what campaigns took off it. */
  const memberOffAfter = (campaignOff: readonly number[]) =>
    payable.map((line, i) =>
      member && !line.plan && !line.priceListId && !voucher(line) && line.unitPriceMinor > 0 ? memberOffAfterCampaign(line.unitPriceMinor, line.quantity, campaignOff[i], member.percent) : 0,
    );
  /** The welcome discount on each line after campaigns and the group's discount. */
  const welcomeAfter = (campaignOff: readonly number[], memberOff: readonly number[]) =>
    friend
      ? welcomeFor(
          friend,
          market,
          payable.map((line, i) => (line.plan || voucher(line) || line.unitPriceMinor <= 0 ? 0 : Math.max(0, today(line) - campaignOff[i] - memberOff[i]))),
        )
      : { totalMinor: 0, lines: payable.map(() => 0) };
  /** What the codes are checked against once campaigns, the group's discount and the welcome discount took their parts. */
  const codeLines = (campaignOff: readonly number[], memberOff: readonly number[], referralOff: readonly number[]) =>
    // A gift card is never in what a code reaches or counts (D300).
    payable.flatMap((line, i) =>
      voucher(line)
        ? []
        : [
            {
              key: String(i),
              productId: line.productId,
              // What the code is taken off: the price after the group's discount for what is bought once.
              unitMinor: member && !line.plan && !line.priceListId ? planPrice(line.unitPriceMinor, member.percent) : line.unitPriceMinor,
              quantity: line.quantity,
              todayMinor: today(line) - campaignOff[i] - memberOff[i] - referralOff[i],
              recurring: line.plan !== null,
            },
          ],
    );
  // Campaigns (D114) come first: reductions on goods bought once, and the free products the basket has earned; where a campaign and a
  // code on the cart do not combine (D367), whichever saves the shopper more, decided as `placeOrder()` decides it.
  const codeTexts = await getCartCodes(shop);
  // Free shipping from a campaign (D299 E3): the basket's first shipping, before any code, never with a subscription.
  const freeShippingWorth = ships && !plan ? (shipping ?? 0) : 0;
  const chosenCampaigns = await campaignsAndCodes(
    db(),
    { storeId, market },
    payable.map((line, i) => ({
      key: String(i),
      productId: line.productId,
      unitMinor: line.unitPriceMinor,
      quantity: line.quantity,
      discountable: !line.plan && !line.booking && !voucher(line) && line.unitPriceMinor > 0,
      valueMinor: voucher(line) ? 0 : today(line),
    })),
    { ships, customerId },
    codeTexts,
    freeShippingWorth,
    (lineOff, shippingOff) => {
      const off = payable.map((_, i) => lineOff[String(i)] ?? 0);
      const memberOff = memberOffAfter(off);
      const welcome = welcomeAfter(off, memberOff);
      return {
        codes: { lines: codeLines(off, memberOff, welcome.lines), shippingMinor: (shipping ?? 0) - shippingOff },
        otherMinor: memberOff.reduce((sum, minor) => sum + minor, 0) + welcome.totalMinor,
      };
    },
  );
  const campaigns = chosenCampaigns.outcome;
  const campaignOff = payable.map((_, i) => campaigns.result.lineOff[String(i)] ?? 0);
  const freeShipping = campaigns.result.freeShipping && freeShippingWorth > 0 ? campaigns.result.freeShipping : null;
  const campaignShippingMinor = freeShipping ? freeShippingWorth : 0;
  const campaignDiscountMinor = campaignOff.reduce((sum, off) => sum + off, 0) + campaignShippingMinor;
  const memberOff = memberOffAfter(campaignOff);
  const memberDiscountMinor = memberOff.reduce((sum, off) => sum + off, 0);
  const welcome = welcomeAfter(campaignOff, memberOff);
  const referralOff = welcome.lines;
  const referralMinor = welcome.totalMinor;
  // The discount codes, checked against this basket as checkout will (D31); the best of them that may be used together (D299 E2),
  // as far as the campaigns taken let them in (D367).
  const code = await previewCartCodes(
    { storeId, market },
    { lines: codeLines(campaignOff, memberOff, referralOff), shippingMinor: (shipping ?? 0) - campaignShippingMinor },
    { texts: codeTexts, customerId, campaigns: chosenCampaigns.codeRule },
  );
  const applied = code?.applied ?? null;
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
          payable.flatMap((line, i) =>
            voucher(line)
              ? []
              : [
                  {
                    totalMinor: renewUnit(line, i) * line.quantity,
                    delivery: line.delivery,
                    recurring: line.plan !== null,
                  },
                ],
          ),
          rate,
          { trial },
        ).renewal
      : basket.renewal;
  const renewal = plan ? renewing + renewalShipping : null;
  const codeLine = (i: number) => applied?.lines[String(i)] ?? 0;
  const memberLine = (i: number) => memberOff[i] ?? 0;
  const campaignLine = (i: number) => campaignOff[i] ?? 0;
  const referralLine = (i: number) => referralOff[i] ?? 0;
  /** What codes, the group and campaigns take off a line (the discount row); the welcome discount and the credits are their own rows. */
  const lineDiscount = (i: number) => codeLine(i) + memberLine(i) + campaignLine(i);
  /** Everything off a line before the credits. */
  const lineOff = (i: number) => lineDiscount(i) + referralLine(i);
  // Appointments paid at the venue, or the rest after a deposit (D66), as checkout will work it out.
  const venueOf = payable.map((line, i) => venuePart(today(line) - lineOff(i), line.payment));
  const balance = venueOf.reduce((sum, part) => sum + part, 0);
  // Bonus credits (D130) come last, off goods bought once that are still to pay online: after campaigns, the group's
  // discount and codes, and never off a subscription, the part left for a venue, sign-up fees or shipping.
  const credits = sellerIsHost ? null : await creditState(db(), shop, customerId, cartId, program);
  const eligible = payable.map((line, i) => (line.plan || voucher(line) || line.unitPriceMinor <= 0 ? 0 : Math.max(0, today(line) - lineOff(i) - venueOf[i])));
  const dueBeforeCredits = subtotal + feeMinor + (shipping ?? 0) - discountMinor - referralMinor - balance;
  const creditPlan = planFor(credits, eligible, dueBeforeCredits);
  const bonusMinor = creditPlan.usingMinor;
  const bonusLine = (i: number) => creditPlan.lines[i] ?? 0;
  // Which VAT the basket carries (D157), decided as `placeOrder()` decides it, on what is left to pay after every discount
  // and credit. With reverse charge the VAT not charged comes off the total last, as the order's discount does.
  const taxFacts = await loadTaxFacts(db(), { storeId, market, cartId });
  const taxBasket = {
    lines: payable.map((line, i) => ({
      key: String(i),
      totalMinor: today(line) - lineOff(i) - bonusLine(i),
      rate: line.vatRate,
      booking: line.booking !== null,
      physical: line.delivery === "physical",
      recurring: line.plan !== null,
      host: line.hostId !== null,
    })),
    shippingMinor: (shipping ?? 0) - (applied?.shippingMinor ?? 0) - campaignShippingMinor,
    fees: fees.map((fee) => ({ amountMinor: fee.amount, rate: fee.rate })),
    currency: market.currency,
  };
  const taxOutcome = decideTax(taxFacts, taxBasket);
  const reliefMinor = taxOutcome.reliefMinor;
  const reliefLine = (i: number) => taxOutcome.result.lines[i]?.reliefMinor ?? 0;
  const total = subtotal + feeMinor + (shipping ?? 0) - discountMinor - referralMinor - bonusMinor - reliefMinor;
  const vat = taxOutcome.taxMinor;
  // Customs and duties (D343): the estimate for a destination the goods cross a customs border into, and what DDP collects beside the total,
  // decided as `placeOrder()` decides it, on the tax decision's lines (after every discount) and shipping.
  const customsFacts = await loadCustomsFacts(db(), { storeId, market, variantIds: payable.map((line) => line.variantId), tax: taxFacts });
  const customs = decideCustoms(customsFacts, {
    lines: payable.map((line, i) => ({
      key: String(i),
      variantId: line.variantId,
      title: line.title,
      quantity: line.quantity,
      shipped: line.delivery === "physical" && line.booking === null,
      totalMinor: taxOutcome.result.lines[i]?.totalMinor ?? 0,
      taxMinor: taxOutcome.result.lines[i]?.taxMinor ?? 0,
      rate: line.vatRate,
    })),
    shippingMinor: taxOutcome.result.shipping.totalMinor,
    shippingTaxMinor: taxOutcome.result.shipping.taxMinor,
    currency: market.currency,
    ioss: taxOutcome.ioss === "applies",
    fallback: plan ? "subscription" : sellerIsHost ? "host" : balance > 0 ? "venue" : null,
  });
  // What this order will earn: what is paid online for goods and fees once credits are off, as the database counts it
  // (the lines' totals, which are net of the VAT not charged).
  const paidOnlineGoods =
    payable.reduce((sum, line, i) => sum + today(line) - lineOff(i) - bonusLine(i) - reliefLine(i) - venueOf[i], 0) + feeMinor;
  const bonus = cartBonusOf(shop.market, program, credits, creditPlan, customerId !== null, paidOnlineGoods, !sellerIsHost);
  // Nothing to pay online: the shopper tells who books instead of Stripe asking.
  const atVenueOnly = balance > 0 && balance === total;
  // Gift cards on the cart (D300 F3) pay what is due online, first and in the order added, as `placeOrder()` takes them: a payment, never a
  // discount, so the total and its VAT stay as they are. They never pay for a gift card, a subscription's order or a host's listing.
  const voucherMinor = payable.filter(voucher).reduce((sum, line) => sum + today(line), 0);
  const cardsBlocked: "subscription" | "host" | null = plan ? "subscription" : sellerIsHost ? "host" : null;
  const cards = cartId ? await cartGiftCards(db(), storeId, cartId, { currency: market.currency }) : [];
  const cardsPaid = giftCardsPay(
    cards.map((card) => ({ id: card.id, balanceMinor: card.balanceMinor, usable: card.problem === null && cardsBlocked === null })),
    cards.length > 0 && cardsBlocked === null ? total - balance - voucherMinor : 0,
    minChargeMinor(market.currency),
  );
  const giftCards = {
    /** Each card on the cart, in the order added, with what it pays here and holds after, or why it cannot pay (a key of `m.giftCardPay.problems`). */
    cards: cards.map((card, i) => ({
      id: card.id,
      last4: card.last4,
      currency: card.currency,
      amountMinor: cardsPaid.parts[i]?.amountMinor ?? 0,
      afterMinor: cardsPaid.parts[i]?.afterMinor ?? card.balanceMinor,
      problem: card.problem ?? cardsBlocked,
    })),
    paidMinor: cardsPaid.paidMinor,
    /** Nothing is left to pay online: no payment page follows, so who pays is asked on the cart (as for Mollie). */
    // Duties collected at checkout (DDP, D343) are never paid by a card: they need the payment page.
    coverAll: cardsPaid.paidMinor > 0 && total - balance - cardsPaid.paidMinor === 0 && customs.collectMinor === 0,
  };
  return {
    payable,
    /** Something stops the checkout: a line's own problem, DDP chosen for a basket with no duty estimate (D343), or a checkout rule's refusal (D357). */
    blocked: linesBlocked || customs.blocked || rules.refusal !== null,
    /** A checkout rule refuses this basket (D357): the owner's words, in the cart's language; null when none does. */
    refusal: rules.refusal?.message ?? null,
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
    /** The delivery chosen at checkout (D135), its order record, or null for the flat rate; `shippingAt()` prices another rate. */
    delivery: chosen,
    /**
     * The whole of the basket's delivery (D237): what is offered, the delivery postal code and its zone, whether the choice changed, whether a postal
     * code is needed before paying; null for a basket with nothing to ship or a subscription (the flat rate).
     */
    deliveryState: resolved,
    shippingAt,
    /** The cart's codes and what became of each (D299 E2): those used, why the others were not, and their label. */
    code,
    applied,
    discountMinor,
    /** What the buyer's group or company gives, its name and percent, and what a code gives: `discountMinor` is both. */
    member,
    memberDiscountMinor,
    codeDiscountMinor,
    /** What campaigns give (D114): the names of those that reduced something, the amount, and the free products earned. */
    campaignDiscountMinor,
    campaignNames: [...campaigns.result.applied.map((a) => a.name), ...(freeShipping ? [freeShipping.name] : [])],
    /** Campaigns not used because a discount code they do not combine with gives the shopper more (D367), for the cart to say. */
    campaignsLeftOut: chosenCampaigns.leftOut,
    /** The shipping a campaign made free (D299 E3), in the currency shown: part of `campaignDiscountMinor`, taken at the shipping's rate. */
    campaignShippingMinor,
    /** How far each campaign's next step is (D299 E3); free shipping only for a basket that ships and has no subscription. */
    campaignNext: campaigns.result.next.filter((step) => step.kind !== "free_shipping" || (ships && !plan)),
    campaignLine,
    gifts: campaigns.gifts,
    renewal,
    lineDiscount,
    codeLine,
    memberLine,
    /** The friend's welcome discount (D131), in the currency shown: off goods before codes and credits, its own line; `discountMinor` leaves it out. */
    referralMinor,
    referralLine,
    referral: friend ? cartAffiliateOf(friend, referralMinor) : NO_CART_AFFILIATE,
    /** Bonus credits used (D130), in the currency shown: off the goods last, part of the order's discount; `discountMinor` leaves them out. */
    bonusMinor,
    bonusLine,
    bonus,
    total,
    vat,
    /** Which VAT the basket carries (D157): the kind and why, the buyer's number and what became of it, the VAT number field's offer. */
    tax: cartTaxOf(taxFacts, taxBasket, taxOutcome),
    /** The VAT a reverse-charge basket does not charge, in the currency shown: part of what is taken off, and of no discount row. */
    reliefMinor,
    reliefLine,
    balance,
    atVenueOnly,
    /** What gift cards pay (D300 F3), card by card. */
    giftCards,
    /**
     * Customs and duties (D343): who pays them for this country (DDP or DAP), the estimate or why there is none, and what checkout collects
     * (`collectMinor`, beside the total); `blocked` when DDP has no estimate.
     */
    customs,
    /** What Stripe is asked for: all but the part left for the venue and what gift cards pay, and the duties DDP collects. */
    dueNowMinor: total - balance - cardsPaid.paidMinor + customs.collectMinor,
  };
}
