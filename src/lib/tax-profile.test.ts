import { describe, expect, it } from "vitest";

import {
  DEFAULT_TAX_PROFILE,
  OSS_SCHEMES,
  TAX_WARNINGS,
  checkupFindings,
  effectiveDispatch,
  formOf,
  normaliseSellerVatNumber,
  parseTaxProfile,
  readiness,
  sellerFacts,
  vatNumberChanged,
  type TaxProfile,
  type TaxProfileForm,
} from "./tax-profile";

const blank = (): TaxProfileForm => formOf(DEFAULT_TAX_PROFILE);
const form = (over: Partial<TaxProfileForm> = {}): TaxProfileForm => ({ ...blank(), ...over });
const profile = (over: Partial<TaxProfile> = {}): TaxProfile => ({ ...DEFAULT_TAX_PROFILE, ...over });
const errors = (f: TaxProfileForm, country: string | null = "SE") => {
  const r = parseTaxProfile(f, country);
  if (r.ok) throw new Error("expected errors");
  return r.errors;
};
const values = (f: TaxProfileForm, country: string | null = "SE") => {
  const r = parseTaxProfile(f, country);
  if (!r.ok) throw new Error(`expected ok: ${JSON.stringify(r.errors)}`);
  return r.values;
};

describe("the seller's own VAT number", () => {
  it("is an EU store's number with its country's prefix", () => {
    expect(normaliseSellerVatNumber("SE", "se 5566 7788 9901")).toEqual({ ok: true, number: "SE556677889901" });
    expect(normaliseSellerVatNumber("DE", "123456789")).toEqual({ ok: true, number: "DE123456789" });
    expect(normaliseSellerVatNumber("GR", "123456789")).toEqual({ ok: true, number: "EL123456789" });
    expect(normaliseSellerVatNumber("GR", "EL123456789")).toEqual({ ok: true, number: "EL123456789" });
  });

  it("is refused when it starts with another country's prefix", () => {
    const r = normaliseSellerVatNumber("SE", "DE123456789");
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error).toMatch(/own country.*SE/);
    expect(normaliseSellerVatNumber("GR", "GR123456789").ok).toBe(true);
    expect(normaliseSellerVatNumber("DE", "SE556677889901").ok).toBe(false);
  });

  it("is refused when it is the wrong shape", () => {
    expect(normaliseSellerVatNumber("SE", "123").ok).toBe(false);
    expect(normaliseSellerVatNumber("SE", "!!").ok).toBe(false);
  });

  it("is a Norwegian store's nine digits and MVA, with the organisation number's check digit", () => {
    expect(normaliseSellerVatNumber("NO", "923 456 783 MVA")).toEqual({ ok: true, number: "NO923456783MVA" });
    expect(normaliseSellerVatNumber("NO", "NO923456783")).toEqual({ ok: true, number: "NO923456783MVA" });
    expect(normaliseSellerVatNumber("NO", "923456784").ok).toBe(false);
    expect(normaliseSellerVatNumber("NO", "12345").ok).toBe(false);
  });

  it("takes the prefix typed when the store has no country", () => {
    expect(normaliseSellerVatNumber(null, "DE123456789")).toEqual({ ok: true, number: "DE123456789" });
    expect(normaliseSellerVatNumber(null, "123456789").ok).toBe(false);
  });
});

