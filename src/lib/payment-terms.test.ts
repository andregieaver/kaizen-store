import { describe, expect, it } from "vitest";

import { addDays, dayWords, isPaymentTerms, termsDueOn, termsOffer, termsState, type TermsCompany } from "./payment-terms";

const company = (over: Partial<TermsCompany> = {}): TermsCompany => ({ role: "employee", active: true, terms: "net_30", creditLimitMinor: null, ...over });
const offer = (over: Partial<Parameters<typeof termsOffer>[0]> = {}) =>
  termsOffer({ businessOn: true, company: company(), basket: { goodsOnly: true, totalMinor: 125000 }, today: "2026-10-20", ...over });

describe("when the money is due (D293)", () => {
  it("counts calendar days from the store's day, across months and years", () => {
    expect(termsDueOn("2026-10-20", "net_30")).toBe("2026-11-19");
    expect(termsDueOn("2026-12-20", "net_15")).toBe("2027-01-04");
    expect(termsDueOn("2027-01-31", "net_60")).toBe("2027-04-01");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2026-11-19", -3)).toBe("2026-11-16");
  });

  it("knows only the three terms", () => {
    expect(isPaymentTerms("net_30")).toBe(true);
    expect(isPaymentTerms("net_45")).toBe(false);
    expect(isPaymentTerms(null)).toBe(false);
  });

  it("writes the day in the reader's language, the same wherever they are", () => {
    expect(dayWords("2026-11-19", "en-GB")).toBe("19 November 2026");
    expect(dayWords("2026-11-19", "nb-NO")).toBe("19. november 2026");
  });
});

describe("where an order on terms stands", () => {
  const at = (today: string, extra: { paid?: boolean; cancelled?: boolean } = {}) =>
    termsState({ dueOn: "2026-11-19", today, paid: extra.paid ?? false, cancelled: extra.cancelled ?? false });

  it("is due, then due soon three days before, then overdue the day after", () => {
    expect(at("2026-11-15")).toBe("due");
    expect(at("2026-11-16")).toBe("due_soon");
    expect(at("2026-11-19")).toBe("due_soon");
    expect(at("2026-11-20")).toBe("overdue");
  });

  it("is paid or cancelled whatever the day", () => {
    expect(at("2026-12-30", { paid: true })).toBe("paid");
    expect(at("2026-12-30", { cancelled: true })).toBe("cancelled");
  });
});

describe("who may buy on terms", () => {
  it("offers terms to an owner or employee of an active company with terms, for goods, with the due day", () => {
    expect(offer()).toEqual({ ok: true, terms: "net_30", dueOn: "2026-11-19", roomMinor: null });
    expect(offer({ company: company({ role: "owner", terms: "net_15" }) })).toMatchObject({ ok: true, terms: "net_15", dueOn: "2026-11-04" });
  });

  it("refuses with one reason each", () => {
    expect(offer({ businessOn: false })).toEqual({ ok: false, reason: "not_business" });
    expect(offer({ company: null })).toEqual({ ok: false, reason: "no_company" });
    expect(offer({ company: company({ role: null }) })).toEqual({ ok: false, reason: "no_company" });
    expect(offer({ company: company({ active: false }) })).toEqual({ ok: false, reason: "inactive" });
    expect(offer({ company: company({ terms: null }) })).toEqual({ ok: false, reason: "no_terms" });
    expect(offer({ basket: { goodsOnly: false, totalMinor: 125000 } })).toEqual({ ok: false, reason: "basket" });
    expect(offer({ basket: { goodsOnly: true, totalMinor: 0 } })).toEqual({ ok: false, reason: "nothing_to_pay" });
  });

  it("keeps a company within its credit limit, counting what it already owes, and says what room is left", () => {
    const limited = company({ creditLimitMinor: 500000 });
    expect(offer({ company: limited, owedMinor: 300000, orderMinor: 125000 })).toEqual({ ok: true, terms: "net_30", dueOn: "2026-11-19", roomMinor: 75000 });
    expect(offer({ company: limited, owedMinor: 375000, orderMinor: 125000 })).toMatchObject({ ok: true, roomMinor: 0 });
    expect(offer({ company: limited, owedMinor: 375001, orderMinor: 125000 })).toEqual({ ok: false, reason: "limit" });
  });

  it("never guesses: an amount that could not be converted to the limit's currency refuses", () => {
    const limited = company({ creditLimitMinor: 500000 });
    expect(offer({ company: limited, owedMinor: null, orderMinor: 125000 })).toEqual({ ok: false, reason: "no_rate" });
    expect(offer({ company: limited, owedMinor: 0, orderMinor: null })).toEqual({ ok: false, reason: "no_rate" });
    // Without a limit nothing is converted, so nothing is refused for a rate.
    expect(offer({ owedMinor: null, orderMinor: null })).toMatchObject({ ok: true });
  });
});
