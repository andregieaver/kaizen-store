/**
 * Return labels (wave 3, D239, `docs/wave-3-exchanges.md` 4.7 and 4.8): when a label can be booked with the store's carrier (`labelBlock()`), and what it
 * takes off the refund (`labelDeduction()`, which feeds `refundFor()` as `returnShippingMinor`: never for a store that pays return shipping, never above what
 * the label cost, CRD Art. 14(1)). Pure: no database, no network, no zod.
 */
import { conversionFactor, type Rates } from "./currency";
import { carrierInfo, type CarrierId } from "./shipping-carriers";

/** Why a label cannot be booked, and why a deduction is refused, by code (staff's English; the shopper sees `m.returnLabel.*`). */
export const LABEL_PROBLEMS = {
  state: "A return label is booked once the return is approved and before it arrives.",
  ended: "The return has ended.",
  restricted: "The customer's data on this order has been erased, so no label is booked for it.",
  store_closed: "The store is not open.",
  no_carrier: "Connect a carrier that books return labels (Posten / Bring) under Integrations, and choose it in the return settings.",
  carrier_incomplete: "The carrier's agreement is not complete. Fill it in under Integrations.",
  carrier_unchecked: "Check the carrier's connection under Integrations first.",
  address_incomplete: "The order's shipping address is not complete (name, street, postal code, city and country).",
  no_return_address: "Add the return address (or the store's postal address) in the return settings.",
  country: "The carrier does not book return labels in this country.",
  booked: "A label is already booked for this return.",
  busy: "A label is being booked for this return right now. Look again in a moment.",
  weight: "Give the parcel's weight.",
  // The deduction.
  above_cost: "Return shipping cannot be more than the label cost (Consumer Rights Directive Art. 14(1)).",
  store_pays: "The store pays return shipping for this order, so nothing is taken off the refund.",
  not_whole: "The amount is a whole number of øre/cents, 0 or more.",
  note_needed: "Say where the amount comes from: the carrier did not price the label.",
  test_label: "The label was booked in the carrier's test environment and cannot be used, so nothing is taken off for it.",
} as const;
export type LabelProblemCode = keyof typeof LABEL_PROBLEMS;
export const labelProblemText = (code: LabelProblemCode): string => LABEL_PROBLEMS[code];

/** An address as the label needs it. */
export type LabelAddress = { name?: string | null; street?: string | null; postalCode?: string | null; city?: string | null; country?: string | null };

export const addressComplete = (a: LabelAddress | null | undefined): boolean =>
  Boolean(a && [a.name, a.street, a.postalCode, a.city, a.country].every((v) => typeof v === "string" && v.trim().length > 0));

export type LabelFacts = {
  returnStatus: "requested" | "approved" | "in_transit" | "received" | "inspected" | "closed" | "declined" | "cancelled";
  restricted: boolean;
  storeOpen: boolean;
  /** The carrier chosen for return labels and what the store's agreement with it is; null when none is chosen or connected. */
  carrier: { id: CarrierId; complete: boolean; checkOk: boolean } | null;
  /** The order's shipping address (the parcel's start). */
  from: LabelAddress | null;
  /** The return address (the settings', else the store's postal address). */
  to: LabelAddress | null;
  /** A label already booked that is not a test (a failed booking left nothing). */
  booked: boolean;
};

/** The first reason a return label cannot be booked, or null. */
export function labelBlock(f: LabelFacts): LabelProblemCode | null {
  if (f.returnStatus === "closed" || f.returnStatus === "declined" || f.returnStatus === "cancelled") return "ended";
  if (f.returnStatus !== "approved" && f.returnStatus !== "in_transit") return "state";
  if (f.restricted) return "restricted";
  if (!f.storeOpen) return "store_closed";
  const info = f.carrier ? carrierInfo(f.carrier.id) : null;
  if (!f.carrier || !info || !info.available.includes("return_labels")) return "no_carrier";
  if (!f.carrier.complete) return "carrier_incomplete";
  if (!f.carrier.checkOk) return "carrier_unchecked";
  if (!addressComplete(f.from)) return "address_incomplete";
  if (!addressComplete(f.to)) return "no_return_address";
  const countries = info.returnCountries ?? [];
  const up = (c: string | null | undefined) => (c ?? "").trim().toUpperCase();
  if (!countries.includes(up(f.from?.country)) || !countries.includes(up(f.to?.country))) return "country";
  if (f.booked) return "booked";
  return null;
}

