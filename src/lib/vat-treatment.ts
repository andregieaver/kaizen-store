/**
 * Which VAT an order carries (D157, docs/wave-1a-tax.md section 4.1): `standard` (the destination country's VAT, as
 * always), `reverse_charge` (the buyer accounts for the VAT) or `ioss` (a consignment of at most 150 EUR marked with the
 * store's IOSS number; destination VAT is charged as always). Pure: facts in, a decision with a reason code out. The cart
 * summary and `placeOrder()` both reach it through `src/server/tax-treatment.ts`, so they agree.
 *
 * NOTHING HERE IS LEGAL OR TAX ADVICE. Every rule is *needs review by an accountant or lawyer*, and has its source:
 * - Goods shipped to a business in another member state, identified for VAT there, are an exempt intra-Community supply
 *   (Directive 2006/112/EC Art. 138(1), text at https://www.legislation.gov.uk/eudr/2006/112/article/138, read
 *   2026-10-03). That the buyer's identification number is a condition: Directive (EU) 2018/1910, a secondary source,
 *   verify.
 * - Downloads sold to a business buyer are supplied where the buyer is established (the general B2B rule, Art. 44 and
 *   196): NOT read, verify.
 * - The invoice carries both numbers and the words "Reverse charge" (Art. 226 points 3, 4 and 11a, read 2026-10-03).
 * - IOSS: the Commission's One Stop Shop page (read 2026-10-03), see `src/lib/ioss.ts`.
 * - VIES confirms that a number is registered; it does not say that the goods are exempt. The owner remains responsible.
 *
 * Rules, in this order; the first that applies decides:
 *  1. a host's order is `standard` (the seller is the host);
 *  2. a private buyer: IOSS, or `standard` (`consumer`);
 *  3. a business buyer without a valid, current number for the delivery country: `standard`, with the reason;
 *  4. a seller that is not EU-established, VAT-registered and checked: `standard`, with the reason;
 *  5. a basket with a booking or a subscription: `standard`, with the reason;
 *  6. a basket with goods that are sent (a physical line) from outside the EU, or from the buyer's own country: not an
 *     intra-Community supply (Art. 138: goods dispatched to another member state), `standard`, with the reason. Downloads are
 *     not dispatched, so a basket of downloads alone does not look at where the store sends goods from;
 *  7. a basket that carries no VAT: `standard`, `nothing_taxable`;
 *  8. otherwise `reverse_charge`.
 *
 * IOSS covers consignments of goods (Commission One Stop Shop page, read 2026-10-03): only physical lines count for it,
 * for its eligibility, for the consignment's value and for the import notice. A download is not a consignment.
 */
import { isEuMemberCountry } from "./vat-number";
import type { BuyerVatState } from "./vies";
import { iossOutcome, type IossOutcome } from "./ioss";

export const VAT_KINDS = ["standard", "reverse_charge", "ioss"] as const;
export type VatKind = (typeof VAT_KINDS)[number];

/** Why an order carries what it carries: a closed list, each with a sentence for staff and one for the shopper. */
export const VAT_REASONS = [
  "host_order",
  "consumer",
  "ioss",
  "ioss_over_limit",
  "ioss_no_rate",
  "no_buyer_vat_number",
  "number_invalid",
  "number_unavailable",
  "number_stale",
  "number_not_eu",
  "number_other_country",
  "own_number",
  "same_country",
  "seller_not_eu",
  "seller_not_registered",
  "seller_number_unverified",
  "has_service",
  "has_subscription",
  "dispatch_outside_eu",
  "dispatch_domestic",
  "nothing_taxable",
  "reverse_charge",
] as const;
export type VatReason = (typeof VAT_REASONS)[number];

export type VatNote = "import_notice";

