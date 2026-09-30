import { describe, expect, it } from "vitest";

import { encodeConsent, FULL_CONSENT, NO_CONSENT } from "./cookie-consent";
import { KNOWN_COOKIES, declaredCookies } from "./cookie-consent";
import {
  bpsText,
  commissionOn,
  makeReferralCode,
  mayKeepReferral,
  normalizeReferralCode,
  readReferralCookie,
  REFERRAL_CODE,
  REFERRAL_COOKIE,
  REFERRAL_DEFAULTS,
  referralCodeFor,
  referralCookie,
  referralEnds,
  referralPath,
  referralSettingsInput,
  referralSignUpPath,
  referralUrl,
  sumPerCurrency,
  withinReferralWindow,
} from "./referrals";

const VISITOR = "0b9f3c1e-5d2a-4f43-9d87-6a1f2e3c4b5d";
const consent = (choices: typeof NO_CONSENT) => `consent_kaizen=${encodeConsent({ visitor: VISITOR, version: "marketing", choices })}`;

describe("codes", () => {
  it("are lower case letters and digits, 6 to 16, and what people type is cleaned", () => {
    expect(normalizeReferralCode("  ABCD2345 ")).toBe("abcd2345");
    for (const bad of ["abc", "abcdefghijklmnopq", "abc def", "ab-cdef", "", null, undefined]) expect(normalizeReferralCode(bad as string)).toBeNull();
  });

  it("are made from letters and digits that are not confused, and always fit the rule", () => {
    let i = 0;
    const steps = () => ((i++ * 7) % 31) / 31;
    for (let n = 0; n < 50; n++) {
      const code = makeReferralCode(steps);
      expect(code).toMatch(REFERRAL_CODE);
      expect(code).not.toMatch(/[0o1li]/);
    }
    expect(makeReferralCode(() => 0.999, 12)).toHaveLength(12);
  });

  it("make the link and where it leads", () => {
    expect(referralPath("abcd2345")).toBe("/r/abcd2345");
    expect(referralUrl("https://kaizenstore.cloud/", "abcd2345")).toBe("https://kaizenstore.cloud/r/abcd2345");
    expect(referralSignUpPath("abcd2345")).toBe("/sign-up?ref=abcd2345");
    expect(referralSignUpPath(null)).toBe("/sign-up");
  });
});

describe("commission", () => {
  it("is a share of the fee in basis points, rounded down, never negative", () => {
    expect(commissionOn(34_900, 1000)).toBe(3490);
    expect(commissionOn(999, 1000)).toBe(99);
    expect(commissionOn(5, 1000)).toBe(0);
    expect(commissionOn(0, 1000)).toBe(0);
    expect(commissionOn(-100, 1000)).toBe(0);
    expect(commissionOn(1000, 0)).toBe(0);
    expect(commissionOn(1_000_000_000_000, 5000)).toBe(500_000_000_000);
    expect(bpsText(1000)).toBe("10 %");
    expect(bpsText(250)).toBe("2.5 %");
  });

  it("counts a fee only inside the months from the referral's creation", () => {
    const made = new Date("2026-01-31T10:00:00Z");
    expect(withinReferralWindow(made, 12, new Date("2026-06-01T00:00:00Z"))).toBe(true);
    expect(withinReferralWindow(made, 12, new Date("2025-12-31T00:00:00Z"))).toBe(false);
    expect(withinReferralWindow(made, 12, new Date("2027-01-31T10:00:00Z"))).toBe(false);
    expect(withinReferralWindow(made, 12, new Date("2027-01-31T09:59:59Z"))).toBe(true);
    expect(referralEnds(new Date("2026-03-15T00:00:00Z"), 12).toISOString()).toBe("2027-03-15T00:00:00.000Z");
  });

  it("adds per currency and never across them", () => {
    expect(
      sumPerCurrency([
        { currency: "NOK", minor: 100 },
        { currency: "EUR", minor: 5 },
        { currency: "NOK", minor: 250 },
      ]),
    ).toEqual([
      { currency: "EUR", minor: 5 },
      { currency: "NOK", minor: 350 },
    ]);
  });
});

