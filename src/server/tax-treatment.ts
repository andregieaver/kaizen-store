import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { toRates, type Rates, type StoreCurrency } from "@/lib/currency";
import { consignmentEurMinor, goodsWithoutVat, iossOutcome, showImportNotice, type IossOutcome } from "@/lib/ioss";
import { vatIncluded } from "@/lib/checkout";
import { parseShippingVatRule, shippingRate, type ShippingVatRule } from "@/lib/shipping-vat";
import { sellerFacts, type TaxProfile } from "@/lib/tax-profile";
import { countryOfVatPrefix, isEuMemberCountry, sameVatNumber } from "@/lib/vat-number";
import { carriesVat, reliefFor, type ReliefResult } from "@/lib/vat-relief";
import {
  buildOrderTreatment,
  vatTreatment,
  type OrderVatTreatment,
  type VatDecision,
  type VatTreatmentInput,
} from "@/lib/vat-treatment";
import type { BuyerVatState } from "@/lib/vies";

import { getTaxProfile, storeCountry } from "./tax-profile";
import { stateOfCheck, toCheck, type VatCheck } from "./vat-checks";
import { STORE_AUDIENCE } from "./product-conditions";

type Row = Record<string, unknown>;
type Runner = Pick<ReturnType<typeof db>, "execute">;

/**
 * Which VAT a basket carries, from the facts in the database and the basket's own lines (D157,
 * docs/wave-1a-tax.md sections 4.1 and 4.2): the ONE function `cartSummary()` and `placeOrder()` both reach, so that the
 * cart page shows what the order will charge. `loadTaxFacts()` reads what the decision rests on (the store's tax profile,
 * the cart's company and VAT number with its stored check, the destination's standard rate and the shipping rule, the
 * store's currency rates); `decideTax()` is pure arithmetic and rules over those facts: it never reads a database or the
 * network, and it never asks VIES (a check is made before checkout, by `checkCartVatNumber()`; a check that is too old
 * only charges VAT).
 */

export type TaxFacts = {
  storeCountry: string | null;
  profile: TaxProfile;
  seller: VatTreatmentInput["seller"];
  /** The cart is bought for a company (a company name and an organisation number on the cart). */
  business: boolean;
  /** The VAT number typed on the cart (normalised), with the answer it got; null for none. */
  buyerVatNumber: string | null;
  buyerCheck: VatCheck | null;
  buyerState: BuyerVatState;
  deliveryCountry: string;
  deliveryInEu: boolean;
  /** The destination's standard rate now (`commerce.vat_rate(country, 'standard')`). */
  standardRate: number;
  /** The destination's shipping rule: `standard` unless a person verified another (`commerce.shipping_vat_rule()`). */
  shippingRule: ShippingVatRule;
  rates: Rates;
};

export type TaxFactsInput = {
  storeId: string;
  market: { code: string };
  /** The cart the facts are for; null when the shopper has none (a private buyer with nothing typed). */
  cartId: string | null;
  now?: Date;
};

/** The number's state for the decision when it has no stored check: see `buyerState()`. */
function stateWithoutCheck(number: string, seller: string | null): BuyerVatState {
  // Not asked VIES (a number that cannot be used, or the store's own): the decision names why VAT is charged, and those
  // two reasons come after the checks on the answer. Anything else typed but unchecked (a request over the rate limit):
  // the shopper is told it could not be checked now.
  const prefix = number.slice(0, 2);
  if (!isEuMemberCountry(countryOfVatPrefix(prefix))) return "valid";
  if (sameVatNumber(seller, number)) return "valid";
  return "unavailable";
}

