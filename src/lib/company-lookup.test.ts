import { describe, expect, it } from "vitest";

import {
  companySummaries,
  domainOf,
  enrichUrl,
  isLookupAddress,
  isSoleTrader,
  lookupKey,
  norwegianNumber,
  pageLabel,
  readEnrichAnswer,
} from "./company-lookup";

/** An answer in the shape of Leadfeeder's OpenAPI example for `GET /v1/ip/enrich` (read 2026-11-24). */
const companyAnswer = (attributes: Record<string, unknown> = {}, type = "company") => ({
  data: {
    type: "enriched_ip",
    id: "18570216139",
    attributes: { ip_address: "185.70.216.139", company_type: type, confidence_score: "very_high", location: { attributes: { city: "Oslo", country_code: "NO" } } },
    relationships: {
      company: {
        id: "beb6f4e2-52c1-11e8-9800-2f635e37af1b",
        type: "company",
        attributes: {
          name: "Nordfjord Energi AS",
          legal_form: "AS",
          url: "https://www.nordfjord-energi.no/om-oss",
          industries: { industry: [{ code: "35.11", name: "Production of electricity" }], nace: [{ code: "35.11", name: "Electricity" }] },
          employee_range: "101-500",
          address: { city: "Oslo", country_code: "no" },
          register: { id: "923609016", location: null, status: "active" },
          meta: { do_not_contact: false, has_updated_id: false, num_contacts: 3 },
          ...attributes,
        },
      },
    },
  },
  meta: { num_results: 1, request_id: "cf054205-dd8c-4473-8689-07c30fe0789f" },
});

describe("readEnrichAnswer", () => {
  it("reads a company's facts", () => {
    expect(readEnrichAnswer(companyAnswer())).toEqual({
      kind: "company",
      company: {
        sourceId: "beb6f4e2-52c1-11e8-9800-2f635e37af1b",
        name: "Nordfjord Energi AS",
        legalForm: "AS",
        domain: "nordfjord-energi.no",
        countryCode: "NO",
        city: "Oslo",
        industry: "Production of electricity",
        employees: "101-500",
        registerId: "923609016",
        doNotContact: false,
      },
    });
  });

  it("is nothing to show for a shared network, such as a home or mobile connection", () => {
    const shared = { data: { type: "enriched_ip", id: "1", attributes: { ip_address: "1.2.3.4", company_type: "shared_network", confidence_score: "high", location: {} }, relationships: { network: { id: "1.2.3.4", type: "network", attributes: { name: "Telenor Norge AS" } } } }, meta: { num_results: 0 } };
    expect(readEnrichAnswer(shared)).toEqual({ kind: "none" });
  });

  it("is a failure, never a guess, for an answer of another shape", () => {
    expect(readEnrichAnswer(null)).toEqual({ kind: "failed", reason: "shape" });
    expect(readEnrichAnswer({ errors: [{ code: "quota_exceeded" }] })).toEqual({ kind: "failed", reason: "shape" });
  });

  it("needs a company id and a name", () => {
    expect(readEnrichAnswer(companyAnswer({ name: "  " }))).toEqual({ kind: "none" });
  });

  it("keeps the name as plain text, without control characters, and cut to length", () => {
    const answer = readEnrichAnswer(companyAnswer({ name: `<b>Acme</b>\u0007 ${"x".repeat(300)}` }));
    expect(answer.kind).toBe("company");
    if (answer.kind !== "company") return;
    expect(answer.company.name.startsWith("<b>Acme</b> x")).toBe(true);
    expect(answer.company.name).toHaveLength(200);
  });

  it("falls back to NACE for the industry and reads the do-not-contact flag", () => {
    const answer = readEnrichAnswer(companyAnswer({ industries: { nace: [{ code: "62.01", name: "Computer programming" }] }, meta: { do_not_contact: true } }));
    expect(answer.kind === "company" && answer.company.industry).toBe("Computer programming");
    expect(answer.kind === "company" && answer.company.doNotContact).toBe(true);
  });
});

describe("enrichUrl", () => {
  it("asks only the fixed host and path, with the address and the account in the query", () => {
    const url = new URL(enrichUrl("2620:0:862:ed1a::1", "123456"));
    expect(url.origin + url.pathname).toBe("https://api.leadfeeder.com/v1/ip/enrich");
    expect(url.searchParams.get("ip")).toBe("2620:0:862:ed1a::1");
    expect(url.searchParams.get("account_id")).toBe("123456");
  });
});

