import { describe, expect, it } from "vitest";

import { findClaims } from "./claims";
import { ORDER_UPDATES, UPDATE_PHASE, UPDATE_WORDS, orderUpdateWords } from "./order-update-email";

describe("an update to a customer about their order (D635)", () => {
  it("has the store's own words for every update in every language written by hand, English for the rest", () => {
    for (const lang of ["nb", "sv", "da", "en"]) {
      for (const update of ORDER_UPDATES) {
        const w = orderUpdateWords(lang, update);
        expect(w.subject("Fjell Sport", "1042")).toContain("1042");
        expect(w.subject("Fjell Sport", "1042")).toContain("Fjell Sport");
        expect(w.intro("1042")).toContain("1042");
        expect(w.heading.length).toBeGreaterThan(5);
      }
    }
    expect(orderUpdateWords("nb", "delayed").heading).toBe("Bestillingen din tar litt lenger tid");
    expect(orderUpdateWords("de", "delayed")).toBe(orderUpdateWords("en", "delayed"));
  });

  it("promises no date, refund or amount, and makes no claim", () => {
    for (const lang of ["nb", "sv", "da", "en"]) {
      for (const update of ORDER_UPDATES) {
        const w = orderUpdateWords(lang, update);
        const all = [w.subject("Shop", "1042"), w.heading, w.intro("1042")].join(" ");
        expect(all.replace(/1042/g, "")).not.toMatch(/\d/);
        expect(all).not.toMatch(/refund|refusjon|återbetal|tilbakebetal|pengene/i);
        expect(findClaims(all)).toEqual([]);
      }
    }
  });

  it("names a tracking phase for every parcel update and words for the owner for every update", () => {
    expect(Object.keys(UPDATE_PHASE).sort()).toEqual(ORDER_UPDATES.filter((u) => u !== "delayed").sort());
    for (const update of ORDER_UPDATES) expect(UPDATE_WORDS[update]).toBeTruthy();
  });
});
