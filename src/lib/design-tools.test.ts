import { describe, expect, it } from "vitest";

import { chargeCosts, chargeKey, chargeTokenFor, liveSummary, makeThemeLiveInput } from "./design-tools";
import type { ThemeCharge } from "./theme-prices";

const nok: ThemeCharge = {
  kind: "now",
  price: { currency: "NOK", amountMinor: 349000 },
};
const later: ThemeCharge = {
  kind: "at_opening",
  price: { currency: "NOK", amountMinor: 349000 },
};

describe("the design tools' charge", () => {
  it("costs money only for a premium theme the store does not have", () => {
    expect(chargeCosts({ kind: "free" })).toBe(false);
    expect(chargeCosts({ kind: "owned", status: "paid" })).toBe(false);
    expect(chargeCosts(nok)).toBe(true);
    expect(chargeCosts(later)).toBe(true);
  });

  it("keeps the kind and the price, so a charge moved from at opening to now is a different yes", () => {
    expect(chargeKey(nok)).toBe("now:NOK:349000");
    expect(chargeKey(later)).toBe("at_opening:NOK:349000");
    expect(chargeKey({ kind: "owned", status: "owed" })).toBe("owned");
    expect(chargeTokenFor(nok)).toBe("NOK:349000");
    expect(chargeTokenFor(later)).toBeNull();
  });

  it("says what changes, what stays and what it costs", () => {
    expect(liveSummary("Calm · Coast", { kind: "free" }, "Custom")).toBe(
      'Make the theme "Calm · Coast" live: visitors see its colours, fonts, header, footer and product page at once; the store\'s words, pages and products stay. "Custom" stays in the theme library and can be put back.',
    );
    expect(liveSummary("Grand", nok, null)).toMatch(/excl\. VAT, once, charged now/);
  });

  it("takes an installed theme or a theme, never both or neither", () => {
    const id = "00000000-0000-4000-8000-000000000000";
    expect(makeThemeLiveInput.safeParse({ install: id }).success).toBe(true);
    expect(makeThemeLiveInput.safeParse({ theme: id, preset: "coast" }).success).toBe(true);
    expect(makeThemeLiveInput.safeParse({ install: id, theme: id }).success).toBe(false);
    expect(makeThemeLiveInput.safeParse({}).success).toBe(false);
  });
});
