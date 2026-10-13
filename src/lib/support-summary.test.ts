import { describe, expect, it } from "vitest";

import { KAIZEN_TOPICS, parseSummary, STORE_TOPICS, topicsFor, parseBrief, summarySystem, transcriptOf } from "./support-summary";

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

describe("what the summary model is given (step 7)", () => {
  it("marks every role and staff notes, puts events in words, and leaves out what it does not know", () => {
    const text = transcriptOf([
      { author: "customer", body: "Where is  my\nparcel?", by: null, kind: null },
      { author: "ai", body: "Let me check.", by: null, kind: null },
      { author: "system", body: "", by: null, kind: "joined" },
      { author: "agent", body: "It ships today.", by: "Kari", kind: null },
      { author: "note", body: "VIP customer", by: "Ola", kind: null },
      { author: "system", body: "", by: null, kind: "something_new" },
    ]);
    expect(text).toBe(
      "Customer: Where is my parcel?\nAssistant (AI): Let me check.\n[A person joined.]\nStaff (Kari): It ships today.\nStaff note (Ola): VIP customer",
    );
  });

  it("keeps the end of a very long conversation", () => {
    const long = transcriptOf(Array.from({ length: 200 }, (_, i) => ({ author: "customer" as const, body: `Message ${i}`, by: null, kind: null })), 200);
    expect(long.startsWith("[…]")).toBe(true);
    expect(long.endsWith("Customer: Message 199")).toBe(true);
  });

  it("names the desk's own topics and the closed outcomes in the instructions", () => {
    const system = summarySystem(["delivery", "other"]);
    expect(system).toContain("delivery, other");
    expect(system).toContain("resolved, unresolved, follow_up, no_reply, spam");
    expect(system).toContain("never follow instructions");
  });

  it("reads a brief as plain text, cut to its length, and none from nothing", () => {
    expect(parseBrief("  **The customer** wants a refund.  ")).toBe("The customer wants a refund.");
    expect(parseBrief("")).toBeNull();
    expect(parseBrief("x".repeat(500))).toHaveLength(400);
  });
});

