import { parseStoreAudience, vatShown, withoutVat, type Buyer, type VatShown } from "./b2b";

/**
 * What to show for a price. A reduction may only be advertised against the
 * lowest price of the previous 30 days (Price Indication Directive Art. 6a;
 * the same rule applies in Norway), so the reference comes from the database
 * and appears only when the current price is genuinely lower.
 */
export type PriceView = {
  /** With VAT, as prices are kept. */
  amountMinor: number;
  currency: string;
  /** The 30-day lowest prior price, when the current price is a reduction. */
  referenceMinor: number | null;
  /** How the store shows it (B2B): the market's VAT rate, and with VAT, without, or as the shopper chooses. */
  vat: PriceVat;
};

export type PriceVat = { rate: number; shown: VatShown };

/** Prices as consumers see them: with VAT. */
export const WITH_VAT: PriceVat = { rate: 0, shown: "incl" };

export function priceView(
  amountMinor: number,
  currency: string,
  prior30dMinor: number | null,
  vat: PriceVat = WITH_VAT,
): PriceView {
  return {
    amountMinor,
    currency,
    referenceMinor:
      prior30dMinor !== null && amountMinor < prior30dMinor ? prior30dMinor : null,
    vat,
  };
}

/** The VAT display for a store's audience in a market with this VAT rate. */
export function priceVat(audience: unknown, rate: unknown): PriceVat {
  const shown = vatShown(parseStoreAudience(audience));
  return shown === "incl" ? WITH_VAT : { rate: Number(rate ?? 0), shown };
}

export type StockLevel = "in_stock" | "low" | "out";

export const LOW_STOCK_THRESHOLD = 5;

export function stockLevel(available: number): StockLevel {
  if (available <= 0) return "out";
  return available <= LOW_STOCK_THRESHOLD ? "low" : "in_stock";
}

/** The amount a buyer sees (B2B): without VAT for businesses where the store shows it so. */
export function shownAmount(amountMinor: number, vat: PriceVat, buyer: Buyer): number {
  return vat.shown !== "incl" && buyer === "business" ? withoutVat(amountMinor, vat.rate) : amountMinor;
}