/**
 * The carrier's price in the order's currency: converted once at the store's rates and rounded half up to the minor unit (a cost, not a shop price, so never
 * to a price step); the same currency comes back unchanged; null when there is no rate (the screens say "price not known", never a guess).
 */
export function labelCostIn(price: { amountMinor: number; currency: string }, orderCurrency: string, rates: Rates): number | null {
  if (!Number.isSafeInteger(price.amountMinor) || price.amountMinor < 0) return null;
  if (price.currency === orderCurrency) return price.amountMinor;
  const c = conversionFactor(price.currency, orderCurrency, rates);
  if (!c) return null;
  return Math.floor(price.amountMinor * c.factor + 0.5);
}

export type DeductionInput = {
  /** The order's `return_cost_payer` as it was sold (null: no record, which counts as the store paying, D153). */
  payer: "shopper" | "store" | null;
  /** How the label came: booked with a carrier, pasted by staff (D153), or none (the customer sends it themselves). */
  source: "carrier" | "pasted" | null;
  /** What a booked label cost, VAT included, in the order's currency; null when the carrier did not price it (or there is no rate). */
  costMinor: number | null;
  /** What staff typed (lower than the cost, or a cost the carrier did not give); undefined or null when they typed nothing. */
  typedMinor?: number | null;
  /** Staff's note for an amount typed when the cost is not known. */
  note?: string | null;
  /** A booked label made in the carrier's test environment: it cannot be used and cost the store nothing, so it is never taken off (Art. 14(1)). */
  test?: boolean;
};

export type Deduction = { ok: true; deductionMinor: number; capMinor: number | null } | { ok: false; code: LabelProblemCode };

const isWhole = (n: unknown): n is number => typeof n === "number" && Number.isSafeInteger(n) && n >= 0;

/**
 * What the label takes off the refund as return shipping (`refundFor()`'s `returnShippingMinor`). The shopper pays: a booked label's cost by default, or less
 * when staff typed less, never more than the cost when it is known; an unknown cost takes off nothing until staff type one with a note; a pasted label keeps
 * D153's rule (what staff typed); no label takes off nothing; a test label (booked in the carrier's test environment) takes off nothing and refuses an
 * amount typed. The store pays (or nothing was recorded): nothing, and an amount typed is refused.
 *
 * Nothing is taken off when a label is booked: the booking only records the cost. Whether the parcel came back with the label is known at refund time, so
 * the refund form starts at 0 and staff take the cost off only when they confirm it did (`refundReturn()` passes what they typed as `typedMinor`).
 */
export function labelDeduction(input: DeductionInput): Deduction {
  const typed = input.typedMinor ?? null;
  if (typed !== null && !isWhole(typed)) return { ok: false, code: "not_whole" };
  if (input.payer !== "shopper") return typed !== null && typed > 0 ? { ok: false, code: "store_pays" } : { ok: true, deductionMinor: 0, capMinor: 0 };
  if (input.source === null) return { ok: true, deductionMinor: 0, capMinor: 0 };
  if (input.source === "carrier" && input.test) return typed !== null && typed > 0 ? { ok: false, code: "test_label" } : { ok: true, deductionMinor: 0, capMinor: 0 };
  if (input.source === "pasted") return { ok: true, deductionMinor: typed ?? 0, capMinor: null };
  const cost = input.costMinor;
  if (cost !== null && !isWhole(cost)) return { ok: false, code: "not_whole" };
  if (cost === null) {
    if (typed === null || typed === 0) return { ok: true, deductionMinor: 0, capMinor: null };
    if (!input.note || input.note.trim().length === 0) return { ok: false, code: "note_needed" };
    return { ok: true, deductionMinor: typed, capMinor: null };
  }
  if (typed === null) return { ok: true, deductionMinor: cost, capMinor: cost };
  if (typed > cost) return { ok: false, code: "above_cost" };
  return { ok: true, deductionMinor: typed, capMinor: cost };
}
