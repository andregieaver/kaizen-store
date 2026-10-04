import { createElement as h } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DEFAULT_TAX_PROFILE, TAX_WARNINGS, readiness, type TaxProfile } from "@/lib/tax-profile";

import { OwnNumberCheckCard, ReadinessList, TaxProfileForm, TaxWarnings } from "./tax-profile-form";

const html = (element: Parameters<typeof renderToString>[0]) =>
  renderToString(element).replace(/<!-- -->/g, "").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");

const action = async () => ({ status: "idle" as const, messages: [] });
const swedish: TaxProfile = {
  ...DEFAULT_TAX_PROFILE,
  vatRegistered: true,
  vatNumber: "SE556677889901",
  vatNumberValid: true,
  iossMarkets: [],
};

const form = (profile: TaxProfile, canEdit = true, country: string | null = "SE") =>
  html(h(TaxProfileForm, { profile, country, countryName: country === "SE" ? "Sweden" : country, canEdit, saveAction: action }));

describe("TaxProfileForm", () => {
  it("has every field the action reads, under the names it reads them by", () => {
    const out = form({ ...swedish, ossScheme: "union", ossMemberState: "SE" });
    for (const name of ["vatRegistered", "vatNumber", "dispatchCountry", "ossScheme", "ossMemberState", "ossRegisteredOn", "iossNumber", "iossIntermediary", "iossMarkets", "iossRegisteredOn"]) {
      expect(out, name).toContain(`name="${name}"`);
    }
  });

  it("shows what is saved, and says what the number must look like for the store's country", () => {
    const out = form(swedish);
    expect(out).toContain('value="SE556677889901"');
    expect(out).toMatch(/name="vatRegistered"[^>]*checked/);
    expect(out).toContain("starts with SE");
    expect(out).toContain("Must be a number of Sweden");
    expect(form({ ...swedish, vatNumber: null }, true, "NO")).toContain("nine digits and MVA");
    expect(form({ ...swedish, vatNumber: null }, true, "GR")).toContain("starts with EL");
  });

  it("offers the scheme's own fields only when a scheme is chosen", () => {
    expect(form(swedish)).not.toContain('name="ossMemberState"');
    const union = form({ ...swedish, ossScheme: "union", ossMemberState: "SE" });
    expect(union).toContain('name="ossMemberState"');
    expect(union).not.toContain('name="ossNumber"');
    expect(form({ ...swedish, ossScheme: "non_union" })).toContain('name="ossNumber"');
  });

  it("does not tell a Norwegian store that it needs an intermediary for IOSS: most non-EU stores do, Norwegian ones can register directly", () => {
    const out = form({ ...swedish, vatNumber: null }, true, "NO");
    expect(out).toContain("Most stores outside the EU must register through an EU intermediary. Stores established in Norway can register directly.");
    expect(out).not.toContain("A store outside the EU needs an intermediary");
  });

  it("ticks the IOSS markets that were saved, among the 27 member states and no others", () => {
    const out = form({ ...swedish, iossMarkets: ["DE", "FR"] });
    expect((out.match(/name="iossMarkets"/g) ?? []).length).toBe(27);
    const tick = (code: string) => out.match(new RegExp(`<input[^>]*name="iossMarkets"[^>]*value="${code}"[^>]*>`))?.[0] ?? "";
    expect(tick("DE")).toContain("checked");
    expect(tick("FR")).toContain("checked");
    expect(tick("IT")).not.toContain("checked");
    expect(tick("IT")).not.toBe("");
    expect(out).not.toContain('value="NO"');
  });

  it("is read-only for anyone but an owner, and says so", () => {
    const out = form(swedish, false);
    expect(out).toContain("<fieldset disabled");
    expect(out).toContain("Only an owner can change the tax settings.");
    expect(out).not.toContain("Save the tax settings");
    expect(form(swedish)).toContain("Save the tax settings");
  });

  it("uses the admin's tokens, never a fixed colour", () => {
    const out = form(swedish);
    expect(out).toContain("border-border");
    expect(out).not.toMatch(/#[0-9a-f]{3,8}\b|bg-white|text-black|bg-gray|text-gray/i);
  });
});

describe("OwnNumberCheckCard", () => {
  const checked = { status: "valid" as const, source: "vies" as const, checkedAt: "2026-10-03T10:00:00Z", requestIdentifier: "WAPIAAAAZZZ", name: "Kaffe AB", address: "Storgatan 1\n111 22 Stockholm" };
  const card = (props: Partial<Parameters<typeof OwnNumberCheckCard>[0]> = {}) => html(h(OwnNumberCheckCard, { number: "SE556677889901", check: checked, canEdit: true, action, ...props }));

  it("asks for a number first when none is saved, with no button to check it", () => {
    const out = card({ number: null, check: null });
    expect(out).toContain("Save a VAT number above first");
    expect(out).not.toContain("Check now");
  });

  it("says a number has not been checked, with the button for an owner only", () => {
    const out = card({ check: null });
    expect(out).toContain("has not been checked");
    expect(out).toContain("Check now");
    expect(card({ check: null, canEdit: false })).not.toContain("Check now");
  });

  it("shows what the register held when the number was registered, and the consultation number", () => {
    const out = card();
    expect(out).toContain("is registered");
    expect(out).toContain("VIES");
    expect(out).toContain("Kaffe AB");
    expect(out).toContain("Storgatan 1");
    expect(out).toContain("WAPIAAAAZZZ");
  });

  it("names the Norwegian register for a number checked there", () => {
    expect(card({ check: { ...checked, source: "brreg", requestIdentifier: null } })).toContain("Brønnøysundregistrene");
  });

  it("never takes a number that could not be checked as valid", () => {
    const out = card({ check: { ...checked, status: "unavailable", name: null, address: null, requestIdentifier: null } });
    expect(out).toContain("could not be checked");
    expect(out).toContain("not taken as valid");
    expect(out).not.toContain("is registered");
    const invalid = card({ check: { ...checked, status: "invalid", name: null, address: null, requestIdentifier: null } });
    expect(invalid).toContain("was not accepted");
    expect(invalid).not.toContain("Registered name");
  });
});

describe("ReadinessList and TaxWarnings", () => {
  it("says On or Off in words for each of the four lines, and what is missing", () => {
    const out = html(h(ReadinessList, { lines: readiness(DEFAULT_TAX_PROFILE, "SE") }));
    expect((out.match(/>Off</g) ?? []).length).toBe(4);
    expect(out).toContain("Reverse charge: off. Needs");
    expect(out).toContain("IOSS: off. Needs an IOSS number");
    const ready = html(h(ReadinessList, { lines: readiness(swedish, "SE") }));
    expect(ready).toContain(">On<");
    expect(ready).toContain("Reverse charge: on.");
  });

  it("lists every warning for the accountant", () => {
    const out = html(h(TaxWarnings, { warnings: TAX_WARNINGS }));
    for (const warning of TAX_WARNINGS) expect(out).toContain(warning.slice(0, 40));
    expect(out).toContain("not tax advice");
  });
});