/** Reads what the decision rests on. Reads only; the store id is on every query of a store-owned table. */
export async function loadTaxFacts(runner: Runner, input: TaxFactsInput): Promise<TaxFacts> {
  const { storeId, market, cartId } = input;
  const now = input.now ?? new Date();
  const [profile, country, [place], currencies, cart] = await Promise.all([
    getTaxProfile(storeId, runner),
    storeCountry(storeId, runner),
    runner.execute<Row>(sql`
      select commerce.vat_rate(${market.code}, 'standard') as standard_rate, commerce.shipping_vat_rule(${market.code}) as shipping_rule
    `),
    runner.execute<Row>(sql`
      select currency, rate, round_to from commerce.store_currencies where store_id = ${storeId}::uuid
    `),
    cartId
      ? runner.execute<Row>(sql`
          select c.company_name, c.organisation_number, c.vat_number, k.id as check_id, k.purpose, k.cart_id, k.number, k.status,
                 k.source, k.name, k.address, k.request_identifier, k.error, k.requested_at,
                 ${STORE_AUDIENCE} <> 'consumers' as to_business
          from commerce.carts c
          join commerce.stores s on s.id = c.store_id
          left join commerce.vat_checks k on k.store_id = c.store_id and k.id = c.vat_check_id
          where c.store_id = ${storeId}::uuid and c.id = ${cartId}::uuid
        `)
      : Promise.resolve([] as Row[]),
  ]);
  const row = cart[0];
  // A company is bought for only where the store sells to businesses (D178: with Sell to businesses off, every cart is a private buyer's).
  const business = Boolean(row?.to_business && row?.company_name && row?.organisation_number);
  const buyerVatNumber = business && row?.vat_number ? String(row.vat_number) : null;
  const check = business && row?.check_id ? toCheck({ ...row, id: row.check_id }) : null;
  const seller = sellerFacts(profile, country);
  const stored: StoreCurrency[] = currencies.map((c) => ({
    currency: String(c.currency).trim(),
    rate: c.rate === null ? null : Number(c.rate),
    roundTo: Number(c.round_to),
  }));
  return {
    storeCountry: country,
    profile,
    seller,
    business,
    buyerVatNumber,
    buyerCheck: check,
    buyerState: !buyerVatNumber ? "none" : check ? stateOfCheck(check, now) : stateWithoutCheck(buyerVatNumber, seller.number),
    deliveryCountry: market.code,
    deliveryInEu: isEuMemberCountry(market.code),
    standardRate: Number(place?.standard_rate ?? 0),
    shippingRule: parseShippingVatRule(place?.shipping_rule),
    rates: toRates(stored),
  };
}

/** One line of the basket as the decision sees it: its total with VAT after every discount and credit. */
export type TaxLine = {
  key: string;
  totalMinor: number;
  rate: number;
  /** An appointment, a stay or a rental. */
  booking: boolean;
  /** The line is shipped (its delivery is `physical`): a download is not a consignment, so it is not IOSS's and not the import notice's. */
  physical: boolean;
  recurring: boolean;
  /** A host's listing. */
  host: boolean;
  /** A free product a campaign gave: left out of the shipping rate's goods. */
  gift?: boolean;
};

export type TaxBasket = {
  lines: readonly TaxLine[];
  /** Shipping with VAT, after the shipping discount (0 when none). */
  shippingMinor: number;
  /** Sign-up fees: one VAT-inclusive amount and rate each (subscriptions only: never relieved). */
  fees: readonly { amountMinor: number; rate: number }[];
  /** The currency the amounts are in (the one shown). */
  currency: string;
};

export type TaxOutcome = {
  decision: VatDecision;
  /** The lines' and the shipping's VAT, or their relief with reverse charge. */
  result: ReliefResult;
  /** The VAT the order carries: lines, shipping and fees (0 on lines and shipping with reverse charge). */
  taxMinor: number;
  /** The VAT not charged (part of the order's discount); 0 unless reverse charge. */
  reliefMinor: number;
  shippingRate: number;
  consignmentEurMinor: number | null;
  ioss: IossOutcome;
  /** The cart says *Import VAT and customs charges may be collected on delivery* (goods from outside the EU, not an IOSS sale). */
  importNotice: boolean;
  /** What `orders.vat_treatment` keeps; null for a host's order (the host is the seller). */
  treatment: OrderVatTreatment | null;
};

