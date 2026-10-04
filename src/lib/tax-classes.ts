/**
 * Where a sale is reported (D161, `docs/wave-1c-reports.md` 4.3): the one function, `classify()`, that says which return a document's
 * VAT belongs in, or the named reason it is in none. The VAT report's "Reported in" column and the OSS and IOSS returns both come
 * from it, so they can never disagree. Pure: facts in, a closed list of results out.
 *
 * NOTHING HERE IS LEGAL OR TAX ADVICE. Every rule below is `needs review: accountant` (docs/wave-1c-reports.md section 8, item 1).
 * Sources, read 2026-10-04:
 * - European Commission, One Stop Shop Guidelines (30 July 2021): Part 1 (the Union scheme covers intra-Community distance sales of
 *   goods and services to non-taxable persons by a seller established in the EU; the non-Union scheme covers services to
 *   non-taxable persons in the EU by a seller not established in the EU; the import scheme covers consignments of at most 150 EUR);
 *   Annex 3 (the return's Part 2 lists supplies by part: 2a services supplied from the Member State of identification, 2b goods
 *   dispatched from it, 2d goods dispatched from another Member State; a sale in the seller's own Member State is not in the return).
 * - Not read, so each use says verify: the Directive's own articles for the place of supply of services (a booking follows the
 *   property or the performance, not the buyer), the treatment of a fee that follows a sale, how a Member State wants a zero rate
 *   declared, a business buyer charged VAT.
 *
 * The order of the rules is the order of the table in the spec; the first that applies decides.
 */
import { isEuMemberCountry } from "./vat-number";

/** The place a sale's VAT belongs: a return, or none (and then the reason says why). */
export type Place = "ioss" | "union" | "non_union" | "national" | "none";
/** The part of an OSS or IOSS return a sale goes in: 2a, 2b and 2d of the Union scheme, NU of the non-Union scheme, IOSS. */
export type ReturnPart = "2a" | "2b" | "2d" | "NU" | "IOSS";

export const CLASS_REASONS = [
  "exempt",
  "ioss",
  "reverse_charge",
  "business_buyer",
  "non_eu_market",
  "non_eu_market_foreign",
  "has_service",
  "dispatch_outside_eu",
  "dispatch_unknown",
  "domestic",
  "union_goods_msi",
  "union_goods_other",
  "union_services",
  "non_union_services",
] as const;
export type ClassReason = (typeof CLASS_REASONS)[number];

/** Notes on how a sale was classed, each a count on the page. */
export type ClassFlag = "mixed_goods_download" | "dispatch_assumed" | "seller_assumed";

export type ClassifyInput = {
  /** The invoice's VAT kind (`standard`, `reverse_charge` or `ioss`); a credit note takes its invoice's. */
  vatKind: string;
  buyerType: string;
  /** The delivery country (`orders.market_code`). */
  market: string;
  marketInEu: boolean;
  /** Line kinds of the invoice: physical = goods or gift, download, service = service or booking. A fee follows the rest of the order. */
  hasPhysical: boolean;
  hasDownload: boolean;
  hasService: boolean;
  /** Where the goods were sent from: frozen on the order when it was placed, else the live setting. */
  dispatchCountry: string | null;
  dispatchSource: string;
  /**
   * Where the seller's country and member state of identification come from: `order` (frozen on the order when it was placed), else
   * `profile` (the store's live settings, for an order placed before they were frozen: counted on the page, never silent).
   */
  sellerSource: string;
  /** The bucket's basis (`standard`, `reverse_charge`, `exempt`, `ioss`). */
  basis: string;
  seller: {
    /** The country the store was established in when the order was placed (the order's frozen treatment, `sellerCountry`), never read live for a document that froze it. */
    country: string | null;
    /** The member state the seller was identified in for the Union scheme (the profile's `oss_member_state`), else the store's country. */
    ossMemberState: string | null;
  };
};

export type ClassResult = {
  place: Place;
  part: ReturnPart | null;
  reason: ClassReason;
  flags: ClassFlag[];
};

const upper = (s: string | null | undefined) => (s ?? "").trim().toUpperCase();

/** The member state of identification: the profile's, else the store's own country. */
export const memberStateOfIdentification = (seller: ClassifyInput["seller"]): string | null => upper(seller.ossMemberState) || upper(seller.country) || null;

