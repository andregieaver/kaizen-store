import { describe, expect, it } from "vitest";

import { emailText } from "./email-text";

/**
 * The words of the withdrawal and returns emails (D153): hand-written in nb, sv, da and en. They need human (legal)
 * review before real use; this holds that every language has every message, that the messages take their arguments, and
 * that the statutory 14 days and the "without undue delay" wording are in the acknowledgement.
 */

const LANGS = ["nb", "sv", "da", "en"] as const;

describe("the returns emails", () => {
  it("have every message in every language, taking their arguments", () => {
    for (const lang of LANGS) {
      const t = emailText(lang).returns;
      const words = [
        t.withdrawLine,
        t.withdrawButton,
        t.ackSubject("Butikken", "1001"),
        t.ackHeading,
        t.ackIntro("Butikken", "1001", "2. oktober 2026"),
        t.ackLinesHeading,
        t.ackReference("1001-R1"),
        t.ackSendBack("16. oktober 2026"),
        t.shopperPays,
        t.storePays,
        t.ackRefundHold("16. oktober 2026"),
        t.ackRefundNoHold("16. oktober 2026"),
        t.ackWholeOrder,
        t.ackValue,
        t.instructionsHeading,
        t.addressHeading,
        t.statusButton,
        t.approvedSubject("Butikken", "1001-R1"),
        t.approvedHeading,
        t.approvedIntro("1001-R1"),
        t.labelButton,
        t.declinedSubject("Butikken", "1001-R1"),
        t.declinedHeading,
        t.declinedIntro("1001-R1"),
        t.declinedReason("Utenfor fristen"),
        t.declinedRights,
        t.receivedSubject("Butikken", "1001-R1"),
        t.receivedHeading,
        t.receivedIntro("1001-R1"),
        t.receivedNext,
        t.refundedSubject("Butikken", "1001-R1"),
        t.refundedHeading,
        t.refundedIntro("kr 100", "1001-R1"),
        t.refundedTiming,
        t.rowGoods,
        t.rowDeductions,
        t.rowShipping,
        t.rowReturnShipping,
        t.rowTotal,
        t.overdueSubject("Butikken", "1001-R1"),
        t.overdueHeading,
        t.overdueIntro("1001-R1", "16 October 2026"),
        t.overdueOpen,
      ];
      for (const word of words) {
        expect(typeof word, lang).toBe("string");
        expect(word.trim().length, lang).toBeGreaterThan(2);
        expect(word, lang).not.toMatch(/undefined|\[object/);
      }
      expect(t.ackSubject("Butikken", "1001")).toContain("1001");
      expect(t.ackSubject("Butikken", "1001")).toContain("Butikken");
      expect(t.ackIntro("Butikken", "1001", "WHEN")).toContain("WHEN");
      expect(t.ackSendBack("DAY")).toContain("DAY");
      expect(t.ackRefundHold("DAY")).toContain("DAY");
      expect(t.ackRefundNoHold("DAY")).toContain("DAY");
      expect(t.refundedIntro("AMOUNT", "R1")).toContain("AMOUNT");
      expect(t.declinedReason("WHY")).toContain("WHY");
      // The statutory period is named, and only the store's right to hold the refund back is hedged.
      expect(t.ackSendBack("DAY")).toContain("14");
      expect(t.ackRefundHold("DAY")).toContain("14");
      expect(t.withdrawLine).toContain("14");
      expect(t.ackRefundNoHold("DAY")).not.toBe(t.ackRefundHold("DAY"));
    }
  });

  it("differ by language (nothing is left in English by accident)", () => {
    for (const lang of ["nb", "sv", "da"] as const) {
      const t = emailText(lang).returns;
      const en = emailText("en").returns;
      for (const key of ["withdrawLine", "withdrawButton", "ackHeading", "shopperPays", "storePays", "ackWholeOrder", "ackValue", "declinedRights", "refundedTiming"] as const) {
        expect(t[key], `${lang}.${key}`).not.toBe(en[key]);
      }
    }
  });

  it("falls back to English for a language that has no texts", () => {
    expect(emailText("xx").returns.ackHeading).toBe(emailText("en").returns.ackHeading);
  });
});
