import { describe, expect, it } from "vitest";

import { agreedAll, checkoutConsents } from "./checkout-consents";
import { directBuyWords } from "./direct-buy-words";
import { t } from "./i18n";
import { planAgreements, type StorePlan } from "./store-plans";

/**
 * What a checkout asks the shopper to agree to (D915): the cart's ticks and the button that skips the cart say it in the same words, so the
 * server can tell that the button said everything the basket asks.
 */

const m = t("en");
const money = (minor: number) => `NOK ${minor / 100}`;
const LEAD = directBuyWords("en").lead;
const monthly = { interval: "month" as const, intervalCount: 1, trialDays: 0, minCycles: 0 };

describe("what a checkout asks to be agreed to", () => {
  it("asks a download's withdrawal, a booked service's request and a subscription's renewals", () => {
    const asked = checkoutConsents(m, { digital: true, service: true, plan: { ...monthly, trialDays: 7, minCycles: 3 }, renewal: 9900 }, money);
    expect(asked.digital).toBe(m.digitalConsent);
    expect(asked.service).toBe(m.serviceRequest);
    expect(asked.subscription).toBe(
      `${m.subscriptionConsent(m.planEvery("month", 1), "NOK 99")} ${m.trialNote(7)} ${m.commitmentNote(3)}`,
    );
  });

  it("asks nothing of a subscription that renews at nothing (D913), nor of goods bought once", () => {
    expect(checkoutConsents(m, { digital: false, service: false, plan: monthly, renewal: 0 }, money)).toEqual({});
    expect(Object.values(checkoutConsents(m, { digital: false, service: false, plan: null, renewal: null }, money)).filter(Boolean)).toEqual([]);
  });

  it("is agreed to only when the button said every sentence the basket asks", () => {
    const asked = checkoutConsents(m, { digital: true, service: false, plan: monthly, renewal: 9900 }, money);
    expect(agreedAll(asked, [asked.digital!, asked.subscription!])).toBe(true);
    // A download added earlier, which this button did not say.
    expect(agreedAll(asked, [asked.subscription!])).toBe(false);
    // Another renewal price than the one the button said.
    const other = checkoutConsents(m, { digital: false, service: false, plan: monthly, renewal: 12900 }, money);
    expect(agreedAll(asked, [asked.digital!, other.subscription!])).toBe(false);
    expect(agreedAll({}, [])).toBe(true);
  });
});

describe("what a plan's button agrees to on a pricing table", () => {
  const plan = (skipsCart: boolean, renewalMinor: number): StorePlan => ({
    id: `plan-${renewalMinor}`,
    handle: "pro",
    name: "Pro",
    line: "",
    included: [],
    skipsCart,
    prices: [
      { currency: "NOK", interval: "month", amountMinor: renewalMinor, renewalMinor, variantId: "v", sellingPlanId: `sp-${renewalMinor}`, trialDays: 14, minCycles: 0 },
    ],
  });

  it("says each price's renewals in the cart's words, for the plans that skip the cart", () => {
    const agreed = planAgreements([plan(true, 9900), plan(false, 19900)], m, money, LEAD);
    expect(agreed?.lead).toBe(LEAD);
    expect(agreed?.byChoice).toEqual({
      "v:sp-9900": checkoutConsents(m, { digital: false, service: false, plan: { ...monthly, trialDays: 14 }, renewal: 9900 }, money).subscription,
    });
  });

  it("has the words of Buy now in each hand-written language, else English", () => {
    expect(directBuyWords("nb").buyNow).toBe("Kjøp nå");
    expect(directBuyWords("fi")).toEqual(directBuyWords("en"));
  });

  it("says nothing for a free plan, nor when no plan skips the cart", () => {
    expect(planAgreements([plan(true, 0)], m, money, LEAD)).toBeUndefined();
    expect(planAgreements([plan(false, 9900)], m, money, LEAD)).toBeUndefined();
  });
});
