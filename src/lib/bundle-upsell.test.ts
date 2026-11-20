import { describe, expect, it } from "vitest";

import { bundleUpsell, signUpCurrency, type UpsellInput } from "./bundle-upsell";

/** The first price sheet in NOK a month: Customers holds the support desk, email automation and deals; Everything holds all five. */
const customers = { id: "customers", name: "Customers", members: ["support_desk", "email_automation", "deals"] as const, priceMinor: 85000 };
const everything = { id: "everything", name: "Everything", members: ["ab_testing", "support_desk", "email_automation", "work", "deals"] as const, priceMinor: 119000 };
const base: UpsellInput = {
  ticked: [],
  chosen: [],
  prices: { ab_testing: 29000, support_desk: 39000, email_automation: 25000, work: 35000, deals: 35000 },
  bundles: [customers, everything],
  needsStore: ["ab_testing", "email_automation"],
  withStore: false,
  nearPercent: 20,
  declined: [],
};

describe("the sign-up's bundle upsell (D859)", () => {
  it("costs the choice: extensions on their own, and a chosen bundle instead of its parts", () => {
    expect(bundleUpsell({ ...base, ticked: ["support_desk", "deals"] })).toMatchObject({ totalMinor: 74000, covered: ["support_desk", "deals"] });
    const bundled = bundleUpsell({ ...base, chosen: ["customers"], ticked: ["support_desk", "work"] });
    expect(bundled.totalMinor).toBe(85000 + 35000);
    expect(bundled.covered.sort()).toEqual(["deals", "email_automation", "support_desk", "work"]);
  });

  it("chooses a bundle that holds everything chosen for no more, and offers it once it was taken off", () => {
    // Customers chosen and Work ticked: 1,200 against Everything's 1,190.
    const up = bundleUpsell({ ...base, chosen: ["customers"], ticked: ["work"] });
    expect(up.switchTo).toEqual({ bundle: everything, fromMinor: 120000 });
    // With a store, all three of Customers' parts ticked one by one: 990 against 850.
    expect(bundleUpsell({ ...base, withStore: true, ticked: ["support_desk", "email_automation", "deals"] }).switchTo?.bundle.id).toBe("customers");
    const declined = bundleUpsell({ ...base, chosen: ["customers"], ticked: ["work"], declined: ["everything"] });
    expect(declined).toMatchObject({ switchTo: null, offer: { bundle: { id: "everything" }, fromMinor: 120000 } });
  });

  it("proposes a bundle for a little more only for what can be used now, naming what needs a store", () => {
    // Without a store: support desk and deals (740) against Customers (850, +15 %), whose only extra needs a store: nothing proposed.
    expect(bundleUpsell({ ...base, ticked: ["support_desk", "deals"] }).propose).toBeNull();
    // With a store the extra can be used: proposed for 110 more.
    expect(bundleUpsell({ ...base, withStore: true, ticked: ["support_desk", "deals"] }).propose).toEqual({
      bundle: customers,
      extraMinor: 11000,
      adds: ["email_automation"],
      addsLater: [],
    });
    // Within 20 % only: Work and deals (700) against Everything (1,190) is 70 % more.
    expect(bundleUpsell({ ...base, withStore: true, ticked: ["work", "deals"] }).propose).toBeNull();
    // Nor one they took off.
    expect(bundleUpsell({ ...base, withStore: true, ticked: ["support_desk", "deals"], declined: ["customers"] }).propose).toBeNull();
    // Nothing proposed when the platform set 0 %.
    expect(bundleUpsell({ ...base, withStore: true, ticked: ["support_desk", "deals"], nearPercent: 0 }).propose).toBeNull();
  });

  it("proposes nothing without a choice or with a part it cannot cost", () => {
    expect(bundleUpsell(base)).toMatchObject({ totalMinor: 0, switchTo: null, propose: null });
    expect(bundleUpsell({ ...base, prices: { support_desk: 39000 }, ticked: ["support_desk", "deals"] })).toMatchObject({ totalMinor: null, switchTo: null, propose: null });
  });

  it("shows prices in the country's currency when the price list has it, else euros", () => {
    expect(signUpCurrency("NOK", ["EUR", "NOK"])).toBe("NOK");
    expect(signUpCurrency("SEK", ["EUR", "NOK"])).toBe("EUR");
    expect(signUpCurrency(null, ["NOK"])).toBe("NOK");
    expect(signUpCurrency("SEK", [])).toBeNull();
  });
});
