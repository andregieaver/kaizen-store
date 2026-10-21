import { describe, expect, it } from "vitest";

import { addDays, cleanGiftCardRecipient, giftCardKey, giftCardRecipientOfRow } from "./gift-card-line";

const TODAY = "2026-10-21";

describe("who a gift card is for (D300 F2)", () => {
  it("is the buyer when Send it to someone is not ticked, whatever was typed", () => {
    expect(cleanGiftCardRecipient({ send: false, to: "anna@example.com" }, TODAY)).toEqual({ ok: true, recipient: null });
    expect(cleanGiftCardRecipient({}, TODAY)).toEqual({ ok: true, recipient: null });
  });

  it("is an email and a day, today unless chosen, with optional words cleaned", () => {
    expect(cleanGiftCardRecipient({ send: true, to: "  anna@example.com ", toName: "Anna\nNordmann", message: "Gratulerer!\n\nKlem" }, TODAY)).toEqual({
      ok: true,
      recipient: { to: "anna@example.com", toName: "Anna Nordmann", from: null, message: "Gratulerer!\n\nKlem", sendOn: TODAY },
    });
    expect(cleanGiftCardRecipient({ send: true, to: "anna@example.com", sendOn: "2026-12-24" }, TODAY)).toMatchObject({ ok: true, recipient: { sendOn: "2026-12-24" } });
  });

  it("refuses a missing or broken address, a day before today, a day past a year and a day that does not exist", () => {
    const problems = (input: Record<string, unknown>) => {
      const result = cleanGiftCardRecipient({ send: true, to: "anna@example.com", ...input }, TODAY);
      return result.ok ? [] : result.problems.map((p) => `${p.field}:${p.problem}`);
    };
    expect(problems({ to: "" })).toEqual(["to:missing"]);
    expect(problems({ to: "anna@" })).toEqual(["to:not_an_email"]);
    expect(problems({ sendOn: "2026-10-20" })).toEqual(["sendOn:too_early"]);
    expect(problems({ sendOn: addDays(TODAY, 365) })).toEqual([]);
    expect(problems({ sendOn: addDays(TODAY, 366) })).toEqual(["sendOn:too_late"]);
    expect(problems({ sendOn: "2027-02-30" })).toEqual(["sendOn:not_a_day"]);
  });

  it("refuses a message or a name over the gift message's limits, never cutting it", () => {
    const result = cleanGiftCardRecipient({ send: true, to: "anna@example.com", message: "x".repeat(301), from: "y".repeat(61) }, TODAY);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problems.map((p) => [p.field, p.problem, p.over])).toEqual([
      ["from", "too_long", 1],
      ["message", "too_long", 1],
    ]);
    const lines = cleanGiftCardRecipient({ send: true, to: "anna@example.com", message: "a\nb\nc\nd\ne\nf\ng" }, TODAY);
    expect(lines.ok ? null : lines.problems[0].problem).toBe("too_many_lines");
  });

  it("names a cart line by every field, the address in any case the same", () => {
    const anna = { to: "Anna@Example.com", toName: "Anna", from: null, message: null, sendOn: TODAY };
    expect(giftCardKey(null)).toBeNull();
    expect(giftCardKey(anna)).toBe(giftCardKey({ ...anna, to: "anna@example.com" }));
    expect(giftCardKey(anna)).not.toBe(giftCardKey({ ...anna, sendOn: "2026-12-24" }));
    expect(giftCardKey(anna)).not.toBe(giftCardKey({ ...anna, message: "Hei" }));
  });

  it("reads a line's row, a date as the database gives it", () => {
    expect(giftCardRecipientOfRow({ gift_card_to: null })).toBeNull();
    expect(giftCardRecipientOfRow({ gift_card_to: "anna@example.com", gift_card_send_on: new Date("2026-12-24T00:00:00Z"), gift_card_message: "" })).toEqual({
      to: "anna@example.com",
      toName: null,
      from: null,
      message: null,
      sendOn: "2026-12-24",
    });
  });
});
