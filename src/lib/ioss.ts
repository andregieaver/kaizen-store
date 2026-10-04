/**
 * IOSS marking (D157, docs/wave-1a-tax.md section 4.1 rule 2): a consignment of at most 150 EUR from outside the EU to a
 * private buyer in an EU market the store's IOSS registration covers is marked `ioss`. Destination VAT is charged at
 * checkout as for every consumer sale (the price does not change); the marking records the IOSS number on the order.
 *
 * Source: the Commission's One Stop Shop page, https://vat-one-stop-shop.ec.europa.eu/one-stop-shop_en (read 2026-10-03):
 * the import scheme is for consignments of an intrinsic value not exceeding 150 EUR, most non-EU businesses must register
 * through an EU intermediary, returns are monthly. Businesses established in a country with a VAT mutual assistance
 * agreement with the EU, Norway among them, can register directly (a finding of review: Kaizen's own market is Norwegian,
 * so the admin text says it; the agreement itself is NOT read, needs review). NOT read, so *needs review by an accountant*: the definition of intrinsic value
 * (Implementing Regulation 282/2011 and the customs code). Here the value is the goods after discounts, without VAT and
 * without separately charged shipping, in euro at the store's own rate; an order is one consignment.
 * The number formats are python-stdnum's (`IM` and ten digits; non-Union OSS `EU` and nine digits): to verify.
 */
import { conversionFactor, type Rates } from "./currency";

/** The limit, in euro cents (150.00 EUR). Exactly the limit is inside it. */
export const IOSS_LIMIT_EUR_MINOR = 15_000;

export const IOSS_NUMBER = /^IM[0-9]{10}$/;
export const OSS_NON_UNION_NUMBER = /^EU[0-9]{9}$/;

/** An IOSS number as typed (spaces and case ignored), normalised, or null when it is not one. */
export function normaliseIossNumber(input: string): string | null {
  const text = input.toUpperCase().replace(/[\s.-]/g, "");
  return IOSS_NUMBER.test(text) ? text : null;
}

/** A non-Union OSS number as typed, normalised, or null when it is not one. */
export function normaliseOssNumber(input: string): string | null {
  const text = input.toUpperCase().replace(/[\s.-]/g, "");
  return OSS_NON_UNION_NUMBER.test(text) ? text : null;
}

/**
 * The goods' value in euro cents, from an amount without VAT in the order's currency at the store's rates; null when
 * the currency has no rate (never a guess). Rounded up, so a value on the border is never taken to be inside the limit.
 */
export function consignmentEurMinor(goodsWithoutVatMinor: number, currency: string, rates: Rates): number | null {
  if (!Number.isFinite(goodsWithoutVatMinor) || goodsWithoutVatMinor < 0) return null;
  if (currency === "EUR") return Math.round(goodsWithoutVatMinor);
  const conversion = conversionFactor(currency, "EUR", rates);
  if (!conversion) return null;
  // Not rounded to the euro step: the limit is a legal figure, not a price. A tiny allowance for floating point.
  return Math.ceil(goodsWithoutVatMinor * conversion.factor - 1e-9);
}

/** The goods' value without VAT: the lines' totals after every discount, less their VAT. Shipping is not goods. */
export function goodsWithoutVat(lines: readonly { totalMinor: number; taxMinor: number }[]): number {
  return lines.reduce((sum, line) => sum + (line.totalMinor - line.taxMinor), 0);
}

export type IossFacts = {
  /** The store's IOSS number, or null. */
  number: string | null;
  /** The EU countries the registration is used for. */
  markets: readonly string[];
  deliveryCountry: string;
  deliveryInEu: boolean;
  /** Whether the goods are dispatched from inside the EU. */
  dispatchInEu: boolean;
  /**
   * The basket has goods that are shipped (physical lines) and no booking or subscription. A download is not a consignment:
   * it counts for none of IOSS, the consignment's value or the import notice.
   */
  goodsOnly: boolean;
  /** The consignment in euro cents; null when the currency has no rate. */
  consignmentEurMinor: number | null;
};

/**
 * `applies` when the order is an IOSS sale; `over_limit` and `no_rate` when everything else holds but the value does
 * not (the buyer may pay import VAT at the border: said to staff and to the shopper); `no` when IOSS is not in question.
 */
export type IossOutcome = "applies" | "over_limit" | "no_rate" | "no";

export function iossOutcome(facts: IossFacts): IossOutcome {
  if (!facts.number || !IOSS_NUMBER.test(facts.number)) return "no";
  if (!facts.deliveryInEu || !facts.markets.includes(facts.deliveryCountry)) return "no";
  if (facts.dispatchInEu || !facts.goodsOnly) return "no";
  if (facts.consignmentEurMinor === null) return "no_rate";
  return facts.consignmentEurMinor <= IOSS_LIMIT_EUR_MINOR ? "applies" : "over_limit";
}

/**
 * Whether the cart says *Import VAT and customs charges may be collected on delivery* (the Consumer Rights Directive
 * Art. 6 asks for extra charges to be stated; the wording needs a lawyer's review): goods sent from outside the EU into
 * the EU, when the order is not an IOSS sale.
 */
export function showImportNotice(facts: Pick<IossFacts, "deliveryInEu" | "dispatchInEu" | "goodsOnly"> & { outcome: IossOutcome }): boolean {
  return facts.deliveryInEu && !facts.dispatchInEu && facts.goodsOnly && facts.outcome !== "applies";
}
