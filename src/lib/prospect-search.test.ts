import { describe, expect, it } from "vitest";

import { cleanFilters, filtersFromQuery, filtersToQuery, hasFilters, placesNamed, readSearch, searchUrl } from "./prospect-search";
import { foldAddress, foldDomain, readEntry } from "./do-not-contact";

describe("finding companies' filters (P5.1, D893)", () => {
  it("keeps only industries and places on the lists, and names places by their Norwegian names", () => {
    const f = cleanFilters({ industries: ["56.1", "99.9", "47"], placeNames: ["Oslo", "Atlantis", "Vestland"], employeesMin: 50, employeesMax: 5 });
    expect(f.industries).toEqual(["56.1", "47"]);
    expect(f.places).toEqual(["0301", "46"]);
    expect([f.employeesMin, f.employeesMax]).toEqual([5, 50]);
    expect(hasFilters(cleanFilters({ employeesMin: 3 }))).toBe(false);
  });

  it("names both municipalities that share a name", () => {
    expect(placesNamed(["Våler"]).length).toBe(2);
  });

  it("round-trips through the page's address", () => {
    const f = cleanFilters({ industries: ["56.1"], places: ["0301"], employeesMin: 5, employeesMax: 50, foundedFrom: "2024-01-01" });
    expect(filtersFromQuery(filtersToQuery(f))).toEqual(f);
  });

  it("asks the register for companies only, none bankrupt or being wound up, and a county as its municipalities", () => {
    const url = new URL(searchUrl(cleanFilters({ industries: ["56.1"], places: ["03"], employeesMin: 5 }), 2));
    expect(url.hostname).toBe("data.brreg.no");
    expect(url.searchParams.get("naeringskode")).toBe("56.1");
    expect(url.searchParams.get("kommunenummer")).toBe("0301");
    expect(url.searchParams.get("organisasjonsform")).not.toContain("ENK");
    expect(url.searchParams.get("konkurs")).toBe("false");
    expect(url.searchParams.get("page")).toBe("2");
  });

  it("reads a page of results, leaving out a sole trader and a bankrupt company", () => {
    const unit = (n: string, over: Record<string, unknown> = {}) => ({ organisasjonsnummer: n, navn: "KAFE AS", organisasjonsform: { kode: "AS" }, antallAnsatte: 12, ...over });
    const page = readSearch(
      { _embedded: { enheter: [unit("911111111"), unit("922222222", { organisasjonsform: { kode: "ENK" } }), unit("933333333", { konkurs: true, konkursdato: "2026-01-02" })] }, page: { totalElements: 3, number: 0, totalPages: 1 } },
      "2026-11-25",
    );
    expect(page.companies.map((c) => c.number)).toEqual(["911111111"]);
    expect(page.companies[0]).toMatchObject({ name: "Kafe AS", employees: 12 });
    expect(page.total).toBe(3);
  });
});

describe("do not contact's folding (P5.6, D893)", () => {
  it("folds an address, a domain and a website to the same domain", () => {
    expect(foldAddress(" Post@WWW.Firma.no ")).toBe("post@firma.no");
    expect(foldDomain("https://www.firma.no/om-oss")).toBe("firma.no");
    expect(foldDomain("post@firma.no")).toBe("firma.no");
    expect(foldDomain("not a domain")).toBeNull();
  });

  it("reads a typed entry as an address or a domain", () => {
    expect(readEntry("ola@firma.no")).toEqual({ kind: "address", value: "ola@firma.no" });
    expect(readEntry("firma.no")).toEqual({ kind: "domain", value: "firma.no" });
    expect(readEntry("hello")).toBeNull();
  });
});