describe("parseTaxProfile", () => {
  it("makes an empty form the defaults", () => {
    expect(values(blank())).toEqual({
      vatRegistered: false, vatNumber: null, dispatchCountry: null, ossScheme: "none", ossMemberState: null, ossNumber: null,
      ossRegisteredOn: null, iossNumber: null, iossIntermediary: null, iossMarkets: [], iossRegisteredOn: null,
    });
  });

  it("keeps what an owner typed, normalised", () => {
    const v = values(form({
      vatRegistered: true, vatNumber: "se556677889901", dispatchCountry: "cn", ossScheme: "union", ossMemberState: "se", ossRegisteredOn: "2026-07-01",
      iossNumber: "im 123 456 7890", iossIntermediary: "  Intermediary AB ", iossMarkets: ["de", "FR", "de", " "], iossRegisteredOn: "2026-09-01",
    }));
    expect(v).toEqual({
      vatRegistered: true, vatNumber: "SE556677889901", dispatchCountry: "CN", ossScheme: "union", ossMemberState: "SE", ossNumber: null,
      ossRegisteredOn: "2026-07-01", iossNumber: "IM1234567890", iossIntermediary: "Intermediary AB", iossMarkets: ["DE", "FR"], iossRegisteredOn: "2026-09-01",
    });
  });

  it("needs a member state for the Union scheme and gives it no number", () => {
    expect(errors(form({ ossScheme: "union" })).ossMemberState).toMatch(/EU member state/);
    expect(errors(form({ ossScheme: "union", ossMemberState: "NO" })).ossMemberState).toMatch(/EU member state/);
    expect(errors(form({ ossScheme: "union", ossMemberState: "SE", ossNumber: "EU123456789" })).ossNumber).toMatch(/no number of its own/);
  });

  it("takes an EU number for the non-Union scheme", () => {
    expect(values(form({ ossScheme: "non_union", ossNumber: "eu123456789" })).ossNumber).toBe("EU123456789");
    expect(errors(form({ ossScheme: "non_union", ossNumber: "EU12" })).ossNumber).toMatch(/EU and nine digits/);
    expect(values(form({ ossScheme: "non_union" })).ossNumber).toBeNull();
  });

  it("clears what does not belong to the chosen scheme", () => {
    const v = values(form({ ossScheme: "none", ossMemberState: "SE", ossNumber: "EU123456789", ossRegisteredOn: "2026-01-01" }));
    expect(v).toMatchObject({ ossScheme: "none", ossMemberState: null, ossNumber: null, ossRegisteredOn: null });
  });

  it("refuses an IOSS number that is not IM and ten digits", () => {
    expect(errors(form({ iossNumber: "IM123" })).iossNumber).toMatch(/IM and ten digits/);
    expect(errors(form({ iossNumber: "EU123456789" })).iossNumber).toBeDefined();
  });

  it("refuses IOSS markets outside the EU", () => {
    expect(errors(form({ iossMarkets: ["DE", "NO"] })).iossMarkets).toMatch(/EU countries only \(not NO\)/);
    expect(errors(form({ iossMarkets: ["XX"] })).iossMarkets).toBeDefined();
    expect(values(form({ iossMarkets: ["DE", "SE", "GR"] })).iossMarkets).toEqual(["DE", "SE", "GR"]);
  });

  it("refuses bad dates, a long intermediary and a bad dispatch country, field by field", () => {
    const e = errors(form({ iossRegisteredOn: "2026-02-30", dispatchCountry: "Norway", iossIntermediary: "x".repeat(121), ossScheme: "non_union", ossRegisteredOn: "tomorrow" }));
    expect(Object.keys(e).sort()).toEqual(["dispatchCountry", "iossIntermediary", "iossRegisteredOn", "ossRegisteredOn"]);
  });

  it("says every problem at once and a wrong VAT number first among them", () => {
    const e = errors(form({ vatNumber: "DE123456789", iossNumber: "no", iossMarkets: ["US"] }));
    expect(Object.keys(e).sort()).toEqual(["iossMarkets", "iossNumber", "vatNumber"]);
  });

  it("treats an unknown scheme as none", () => {
    expect(values(form({ ossScheme: "bogus" as never })).ossScheme).toBe("none");
    expect([...OSS_SCHEMES]).toEqual(["none", "union", "non_union"]);
  });

  it("saves a Norwegian store's own number and nothing else needed", () => {
    expect(values(form({ vatRegistered: true, vatNumber: "923456783" }), "NO").vatNumber).toBe("NO923456783MVA");
  });
});

describe("a changed number clears its check", () => {
  it("is a change when the normalised number differs", () => {
    const saved = profile({ vatNumber: "SE556677889901" });
    expect(vatNumberChanged(saved, { vatNumber: "SE556677889901" })).toBe(false);
    expect(vatNumberChanged(saved, { vatNumber: "SE556677889902" })).toBe(true);
    expect(vatNumberChanged(saved, { vatNumber: null })).toBe(true);
    expect(vatNumberChanged(profile(), { vatNumber: null })).toBe(false);
  });
});

describe("where goods are sent from", () => {
  it("is the profile's country, else the store's", () => {
    expect(effectiveDispatch(profile({ dispatchCountry: "CN" }), "SE")).toBe("CN");
    expect(effectiveDispatch(profile(), "SE")).toBe("SE");
    expect(effectiveDispatch(profile(), null)).toBeNull();
  });

  it("gives the seller's side of the treatment", () => {
    const s = sellerFacts(profile({ vatRegistered: true, vatNumber: "SE556677889901", vatNumberValid: true, dispatchCountry: "CN" }), "SE");
    expect(s).toEqual({ country: "SE", inEu: true, registered: true, numberValid: true, number: "SE556677889901", dispatchCountry: "CN", dispatchInEu: false });
    expect(sellerFacts(profile({ vatRegistered: true }), "SE")).toMatchObject({ registered: false, numberValid: false });
    expect(sellerFacts(profile(), "NO")).toMatchObject({ inEu: false, dispatchInEu: false, dispatchCountry: "NO" });
    expect(sellerFacts(profile({ vatNumber: "SE556677889901", vatNumberValid: false }), "SE").numberValid).toBe(false);
  });
});

