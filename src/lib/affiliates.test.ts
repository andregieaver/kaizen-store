import { describe, expect, it } from "vitest";

import {
  AFFILIATE_CODE,
  AFFILIATE_DEFAULTS,
  AFFILIATE_REJECTION_LABELS,
  AFFILIATE_STATUS_LABELS,
  affiliateCookie,
  affiliateSettingsInput,
  codeFromSearch,
  friendDiscount,
  friendLabel,
  makeAffiliateCode,
  mayKeepAffiliate,
  normalizeAffiliateCode,
  planWelcome,
  readAffiliateCookie,
  referrerReward,
  shouldCarry,
  statusOf,
  withAffiliate,
  writeAffiliateCookie,
} from "./affiliates";
import { consentCookieName, encodeConsent } from "./cookie-consent";

const STORE = "0f8fad5b-d9cb-469f-a165-70867728950e";
const consent = (marketing: boolean) =>
  `${consentCookieName(STORE)}=${encodeConsent({ visitor: "11111111-1111-4111-8111-111111111111", version: "marketing", choices: { preferences: false, statistics: false, marketing } })}`;

describe("the welcome discount", () => {
  it("is a percentage of the goods, rounded down, at most the owner's cap", () => {
    expect(friendDiscount(10_000, { friendPercent: 10, friendMaxMinor: null })).toBe(1_000);
    expect(friendDiscount(9_999, { friendPercent: 10, friendMaxMinor: null })).toBe(999);
    expect(friendDiscount(10_000, { friendPercent: 10, friendMaxMinor: 500 })).toBe(500);
    expect(friendDiscount(10_000, { friendPercent: 10, friendMaxMinor: 0 })).toBe(0);
    expect(friendDiscount(10_000, { friendPercent: 0, friendMaxMinor: null })).toBe(0);
    expect(friendDiscount(0, { friendPercent: 10, friendMaxMinor: null })).toBe(0);
    expect(friendDiscount(-5, { friendPercent: 10, friendMaxMinor: null })).toBe(0);
  });

  it("is spread over the lines so the parts add up to the whole, and no line gives more than it holds", () => {
    const plan = planWelcome([24_900, 10_000, 0, 5_001], { friendPercent: 10 }, null);
    expect(plan.totalMinor).toBe(Math.floor(39_901 / 10));
    expect(plan.lines.reduce((sum, part) => sum + part, 0)).toBe(plan.totalMinor);
    expect(plan.lines[2]).toBe(0);
    plan.lines.forEach((part, i) => expect(part).toBeLessThanOrEqual([24_900, 10_000, 0, 5_001][i]));
    // A cap brings the whole down, and the lines with it.
    const capped = planWelcome([24_900, 10_000], { friendPercent: 10 }, 1_000);
    expect(capped.totalMinor).toBe(1_000);
    expect(capped.lines.reduce((sum, part) => sum + part, 0)).toBe(1_000);
    // Nothing to take it off.
    expect(planWelcome([0, 0], { friendPercent: 10 }, null)).toEqual({ totalMinor: 0, lines: [0, 0] });
    expect(planWelcome([], { friendPercent: 10 }, null)).toEqual({ totalMinor: 0, lines: [] });
    expect(planWelcome([1_000], { friendPercent: 0 }, null)).toEqual({ totalMinor: 0, lines: [0] });
  });
});

describe("the referrer's reward", () => {
  it("is the basis points of what was paid, rounded down, never negative", () => {
    expect(referrerReward(10_000, 500)).toBe(500);
    expect(referrerReward(999, 500)).toBe(49);
    expect(referrerReward(700, 500)).toBe(35);
    expect(referrerReward(0, 500)).toBe(0);
    expect(referrerReward(-1, 500)).toBe(0);
    expect(referrerReward(10_000, 0)).toBe(0);
    expect(referrerReward(9_007_199_254_740_000, 500)).toBe(450_359_962_737_000);
  });
});

