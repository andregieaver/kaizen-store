import { describe, expect, it } from "vitest";

import { dueReminderEmail, ownersNoticeEmail } from "./privacy-emails";
import { REFUSAL_REASONS } from "./privacy-request";
import {
  PRIVACY_LANGUAGES,
  REFUSAL_REASON_KEYS,
  STAFF_TEXT,
  erasureConfirmationEmail,
  extensionNoticeEmail,
  formatPrivacyDay,
  informationBlock,
  keptReason,
  notIncludedText,
  privacyLanguage,
  refusalNoticeEmail,
  shopperPrivacyText,
  supervisoryAuthority,
  type PrivacyLanguage,
} from "./privacy-text";

const facts = { storeName: "Fjord Shop", legalName: "Fjord AS", contactEmail: "hei@fjord.no", country: "NO" };

describe("the shopper's pages", () => {
  it("has every key in all four languages, and never an empty string", () => {
    const keys = (l: PrivacyLanguage) => Object.keys(shopperPrivacyText(l)).sort();
    for (const l of PRIVACY_LANGUAGES) expect(keys(l)).toEqual(keys("en"));
    for (const l of PRIVACY_LANGUAGES) {
      const t = shopperPrivacyText(l);
      for (const [k, v] of Object.entries(t)) {
        if (typeof v === "string") expect([l, k, v.trim().length > 0]).toEqual([l, k, true]);
        if (Array.isArray(v)) expect([l, k, v.length]).toEqual([l, k, 6]);
      }
      expect(t.cardIntro("Fjord").length).toBeGreaterThan(10);
    }
  });

  it("shows English for a language that is not written by hand", () => {
    expect(shopperPrivacyText("fi").cardTitle).toBe("Your data");
    expect(shopperPrivacyText("xx").confirmButton).toBe("Delete my account");
    expect(["nb", "nb-NO", "nn", "no", "sv-SE", "da", "fi", null, undefined].map(privacyLanguage)).toEqual(["nb", "nb", "nb", "nb", "sv", "da", "en", "en", "en"]);
  });

  it("says what stays and until when, with a count, in every language", () => {
    expect(shopperPrivacyText("nb").staysOrders(1, "1. januar 2032")).toContain("1 bestilling beholdes");
    expect(shopperPrivacyText("nb").staysOrders(3, "1. januar 2032")).toContain("3 bestillinger beholdes");
    expect(shopperPrivacyText("sv").staysOrders(2, "1 januari 2033")).toContain("2 beställningar sparas");
    expect(shopperPrivacyText("da").staysOrders(1, "1. januar 2032")).toContain("1 bestilling opbevares");
    expect(shopperPrivacyText("en").staysOrders(1, "1 January 2032")).toContain("1 order is kept by the shop until 1 January 2032");
    expect(shopperPrivacyText("en").staysOrders(2, "1 January 2032")).toContain("2 orders are kept");
    for (const l of PRIVACY_LANGUAGES) {
      const t = shopperPrivacyText(l);
      expect(t.subscriptionsEnd(1)).not.toEqual(t.subscriptionsEnd(2));
      expect(t.bonusLost("500 kr")).toContain("500 kr");
      expect(t.stripeNote).toContain("Stripe");
    }
  });

  it("says that the delete cannot be undone and that Stripe keeps its own records, never that this is legal advice", () => {
    for (const l of PRIVACY_LANGUAGES) {
      const text = JSON.stringify(shopperPrivacyText(l));
      expect(text.toLowerCase()).not.toContain("legal advice");
    }
    expect(shopperPrivacyText("en").irreversible).toBe("This cannot be undone.");
  });
});

describe("dates and authorities", () => {
  it("writes a day for the reader in the language, in UTC", () => {
    expect(formatPrivacyDay("2032-01-01", "en")).toBe("1 January 2032");
    expect(formatPrivacyDay("2032-01-01", "nb")).toMatch(/^1\. januar 2032$/);
    expect(formatPrivacyDay("2032-01-01", "sv")).toBe("1 januari 2032");
    expect(formatPrivacyDay("2032-01-01", "da")).toBe("1. januar 2032");
    expect(formatPrivacyDay("nonsense", "en")).toBe("nonsense");
  });

  it("names the supervisory authority by the store's country, or the store's own, or a plain description", () => {
    expect(supervisoryAuthority("NO", "nb")).toBe("Datatilsynet");
    expect(supervisoryAuthority("SE", "sv")).toBe("Integritetsskyddsmyndigheten (IMY)");
    expect(supervisoryAuthority("DK", "da")).toBe("Datatilsynet");
    expect(supervisoryAuthority("FI", "en")).toBe("the data protection authority in your country");
    expect(supervisoryAuthority("FI", "nb")).toBe("personvernmyndigheten i ditt land");
    expect(supervisoryAuthority("NO", "nb", "  Personvernnemnda ")).toBe("Personvernnemnda");
  });
});