/** The decision and the arithmetic over the facts and the basket. Pure. */
export function decideTax(facts: TaxFacts, basket: TaxBasket): TaxOutcome {
  const goods = basket.lines.filter((l) => !l.gift);
  const rate = shippingRate(facts.shippingRule, goods.map((l) => l.rate), facts.standardRate);
  const input = {
    lines: basket.lines.map((l) => ({ key: l.key, totalMinor: l.totalMinor, rate: l.rate })),
    shippingMinor: basket.shippingMinor,
    shippingRate: rate,
  };
  const ordinary = reliefFor({ ...input, reverseCharge: false });
  const feeTax = basket.fees.reduce((sum, fee) => sum + vatIncluded(fee.amountMinor, fee.rate), 0);

  const hasService = basket.lines.some((l) => l.booking);
  const hasSubscription = basket.lines.some((l) => l.recurring);
  const hasGoodsOrDigital = basket.lines.some((l) => !l.booking);
  // IOSS and the import notice are about consignments: only the lines that are shipped count, and only they are its value.
  const shippedKeys = new Set(basket.lines.filter((l) => l.physical && !l.booking).map((l) => l.key));
  const hasPhysical = shippedKeys.size > 0;
  const consignment = consignmentEurMinor(
    goodsWithoutVat(ordinary.lines.filter((l) => shippedKeys.has(l.key)).map((l) => ({ totalMinor: l.totalMinor, taxMinor: l.taxMinor }))),
    basket.currency,
    facts.rates,
  );
  const buyerNumber = facts.buyerVatNumber;
  const decision = vatTreatment({
    seller: facts.seller,
    buyer: {
      kind: facts.business ? "business" : "private",
      vat: { state: facts.buyerState, number: buyerNumber, prefixCountry: buyerNumber ? countryOfVatPrefix(buyerNumber.slice(0, 2)) : null },
    },
    delivery: { country: facts.deliveryCountry, inEu: facts.deliveryInEu },
    basket: { hasService, hasSubscription, hasGoodsOrDigital, hasPhysical, hostOrder: basket.lines.some((l) => l.host), taxedAmountPositive: carriesVat(ordinary) },
    ioss: { number: facts.profile.iossNumber, markets: facts.profile.iossMarkets },
    consignmentEurMinor: consignment,
  });
  const result = decision.reverseCharge ? reliefFor({ ...input, reverseCharge: true }) : ordinary;

  const ioss = iossOutcome({
    number: facts.profile.iossNumber,
    markets: facts.profile.iossMarkets,
    deliveryCountry: facts.deliveryCountry,
    deliveryInEu: facts.deliveryInEu,
    dispatchInEu: facts.seller.dispatchInEu,
    goodsOnly: !hasService && !hasSubscription && hasPhysical,
    consignmentEurMinor: consignment,
  });
  // Said only when it is known where the goods are sent from (a store that has not said where it is says nothing about customs).
  const importNotice =
    facts.seller.dispatchCountry !== null &&
    !basket.lines.some((l) => l.host) &&
    showImportNotice({ deliveryInEu: facts.deliveryInEu, dispatchInEu: facts.seller.dispatchInEu, goodsOnly: !hasService && !hasSubscription && hasPhysical, outcome: ioss });

  const hostOrder = decision.reason === "host_order";
  return {
    decision,
    result,
    taxMinor: result.taxMinor + feeTax,
    reliefMinor: result.reliefMinor,
    shippingRate: rate,
    consignmentEurMinor: consignment,
    ioss,
    importNotice,
    treatment: hostOrder
      ? null
      : buildOrderTreatment({
          decision,
          sellerVatNumber: facts.profile.vatRegistered ? facts.profile.vatNumber : null,
          sellerCountry: facts.storeCountry,
          buyerVatNumber: facts.business ? buyerNumber : null,
          buyerCountry: facts.business && buyerNumber ? countryOfVatPrefix(buyerNumber.slice(0, 2)) : null,
          check: facts.business && facts.buyerCheck ? { status: facts.buyerCheck.status, requestedAt: facts.buyerCheck.requestedAt, requestIdentifier: facts.buyerCheck.requestIdentifier, name: facts.buyerCheck.name, address: facts.buyerCheck.address } : null,
          iossNumber: facts.profile.iossNumber,
          consignmentEurMinor: consignment,
          shippingRule: facts.shippingRule,
          shippingRate: rate,
          dispatchCountry: facts.seller.dispatchCountry,
          ossMemberState: facts.profile.ossMemberState,
        }),
  };
}