export type VatTreatmentInput = {
  seller: {
    /** The store's country (ISO), null when not known. */
    country: string | null;
    /** Whether the store is established in an EU member state. */
    inEu: boolean;
    registered: boolean;
    /** The seller's own number was checked valid. */
    numberValid: boolean;
    number: string | null;
    dispatchCountry: string | null;
    /** Goods are dispatched from inside the EU. */
    dispatchInEu: boolean;
  };
  buyer: {
    kind: "private" | "business";
    vat: {
      state: BuyerVatState;
      number: string | null;
      /** The country the number's prefix belongs to (`GR` for `EL`), null when none. */
      prefixCountry: string | null;
    };
  };
  delivery: { country: string; inEu: boolean };
  basket: {
    /** A booking: an appointment, a stay or a rental. */
    hasService: boolean;
    hasSubscription: boolean;
    /** Goods or downloads (a line that is not a booking): what reverse charge needs. */
    hasGoodsOrDigital: boolean;
    /** At least one line is shipped (a physical line that is not a booking): what IOSS, the dispatch rule and the import notice look at. */
    hasPhysical: boolean;
    hostOrder: boolean;
    /** The order would carry VAT if charged in the ordinary way (`reliefFor(..., reverseCharge: false).taxMinor > 0`). */
    taxedAmountPositive: boolean;
  };
  ioss: { number: string | null; markets: readonly string[] };
  /** The goods' value in euro cents (`consignmentEurMinor()`), null when the currency has no rate. */
  consignmentEurMinor: number | null;
};

export type VatDecision = {
  kind: VatKind;
  reverseCharge: boolean;
  reason: VatReason;
  notes: VatNote[];
};

const standard = (reason: VatReason, notes: VatNote[] = []): VatDecision => ({ kind: "standard", reverseCharge: false, reason, notes });

export function vatTreatment(input: VatTreatmentInput): VatDecision {
  const { seller, buyer, delivery, basket } = input;

  // 1. A host's order: the seller is the host, whose own VAT status (and rate 0 when not registered) already applies.
  if (basket.hostOrder) return standard("host_order");

  // 2. A private buyer pays the destination country's VAT. IOSS marks a consignment, it does not change the price.
  if (buyer.kind === "private") {
    const outcome: IossOutcome = iossOutcome({
      number: input.ioss.number,
      markets: input.ioss.markets,
      deliveryCountry: delivery.country,
      deliveryInEu: delivery.inEu,
      dispatchInEu: seller.dispatchInEu,
      goodsOnly: !basket.hasService && !basket.hasSubscription && basket.hasPhysical,
      consignmentEurMinor: input.consignmentEurMinor,
    });
    if (outcome === "applies") return { kind: "ioss", reverseCharge: false, reason: "ioss", notes: [] };
    if (outcome === "over_limit") return standard("ioss_over_limit", ["import_notice"]);
    if (outcome === "no_rate") return standard("ioss_no_rate", ["import_notice"]);
    return standard("consumer");
  }

  // 3. A business buyer needs a valid, current number for the country the goods go to.
  const vat = buyer.vat;
  if (vat.state === "none") return standard("no_buyer_vat_number");
  if (vat.state === "invalid") return standard("number_invalid");
  if (vat.state === "unavailable") return standard("number_unavailable");
  if (vat.state === "stale") return standard("number_stale");
  if (seller.number && vat.number && seller.number === vat.number) return standard("own_number");
  if (!isEuMemberCountry(vat.prefixCountry)) return standard("number_not_eu");
  if (seller.country && delivery.country === seller.country) return standard("same_country");
  if (vat.prefixCountry !== delivery.country) return standard("number_other_country");

  // 4. The seller: established in the EU, registered, with a number that was checked valid.
  if (!seller.inEu) return standard("seller_not_eu");
  if (!seller.registered || !seller.number) return standard("seller_not_registered");
  if (!seller.numberValid) return standard("seller_number_unverified");

  // 5. The basket: only goods and downloads. A booking's place of supply follows the property, the event or the place of
  //    performance, not the buyer; a subscription's renewals do not keep the number.
  if (basket.hasService) return standard("has_service");
  if (basket.hasSubscription) return standard("has_subscription");

  // 6. Goods that are sent: an intra-Community supply needs the goods to go from one member state to another (Art. 138).
  //    From outside the EU there is an import; from the buyer's own country the supply is domestic there. The owner's
  //    "goods are sent from" fact decides. Downloads are not sent, so a basket of downloads alone is not asked.
  if (basket.hasPhysical) {
    if (!seller.dispatchInEu) return standard("dispatch_outside_eu");
    if (seller.dispatchCountry === delivery.country) return standard("dispatch_domestic");
  }

  // 7. Something to take the VAT off.
  if (!basket.hasGoodsOrDigital || !basket.taxedAmountPositive) return standard("nothing_taxable");

  // 8. Reverse charge.
  return { kind: "reverse_charge", reverseCharge: true, reason: "reverse_charge", notes: [] };
}