describe("the settings", () => {
  it("default to off, with the owner's decided numbers", () => {
    expect(AFFILIATE_DEFAULTS).toEqual({ enabled: false, rewardBps: 500, rewardOrders: 1, friendPercent: 10, friendMaxMinor: null, monthlyCapMinor: null, cookieDays: 30 });
    expect(affiliateSettingsInput.safeParse(AFFILIATE_DEFAULTS).success).toBe(true);
  });

  it("are checked against the limits the database keeps", () => {
    const bad = (over: Record<string, unknown>) => affiliateSettingsInput.safeParse({ ...AFFILIATE_DEFAULTS, ...over }).success;
    expect(bad({ rewardBps: 5_000 })).toBe(true);
    expect(bad({ rewardBps: 5_001 })).toBe(false);
    expect(bad({ rewardBps: -1 })).toBe(false);
    expect(bad({ rewardOrders: null })).toBe(true);
    expect(bad({ rewardOrders: 0 })).toBe(false);
    expect(bad({ rewardOrders: 101 })).toBe(false);
    expect(bad({ friendPercent: 50 })).toBe(true);
    expect(bad({ friendPercent: 51 })).toBe(false);
    expect(bad({ friendPercent: 2.5 })).toBe(false);
    expect(bad({ friendMaxMinor: 0 })).toBe(true);
    expect(bad({ friendMaxMinor: 100_000_001 })).toBe(false);
    expect(bad({ monthlyCapMinor: 1_000_000_000 })).toBe(true);
    expect(bad({ monthlyCapMinor: 1_000_000_001 })).toBe(false);
    expect(bad({ cookieDays: 90 })).toBe(true);
    expect(bad({ cookieDays: 91 })).toBe(false);
    expect(bad({ cookieDays: 0 })).toBe(false);
  });
});

describe("codes", () => {
  it("are made from letters and digits that are not confused, in the format the database keeps", () => {
    for (let i = 0; i < 50; i++) {
      const code = makeAffiliateCode();
      expect(code).toMatch(AFFILIATE_CODE);
      expect(code).not.toMatch(/[01oli]/);
    }
    expect(makeAffiliateCode(() => 0, 6)).toBe("aaaaaa");
  });

  it("are read from what people type or paste, and from an address", () => {
    expect(normalizeAffiliateCode("  ABCDEF23  ")).toBe("abcdef23");
    expect(normalizeAffiliateCode("short")).toBeNull();
    expect(normalizeAffiliateCode("has space1")).toBeNull();
    expect(normalizeAffiliateCode("x".repeat(17))).toBeNull();
    expect(normalizeAffiliateCode(null)).toBeNull();
    expect(codeFromSearch("?ref=ABCDEF23")).toBe("abcdef23");
    expect(codeFromSearch("?a=1&ref=abcdef23&b=2")).toBe("abcdef23");
    expect(codeFromSearch("?ref=nope")).toBeNull();
    expect(codeFromSearch("")).toBeNull();
    expect(codeFromSearch("?ref=<script>")).toBeNull();
  });
});

describe("keeping the code in a cookie", () => {
  it("is named for the store, and written for the owner's days, at most 90", () => {
    expect(affiliateCookie(STORE)).toBe(`kaizen_aff_${STORE}`);
    expect(writeAffiliateCookie(STORE, "ABCDEF23", 30, true)).toBe(`kaizen_aff_${STORE}=abcdef23; Max-Age=2592000; Path=/; SameSite=Lax; Secure`);
    expect(writeAffiliateCookie(STORE, "abcdef23", 30, false)).toBe(`kaizen_aff_${STORE}=abcdef23; Max-Age=2592000; Path=/; SameSite=Lax`);
    expect(writeAffiliateCookie(STORE, "abcdef23", 500, false)).toContain(`Max-Age=${90 * 86_400}`);
    expect(writeAffiliateCookie(STORE, "abcdef23", 0, false)).toContain("Max-Age=86400");
    expect(writeAffiliateCookie(STORE, "bad", 30, false)).toBeNull();
    expect(readAffiliateCookie(`a=1; kaizen_aff_${STORE}=abcdef23; b=2`, STORE)).toBe("abcdef23");
    expect(readAffiliateCookie("a=1", STORE)).toBeNull();
    expect(readAffiliateCookie(`kaizen_aff_${STORE}=<x>`, STORE)).toBeNull();
  });

  it("is kept only when the visitor allowed marketing on this store", () => {
    expect(mayKeepAffiliate(consent(true), STORE)).toBe(true);
    expect(mayKeepAffiliate(consent(false), STORE)).toBe(false);
    expect(mayKeepAffiliate("", STORE)).toBe(false);
    expect(mayKeepAffiliate(`a=1; ${consent(true)}`, STORE)).toBe(true);
    // Another store's choice is not this one's.
    expect(mayKeepAffiliate(consent(true), "1f8fad5b-d9cb-469f-a165-70867728950e")).toBe(false);
    expect(mayKeepAffiliate("consent_x=garbage", STORE)).toBe(false);
  });
});