describe("settings", () => {
  it("start with the program off and the owner's terms", () => {
    expect(REFERRAL_DEFAULTS).toEqual({ enabled: false, commissionBps: 1000, months: 12, pendingDays: 30, cookieDays: 30 });
    expect(referralSettingsInput.safeParse(REFERRAL_DEFAULTS).success).toBe(true);
  });

  it("refuse what is out of range", () => {
    const bad = (over: Partial<typeof REFERRAL_DEFAULTS>) => referralSettingsInput.safeParse({ ...REFERRAL_DEFAULTS, ...over }).success;
    expect(bad({ commissionBps: 5001 })).toBe(false);
    expect(bad({ commissionBps: -1 })).toBe(false);
    expect(bad({ commissionBps: 2.5 })).toBe(false);
    expect(bad({ months: 0 })).toBe(false);
    expect(bad({ months: 61 })).toBe(false);
    expect(bad({ pendingDays: 91 })).toBe(false);
    expect(bad({ cookieDays: 0 })).toBe(false);
    expect(bad({ commissionBps: 5000, months: 60, pendingDays: 0, cookieDays: 90 })).toBe(true);
  });
});

describe("the cookie (D58)", () => {
  it("is kept only when the visitor has allowed marketing on Kaizen's site", () => {
    expect(mayKeepReferral("")).toBe(false);
    expect(mayKeepReferral(consent(NO_CONSENT))).toBe(false);
    expect(mayKeepReferral(consent({ ...NO_CONSENT, preferences: true, statistics: true }))).toBe(false);
    expect(mayKeepReferral(consent({ ...NO_CONSENT, marketing: true }))).toBe(true);
    expect(mayKeepReferral(`a=1; ${consent(FULL_CONSENT)}; b=2`)).toBe(true);
    // A store's consent is not Kaizen's.
    expect(mayKeepReferral(`consent_${VISITOR}=${encodeConsent({ visitor: VISITOR, version: "marketing", choices: FULL_CONSENT })}`)).toBe(false);
  });

  it("is written as a code for some days, and never for anything else", () => {
    expect(referralCookie("ABCD2345", 30, true)).toBe(`${REFERRAL_COOKIE}=abcd2345; Max-Age=${30 * 86400}; Path=/; SameSite=Lax; Secure`);
    expect(referralCookie("abcd2345", 30, false)).not.toContain("Secure");
    expect(referralCookie("abcd2345", 500, false)).toContain(`Max-Age=${90 * 86400}`);
    expect(referralCookie("a b; c=d", 30, true)).toBeNull();
    expect(referralCookie("abcd2345", 0, true)).toBeNull();
  });

  it("is read back as a code or nothing", () => {
    expect(readReferralCookie("x=1; kaizen_ref=abcd2345; y=2")).toBe("abcd2345");
    expect(readReferralCookie("kaizen_ref=<script>")).toBeNull();
    expect(readReferralCookie("x=1")).toBeNull();
  });

  it("gives the last click: the address, else the cookie", () => {
    expect(referralCodeFor("newcode22", "oldcode33")).toBe("newcode22");
    expect(referralCodeFor("", "oldcode33")).toBe("oldcode33");
    expect(referralCodeFor("bad code", "oldcode33")).toBe("oldcode33");
    expect(referralCodeFor(null, null)).toBeNull();
  });

  it("is listed on Kaizen's cookie page as a marketing cookie only while the program is on", () => {
    const known = KNOWN_COOKIES.find((c) => c.name === REFERRAL_COOKIE);
    expect(known).toMatchObject({ category: "marketing", on: "platform", referrals: true });
    expect(known!.pattern.test(REFERRAL_COOKIE)).toBe(true);
    const names = (opts: Parameters<typeof declaredCookies>[2], site: "platform" | "store" = "platform") => declaredCookies(site, {}, opts).map((c) => c.name);
    expect(names({})).not.toContain(REFERRAL_COOKIE);
    expect(names({ referrals: true })).toContain(REFERRAL_COOKIE);
    // Never on a store's site.
    expect(names({ referrals: true }, "store")).not.toContain(REFERRAL_COOKIE);
    for (const lang of ["en", "nb", "sv", "da"] as const) expect(known!.purpose[lang].length).toBeGreaterThan(20);
  });
});
