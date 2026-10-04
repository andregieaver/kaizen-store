import { describe, expect, it } from "vitest";

import { CLASS_REASONS, classKey, classify, placeLabel, rateKind, reasonText, registrationNotes, type ClassifyInput } from "./tax-classes";

/** A Swedish store (EU, identified in SE, dispatching from SE) selling goods to a private buyer in Germany, standard VAT. */
const base: ClassifyInput = {
  vatKind: "standard",
  buyerType: "consumer",
  market: "DE",
  marketInEu: true,
  hasPhysical: true,
  hasDownload: false,
  hasService: false,
  dispatchCountry: "SE",
  dispatchSource: "order",
  sellerSource: "order",
  basis: "standard",
  seller: { country: "SE", ossMemberState: "SE" },
};
const c = (over: Partial<ClassifyInput> = {}, seller: Partial<ClassifyInput["seller"]> = {}) => classify({ ...base, ...over, seller: { ...base.seller, ...seller } });

describe("classify: the table of docs/wave-1c-reports.md 4.3, row by row", () => {
  it("1. an exempt bucket is in no return, whatever else is true", () => {
    expect(c({ basis: "exempt" })).toMatchObject({ place: "none", part: null, reason: "exempt" });
    expect(c({ basis: "exempt", vatKind: "ioss" })).toMatchObject({ reason: "exempt" });
    expect(c({ basis: "exempt", vatKind: "reverse_charge" })).toMatchObject({ reason: "exempt" });
  });

  it("2. an IOSS sale goes in the IOSS return", () => {
    expect(c({ vatKind: "ioss", dispatchCountry: "NO" }, { country: "NO", ossMemberState: null })).toMatchObject({ place: "ioss", part: "IOSS", reason: "ioss" });
  });

  it("3. reverse charge is in no return", () => {
    expect(c({ vatKind: "reverse_charge", buyerType: "business" })).toMatchObject({ place: "none", reason: "reverse_charge" });
    expect(c({ basis: "reverse_charge" })).toMatchObject({ reason: "reverse_charge" });
  });

  it("4. a business buyer charged VAT is not an OSS supply", () => {
    expect(c({ buyerType: "business" })).toMatchObject({ place: "none", part: null, reason: "business_buyer" });
  });

  it("5. a market outside the EU is the national return only of a store established there", () => {
    const norwegian = { country: "NO", ossMemberState: null };
    expect(c({ market: "NO", marketInEu: false, dispatchCountry: "NO" }, norwegian)).toMatchObject({ place: "national", part: null, reason: "non_eu_market" });
    expect(c({ market: "NO", marketInEu: false, hasPhysical: false, hasDownload: true }, norwegian)).toMatchObject({ place: "national", reason: "non_eu_market" });
  });

  it("5b. a market outside the EU of a store established elsewhere is in no return here, and says whose VAT it is", () => {
    // The finding: a Swedish store with a Norway market is told to put Norwegian VAT in its Swedish return. It is a Norwegian matter.
    for (const input of [{ market: "NO", marketInEu: false }, { market: "NO", marketInEu: false, hasPhysical: false, hasDownload: true }]) {
      const r = c(input);
      expect(r).toMatchObject({ place: "none", part: null, reason: "non_eu_market_foreign" });
      expect(placeLabel(r)).toBe("Not in a return: market outside the EU, store not established there");
      expect(reasonText(r.reason)).toContain("not established");
      expect(reasonText(r.reason)).not.toContain("belongs in your national VAT return");
    }
    // A store with no country on record is never taken to be established in the market.
    expect(c({ market: "NO", marketInEu: false }, { country: null, ossMemberState: null })).toMatchObject({ place: "none", reason: "non_eu_market_foreign" });
    // The same Norway market, a Danish store.
    expect(c({ market: "NO", marketInEu: false }, { country: "DK", ossMemberState: "DK" })).toMatchObject({ reason: "non_eu_market_foreign" });
  });

  it("6. a booked service is in no OSS return", () => {
    expect(c({ hasService: true })).toMatchObject({ place: "none", reason: "has_service" });
    expect(c({ hasService: true, hasPhysical: false })).toMatchObject({ reason: "has_service" });
  });

  it("7. goods dispatched from outside the EU that were not IOSS sales are in no return", () => {
    expect(c({ dispatchCountry: "NO" })).toMatchObject({ place: "none", reason: "dispatch_outside_eu" });
    expect(c({ dispatchCountry: "GB" })).toMatchObject({ reason: "dispatch_outside_eu" });
    expect(c({ dispatchCountry: null })).toMatchObject({ place: "none", reason: "dispatch_unknown" });
  });

  it("8. goods sent from and to the same country are the national return", () => {
    expect(c({ market: "SE", dispatchCountry: "SE" })).toMatchObject({ place: "national", reason: "domestic" });
  });

  it("9. goods from one member state to another are the Union scheme, 2b from the member state of identification and 2d from another", () => {
    expect(c()).toMatchObject({ place: "union", part: "2b", reason: "union_goods_msi" });
    expect(c({ dispatchCountry: "DK" })).toMatchObject({ place: "union", part: "2d", reason: "union_goods_other" });
    // The identification state is the profile's, else the store's country.
    expect(c({ dispatchCountry: "DK" }, { country: "NO", ossMemberState: "DK" })).toMatchObject({ part: "2b" });
    expect(c({ dispatchCountry: "DK" }, { ossMemberState: null })).toMatchObject({ part: "2d" });
    expect(c({ dispatchCountry: "SE" }, { country: "SE", ossMemberState: null })).toMatchObject({ part: "2b" });
  });

  it("10. downloads and fees only, in the seller's own country, are the national return", () => {
    expect(c({ hasPhysical: false, hasDownload: true, market: "SE" })).toMatchObject({ place: "national", reason: "domestic" });
    expect(c({ hasPhysical: false, hasDownload: false, market: "SE" })).toMatchObject({ place: "national", reason: "domestic" });
  });

  it("11. downloads to another member state from an EU seller are 2a", () => {
    expect(c({ hasPhysical: false, hasDownload: true })).toMatchObject({ place: "union", part: "2a", reason: "union_services" });
    // The dispatch country is never looked at for a download.
    expect(c({ hasPhysical: false, hasDownload: true, dispatchCountry: "NO" })).toMatchObject({ part: "2a" });
  });

  it("12. services from a seller outside the EU to an EU consumer are the non-Union scheme", () => {
    expect(c({ hasPhysical: false, hasDownload: true, dispatchCountry: "NO" }, { country: "NO", ossMemberState: null })).toMatchObject({ place: "non_union", part: "NU", reason: "non_union_services" });
  });

  it("is case-insensitive about countries and ignores spaces", () => {
    expect(c({ market: " de ", dispatchCountry: "se" }, { country: "se", ossMemberState: " SE " })).toMatchObject({ part: "2b" });
  });

  it("puts the Norwegian default (Norway dispatching to EU consumers, no IOSS) in no return, with the reason", () => {
    const r = c({ dispatchCountry: "NO" }, { country: "NO", ossMemberState: null });
    expect(r).toMatchObject({ place: "none", reason: "dispatch_outside_eu" });
    expect(placeLabel(r)).toBe("Not in a return: dispatch outside the EU");
    expect(reasonText(r.reason)).toContain("ask your accountant");
  });
});