describe("the export's information block (GDPR Art. 15(1))", () => {
  it("has the points of Art. 15(1) in every language: purposes, categories, recipients, storage periods, source, rights, complaint", () => {
    for (const l of PRIVACY_LANGUAGES) {
      const b = informationBlock(l, { storeName: "Fjord Shop", legalName: "Fjord AS", contactEmail: "hei@fjord.no", country: "SE", bookkeepingYears: 7 });
      expect(b.controller).toContain("Fjord AS");
      expect(b.controller).toContain("hei@fjord.no");
      for (const list of [b.purposes, b.categories, b.recipients, b.storagePeriods, b.rights]) expect(list.length).toBeGreaterThanOrEqual(5);
      expect(b.storagePeriods[0]).toContain("7");
      expect(b.source.length).toBeGreaterThan(20);
      expect(b.complaint).toContain("Integritetsskyddsmyndigheten");
      expect(b.automatedDecisions.length).toBeGreaterThan(20);
    }
    expect(informationBlock("en", { storeName: "Shop", legalName: null, contactEmail: null, country: null, bookkeepingYears: 10 }).controller).toBe("The controller is Shop.");
  });

  it("lists what is not in the file, in every language, with a reason each", () => {
    for (const l of PRIVACY_LANGUAGES) {
      const list = notIncludedText(l);
      expect(list).toHaveLength(7);
      for (const n of list) expect([n.what.length > 5, n.why.length > 5]).toEqual([true, true]);
    }
    expect(notIncludedText("en").map((n) => n.what.toLowerCase()).join(" ")).toContain("cookie consent");
    expect(notIncludedText("en").map((n) => n.what.toLowerCase()).join(" ")).toContain("reviews");
  });

  it("gives a reason a kept record is kept, one sentence, with the day", () => {
    for (const l of PRIVACY_LANGUAGES) {
      expect(keptReason(l, "bookkeeping", "2032")).toContain("2032");
      expect(keptReason(l, "legal_claims", "2032")).toContain("2032");
      expect(keptReason(l, "opt_out", "")).not.toContain("undefined");
    }
  });
});

describe("the emails to the person", () => {
  it("confirms an erasure: what was removed, what is kept and until when, the opt-out, the complaint, in every language", () => {
    for (const l of PRIVACY_LANGUAGES) {
      const mail = erasureConfirmationEmail(l, facts, { orders: 2, until: "2032-01-01" });
      const text = JSON.stringify(mail.blocks);
      expect(mail.subject).toContain("Fjord Shop");
      expect(text).toContain("Stripe");
      expect(text).toContain("Datatilsynet");
      expect(text).toMatch(/2032/);
      expect(mail.lang).toBe(l);
    }
    const none = erasureConfirmationEmail("en", facts, { orders: 0, until: null });
    expect(JSON.stringify(none.blocks)).not.toContain("kept until");
  });

  it("holds no name or address of the person: only the store's", () => {
    const mail = erasureConfirmationEmail("nb", facts, { orders: 1, until: "2032-01-01" });
    expect(JSON.stringify(mail)).not.toContain("ola@");
    expect(mail.footer).toEqual(["Fjord Shop", "Fjord AS", "hei@fjord.no"]);
  });

  it("tells an extension within the month with the reasons, the staff's words on their own line", () => {
    const mail = extensionNoticeEmail("en", facts, { receivedDay: "2026-10-01", untilDay: "2027-01-01", reason: "A very large account" });
    expect(mail.blocks).toContainEqual({ type: "paragraph", text: "A very large account" });
    const statutory = mail.blocks.filter((b) => b.type === "paragraph").map((b) => (b as { text: string }).text).filter((t) => t !== "A very large account");
    expect(statutory.join(" ")).toContain("1 October 2026");
    expect(statutory.join(" ")).toContain("1 January 2027");
    expect(statutory.join(" ")).not.toContain("A very large account");
  });

  it("refuses with a reason, the right to complain and the right to a judicial remedy, in every language", () => {
    for (const l of PRIVACY_LANGUAGES) {
      for (const reason of REFUSAL_REASONS) {
        const mail = refusalNoticeEmail(l, facts, { receivedDay: "2026-10-01", reason, note: "A note" });
        const text = JSON.stringify(mail.blocks);
        expect(text).toContain("Datatilsynet");
        expect(text).toContain("A note");
        expect(mail.subject).toContain("Fjord Shop");
      }
    }
    expect(refusalNoticeEmail("en", facts, { receivedDay: "2026-10-01", reason: "excessive" }).blocks.some((b) => b.type === "paragraph" && b.text === "A note from the shop:")).toBe(false);
    expect(REFUSAL_REASON_KEYS).toEqual(REFUSAL_REASONS);
    expect(refusalNoticeEmail("en", facts, { receivedDay: "2026-10-01", reason: "legal_hold" }).blocks.map((b) => (b as { text?: string }).text).join(" ")).toContain("judicial remedy");
  });

  it("no consumer sentence puts a free-text field inside a statutory one: the reasons are fixed strings", () => {
    for (const l of PRIVACY_LANGUAGES) {
      const mail = refusalNoticeEmail(l, facts, { receivedDay: "2026-10-01", reason: "other", note: "<script>alert(1)</script>" });
      const statutory = mail.blocks.filter((b) => b.type === "paragraph").map((b) => (b as { text: string }).text);
      expect(statutory.filter((t) => t.includes("<script>"))).toEqual(["<script>alert(1)</script>"]);
    }
  });
});

