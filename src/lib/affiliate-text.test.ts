import { describe, expect, it } from "vitest";

import { affiliateRewardText, emailText, orderReferralRows } from "./email-text";
import { t } from "./i18n";

/** The words of the referral program (D131): the storefront's and the emails', in the four hand-written languages. */

const LANGS = ["nb", "sv", "da", "en"] as const;
const money = (minor: number) => `${(minor / 100).toFixed(2)} kr`;

describe("the storefront's referral texts", () => {
  it("are written by hand for every language, with the same keys, each differing from English", () => {
    const en = t("en").affiliate as Record<string, unknown>;
    for (const lang of ["nb", "sv", "da"] as const) {
      const own = t(lang).affiliate as Record<string, unknown>;
      expect(Object.keys(own).sort(), lang).toEqual(Object.keys(en).sort());
      for (const [key, value] of Object.entries(own)) {
        if (typeof value === "string") expect(value, `${lang}.${key}`).not.toBe(en[key]);
      }
    }
  });

  it("keep what is in the message in the message: amounts, percentages, waits and names are the caller's words", () => {
    for (const lang of LANGS) {
      const a = t(lang).affiliate;
      expect(a.signInForDiscount("P1"), lang).toContain("P1");
      expect(a.cartApplied("P1"), lang).toContain("P1");
      expect(a.friendGets("P1"), lang).toContain("P1");
      expect(a.friendGetsUpTo("P1", "M2"), lang).toContain("P1");
      expect(a.friendGetsUpTo("P1", "M2"), lang).toContain("M2");
      expect(a.youEarn("P1", "W2"), lang).toContain("P1");
      expect(a.youEarn("P1", "W2"), lang).toContain("W2");
      expect(a.waitAfter("D1"), lang).toContain("D1");
      expect(a.countsFirstOrders("N1"), lang).toContain("N1");
      expect(a.monthlyLimit("M1"), lang).toContain("M1");
      for (const status of ["pending", "rewarded", "reversed", "rejected"] as const) expect(a.status[status], `${lang}.${status}`).toBeTruthy();
    }
  });

  it("read the same in English as the owner's summary, for the parts they share", () => {
    expect(t("en").affiliate.friendGets("10")).toBe("Your friend gets 10% off the goods in their first order.");
    expect(t("en").affiliate.discountRow).toBe("Welcome discount");
    expect(t("nb").affiliate.discountRow).toBe("Velkomstrabatt");
    expect(t("sv").affiliate.discountRow).toBe("Välkomstrabatt");
    expect(t("da").affiliate.discountRow).toBe("Velkomstrabat");
    expect(t("en").bonus.kinds.referral).toBe("Referral reward");
    for (const lang of LANGS) expect(t(lang).bonus.kinds.referral, lang).toBeTruthy();
  });
});

describe("the emails", () => {
  it("show the welcome discount among an order's totals, only when there was one", () => {
    expect(orderReferralRows(emailText("en"), 4_980, money)).toEqual([{ label: "Welcome discount", value: "−49.80 kr", muted: true }]);
    expect(orderReferralRows(emailText("nb"), 4_980, money)[0].label).toBe("Velkomstrabatt");
    expect(orderReferralRows(emailText("en"), 0, money)).toEqual([]);
  });

  it("tell a referrer what they earned and from when, in each language, never who the friend is", () => {
    for (const lang of LANGS) {
      const words = affiliateRewardText(emailText(lang), { store: "Kaffe", customerName: "Kari Nordmann", amount: "A1", usableFrom: "D2", url: "https://kaffe.example/s/kaffe/no/account/referrals" });
      expect(words.subject, lang).toContain("Kaffe");
      expect(words.paragraphs.join(" "), lang).toContain("A1");
      expect(words.paragraphs.join(" "), lang).toContain("D2");
      expect(words.paragraphs[0], lang).toContain("Kari");
      expect(words.button.url).toBe("https://kaffe.example/s/kaffe/no/account/referrals");
    }
    // Usable now, and no name.
    const now = affiliateRewardText(emailText("en"), { store: "Kaffe", customerName: "", amount: "A1", usableFrom: null, url: "u" });
    expect(now.paragraphs[0]).toBe("Hi!");
    expect(now.paragraphs[1]).toBe("You earned A1 in bonus credits, ready to use.");
    expect(now.preview).toBe(now.paragraphs[1]);
  });
});