describe("classify: notes", () => {
  it("flags a seller country and member state taken from the live profile, because the order did not freeze them", () => {
    expect(c({ sellerSource: "profile" }).flags).toEqual(["seller_assumed"]);
    expect(c({ sellerSource: "profile", dispatchSource: "profile" }).flags).toEqual(["dispatch_assumed", "seller_assumed"]);
    expect(c({ sellerSource: "order" }).flags).toEqual([]);
  });

  it("flags a basket of goods and downloads (classed by its goods) and a dispatch country taken from the live profile", () => {
    expect(c({ hasDownload: true }).flags).toEqual(["mixed_goods_download"]);
    expect(c({ dispatchSource: "profile" }).flags).toEqual(["dispatch_assumed"]);
    expect(c({ hasDownload: true, dispatchSource: "profile" }).flags).toEqual(["mixed_goods_download", "dispatch_assumed"]);
    expect(c().flags).toEqual([]);
    // A download alone never depends on where goods are sent from.
    expect(c({ hasPhysical: false, hasDownload: true, dispatchSource: "profile" }).flags).toEqual([]);
  });
});

describe("classify: a total partition", () => {
  const bools = [false, true];
  it("gives every combination of facts exactly one place, one reason of the closed list, and a part exactly when it is in an OSS or IOSS return", () => {
    let n = 0;
    for (const vatKind of ["standard", "reverse_charge", "ioss"])
      for (const buyerType of ["consumer", "business"])
        for (const marketInEu of bools)
          for (const hasPhysical of bools)
            for (const hasDownload of bools)
              for (const hasService of bools)
                for (const dispatchCountry of ["SE", "DK", "NO", null])
                  for (const market of ["SE", "DE", "NO"])
                    for (const basis of ["standard", "exempt", "reverse_charge"])
                      for (const country of ["SE", "NO"]) {
                        const r = c({ vatKind, buyerType, marketInEu, hasPhysical, hasDownload, hasService, dispatchCountry, market, basis }, { country, ossMemberState: country === "SE" ? "SE" : null });
                        n += 1;
                        expect(CLASS_REASONS).toContain(r.reason);
                        expect(["ioss", "union", "non_union", "national", "none"]).toContain(r.place);
                        expect(r.part !== null).toBe(r.place === "ioss" || r.place === "union" || r.place === "non_union");
                        expect(placeLabel(r).length).toBeGreaterThan(5);
                        expect(classKey(r)).toContain(r.reason);
                      }
    expect(n).toBeGreaterThan(5000);
  });
});