describe("carrying the code through links", () => {
  const here = { origin: "https://shop.example", pathname: "/s/demo/no" };
  const scope = "/s/demo";

  it("carries it out of the market's own pages to the store's other pages, and leaves everything else alone", () => {
    // From a market: to another market yes, within the market no, out of the store no.
    expect(shouldCarry("/s/demo/se", here, "/s/demo/no", scope)).toBe(true);
    expect(shouldCarry("/s/demo/no-en", here, "/s/demo/no", scope)).toBe(true);
    expect(shouldCarry("/s/demo", here, "/s/demo/no", scope)).toBe(true);
    expect(shouldCarry("/s/demo/no/cart", here, "/s/demo/no", scope)).toBe(false);
    expect(shouldCarry("/s/demo/no", here, "/s/demo/no", scope)).toBe(false);
    expect(shouldCarry("/s/demo/nope", here, "/s/demo/no", scope)).toBe(true);
    expect(shouldCarry("/s/other/no", here, "/s/demo/no", scope)).toBe(false);
    expect(shouldCarry("/admin", here, "/s/demo/no", scope)).toBe(false);
    expect(shouldCarry("https://elsewhere.example/s/demo/se", here, "/s/demo/no", scope)).toBe(false);
    // From the front door: every page of the store.
    expect(shouldCarry("/s/demo/no", { origin: here.origin, pathname: "/s/demo" }, null, scope)).toBe(true);
    // A link with a code of its own, an anchor on this page, or something that is not an address.
    expect(shouldCarry("/s/demo/se?ref=abcdef23", here, "/s/demo/no", scope)).toBe(false);
    expect(shouldCarry("#top", here, "/s/demo/no", scope)).toBe(false);
    expect(shouldCarry("http://[bad", here, "/s/demo/no", scope)).toBe(false);
  });

  it("on the store's own host, where every path is the store's", () => {
    const own = { origin: "https://demo.shops.example", pathname: "/no" };
    expect(shouldCarry("/se", own, "/no", "/")).toBe(true);
    expect(shouldCarry("/no/cart", own, "/no", "/")).toBe(false);
  });

  it("adds the code to the address, keeping what was there", () => {
    expect(withAffiliate("/s/demo/se", "https://shop.example", "abcdef23")).toBe("/s/demo/se?ref=abcdef23");
    expect(withAffiliate("https://shop.example/s/demo/se?x=1#y", "https://shop.example", "abcdef23")).toBe("/s/demo/se?x=1&ref=abcdef23#y");
    expect(withAffiliate("https://elsewhere.example/a", "https://shop.example", "abcdef23")).toBe("https://elsewhere.example/a?ref=abcdef23");
  });
});

describe("what a referrer is told of their friends", () => {
  it("is a first name at most, never an email, and short", () => {
    expect(friendLabel("Fiona Friendly Secret")).toBe("Fiona");
    expect(friendLabel("  kari  ")).toBe("kari");
    expect(friendLabel("")).toBeNull();
    expect(friendLabel(null)).toBeNull();
    expect(friendLabel("kari@example.com")).toBeNull();
    expect(friendLabel("Bartholomew-Maximilian-Alexander")).toBe("Bartholomew-Maximil…");
  });

  it("words where an order stands, and an unpaid order that was cancelled as not paid", () => {
    expect(statusOf("pending", false)).toBe("pending");
    expect(statusOf("pending", true)).toBe("unpaid");
    expect(statusOf("rewarded", true)).toBe("rewarded");
    for (const status of ["pending", "unpaid", "rewarded", "reversed", "rejected"] as const) expect(AFFILIATE_STATUS_LABELS[status]).toBeTruthy();
    for (const reason of ["self", "not_new", "blocked", "cap", "limit", "off", "zero"] as const) expect(AFFILIATE_REJECTION_LABELS[reason]).toBeTruthy();
  });
});