/** Why the VAT number field is not offered, or null when it is: what the cart's one-line reason says. */
export type VatFieldReason =
  | "private"
  | "market_not_eu"
  | "seller_not_ready"
  | "domestic"
  | "has_service"
  | "has_subscription"
  | "host_order"
  | "dispatch_outside_eu"
  | "dispatch_domestic";

/**
 * Whether the cart offers a business buyer a VAT number field (docs/wave-1a-tax.md section 2.1): a business, an EU
 * market, an EU-established seller registered for VAT with a number that was checked valid, a market that is not the
 * seller's own country, goods or downloads only (no booking, no subscription, no host's listing), and, when goods are
 * shipped, shipped from an EU country other than the delivery country (the owner's "goods are sent from" fact).
 */
export function vatFieldFor(
  facts: TaxFacts,
  basket: Pick<TaxBasket, "lines">,
  /** Ask as if the cart were already a company's: the shopper who is about to enter the company has none on the cart yet. */
  asBusiness: boolean = facts.business,
): { offered: true } | { offered: false; reason: VatFieldReason } {
  if (!asBusiness) return { offered: false, reason: "private" };
  if (!facts.deliveryInEu) return { offered: false, reason: "market_not_eu" };
  if (!facts.seller.inEu || !facts.seller.registered || !facts.seller.numberValid) return { offered: false, reason: "seller_not_ready" };
  if (facts.storeCountry && facts.storeCountry === facts.deliveryCountry) return { offered: false, reason: "domestic" };
  if (basket.lines.some((l) => l.host)) return { offered: false, reason: "host_order" };
  if (basket.lines.some((l) => l.booking)) return { offered: false, reason: "has_service" };
  if (basket.lines.some((l) => l.recurring)) return { offered: false, reason: "has_subscription" };
  if (basket.lines.some((l) => l.physical)) {
    if (!facts.seller.dispatchInEu) return { offered: false, reason: "dispatch_outside_eu" };
    if (facts.seller.dispatchCountry === facts.deliveryCountry) return { offered: false, reason: "dispatch_domestic" };
  }
  return { offered: true };
}

/** What the cart page and the checkout show of the treatment: no VIES name or address, only what a shopper may see. */
export type CartTax = {
  kind: OrderVatTreatment["kind"];
  reason: VatDecision["reason"];
  reverseCharge: boolean;
  notes: VatDecision["notes"];
  importNotice: boolean;
  /** VAT not charged, in the currency shown (0 unless reverse charge). */
  reliefMinor: number;
  /** The rate shipping is charged at (the shipping rule's). */
  shippingRate: number;
  /** The number the shopper typed and what became of it. */
  buyerVatNumber: string | null;
  buyerState: BuyerVatState;
  sellerVatNumber: string | null;
  field: ReturnType<typeof vatFieldFor>;
  /** The same as `field` for a shopper buying as a business who has not entered the company yet: what the cart draws first. */
  fieldIfBusiness: ReturnType<typeof vatFieldFor>;
};

export function cartTaxOf(facts: TaxFacts, basket: TaxBasket, outcome: TaxOutcome): CartTax {
  return {
    kind: outcome.decision.kind,
    reason: outcome.decision.reason,
    reverseCharge: outcome.decision.reverseCharge,
    notes: outcome.decision.notes,
    importNotice: outcome.importNotice,
    reliefMinor: outcome.reliefMinor,
    shippingRate: outcome.shippingRate,
    buyerVatNumber: facts.business ? facts.buyerVatNumber : null,
    buyerState: facts.buyerState,
    sellerVatNumber: facts.profile.vatRegistered ? facts.profile.vatNumber : null,
    field: vatFieldFor(facts, basket),
    fieldIfBusiness: vatFieldFor(facts, basket, true),
  };
}