const STAFF_TEXT: Record<VatReason, string> = {
  host_order: "A host's order: the host is the seller, so the destination country's VAT applies as set for the listing.",
  consumer: "A private buyer: the destination country's VAT is charged.",
  ioss: "A consignment of at most 150 EUR from outside the EU to a private buyer: destination VAT charged, marked with the store's IOSS number.",
  ioss_over_limit: "A consignment above 150 EUR: not an IOSS sale. The buyer may pay import VAT at the border.",
  ioss_no_rate: "The order's currency has no euro rate in this store, so the 150 EUR limit cannot be checked: not marked as IOSS.",
  no_buyer_vat_number: "A business buyer without a VAT number: VAT is charged.",
  number_invalid: "VIES did not accept the buyer's VAT number: VAT is charged.",
  number_unavailable: "VIES could not be reached for the buyer's VAT number: VAT is charged and the sale went on.",
  number_stale: "The check of the buyer's VAT number was more than 24 hours old: VAT is charged.",
  number_not_eu: "The buyer's VAT number is not from an EU member state: VAT is charged.",
  number_other_country: "The buyer's VAT number is for another country than the one the goods go to: VAT is charged.",
  own_number: "The number is the store's own: VAT is charged.",
  same_country: "The goods go to the seller's own country: a domestic sale, VAT is charged.",
  seller_not_eu: "The store is not established in an EU member state: reverse charge is not used.",
  seller_not_registered: "The store has no VAT registration with a number: reverse charge is not used.",
  seller_number_unverified: "The store's own VAT number has not been checked valid: reverse charge is not used.",
  has_service: "The basket has a booking: services are charged VAT in full.",
  has_subscription: "The basket has a subscription: it is charged VAT in full.",
  dispatch_outside_eu: "The goods are sent from outside the EU: that is an import, not a supply to another member state, so reverse charge is not used.",
  dispatch_domestic: "The goods are sent from the buyer's own country: that is a domestic sale there, so reverse charge is not used.",
  nothing_taxable: "The order carries no VAT, so there is nothing to reverse.",
  reverse_charge: "Reverse charge: the buyer's VAT number was checked valid and the buyer accounts for the VAT in their own country.",
};

const SHOPPER_TEXT: Record<VatReason, string> = {
  host_order: "",
  consumer: "",
  ioss: "VAT has been collected at checkout under IOSS; no further VAT is due on delivery.",
  ioss_over_limit: "Import VAT and customs charges may be collected on delivery.",
  ioss_no_rate: "Import VAT and customs charges may be collected on delivery.",
  no_buyer_vat_number: "",
  number_invalid: "This VAT number was not accepted. VAT is charged.",
  number_unavailable: "The VAT number could not be checked right now. VAT is charged. Try again in a moment.",
  number_stale: "The VAT number needs to be checked again. VAT is charged until it is.",
  number_not_eu: "Only VAT numbers from EU member states can be used. VAT is charged.",
  number_other_country: "This VAT number is for another country than the one the goods go to. VAT is charged.",
  own_number: "This is the store's own VAT number. VAT is charged.",
  same_country: "",
  seller_not_eu: "",
  seller_not_registered: "",
  seller_number_unverified: "",
  has_service: "Bookings are charged VAT in full.",
  has_subscription: "Subscriptions are charged VAT in full.",
  dispatch_outside_eu: "",
  dispatch_domestic: "",
  nothing_taxable: "",
  reverse_charge: "Reverse charge: the buyer accounts for the VAT.",
};

/** A plain English sentence for staff (the order page's treatment panel). Needs review: legal-adjacent. */
export const reasonStaffText = (reason: VatReason): string => STAFF_TEXT[reason];

/**
 * The English default of the sentence a shopper sees for a reason ("" when there is nothing to say). The shopper-facing
 * wording in nb, sv, da and en is `i18n.ts` (hand-written, `// legal: needs review`); this is its source.
 */
export const reasonShopperText = (reason: VatReason): string => SHOPPER_TEXT[reason];

/** The reasons a seller can fix on the tax screen (their own side), to list in the readiness lines. */
export const SELLER_REASONS: readonly VatReason[] = ["seller_not_eu", "seller_not_registered", "seller_number_unverified"];

// ---------------------------------------------------------------------------
// What an order keeps
// ---------------------------------------------------------------------------

