import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { compareVatReturns, formAmount, mvaMeldingXml, theirVatRows, vatReturnOf, vatTerm, vatTermOfDay, vatTermOfKey, vatTermsOf } from "./vat-return";

describe("VAT terms and when they are due (D496)", () => {
  it("knows a day's two-month term, its name and its due day", () => {
    expect(vatTermOfDay("two_months", "2026-11-08")).toMatchObject({ year: 2026, term: 6, from: "2026-11-01", to: "2026-12-31", period: "november-desember", due: "2027-02-10", key: "2026-6" });
    expect(vatTermOfDay("two_months", "2026-02-28")).toMatchObject({ term: 1, from: "2026-01-01", to: "2026-02-28", period: "januar-februar", due: "2026-04-10" });
    expect(vatTermOfDay("two_months", "2028-02-15").to).toBe("2028-02-29");
    // May–June is due on 31 August.
    expect(vatTerm("two_months", 2026, 3).due).toBe("2026-08-31");
    // A weekend moves to the Monday after: 10 October 2026 is a Saturday.
    expect(vatTerm("two_months", 2026, 4).due).toBe("2026-10-12");
  });

  it("knows a yearly term, due 10 March", () => {
    expect(vatTermOfDay("year", "2026-11-08")).toMatchObject({ term: 1, from: "2026-01-01", to: "2026-12-31", period: "aarlig", due: "2027-03-10", key: "2026-1" });
  });

  it("lists the terms from the book's first to today's, newest first", () => {
    expect(vatTermsOf("two_months", "2026-07-15", "2026-11-08").map((t) => t.key)).toEqual(["2026-6", "2026-5", "2026-4"]);
    expect(vatTermsOf("two_months", "2025-12-01", "2026-03-02").map((t) => t.key)).toEqual(["2026-2", "2026-1", "2025-6"]);
    expect(vatTermsOf("year", "2025-03-01", "2026-11-08").map((t) => t.key)).toEqual(["2026-1", "2025-1"]);
  });

  it("reads a term from its key, and nothing else", () => {
    expect(vatTermOfKey("two_months", "2026-6")?.period).toBe("november-desember");
    expect(vatTermOfKey("two_months", "2026-7")).toBeNull();
    expect(vatTermOfKey("year", "2026-2")).toBeNull();
    expect(vatTermOfKey("two_months", "x")).toBeNull();
  });
});

describe("the return's lines, as Skatteetaten's form asks for them (D496)", () => {
  it("gives a sale its base, rate and VAT, a purchase only its deduction, a sale without VAT its base, and sums what is to pay", () => {
    const ret = vatReturnOf([
      { code: "3", base: 2_000_000, vat: 500_000 },
      { code: "52", base: 1_000_000, vat: 0 },
      { code: "1", base: -400_000, vat: -100_000 },
      { code: "13", base: -10_000, vat: -1_200 },
    ]);
    expect(ret.lines).toEqual([
      { code: "1", side: "deducted", base: null, rate: null, vat: -100_000 },
      { code: "3", side: "due", base: 2_000_000, rate: 25, vat: 500_000 },
      { code: "13", side: "deducted", base: null, rate: null, vat: -1_200 },
      { code: "52", side: "due", base: 1_000_000, rate: 0, vat: 0 },
    ]);
    expect(ret.total).toBe(398_800);
  });

  it("gives a reverse charge its VAT due and, where it may be deducted, the same again as a deduction", () => {
    const deductible = vatReturnOf([{ code: "86", base: -1_000_000, vat: 0 }]);
    expect(deductible.lines).toEqual([
      { code: "86", side: "due", base: 1_000_000, rate: 25, vat: 250_000 },
      { code: "86", side: "deducted", base: null, rate: null, vat: -250_000 },
    ]);
    expect(deductible.total).toBe(0);
    expect(vatReturnOf([{ code: "87", base: -1_000_000, vat: 0 }]).total).toBe(250_000);
  });

  it("gives a lost receivable's VAT taken back a deduction line of its own, as Skatteetaten's tap på krav (D500)", () => {
    const ret = vatReturnOf([
      { code: "1", base: -80_000, vat: -20_000 },
      { code: "1", base: -40_000, vat: -10_000, spec: "tapPåKrav" },
    ]);
    expect(ret.lines).toEqual([
      { code: "1", side: "deducted", base: null, rate: null, vat: -20_000 },
      { code: "1", side: "deducted", base: null, rate: null, vat: -10_000, spec: "tapPåKrav" },
    ]);
    expect(ret.total).toBe(-30_000);
    const xml = mvaMeldingXml({ organisationNumber: "913238254", term: vatTerm("two_months", 2026, 6), ret, reference: "r", system: { name: "K", version: "1" } });
    expect(xml).toMatch(/<mvaKode>1<\/mvaKode>\s*<spesifikasjon>tapPåKrav<\/spesifikasjon>\s*<merverdiavgift>-100<\/merverdiavgift>/);
    // Compared with Tripletex by code: the two rows of code 1 together.
    expect(compareVatReturns([{ code: "1", base: -80_000, vat: -20_000 }, { code: "1", base: -40_000, vat: -10_000, spec: "tapPåKrav" }], [{ code: "1", base: -120_000, vat: -30_000 }])).toEqual({ differences: [], totalDifference: 0 });
  });

  it("names a code the form does not take, and leaves it out", () => {
    expect(vatReturnOf([{ code: "0", base: -5_000, vat: 0 }])).toEqual({ lines: [], total: 0, unknown: ["0"] });
  });
});