export function classify(input: ClassifyInput): ClassResult {
  const flags: ClassFlag[] = [];
  const done = (place: Place, part: ReturnPart | null, reason: ClassReason): ClassResult => {
    if (input.hasPhysical && input.hasDownload) flags.push("mixed_goods_download");
    if (input.dispatchSource === "profile" && input.hasPhysical) flags.push("dispatch_assumed");
    if (input.sellerSource === "profile") flags.push("seller_assumed");
    return { place, part, reason, flags };
  };
  const market = upper(input.market);
  const dispatch = upper(input.dispatchCountry);
  const sellerCountry = upper(input.seller.country);

  // 1. An exempt product's bucket (decided per bucket; the rules after this are per order).
  if (input.basis === "exempt") return done("none", null, "exempt");
  // 2. A consignment marked IOSS (D157): the monthly import scheme return.
  if (input.vatKind === "ioss") return done("ioss", "IOSS", "ioss");
  // 3. Reverse charge: an exempt intra-Community supply, or a service the buyer accounts for. The EC sales list is not built (section 7).
  if (input.vatKind === "reverse_charge" || input.basis === "reverse_charge") return done("none", null, "reverse_charge");
  // 4. A business buyer who was charged VAT: OSS is for supplies to non-taxable persons. Needs review: accountant.
  if (input.buyerType === "business") return done("none", null, "business_buyer");
  // 5. A market outside the EU (Norway): the VAT belongs in the return of that country, so only a store established there has it in its
  // own national return. A store established anywhere else charged VAT of a country it is not established in: it is in no return here.
  if (!input.marketInEu) return sellerCountry === market ? done("national", null, "non_eu_market") : done("none", null, "non_eu_market_foreign");
  // 6. A booking or other service: the place of supply follows the performance or the property, not the buyer. Verify.
  if (input.hasService) return done("none", null, "has_service");

  if (input.hasPhysical) {
    // 7. Goods dispatched from outside the EU that were not IOSS sales: an import. The VAT charged at checkout has no return here.
    if (!dispatch) return done("none", null, "dispatch_unknown");
    if (!isEuMemberCountry(dispatch)) return done("none", null, "dispatch_outside_eu");
    // 8. Goods dispatched and delivered in the same country: a domestic sale, in that country's own return.
    if (dispatch === market) return done("national", null, "domestic");
    // 9. Goods from one member state to another: the Union scheme, 2b from the member state of identification, else 2d.
    return dispatch === memberStateOfIdentification(input.seller) ? done("union", "2b", "union_goods_msi") : done("union", "2d", "union_goods_other");
  }

  // Downloads and fees only.
  const established = isEuMemberCountry(sellerCountry);
  // 10. The seller's own country: domestic.
  if (established && market === sellerCountry) return done("national", null, "domestic");
  // 11. Electronic services from an EU seller to another member state: the Union scheme, 2a.
  if (established) return done("union", "2a", "union_services");
  // 12. A seller outside the EU selling services to a consumer in the EU: the non-Union scheme.
  return done("non_union", "NU", "non_union_services");
}

/** `standard` when the bucket's rate is the country's standard rate on that day, else `reduced` (a zero rate is shown as reduced: verify). */
export function rateKind(rate: number, standardRate: number | null): "standard" | "reduced" {
  return standardRate !== null && Math.abs(rate - standardRate) < 1e-9 ? "standard" : "reduced";
}

const REASON_TEXT: Record<ClassReason, string> = {
  exempt: "An exempt product: no VAT is charged, so there is nothing to put in a return.",
  ioss: "A consignment marked with your IOSS number: it goes in the monthly IOSS return.",
  reverse_charge: "Reverse charge: the buyer accounts for the VAT. It is in no OSS or IOSS return (and no EC sales list is made here).",
  business_buyer: "A business buyer was charged VAT. OSS is for sales to people without a VAT number, so this is not in an OSS return.",
  non_eu_market: "A market outside the EU, in the country your store is established in: the VAT belongs in your national VAT return.",
  non_eu_market_foreign:
    "A market outside the EU, in a country your store is not established in. The VAT charged is for that country and is in no OSS or IOSS return and not in your own national return: ask your accountant where it is declared (for example a VAT registration in that country, or import VAT).",
  has_service: "The order has a booked service. Where a booking is taxed follows the place of the service, so it is not in an OSS return; ask your accountant.",
  dispatch_outside_eu:
    "Goods sent from outside the EU that were not marked IOSS. VAT was charged at checkout, but there is no return for it here: ask your accountant where it belongs.",
  dispatch_unknown: "Goods with no dispatch country on record. Set where you send goods from under Settings > Tax; until then this is in no return.",
  domestic: "Sent from and to the same country: a domestic sale, in that country's own VAT return, not in an OSS return.",
  union_goods_msi: "Goods sent to another EU country from your member state of identification: Union scheme, part 2b.",
  union_goods_other: "Goods sent to another EU country from a member state other than your member state of identification: Union scheme, part 2d.",
  union_services: "Electronic services to a private buyer in another EU country: Union scheme, part 2a.",
  non_union_services: "Services to a private buyer in the EU from a seller outside the EU: non-Union scheme.",
};

