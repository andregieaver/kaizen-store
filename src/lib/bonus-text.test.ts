import { describe, expect, it } from "vitest";

import { bonusExpiryText, emailText, orderBonusEarned, orderBonusRows } from "./email-text";
import { t } from "./i18n";

/** The words of the bonus program (D130): the emails and the storefront, in the four hand-written languages. */

const LANGS = ["nb", "sv", "da", "en"] as const;
const money = (minor: number) => `${(minor / 100).toFixed(2)} kr`;
const date = (iso: string) => iso.slice(0, 10);
const now = new Date("2026-09-30T12:00:00Z");

/** Every text of a language that is not English, to tell a forgotten copy of the English from a translation. */
const SAME_IN_EVERY_LANGUAGE = new Set(["apply"]);

describe("the storefront's bonus texts", () => {
  it("are written by hand for every language, each differing from English", () => {
    const en = t("en").bonus as Record<string, unknown>;
    for (const lang of ["nb", "sv", "da"] as const) {
      const own = t(lang).bonus as Record<string, unknown>;
      expect(Object.keys(own).sort(), lang).toEqual(Object.keys(en).sort());
      for (const [key, value] of Object.entries(own)) {
        if (typeof value === "string" && !SAME_IN_EVERY_LANGUAGE.has(key))
          expect(value, `${lang}.${key}`).not.toBe(en[key]);
      }
    }
  });

  it("call the thing bonus credits, and never a price", () => {
    expect(t("en").bonus.title).toBe("Bonus credits");
    for (const lang of LANGS) {
      const b = t(lang).bonus;
      expect(b.title.toLowerCase(), lang).toContain("bonus");
      expect(b.discountRow.toLowerCase(), lang).toContain("bonus");
      expect(b.usedRow.toLowerCase(), lang).toContain("bonus");
    }
  });

  it("count days and months in the singular and the plural", () => {
    expect(t("en").bonus.dayCount(1)).toBe("1 day");
    expect(t("en").bonus.dayCount(14)).toBe("14 days");
    expect(t("en").bonus.monthCount(1)).toBe("1 month");
    expect(t("nb").bonus.dayCount(1)).toBe("1 dag");
    expect(t("nb").bonus.dayCount(14)).toBe("14 dager");
    expect(t("nb").bonus.monthCount(12)).toBe("12 måneder");
    expect(t("sv").bonus.dayCount(1)).toBe("1 dag");
    expect(t("sv").bonus.monthCount(1)).toBe("1 månad");
    expect(t("da").bonus.dayCount(14)).toBe("14 dage");
    expect(t("da").bonus.monthCount(1)).toBe("1 måned");
  });

  it("keep what is in the message in the message: amounts, dates and waits are the caller's words", () => {
    for (const lang of LANGS) {
      const b = t(lang).bonus;
      expect(b.haveAvailable("A1", "M2"), lang).toContain("A1");
      expect(b.haveAvailable("A1", "M2"), lang).toContain("M2");
      expect(b.willEarn("E1", "W2"), lang).toContain("E1");
      expect(b.willEarn("E1", "W2"), lang).toContain("W2");
      expect(b.earnedLine("E1", "D2"), lang).toContain("D2");
      expect(b.signInToEarn("5"), lang).toContain("5");
      expect(b.howEarn("5", "W2"), lang).toContain("W2");
      expect(b.pendingFrom("P1", "D2"), lang).toContain("D2");
      expect(b.howUseExpires("M1"), lang).toContain("M1");
    }
  });
});

