import { describe, expect, it } from "vitest";

import { KAIZEN_TOPICS, parseSummary, STORE_TOPICS, topicsFor } from "./support-summary";

const answer = (value: Record<string, unknown>) => `Summary:\n${JSON.stringify(value)}`;

describe("a support conversation's summary (D216, 2.7)", () => {
  it("takes a summary that fits the closed lists", () => {
    const summary = parseSummary(
      answer({ title: "Late parcel", text: "The customer asked where order 1042 is.", outcome: "resolved", topics: ["delivery", "order_status"], followUp: null }),
      STORE_TOPICS,
    );
    expect(summary).toEqual({ title: "Late parcel", text: "The customer asked where order 1042 is.", outcome: "resolved", topics: ["delivery", "order_status"], followUp: null });
  });

  it("drops topics outside the desk's list, and fails when none is left", () => {
    const base = { title: "T", text: "X", outcome: "unresolved" };
    expect(parseSummary(answer({ ...base, topics: ["delivery", "politics"] }), STORE_TOPICS)?.topics).toEqual(["delivery"]);
    expect(parseSummary(answer({ ...base, topics: ["billing"] }), STORE_TOPICS)).toBeNull();
    expect(parseSummary(answer({ ...base, topics: ["billing"] }), KAIZEN_TOPICS)?.topics).toEqual(["billing"]);
    expect(topicsFor(true)).toBe(KAIZEN_TOPICS);
  });

  it("fails on an unknown outcome, a missing title or text, or no JSON", () => {
    expect(parseSummary(answer({ title: "T", text: "X", outcome: "great", topics: ["other"] }), STORE_TOPICS)).toBeNull();
    expect(parseSummary(answer({ text: "X", outcome: "resolved", topics: ["other"] }), STORE_TOPICS)).toBeNull();
    expect(parseSummary("It went fine.", STORE_TOPICS)).toBeNull();
  });

  it("cuts every field to its length", () => {
    const summary = parseSummary(answer({ title: "t".repeat(200), text: "x".repeat(2000), outcome: "follow_up", topics: STORE_TOPICS, followUp: "f".repeat(500) }), STORE_TOPICS);
    expect(summary?.title).toHaveLength(80);
    expect(summary?.text).toHaveLength(700);
    expect(summary?.topics).toHaveLength(3);
    expect(summary?.followUp).toHaveLength(200);
  });
});