describe("readiness", () => {
  const line = (p: TaxProfile, key: string, country: string | null = "SE") => readiness(p, country).find((l) => l.key === key)!;

  it("says reverse charge is off and what it needs", () => {
    expect(line(profile(), "reverse_charge")).toMatchObject({ on: false, needs: ["registration for VAT", "a VAT number"] });
    expect(line(profile({ vatRegistered: true, vatNumber: "SE556677889901" }), "reverse_charge").text).toBe(
      "Reverse charge: off. Needs a VAT number that has been checked valid.",
    );
    expect(line(profile({ vatRegistered: true, vatNumber: "SE556677889901", vatNumberValid: false }), "reverse_charge").on).toBe(false);
  });

  it("says reverse charge is on with a registered, checked number in an EU store", () => {
    const l = line(profile({ vatRegistered: true, vatNumber: "SE556677889901", vatNumberValid: true }), "reverse_charge");
    expect(l.on).toBe(true);
    expect(l.needs).toEqual([]);
    expect(l.text).toMatch(/^Reverse charge: on\./);
  });

  it("turns reverse charge off for goods when they are sent from outside the EU, and says so", () => {
    const l = line(profile({ vatRegistered: true, vatNumber: "SE556677889901", vatNumberValid: true, dispatchCountry: "CN" }), "reverse_charge");
    expect(l.on).toBe(false);
    expect(l.text).toMatch(/goods sent from an EU country/);
    expect(line(profile({ vatRegistered: true, vatNumber: "SE556677889901", vatNumberValid: true, dispatchCountry: "PL" }), "reverse_charge").on).toBe(true);
  });

  it("never turns reverse charge on for a store outside the EU", () => {
    const l = line(profile({ vatRegistered: true, vatNumber: "NO923456783MVA", vatNumberValid: true }), "reverse_charge", "NO");
    expect(l.on).toBe(false);
    expect(l.text).toMatch(/outside the EU never uses reverse charge/);
  });

  it("says IOSS is off until there is a number and markets, as the spec words it", () => {
    expect(line(profile(), "ioss", "NO").text).toBe("IOSS: off. Needs an IOSS number, the markets it applies to.");
    expect(line(profile({ iossNumber: "IM1234567890" }), "ioss", "NO").needs).toEqual(["the markets it applies to"]);
    expect(line(profile({ iossMarkets: ["DE"] }), "ioss", "NO").needs).toEqual(["an IOSS number"]);
  });

  it("says IOSS is on for a Norwegian store with number and markets, and not for goods sent from inside the EU", () => {
    const p = profile({ iossNumber: "IM1234567890", iossMarkets: ["DE"] });
    expect(line(p, "ioss", "NO").on).toBe(true);
    expect(line(p, "ioss", "SE").on).toBe(false);
    expect(line({ ...p, dispatchCountry: "CN" }, "ioss", "SE").on).toBe(true);
  });

  it("says what OSS needs once a scheme is chosen", () => {
    expect(line(profile(), "oss").on).toBe(false);
    expect(line(profile({ ossScheme: "union", ossMemberState: "SE" }), "oss").on).toBe(true);
    expect(line(profile({ ossScheme: "non_union" }), "oss").needs).toEqual(["the non-Union OSS number"]);
  });

  it("has a line for VAT registration", () => {
    expect(line(profile(), "vat").on).toBe(false);
    expect(line(profile({ vatRegistered: true }), "vat").needs).toEqual(["a VAT number"]);
    expect(line(profile({ vatRegistered: true, vatNumber: "SE556677889901" }), "vat").on).toBe(true);
  });
});

describe("the store checkup", () => {
  const codes = (p: TaxProfile) => checkupFindings(p).map((f) => f.code);

  it("is silent for a store with nothing set up", () => {
    expect(codes(profile())).toEqual([]);
  });

  it("reports registered without a number, a number never checked valid, IOSS halves, and OSS without details", () => {
    expect(codes(profile({ vatRegistered: true }))).toEqual(["vat_registered_without_number"]);
    expect(codes(profile({ vatRegistered: true, vatNumber: "SE556677889901" }))).toEqual(["vat_number_not_valid"]);
    expect(codes(profile({ vatRegistered: true, vatNumber: "SE556677889901", vatNumberValid: true }))).toEqual([]);
    expect(codes(profile({ iossMarkets: ["DE"] }))).toEqual(["ioss_markets_without_number"]);
    expect(codes(profile({ iossNumber: "IM1234567890" }))).toEqual(["ioss_number_without_markets"]);
    expect(codes(profile({ ossScheme: "union" }))).toEqual(["oss_incomplete"]);
    expect(codes(profile({ ossScheme: "non_union" }))).toEqual(["oss_incomplete"]);
  });
});

describe("the warnings", () => {
  it("say the things the screen has to say", () => {
    const all = TAX_WARNINGS.join(" ");
    expect(all).toMatch(/Destination VAT/);
    expect(all).toMatch(/10,000 EUR/);
    expect(all).toMatch(/origin-country/);
    expect(all).toMatch(/150 EUR/);
    expect(all).toMatch(/VIES/);
    expect(all).toMatch(/standard VAT rate/);
  });
});
