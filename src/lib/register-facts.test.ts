import { describe, expect, it } from "vitest";

import { compactMoney, readAccounts, readableName, readUnit, readUpdates, redFlagOf, revenueChange, updatesUrl, websiteOf } from "./register-facts";

/** Answers in the shapes Brønnøysund's open APIs gave on 24 November 2026 (a real unit's fields, shortened). */
const unit = (over: Record<string, unknown> = {}) => ({
  organisasjonsnummer: "923609016",
  navn: "NORDFJORD ENERGI AS",
  organisasjonsform: { kode: "AS", beskrivelse: "Aksjeselskap" },
  naeringskode1: { kode: "35.111", beskrivelse: "Produksjon av elektrisitet fra vannkraft" },
  antallAnsatte: 120,
  harRegistrertAntallAnsatte: true,
  stiftelsesdato: "2009-03-01",
  hjemmeside: "www.nordfjord-energi.no",
  forretningsadresse: { adresse: ["Kaien 1"], poststed: "BERGEN", kommune: "BERGEN" },
  konkurs: false,
  underAvvikling: false,
  underTvangsavviklingEllerTvangsopplosning: false,
  ...over,
});

const TODAY = "2026-11-24";

describe("readUnit", () => {
  it("reads a company's facts, its name and place made readable", () => {
    expect(readUnit(unit(), TODAY)).toEqual({
      status: "company",
      facts: {
        name: "Nordfjord Energi AS",
        orgForm: "AS",
        orgFormName: "Aksjeselskap",
        industryCode: "35.111",
        industryName: "Produksjon av elektrisitet fra vannkraft",
        employees: 120,
        founded: "2009-03-01",
        municipality: "Bergen",
        website: "nordfjord-energi.no",
        redFlag: null,
        redFlagOn: null,
      },
    });
  });

  it("keeps nothing but the form of a sole trader, whose entry is a person's", () => {
    expect(readUnit(unit({ navn: "NORDMANN OLA", organisasjonsform: { kode: "ENK", beskrivelse: "Enkeltpersonforetak" } }), TODAY)).toEqual({ status: "sole_trader", orgForm: "ENK" });
  });

  it("is not found without a nine-digit number", () => {
    expect(readUnit({ navn: "X" }, TODAY)).toEqual({ status: "not_found" });
    expect(readUnit(null, TODAY)).toEqual({ status: "not_found" });
  });

  it("leaves the headcount out when the register says none is registered", () => {
    const read = readUnit(unit({ harRegistrertAntallAnsatte: false, antallAnsatte: 0 }), TODAY);
    expect(read.status === "company" && read.facts.employees).toBeNull();
  });
});

describe("redFlagOf", () => {
  it("is the most serious flag that holds, with the register's day", () => {
    expect(redFlagOf(unit(), TODAY)).toEqual({ flag: null, on: null });
    expect(redFlagOf(unit({ konkurs: true, konkursdato: "2026-11-23" }), TODAY)).toEqual({ flag: "bankrupt", on: "2026-11-23" });
    expect(redFlagOf(unit({ underAvvikling: true, underAvviklingDato: "2026-10-01" }), TODAY)).toEqual({ flag: "winding_up", on: "2026-10-01" });
    expect(redFlagOf(unit({ konkurs: true, underAvvikling: true }), TODAY)).toEqual({ flag: "bankrupt", on: TODAY });
    expect(redFlagOf(unit({ slettedato: "2026-11-20", konkurs: true }), TODAY)).toEqual({ flag: "deleted", on: "2026-11-20" });
    expect(redFlagOf(unit({ underTvangsavviklingEllerTvangsopplosning: true }), TODAY)).toEqual({ flag: "dissolution", on: TODAY });
  });
});

describe("readAccounts", () => {
  const year = (end: string, revenue: number, type = "SELSKAP", currency = "NOK") => ({
    regnskapstype: type,
    regnskapsperiode: { fraDato: `${end.slice(0, 4)}-01-01`, tilDato: end },
    valuta: currency,
    resultatregnskapResultat: { aarsresultat: 151171.0, driftsresultat: { driftsresultat: 201570.0, driftsinntekter: { sumDriftsinntekter: revenue } } },
    egenkapitalGjeld: { egenkapital: { sumEgenkapital: -1002498.0 } },
  });

  it("reads the latest year of the company's own accounts, in minor units, with the year before's revenue", () => {
    expect(readAccounts([year("2023-12-31", 6768471.0), year("2025-12-31", 8400202.0), year("2024-12-31", 7089352.0), year("2025-12-31", 99e9, "KONSERN", "USD")])).toEqual({
      year: 2025,
      currency: "NOK",
      revenueMinor: 840020200,
      operatingResultMinor: 20157000,
      profitMinor: 15117100,
      equityMinor: -100249800,
      previousRevenueMinor: 708935200,
    });
  });

  it("takes the group's when the company files none of its own, and nothing from an answer of another shape", () => {
    expect(readAccounts([year("2025-12-31", 1000, "KONSERN", "USD")])?.currency).toBe("USD");
    expect(readAccounts({ error: "x" })).toBeNull();
    expect(readAccounts([])).toBeNull();
  });
});

describe("the feed and the small helpers", () => {
  it("reads the numbers that changed, once each", () => {
    const json = { _embedded: { oppdaterteEnheter: [{ organisasjonsnummer: "923609016", endringstype: "Endring" }, { organisasjonsnummer: "923609016" }, { organisasjonsnummer: "x" }] } };
    expect(readUpdates(json)).toEqual(["923609016"]);
    expect(readUpdates({})).toEqual([]);
  });

  it("asks the feed about our numbers only, since a moment", () => {
    const url = new URL(updatesUrl(new Date("2026-11-21T00:00:00Z"), ["923609016", "935298830"]));
    expect(url.origin + url.pathname).toBe("https://data.brreg.no/enhetsregisteret/api/oppdateringer/enheter");
    expect(url.searchParams.get("organisasjonsnummer")).toBe("923609016,935298830");
    expect(url.searchParams.get("dato")).toBe("2026-11-21T00:00:00.000Z");
  });

  it("writes names, websites, changes and amounts for people", () => {
    expect(readableName("BERGVIK MASKIN AS")).toBe("Bergvik Maskin AS");
    expect(readableName("Already Fine AS")).toBe("Already Fine AS");
    expect(websiteOf("www.Example.no")).toBe("example.no");
    expect(websiteOf("not a site")).toBeNull();
    expect(revenueChange({ revenueMinor: 110, previousRevenueMinor: 100 })).toBe(10);
    expect(revenueChange({ revenueMinor: 110, previousRevenueMinor: null })).toBeNull();
    expect(compactMoney(840020200, "NOK", "en")).toMatch(/8\.4M/);
    expect(compactMoney(840020200, "NOK", "nb-NO")).toMatch(/8,4/);
  });
});