export type OrderVatTreatment = {
  kind: VatKind;
  reason: VatReason;
  /** The seller's number as it was when the order was placed (the invoice reads it from here, never the live profile). */
  sellerVatNumber: string | null;
  sellerCountry: string | null;
  buyerVatNumber: string | null;
  buyerCountry: string | null;
  vies: {
    status: "valid" | "invalid" | "unavailable" | "not_checked";
    checkedAt: string | null;
    requestIdentifier: string | null;
    /** VIES's own words, for staff: never shown to shoppers. */
    registeredName: string | null;
    registeredAddress: string | null;
  };
  iossNumber: string | null;
  consignmentEurMinor: number | null;
  /** The shipping rule in force (`standard` unless a verified rule applied) and the rate shipping was charged at. */
  shippingRule: string;
  shippingRate: number | null;
};

export type TreatmentFacts = {
  decision: VatDecision;
  sellerVatNumber: string | null;
  sellerCountry: string | null;
  buyerVatNumber: string | null;
  buyerCountry: string | null;
  check: {
    status: "valid" | "invalid" | "unavailable";
    requestedAt: Date | string;
    requestIdentifier: string | null;
    name: string | null;
    address: string | null;
  } | null;
  iossNumber: string | null;
  consignmentEurMinor: number | null;
  shippingRule: string;
  shippingRate: number | null;
};

/** The JSON kept on `orders.vat_treatment`, built from the decision and the facts it rested on. */
export function buildOrderTreatment(facts: TreatmentFacts): OrderVatTreatment {
  const check = facts.check;
  const markIoss = facts.decision.kind === "ioss";
  return {
    kind: facts.decision.kind,
    reason: facts.decision.reason,
    sellerVatNumber: facts.sellerVatNumber,
    sellerCountry: facts.sellerCountry,
    buyerVatNumber: facts.buyerVatNumber,
    buyerCountry: facts.buyerCountry,
    vies: {
      status: check ? check.status : "not_checked",
      checkedAt: check ? new Date(check.requestedAt).toISOString() : null,
      requestIdentifier: check?.requestIdentifier ?? null,
      registeredName: check?.name ?? null,
      registeredAddress: check?.address ?? null,
    },
    iossNumber: markIoss ? facts.iossNumber : null,
    consignmentEurMinor: facts.consignmentEurMinor,
    shippingRule: facts.shippingRule,
    shippingRate: facts.shippingRate,
  };
}

const text = (value: unknown): string | null => (typeof value === "string" && value !== "" ? value : null);

/** `orders.vat_treatment` read defensively (older orders have none; a copied order never has one). */
export function parseOrderTreatment(value: unknown): OrderVatTreatment | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  const kind = VAT_KINDS.find((k) => k === v.kind);
  const reason = VAT_REASONS.find((r) => r === v.reason);
  if (!kind || !reason) return null;
  const vies = typeof v.vies === "object" && v.vies !== null ? (v.vies as Record<string, unknown>) : {};
  const status = ["valid", "invalid", "unavailable", "not_checked"].find((s) => s === vies.status) as OrderVatTreatment["vies"]["status"] | undefined;
  return {
    kind,
    reason,
    sellerVatNumber: text(v.sellerVatNumber),
    sellerCountry: text(v.sellerCountry),
    buyerVatNumber: text(v.buyerVatNumber),
    buyerCountry: text(v.buyerCountry),
    vies: {
      status: status ?? "not_checked",
      checkedAt: text(vies.checkedAt),
      requestIdentifier: text(vies.requestIdentifier),
      registeredName: text(vies.registeredName),
      registeredAddress: text(vies.registeredAddress),
    },
    iossNumber: text(v.iossNumber),
    consignmentEurMinor: typeof v.consignmentEurMinor === "number" ? v.consignmentEurMinor : null,
    shippingRule: text(v.shippingRule) ?? "standard",
    shippingRate: typeof v.shippingRate === "number" ? v.shippingRate : null,
  };
}

/** What a shopper may be shown of a treatment: never VIES's registered name or address. */
export function shopperTreatment(t: OrderVatTreatment): Omit<OrderVatTreatment, "vies"> & { vies: { status: OrderVatTreatment["vies"]["status"]; checkedAt: string | null } } {
  return { ...t, vies: { status: t.vies.status, checkedAt: t.vies.checkedAt } };
}
