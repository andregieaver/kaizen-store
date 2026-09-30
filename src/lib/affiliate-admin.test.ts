import { describe, expect, it } from "vitest";

import {
  AFFILIATE_EXPLANATION,
  AFFILIATE_FIELD_ORDER,
  AFFILIATE_NEEDS_BONUS,
  AFFILIATE_ON_NOTES,
  attributionStatus,
  example,
  formFromSettings,
  orderedProblems,
  overviewRows,
  personLabel,
  readAffiliateForm,
  rulesSummary,
  type AffiliateFormValues,
} from "./affiliate-admin";
import { AFFILIATE_DEFAULTS, type AffiliateOverview, type AffiliateSettings } from "./affiliates";
import { moneyIn } from "./bonus-admin";

const settings = (over: Partial<AffiliateSettings> = {}): AffiliateSettings => ({ ...AFFILIATE_DEFAULTS, ...over });
/** As a person reads it: the no-break spaces in an amount made plain. */
const plain = (text: string) => text.replace(/\u00a0/g, " ");
const money = (minor: number) => plain(moneyIn("NOK", "en-GB")(minor));

describe("the settings form", () => {
  it("shows the settings as the owner types them", () => {
    expect(formFromSettings(settings(), "NOK")).toEqual({
      enabled: false,
      rewardPercent: "5",
      rewardScope: "limited",
      rewardOrders: "1",
      friendPercent: "10",
      friendMax: "",
      monthlyCap: "",
      cookieDays: "30",
    });
    expect(formFromSettings(settings({ enabled: true, rewardBps: 275, rewardOrders: null, friendMaxMinor: 10_050, monthlyCapMinor: 500_000, cookieDays: 60 }), "NOK")).toEqual({
      enabled: true,
      rewardPercent: "2.75",
      rewardScope: "every",
      rewardOrders: "1",
      friendPercent: "10",
      friendMax: "100,50",
      monthlyCap: "5000,00",
      cookieDays: "60",
    });
  });

  it("reads back to the same settings", () => {
    for (const s of [settings(), settings({ enabled: true, rewardBps: 275, rewardOrders: null, friendMaxMinor: 10_050, monthlyCapMinor: 500_000, cookieDays: 60 }), settings({ friendPercent: 0, rewardBps: 0 })]) {
      expect(readAffiliateForm(formFromSettings(s, "NOK"), "NOK")).toEqual({ ok: true, settings: s });
    }
  });

  it("reads what is typed in the ways people type it, through the server's own schema", () => {
    const values: AffiliateFormValues = {
      enabled: true,
      rewardPercent: "2,5 %",
      rewardScope: "limited",
      rewardOrders: " 3 ",
      friendPercent: "15",
      friendMax: "1 249,50",
      monthlyCap: "5000",
      cookieDays: "45",
    };
    expect(readAffiliateForm(values, "NOK")).toEqual({
      ok: true,
      settings: { enabled: true, rewardBps: 250, rewardOrders: 3, friendPercent: 15, friendMaxMinor: 124_950, monthlyCapMinor: 500_000, cookieDays: 45 },
    });
    // Every order earns when the box is unticked, whatever the number says.
    expect(readAffiliateForm({ ...values, rewardScope: "every", rewardOrders: "nonsense" }, "NOK")).toMatchObject({ ok: true, settings: { rewardOrders: null } });
  });

  it("says what is wrong beside each field, in the contract's words where it has them", () => {
    const base = formFromSettings(settings(), "NOK");
    const errors = (over: Partial<AffiliateFormValues>) => {
      const read = readAffiliateForm({ ...base, ...over }, "NOK");
      return read.ok ? {} : read.errors;
    };
    expect(errors({ friendPercent: "ten" }).friendPercent).toContain("whole percentage");
    expect(errors({ friendPercent: "51" }).friendPercent).toBe("Keep the friend's discount at 50% or less.");
    expect(errors({ rewardPercent: "x" }).rewardPercent).toContain("percentage such as 5");
    expect(errors({ rewardPercent: "51" }).rewardPercent).toBe("Keep the reward at 50% or less.");
    expect(errors({ friendMax: "abc" }).friendMax).toContain("NOK");
    expect(errors({ monthlyCap: "abc" }).monthlyCap).toContain("NOK");
    expect(errors({ rewardOrders: "0" }).rewardOrders).toBe("Write a number of orders from 1 to 100.");
    expect(errors({ cookieDays: "91" }).cookieDays).toBe("Write a number of days from 1 to 90.");
    expect(errors({ cookieDays: "" }).cookieDays).toContain("days");
    // Several at once, in the form's order.
    const read = readAffiliateForm({ ...base, cookieDays: "x", friendPercent: "x", rewardPercent: "x" }, "NOK");
    expect(read.ok).toBe(false);
    if (!read.ok) expect(orderedProblems(read.errors).map((p) => p.field)).toEqual(["friendPercent", "rewardPercent", "cookieDays"]);
    expect(AFFILIATE_FIELD_ORDER).toEqual(["friendPercent", "friendMax", "rewardPercent", "rewardOrders", "monthlyCap", "cookieDays"]);
  });
});