describe("rateKind", () => {
  it("is standard only when the rate is the country's standard rate that day", () => {
    expect(rateKind(0.19, 0.19)).toBe("standard");
    expect(rateKind(0.07, 0.19)).toBe("reduced");
    expect(rateKind(0, 0.19)).toBe("reduced");
    expect(rateKind(0.25, null)).toBe("reduced");
    expect(rateKind(0.2500000001, 0.25)).toBe("standard");
  });
});

describe("registrationNotes", () => {
  it("warns of Union sales with no OSS registration", () => {
    expect(registrationNotes({ ossScheme: "none", iossNumber: null }, { "2b": 3 }).map((n) => n.code)).toEqual(["union_sales_no_registration"]);
    expect(registrationNotes({ ossScheme: "none", iossNumber: null }, { "2a": 1, "2d": 2 }).map((n) => n.code)).toEqual(["union_sales_no_registration"]);
    expect(registrationNotes({ ossScheme: "union", iossNumber: null }, { "2b": 3 })).toEqual([]);
  });

  it("warns of goods with a non-Union registration, and of services in the wrong scheme", () => {
    expect(registrationNotes({ ossScheme: "non_union", iossNumber: null }, { "2b": 1 }).map((n) => n.code)).toEqual(["goods_with_non_union_registration"]);
    expect(registrationNotes({ ossScheme: "non_union", iossNumber: null }, { NU: 1 })).toEqual([]);
    expect(registrationNotes({ ossScheme: "union", iossNumber: null }, { NU: 1 }).map((n) => n.code)).toEqual(["non_union_sales_union_registration"]);
    expect(registrationNotes({ ossScheme: "none", iossNumber: null }, { NU: 1 }).map((n) => n.code)).toEqual(["non_union_sales_no_registration"]);
  });

  it("warns of IOSS sales with no IOSS number, and says nothing of IOSS markets no sale touched", () => {
    expect(registrationNotes({ ossScheme: "none", iossNumber: null }, { IOSS: 2 }).map((n) => n.code)).toEqual(["ioss_sales_no_number"]);
    expect(registrationNotes({ ossScheme: "none", iossNumber: "IM5780000001" }, { IOSS: 2 })).toEqual([]);
    expect(registrationNotes({ ossScheme: "none", iossNumber: "IM5780000001" }, {})).toEqual([]);
  });

  it("says nothing when there are no sales in a return", () => {
    expect(registrationNotes({ ossScheme: "none", iossNumber: null }, {})).toEqual([]);
  });
});
