import { describe, expect, it } from "vitest";

import { noShowCharge, parsePaymentMode, selfServiceOpen, venuePart } from "./pay-later";

describe("paying for appointments later (D66)", () => {
  it("leaves the rest of a deposit, or all of it, to the venue", () => {
    expect(venuePart(89000, { mode: "now", depositPercent: 30 })).toBe(0);
    expect(venuePart(89000, { mode: "deposit", depositPercent: 30 })).toBe(62300);
    expect(venuePart(99, { mode: "deposit", depositPercent: 25 })).toBe(74);
    expect(venuePart(89000, { mode: "venue", depositPercent: 30 })).toBe(89000);
    expect(venuePart(89000, null)).toBe(0);
    expect(venuePart(0, { mode: "venue", depositPercent: 30 })).toBe(0);
    expect(parsePaymentMode("later")).toBe("now");
  });

  it("lets shoppers cancel until the rule's hours before, and charges no-shows less what was paid", () => {
    const now = Date.parse("2026-10-05T08:00:00Z");
    expect(selfServiceOpen("2026-10-06T08:00:00Z", 24, now)).toBe(true);
    expect(selfServiceOpen("2026-10-06T07:59:00Z", 24, now)).toBe(false);
    expect(selfServiceOpen("2026-10-05T08:30:00Z", 0, now)).toBe(true);
    expect(noShowCharge(89000, 26700, 50)).toBe(17800);
    expect(noShowCharge(89000, 26700, 20)).toBe(0);
  });
});