/** A plain sentence for the reason a sale is where it is (English, for an accountant's eyes; needs review: accountant). */
export const reasonText = (reason: ClassReason): string => REASON_TEXT[reason];

/** Where a sale is reported, in a few words: the VAT table's last column and the CSV's `reported_in`. */
export function placeLabel(result: Pick<ClassResult, "place" | "part" | "reason">): string {
  switch (result.place) {
    case "ioss":
      return "IOSS return";
    case "union":
      return `OSS Union scheme, part ${result.part}`;
    case "non_union":
      return "OSS non-Union scheme";
    case "national":
      return result.reason === "non_eu_market" ? "National return (market outside the EU)" : "National return (domestic sale)";
    default:
      return `Not in a return: ${NONE_LABEL[result.reason] ?? result.reason}`;
  }
}

const NONE_LABEL: Partial<Record<ClassReason, string>> = {
  exempt: "exempt",
  reverse_charge: "reverse charge",
  business_buyer: "business buyer",
  non_eu_market_foreign: "market outside the EU, store not established there",
  has_service: "booked service",
  dispatch_outside_eu: "dispatch outside the EU",
  dispatch_unknown: "no dispatch country",
};

/** A stable key of a result (place, part, reason), for grouping rows by where they are reported. */
export const classKey = (r: Pick<ClassResult, "place" | "part" | "reason">): string => `${r.place}|${r.part ?? ""}|${r.reason}`;

// ---------------------------------------------------------------------------
// Registration fit
// ---------------------------------------------------------------------------

export type RegistrationFacts = {
  ossScheme: "none" | "union" | "non_union";
  iossNumber: string | null;
};

/** Documents found per part of a return. */
export type PartCounts = Partial<Record<ReturnPart, number>>;

export type RegistrationNote = { code: string; message: string };

/**
 * A warning, never a block, when the sales found do not match the registration in the profile. IOSS markets in the profile that no
 * sale touched are not a warning. Needs review: accountant.
 */
export function registrationNotes(profile: RegistrationFacts, found: PartCounts): RegistrationNote[] {
  const notes: RegistrationNote[] = [];
  const union = (found["2a"] ?? 0) + (found["2b"] ?? 0) + (found["2d"] ?? 0);
  if (union > 0 && profile.ossScheme === "none") {
    notes.push({
      code: "union_sales_no_registration",
      message: "These sales fit the OSS Union scheme, but no OSS registration is recorded in Settings > Tax. Without one, each EU country's own VAT rules apply to them.",
    });
  }
  if (union > 0 && profile.ossScheme === "non_union") {
    notes.push({
      code: "goods_with_non_union_registration",
      message: "The profile says non-Union scheme, which is for services from a seller outside the EU, but these sales fit the Union scheme (goods, or services from a seller established in the EU). Check the registration with your accountant.",
    });
  }
  if ((found.NU ?? 0) > 0 && profile.ossScheme === "none") {
    notes.push({
      code: "non_union_sales_no_registration",
      message: "These services fit the OSS non-Union scheme, but no OSS registration is recorded in Settings > Tax.",
    });
  }
  if ((found.NU ?? 0) > 0 && profile.ossScheme === "union") {
    notes.push({
      code: "non_union_sales_union_registration",
      message: "These services fit the non-Union scheme (the store is not established in the EU), but the profile says Union scheme. Check the registration with your accountant.",
    });
  }
  if ((found.IOSS ?? 0) > 0 && !profile.iossNumber) {
    notes.push({
      code: "ioss_sales_no_number",
      message: "Orders are marked IOSS, but no IOSS number is recorded in Settings > Tax now. They are listed here as they were marked.",
    });
  }
  return notes;
}