describe("the English for staff and owners", () => {
  it("says the one-month clock and the limit of an extension, and no fee", () => {
    expect(STAFF_TEXT.clock).toContain("one month");
    expect(STAFF_TEXT.clock).toContain("two further months");
    expect(STAFF_TEXT.free.toLowerCase()).toContain("free of charge");
    expect(STAFF_TEXT.restrictedBanner("1 March 2026", "1 January 2032")).toContain("1 January 2032");
  });

  it("tells the owners who did it and when, never who it was about", () => {
    const mail = ownersNoticeEmail({ storeName: "Fjord Shop", action: "erasure", actor: "Kari Staff", when: "2026-10-04 14:32 UTC", requestId: "r-1", url: "https://admin/x" });
    const text = JSON.stringify(mail);
    expect(text).toContain("Kari Staff");
    expect(text).toContain("r-1");
    expect(mail.subject).toBe("A customer was erased in Fjord Shop");
    expect(text).not.toMatch(/@example/);
    expect(ownersNoticeEmail({ storeName: "S", action: "export", actor: "A", when: "now", requestId: null, url: "u" }).subject).toBe("A customer's data was downloaded in S");
  });

  it("reminds the owners seven days before and when overdue", () => {
    expect(dueReminderEmail({ storeName: "S", kind: "due_soon", requestId: "r", dueDay: "2026-10-11", requestKind: "export", url: "u" }).subject).toContain("is due 2026-10-11");
    expect(dueReminderEmail({ storeName: "S", kind: "overdue", requestId: "r", dueDay: "2026-10-11", requestKind: "erasure", url: "u" }).subject).toBe("A privacy erasure request in S is overdue");
  });
});

describe("the statutes the texts name (review)", () => {
  const nbTexts = () => {
    const t = shopperPrivacyText("nb");
    const info = informationBlock("nb", { storeName: "Fjord Shop", legalName: "Fjord AS", contactEmail: "hei@fjord.no", country: "NO", bookkeepingYears: 5 });
    const mail = erasureConfirmationEmail("nb", facts, { orders: 2, until: "2031-01-01" });
    return JSON.stringify([t, info, mail, keptReason("nb", "bookkeeping", "1. januar 2031")]);
  };

  it("names bokføringsloven, never regnskapsloven (the annual-accounts act), as the Norwegian ground for keeping orders", () => {
    const text = nbTexts();
    expect(text).toContain("bokføringsloven");
    expect(text).not.toContain("regnskapsloven");
  });

  it("does not tell staff that a weekend or holiday never moves the month: it says what the system does and sends the rule to a lawyer", () => {
    expect(STAFF_TEXT.clock).not.toMatch(/does not extend the month/i);
    expect(STAFF_TEXT.clock).toContain("1182/71");
    expect(STAFF_TEXT.clock).toMatch(/same calendar day/);
  });
});
