import { describe, expect, it } from "vitest";

import { mayModerate } from "./review-status";
import { cleanReview, defaultReviewName, ratingSummary } from "./reviews";

/** Product reviews' pure rules (D301, `docs/wave-5-marketing.md` 9). */

describe("cleanReview", () => {
  it("takes stars alone, with the name, and cleans the words", () => {
    expect(cleanReview({ rating: "5", name: "  Kari  N. " })).toEqual({ ok: true, review: { rating: 5, title: null, body: null, name: "Kari N." } });
    expect(cleanReview({ rating: 3, title: " Good​  fit ", body: "Line one  \r\n\r\n\r\n\r\nLine two\u0007", name: "Ola" })).toEqual({
      ok: true,
      review: { rating: 3, title: "Good fit", body: "Line one\n\nLine two", name: "Ola" },
    });
  });

  it("refuses what is missing or too long, never cutting it", () => {
    expect(cleanReview({ rating: 0, name: "Ola" })).toEqual({ ok: false, problem: "rating" });
    expect(cleanReview({ rating: 4.5, name: "Ola" })).toEqual({ ok: false, problem: "rating" });
    expect(cleanReview({ rating: 4, name: "  " })).toEqual({ ok: false, problem: "name" });
    expect(cleanReview({ rating: 4, name: "Ola", title: "x".repeat(121) })).toEqual({ ok: false, problem: "title" });
    expect(cleanReview({ rating: 4, name: "Ola", body: "x".repeat(5001) })).toEqual({ ok: false, problem: "body" });
    expect(cleanReview({ rating: 4, name: "x".repeat(61) })).toEqual({ ok: false, problem: "name" });
  });
});

describe("defaultReviewName", () => {
  it("is the first name and the last name's initial, never more", () => {
    expect(defaultReviewName("Kari Anne Nordmann")).toBe("Kari N.");
    expect(defaultReviewName("Ola")).toBe("Ola");
    expect(defaultReviewName("  ")).toBe("");
    expect(defaultReviewName("åse ødegård")).toBe("åse Ø.");
  });
});

describe("ratingSummary", () => {
  it("counts each number of stars and averages to one decimal, half up", () => {
    expect(ratingSummary({})).toEqual({ count: 0, average: null, counts: [0, 0, 0, 0, 0] });
    expect(ratingSummary({ 5: 1, 4: 2, 3: 1 })).toEqual({ count: 4, average: 4, counts: [1, 2, 1, 0, 0] });
    // 17 / 4 = 4.25, shown as 4.3.
    expect(ratingSummary({ 5: 2, 4: 1, 3: 1 }).average).toBe(4.3);
    expect(ratingSummary({ 1: 3 }).average).toBe(1);
  });
});

describe("mayModerate", () => {
  it("moves a review only as staff may", () => {
    expect(mayModerate("pending", "published")).toBe(true);
    expect(mayModerate("pending", "hidden")).toBe(true);
    expect(mayModerate("published", "hidden")).toBe(true);
    expect(mayModerate("hidden", "published")).toBe(true);
    expect(mayModerate("published", "pending")).toBe(false);
    expect(mayModerate("hidden", "pending")).toBe(false);
  });
});