describe("the bonus lines of an order confirmation", () => {
  it("has a row for the credits used, in each language, and none when none were used", () => {
    const words = {
      nb: "Bonuskreditt brukt",
      sv: "Bonuskredit använd",
      da: "Bonuskredit brugt",
      en: "Bonus credits used",
    };
    for (const lang of LANGS) {
      const text = emailText(lang);
      expect(orderBonusRows(text, { usedMinor: 1500, earnedMinor: 0, availableAt: null }, money)).toEqual([
        { label: words[lang], value: "−15.00 kr", muted: true },
      ]);
      expect(orderBonusRows(text, { usedMinor: 0, earnedMinor: 250, availableAt: null }, money)).toEqual([]);
      expect(orderBonusRows(text, null, money)).toEqual([]);
    }
  });

  it("says what the order earned and from when, or that it is ready, in each language", () => {
    const pending = { usedMinor: 0, earnedMinor: 250, availableAt: "2026-10-14T00:00:00Z" };
    expect(orderBonusEarned(emailText("en"), pending, money, date, now)).toBe(
      "You earned 2.50 kr in bonus credits, usable from 2026-10-14.",
    );
    expect(orderBonusEarned(emailText("nb"), pending, money, date, now)).toBe(
      "Du tjente 2.50 kr i bonuskreditt, som kan brukes fra 2026-10-14.",
    );
    expect(orderBonusEarned(emailText("sv"), pending, money, date, now)).toBe(
      "Du tjänade 2.50 kr i bonuskredit, som kan användas från 2026-10-14.",
    );
    expect(orderBonusEarned(emailText("da"), pending, money, date, now)).toBe(
      "Du optjente 2.50 kr i bonuskredit, som kan bruges fra 2026-10-14.",
    );
    const ready = { usedMinor: 0, earnedMinor: 250, availableAt: null };
    expect(orderBonusEarned(emailText("en"), ready, money, date, now)).toBe(
      "You earned 2.50 kr in bonus credits, ready to use.",
    );
    expect(orderBonusEarned(emailText("nb"), ready, money, date, now)).toContain("kan bruke nå");
  });

  it("says nothing for an order that earned no credits", () => {
    for (const lang of LANGS) {
      expect(
        orderBonusEarned(emailText(lang), { usedMinor: 500, earnedMinor: 0, availableAt: null }, money, date, now),
      ).toBeNull();
      expect(orderBonusEarned(emailText(lang), null, money, date, now)).toBeNull();
    }
  });

  it("falls back to English for a language with no text of its own", () => {
    expect(emailText("xx").bonus.usedRow).toBe("Bonus credits used");
  });
});

describe("the reminder before bonus credits expire", () => {
  const data = {
    store: "Demo Store",
    customerName: "Kari Nordmann",
    amount: "10.00 kr",
    expiresOn: "1 March 2027",
    url: "https://demo.example/s/demo/no/account/bonus",
  };

  it("names the amount, the day and the store, greets the customer and links to My account's bonus credits", () => {
    const mail = bonusExpiryText(emailText("en"), data);
    expect(mail.subject).toBe("Your bonus credits at Demo Store expire on 1 March 2027");
    expect(mail.heading).toBe("Your bonus credits are about to expire");
    expect(mail.paragraphs[0]).toBe("Hello, Kari!");
    expect(mail.paragraphs[1]).toBe("10.00 kr of your bonus credits expires on 1 March 2027.");
    expect(mail.paragraphs).toHaveLength(3);
    expect(mail.preview).toBe(mail.paragraphs[1]);
    expect(mail.button).toEqual({ text: "See my bonus credits", url: data.url });
  });

  it("is written by hand in Norwegian, Swedish and Danish", () => {
    const nb = bonusExpiryText(emailText("nb"), data);
    expect(nb.subject).toBe("Bonuskreditten din hos Demo Store utløper 1 March 2027");
    expect(nb.paragraphs[0]).toBe("Hei, Kari!");
    expect(nb.paragraphs[1]).toContain("utløper");
    expect(nb.button.text).toBe("Se bonuskreditten min");
    const sv = bonusExpiryText(emailText("sv"), data);
    expect(sv.subject).toContain("går ut");
    expect(sv.paragraphs[0]).toBe("Hej, Kari!");
    const da = bonusExpiryText(emailText("da"), data);
    expect(da.subject).toContain("udløber");
    expect(da.paragraphs[0]).toBe("Hej, Kari!");
  });

  it("greets without a name when there is none", () => {
    expect(bonusExpiryText(emailText("en"), { ...data, customerName: "  " }).paragraphs[0]).toBe("Hello!");
    expect(bonusExpiryText(emailText("nb"), { ...data, customerName: "" }).paragraphs[0]).toBe("Hei!");
  });
});
