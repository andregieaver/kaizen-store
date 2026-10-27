import { describe, expect, it } from "vitest";

import { PRODUCER_SCHEMES } from "./product-input";
import {
  checkRegistration,
  covers,
  endingSoon,
  firstBlockedDay,
  groupMissing,
  isDay,
  nextDay,
  numberShownByDefault,
  registrationState,
  SCHEME_IDS,
  type Registration,
} from "./producer-registrations";

/** Producer responsibility (wave 7 unit H, D342): the pure rules of the page, the AI manager and the database's `registration_blocks()`. */

const markets = ["NO", "SE", "DE"];
const typed = {
  scheme: "packaging",
  market: "no",
  kind: "registered",
  number: "  NO-123 456 ",
  authority: "Miljødirektoratet",
  showNumber: true,
  validFrom: "2026-01-01",
  validTo: "",
};

describe("a registration as typed", () => {
  it("is cleaned: the country upper-cased, the number on one line, an empty last day open-ended", () => {
    expect(checkRegistration(typed, markets)).toEqual({
      ok: true,
      value: {
        scheme: "packaging",
        market: "NO",
        kind: "registered",
        number: "NO-123 456",
        authority: "Miljødirektoratet",
        exemption: null,
        showNumber: true,
        validFrom: "2026-01-01",
        validTo: null,
      },
    });
  });

  it("needs a known scheme, one of the store's countries, a number, an authority and real days in order", () => {
    const result = checkRegistration({ scheme: "glass", market: "FR", kind: "registered", number: " ", authority: "", validFrom: "2026-02-30", validTo: "soon" }, markets);
    expect(result).toEqual({ ok: false, problems: ["scheme", "market", "number", "authority", "from", "to"] });
    expect(checkRegistration({ ...typed, validTo: "2025-12-31" }, markets)).toEqual({ ok: false, problems: ["range"] });
    expect(checkRegistration({ ...typed, number: "x".repeat(101) }, markets)).toEqual({ ok: false, problems: ["number"] });
    // The last day may be the first: a registration of one day.
    expect(checkRegistration({ ...typed, validTo: "2026-01-01" }, markets).ok).toBe(true);
  });

  it("as an exemption needs its reason, and keeps neither number nor authority, never shown", () => {
    expect(checkRegistration({ ...typed, kind: "exempt", exemption: "" }, markets)).toEqual({ ok: false, problems: ["exemption"] });
    const done = checkRegistration({ ...typed, kind: "exempt", exemption: "No scheme for this here." }, markets);
    expect(done).toMatchObject({ ok: true, value: { kind: "exempt", number: null, authority: null, exemption: "No scheme for this here.", showNumber: false } });
  });
});

describe("the days a registration covers", () => {
  const reg = { validFrom: "2026-03-01", validTo: "2026-06-30" };

  it("covers its first and its last day, and nothing outside them", () => {
    expect(registrationState(reg, "2026-02-28")).toBe("upcoming");
    expect(covers(reg, "2026-03-01")).toBe(true);
    expect(covers(reg, "2026-06-30")).toBe(true);
    expect(covers(reg, "2026-07-01")).toBe(false);
    expect(registrationState(reg, "2026-07-01")).toBe("ended");
    expect(covers({ validFrom: "2026-03-01", validTo: null }, "2099-01-01")).toBe(true);
  });

  it("stops sales from the day after its last day", () => {
    expect(firstBlockedDay(reg)).toBe("2026-07-01");
    expect(firstBlockedDay({ validTo: "2026-12-31" })).toBe("2027-01-01");
    expect(firstBlockedDay({ validTo: null })).toBeNull();
    expect(nextDay("2028-02-28")).toBe("2028-02-29");
    expect(isDay("2027-02-29")).toBe(false);
  });

  it("warns of one ending within thirty days only when nothing follows it", () => {
    const base: Registration = { id: "a", scheme: "packaging", market: "NO", kind: "registered", number: "1", authority: "A", exemption: null, showNumber: false, validFrom: "2026-01-01", validTo: "2026-11-15" };
    expect(endingSoon([base], "2026-10-27").map((r) => r.id)).toEqual(["a"]);
    expect(endingSoon([base], "2026-09-01")).toEqual([]);
    const next = { ...base, id: "b", validFrom: "2026-11-16", validTo: null };
    expect(endingSoon([base, next], "2026-10-27")).toEqual([]);
    // Another country's renewal does not count.
    expect(endingSoon([base, { ...next, market: "SE" }], "2026-10-27").map((r) => r.id)).toEqual(["a"]);
  });
});

describe("what is missing", () => {
  it("is grouped by scheme in the registry's order and by country, each product once, by title", () => {
    const groups = groupMissing([
      { productId: "2", handle: "b", title: "Lamp", market: "SE", scheme: "electrical_equipment" },
      { productId: "1", handle: "a", title: "Mug", market: "NO", scheme: "packaging" },
      { productId: "2", handle: "b", title: "Lamp", market: "NO", scheme: "packaging" },
      { productId: "2", handle: "b", title: "Lamp", market: "NO", scheme: "packaging" },
    ]);
    expect(groups.map((g) => [g.scheme, g.market, g.products.map((p) => p.title)])).toEqual([
      ["packaging", "NO", ["Lamp", "Mug"]],
      ["electrical_equipment", "SE", ["Lamp"]],
    ]);
  });
});

describe("the schemes", () => {
  it("are the product editor's, in its order", () => {
    expect(SCHEME_IDS).toEqual(PRODUCER_SCHEMES.map((s) => s.id));
  });

  it("start with the number shown only where a country is known to ask for it", () => {
    expect(numberShownByDefault("electrical_equipment", "DE")).toBe(true);
    expect(numberShownByDefault("packaging", "de")).toBe(false);
    expect(numberShownByDefault("textiles", "FR")).toBe(true);
    expect(numberShownByDefault("packaging", "NO")).toBe(false);
  });
});
