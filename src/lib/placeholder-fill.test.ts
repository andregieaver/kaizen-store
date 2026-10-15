import { describe, expect, it } from "vitest";

import { sampleOrder, samplePlaceholders } from "./notification-sample";
import { fillNamed } from "./placeholder-fill";
import { fillPlaceholders } from "./support-replies";

describe("fillNamed(): the filler saved replies and email templates share", () => {
  it("fills, leaves out unknown values with their space, and leaves other braces alone", () => {
    expect(fillNamed("Hi {a} and {b}, from {c}", { a: "Ann", b: null })).toBe("Hi Ann and, from {c}");
    expect(fillNamed("{a}, welcome", { a: "" })).toBe("welcome");
    expect(fillNamed("Nothing here", {})).toBe("Nothing here");
    // A stray NUL in the text cannot be mistaken for the marker of a left-out value.
    expect(fillNamed("a\u0000b {a}", { a: "x" })).toBe("ab x");
  });

  it("keeps a line left empty unless asked to drop bare lines", () => {
    expect(fillNamed("{a},\nnext", { a: null })).toBe("\nnext");
    expect(fillNamed("{a},\nnext", { a: null }, { dropBareLines: true })).toBe("next");
    expect(fillNamed("— {a} —\nnext", { a: null }, { dropBareLines: true })).toBe("next");
    expect(fillNamed("Hi {a}!\nnext", { a: null }, { dropBareLines: true })).toBe("Hi!\nnext");
  });

  it("is the rule saved replies kept (D216)", () => {
    expect(fillPlaceholders("Hi {customer_first_name}, I am {agent_first_name} at {store}.", { customerFirstName: null, agentFirstName: "Ola", store: "Bok" })).toBe(
      "Hi, I am Ola at Bok.",
    );
    expect(fillPlaceholders("{customer_first_name},\n\nThanks", { customerFirstName: null, agentFirstName: null, store: null })).toBe("\n\nThanks");
  });
});

describe("the sample order", () => {
  it("adds up in whole units of the market's currency", () => {
    const nok = sampleOrder({ storeName: "Bok", currency: "NOK", locale: "nb-NO", lang: "nb", now: new Date("2026-10-15T10:00:00Z") });
    expect(nok.lines.map((l) => l.totalMinor)).toEqual([29800, 29900]);
    expect(nok.totalMinor).toBe(nok.subtotalMinor + nok.shippingMinor);
    expect(nok.placedAt).toBe("2026-10-15T10:00:00.000Z");
    // HUF is kept with two decimals (`MINOR_UNIT_DIGITS`), as every currency a store can offer.
    const huf = sampleOrder({ storeName: "Bok", currency: "HUF", locale: "hu-HU", lang: "hu" });
    expect(huf.lines[0].unitMinor).toBe(14900);
  });

  it("fills every placeholder, the money in the sample's own currency", () => {
    const eur = sampleOrder({ storeName: "Bok", currency: "EUR", locale: "en-IE", lang: "en" });
    const values = samplePlaceholders(eur, "Bok");
    expect(Object.values(values).every((v) => typeof v === "string" && v.length > 0)).toBe(true);
    expect(values.order_total).toBe("€646.00");
    expect(values.refund_amount).toBe("€298.00");
    expect(values.store_name).toBe("Bok");
  });
});
