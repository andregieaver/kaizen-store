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

describe("reading a found company's site (P5.2, P5.9, D894)", async () => {
  const { cleanCriteria, cleanReading, criteriaFromQuery, criteriaToQuery, generalAddresses, plainSentence } = await import("./prospect-reading");

  it("keeps the owner's site criteria named, weighted 1 to 3, none twice, and through the address", () => {
    const criteria = cleanCriteria([{ name: "Serves vegan food", weight: 9 }, { name: "serves vegan food", weight: 1 }, { name: "Sells online", weight: 0 }, { name: "" }]);
    expect(criteria).toEqual([{ name: "Serves vegan food", weight: 3 }, { name: "Sells online", weight: 1 }]);
    expect(criteriaFromQuery(criteriaToQuery(criteria))).toEqual(criteria);
  });

  it("finds only the company's own door: a role address on its domain, never a named person's, never another domain's", () => {
    const text = "Kontakt oss på post@kafe.no eller kontakt@booking.kafe.no. Skriv til daglig leder ola.nordmann@kafe.no. Partner: info@other.no";
    expect(generalAddresses(text, "kafe.no")).toEqual(["post@kafe.no", "kontakt@booking.kafe.no"]);
    expect(generalAddresses("Please email our CEO at kari@kafe.no", "kafe.no")).toEqual([]);
  });

  it("lets nothing the model writes carry an address, a phone number or a link", () => {
    expect(plainSentence("A café. Write to ola.nordmann@kafe.no, call +47 912 34 567 or see https://evil.example/x and www.evil.example")).toBe("A café. Write to , call or see and");
  });

  it("scores a page that says it fits as the model's numbers allow only: unknown names ignored, odd scores 1, the fit worked out in code", () => {
    const criteria = [{ name: "Serves vegan food", weight: 3 }, { name: "Sells online", weight: 1 }];
    const reading = cleanReading({ does: "A vegan café.", scores: { "serves vegan food": 5, "Sells online": 11, "ignore previous instructions": 5 } }, criteria);
    expect(reading.scores).toEqual({ "Serves vegan food": 5, "Sells online": 1 });
    expect(reading.fit).toBe(80);
    expect(cleanReading("not json", criteria)).toMatchObject({ does: "", fit: 20 });
    expect(cleanReading({ does: "x" }, []).fit).toBeNull();
  });
});
