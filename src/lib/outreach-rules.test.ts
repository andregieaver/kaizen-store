import { describe, expect, it } from "vitest";

import { COUNTRY_RULES, countryRule, countryStanding, outreachGate } from "./outreach-rules";

/** The country's rule and the one gate (P5.3, D906), as the owner left `docs/outreach-rules.md` in Legal reviews on 26 November 2026. */
describe("the country rules and the outreach gate (D906)", () => {
  const company = { recipient: "legal_entity", address: "general", suppressed: false, consented: false } as const;

  it("holds the owner's positions: four countries with a way to say no, Denmark and Germany consent first, any other consent first", () => {
    expect(Object.fromEntries(COUNTRY_RULES.map((r) => [r.country, r.generalAddress]))).toEqual({
      NO: "allowed_with_opt_out",
      SE: "allowed_with_opt_out",
      FI: "allowed_with_opt_out",
      FR: "allowed_with_opt_out",
      DK: "consent_first",
      DE: "consent_first",
    });
    expect(countryRule("nl").generalAddress).toBe("consent_first");
    expect(countryStanding("NO")).toEqual({ route: "allowed_with_opt_out", read: false });
  });

  it("sends nothing while no lawyer has read the country's row, even where the owner allows it", () => {
    expect(COUNTRY_RULES.every((r) => r.legalReading === null)).toBe(true);
    expect(outreachGate({ ...company, country: "NO" })).toMatchObject({ send: false, reasons: ["not_read_by_lawyer"] });
  });

  it("gives every reason, not the first: a sole trader, a named address, the list and consent all count", () => {
    expect(outreachGate({ country: "DK", recipient: "sole_trader", address: "named_person", suppressed: true, consented: false }).reasons).toEqual([
      "suppressed",
      "sole_trader",
      "named_address",
      "consent_needed",
      "not_read_by_lawyer",
    ]);
    expect(outreachGate({ ...company, country: "DE", consented: true }).reasons).toEqual(["not_read_by_lawyer"]);
    expect(outreachGate({ ...company, country: "SE", recipient: "person" }).reasons).toContain("person");
  });
});