describe("Tripletex's return worked out from its postings, and the comparison (D496)", () => {
  it("takes each posting's net as the base and the rest as VAT, never the VAT accounts' own postings", () => {
    const rows = theirVatRows([
      { account: 3000, vatCode: "3", netMinor: -1_200_000, grossMinor: -1_500_000 },
      { account: 2700, vatCode: "3", netMinor: -300_000, grossMinor: -300_000 },
      { account: 6540, vatCode: "1", netMinor: 80_000, grossMinor: 100_000 },
      { account: 1500, vatCode: null, netMinor: 1_500_000, grossMinor: 1_500_000 },
    ]);
    expect(rows).toEqual([
      { code: "1", base: -80_000, vat: -20_000 },
      { code: "3", base: 1_200_000, vat: 300_000 },
    ]);
  });

  it("lists where the two differ, code by code, and by how much to pay in all", () => {
    const ours = [
      { code: "3", base: 1_200_000, vat: 300_000 },
      { code: "1", base: -80_000, vat: -20_000 },
    ];
    const theirs = [{ code: "3", base: 1_200_000, vat: 300_000 }];
    expect(compareVatReturns(ours, theirs)).toEqual({ differences: [{ code: "1", oursBase: -80_000, theirsBase: 0, oursVat: -20_000, theirsVat: 0 }], totalDifference: -20_000 });
    expect(compareVatReturns(ours, ours)).toEqual({ differences: [], totalDifference: 0 });
  });
});

describe("the return as Skatteetaten's XML (D496)", () => {
  it("writes kroner and øre as the form's decimal", () => {
    expect(formAmount(125_000)).toBe("1250");
    expect(formAmount(125_050)).toBe("1250.50");
    expect(formAmount(-31_250)).toBe("-312.50");
    expect(formAmount(0)).toBe("0");
  });

  it("writes the term, the VAT to pay and each line in the schema's order", () => {
    const xml = mvaMeldingXml({
      organisationNumber: "913 238 254",
      term: vatTerm("two_months", 2026, 6),
      ret: vatReturnOf([
        { code: "3", base: 2_000_050, vat: 500_012 },
        { code: "1", base: -400_000, vat: -100_000 },
      ]),
      reference: "kf-2026-6",
      system: { name: "Kaizena Flow", version: "abc1234" },
    });
    expect(xml).toContain('<mvaMeldingDto xmlns="no:skatteetaten:fastsetting:avgift:mva:skattemeldingformerverdiavgift:v1.0">');
    expect(xml).toContain("<skattleggingsperiodeToMaaneder>november-desember</skattleggingsperiodeToMaaneder>");
    expect(xml).toContain("<fastsattMerverdiavgift>4000.12</fastsattMerverdiavgift>");
    expect(xml).toMatch(/<mvaKode>1<\/mvaKode>\s*<merverdiavgift>-1000<\/merverdiavgift>/);
    expect(xml).toMatch(/<mvaKode>3<\/mvaKode>\s*<grunnlag>20000.50<\/grunnlag>\s*<sats>25<\/sats>\s*<merverdiavgift>5000.12<\/merverdiavgift>/);
    expect(xml).toContain("<organisasjonsnummer>913238254</organisasjonsnummer>");
    expect(xml.indexOf("<innsending>")).toBeLessThan(xml.indexOf("<skattegrunnlagOgBeregnetSkatt>"));
    expect(xml.indexOf("</skattegrunnlagOgBeregnetSkatt>")).toBeLessThan(xml.indexOf("<skattepliktig>"));
    expect(mvaMeldingXml({ organisationNumber: "913238254", term: vatTerm("year", 2026, 1), ret: vatReturnOf([]), reference: "r", system: { name: "K", version: "1" } })).toContain(
      "<skattleggingsperiodeAar>aarlig</skattleggingsperiodeAar>",
    );
  });

  it("writes exactly the sample validated against Skatteetaten's schema", () => {
    // `src/data/vat-return/mva-melding-sample.xml` was validated with xmllint against `skattemeldingformerverdiavgift.v1.0.xsd`
    // (github.com/Skatteetaten/mva-meldingen) on 8 November 2026. A change to the XML changes this file, and is validated again first.
    const ret = vatReturnOf([
      { code: "3", base: 2_000_050, vat: 500_012 },
      { code: "1", base: -400_000, vat: -100_000 },
      { code: "52", base: 100_000, vat: 0 },
      { code: "86", base: -100_000, vat: 0 },
    ]);
    const xml = mvaMeldingXml({ organisationNumber: "913238254", term: vatTerm("two_months", 2026, 6), ret, reference: "kf-2026-6", system: { name: "Kaizena Flow", version: "abc1234" } });
    expect(xml).toBe(readFileSync(path.resolve(__dirname, "../data/vat-return/mva-melding-sample.xml"), "utf8"));
  });
});