describe("the words the owner reads", () => {
  it("say the rules back, in the order a shopper meets them", () => {
    expect(rulesSummary(settings(), money, 14)).toEqual([
      "A friend gets 10% off the goods in their first order.",
      "The customer who shared the link earns 5% of what the friend pays online for goods, as bonus credits, for the friend's first order. The credits can be used 14 days after the friend pays.",
      "A visitor's link is remembered for 30 days, if they allow marketing cookies.",
    ]);
    expect(rulesSummary(settings({ friendMaxMinor: 10_000, rewardOrders: 3, monthlyCapMinor: 50_000, cookieDays: 1 }), money, 0)).toEqual([
      "A friend gets 10% off the goods in their first order, at most NOK 100.00.",
      "The customer who shared the link earns 5% of what the friend pays online for goods, as bonus credits, for the friend's first 3 orders. The credits can be used right after the friend pays.",
      "One customer can earn at most NOK 500.00 a month.",
      "A visitor's link is remembered for 1 day, if they allow marketing cookies.",
    ]);
    expect(rulesSummary(settings({ friendPercent: 0, rewardBps: 0, rewardOrders: null }), money, 14).slice(0, 2)).toEqual([
      "A friend gets no welcome discount.",
      "The customer who shared the link earns nothing: the reward is 0%.",
    ]);
    expect(rulesSummary(settings({ rewardOrders: null }), money, 14)[1]).toContain("for every order");
  });

  it("work an example in the credits' currency", () => {
    expect(plain(example(settings(), "NOK", "en-GB"))).toBe("A first order of NOK 1,000.00 in goods: the friend saves NOK 100.00 and pays NOK 900.00; the customer who shared the link earns NOK 45.00 in credits.");
    expect(plain(example(settings({ friendMaxMinor: 5_000 }), "NOK", "en-GB"))).toContain("the friend saves NOK 50.00 and pays NOK 950.00");
  });

  it("explain what the program is, what it needs and what switching it on does", () => {
    expect(AFFILIATE_EXPLANATION).toContain("welcome discount");
    expect(AFFILIATE_NEEDS_BONUS).toContain("bonus program");
    expect(AFFILIATE_ON_NOTES.join(" ")).toContain("marketing cookies");
    expect(AFFILIATE_ON_NOTES.join(" ")).toContain("refer themselves");
  });

  it("list the overview as rows, and word an attribution's status with the reason a guard stopped it", () => {
    const overview: AffiliateOverview = { currency: "NOK", affiliates: 3, visits30d: 40, orders30d: 5, rewarded30dMinor: 12_500, outstandingMinor: 10_000, pendingMinor: 2_500, rejected30d: 1 };
    const rows = overviewRows(overview, money);
    expect(rows.find((r) => r.label === "Customers with a link")?.value).toBe("3");
    expect(rows.find((r) => r.label.startsWith("Credits earned"))?.value).toBe("NOK 125.00");
    expect(rows.find((r) => r.label === "Referral credits usable now")?.value).toBe("NOK 100.00");
    expect(rows.find((r) => r.label === "Orders that earned nothing, last 30 days")?.value).toBe("1");
    expect(attributionStatus({ status: "rewarded", reason: null })).toBe("Rewarded");
    expect(attributionStatus({ status: "rejected", reason: "self" })).toBe("No reward: The friend is the referrer");
    expect(attributionStatus({ status: "rejected", reason: "cap" })).toBe("No reward: The referrer's monthly limit was reached");
    expect(attributionStatus({ status: "unpaid", reason: null })).toBe("Not paid");
    expect(personLabel("Kari Nordmann", "kari@example.com")).toBe("Kari Nordmann (kari@example.com)");
    expect(personLabel(" ", "kari@example.com")).toBe("kari@example.com");
  });
});