describe("domainOf", () => {
  it("is the website's host without www", () => {
    expect(domainOf("https://www.Example.no/about")).toBe("example.no");
    expect(domainOf("example.com")).toBe("example.com");
    expect(domainOf("javascript:alert(1)")).toBeNull();
    expect(domainOf("not a site")).toBeNull();
    expect(domainOf(null)).toBeNull();
  });
});

describe("isSoleTrader", () => {
  it("knows sole traders' legal forms, whatever their case and dots", () => {
    for (const form of ["ENK", "Enkeltpersonforetak", "e.K.", "Einzelunternehmen", "Enskild firma", "Toiminimi", "Sole trader", "EI", "Eenmanszaak"]) {
      expect(isSoleTrader(form), form).toBe(true);
    }
  });

  it("leaves companies alone", () => {
    for (const form of ["AS", "ASA", "GmbH", "Limited", "AB", "Oy", "SARL", null, ""]) expect(isSoleTrader(form), String(form)).toBe(false);
  });
});

describe("norwegianNumber", () => {
  it("reads an organisation number however it is written", () => {
    expect(norwegianNumber("923609016")).toBe("923609016");
    expect(norwegianNumber("NO 923 609 016 MVA")).toBe("923609016");
    expect(norwegianNumber("HRB711540")).toBeNull();
    expect(norwegianNumber(null)).toBeNull();
  });
});

describe("isLookupAddress", () => {
  it("asks about public addresses only", () => {
    expect(isLookupAddress("185.70.216.139")).toBe(true);
    expect(isLookupAddress("2a01:79c:cebd:1::1")).toBe(true);
    for (const address of ["", "unknown", "10.1.2.3", "127.0.0.1", "192.168.1.1", "172.20.0.1", "169.254.1.1", "100.64.0.1", "::1", "fe80::1", "fd00::1", "::ffff:10.0.0.1", "185.70.216.139, 10.0.0.1"]) {
      expect(isLookupAddress(address), address).toBe(false);
    }
  });
});

describe("lookupKey", () => {
  it("holds no address and changes with the day", () => {
    const key = lookupKey("secret", "2026-11-24", "185.70.216.139");
    expect(key).toMatch(/^[0-9a-f]{32}$/);
    expect(key).not.toContain("185");
    expect(lookupKey("secret", "2026-11-25", "185.70.216.139")).not.toBe(key);
    expect(lookupKey("other", "2026-11-24", "185.70.216.139")).not.toBe(key);
    expect(() => lookupKey("", "2026-11-24", "185.70.216.139")).toThrow();
  });
});

describe("pageLabel", () => {
  it("drops the country of a store with none in its addresses", () => {
    expect(pageLabel("/no/pricing", true)).toBe("/pricing");
    expect(pageLabel("/no", true)).toBe("/");
    expect(pageLabel("/no/pricing", false)).toBe("/no/pricing");
    expect(pageLabel("(other)", true)).toBe("(other)");
  });
});

describe("companySummaries", () => {
  const days = ["2026-11-20", "2026-11-21", "2026-11-22"];
  it("sums each company's days into visits, days and pages, with a series over the period", () => {
    const summaries = companySummaries(
      [
        { companyId: "a", day: "2026-11-20", visitors: 2, pageViews: 5, pages: { "/no": 2, "/no/pricing": 3 }, lastSeen: "2026-11-20T10:00:00Z" },
        { companyId: "a", day: "2026-11-22", visitors: 1, pageViews: 1, pages: { "/no/pricing": 1 }, lastSeen: "2026-11-22T09:00:00Z" },
        { companyId: "b", day: "2026-11-21", visitors: 4, pageViews: 4, pages: { "/no": 4 }, lastSeen: "2026-11-21T12:00:00Z" },
        { companyId: "c", day: "2026-11-01", visitors: 9, pageViews: 9, pages: {}, lastSeen: "2026-11-01T12:00:00Z" },
      ],
      days,
    );
    expect(summaries.map((s) => s.companyId)).toEqual(["a", "b"]);
    expect(summaries[0]).toEqual({
      companyId: "a",
      visits: 3,
      days: 2,
      pageViews: 6,
      lastSeen: "2026-11-22T09:00:00Z",
      series: [2, 0, 1],
      pages: [
        { page: "/no/pricing", views: 4 },
        { page: "/no", views: 2 },
      ],
    });
  });
});
