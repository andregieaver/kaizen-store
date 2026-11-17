import { describe, expect, it } from "vitest";

import { RETENTION_SEED } from "./retention";
import {
  ANSWER_MAX,
  MASK,
  QUESTION_KEEP_DAYS,
  QUESTION_MAX,
  answerInput,
  answerTitle,
  gapOf,
  questionKey,
  questionText,
} from "./unanswered-questions";

describe("when a chat answer counts as not answered (ecosystem plan E4.3)", () => {
  it("is a hand-over because the AI could not help, or an answer the knowledge search found nothing for, never anything else", () => {
    expect(gapOf({ handoff: "Wants to know about gift wrapping", escalation: "could_not_help" })).toBe("handoff");
    expect(gapOf({ foundNothing: true })).toBe("knowledge");
    expect(gapOf({ handoff: "Asked for a person", escalation: "asked_for_person" })).toBeNull();
    expect(gapOf({ handoff: "Upset", escalation: "upset" })).toBeNull();
    // A category without a hand-over is not one (the reply carries the category only with it).
    expect(gapOf({ escalation: "could_not_help" })).toBeNull();
    expect(gapOf({})).toBeNull();
  });
});

describe("what is kept of a visitor's question", () => {
  it("takes out email addresses, long numbers, links and secrets, and keeps the rest as typed", () => {
    expect(questionText("Can you email me at kari.nordmann@example.no about order 1234567?")).toBe(`Can you email me at ${MASK.email} about order ${MASK.number}?`);
    expect(questionText("Ring meg på +47 912 34 567, takk")).toBe(`Ring meg på ${MASK.number}, takk`);
    expect(questionText("Is https://evil.example/x?a=1 your shop?")).toBe(`Is ${MASK.link} your shop?`);
    expect(questionText("My key is sk_live_abcdef123456, does it work?")).not.toContain("sk_live_abcdef123456");
    // Short numbers stay: a delivery time, a size, a year.
    expect(questionText("Do you deliver in 10 - 20 days to size 42 in 2026?")).toBe("Do you deliver in 10 - 20 days to size 42 in 2026?");
  });

  it("makes spaces one, keeps nothing that is too short to be a question, and cuts a long one at a word", () => {
    expect(questionText("  Do   you\n\nship\tto Iceland? ")).toBe("Do you ship to Iceland?");
    expect(questionText("ok")).toBeNull();
    expect(questionText("???")).toBeNull();
    expect(questionText("12345678")).toBeNull();
    const long = questionText(`${"Hvor lenge tar frakten til Tromsø ".repeat(20)}?`)!;
    expect(long.length).toBeLessThanOrEqual(QUESTION_MAX);
    expect(long.endsWith("…")).toBe(true);
    expect(long).not.toMatch(/\s…$/);
  });

  it("groups repeats that differ only in case, spaces and marks, and keeps other wordings apart", () => {
    expect(questionKey("Do you ship to Iceland?")).toBe(questionKey("do you  ship to ICELAND"));
    expect(questionKey("Sender dere til Island?")).toBe("sender dere til island");
    expect(questionKey("Do you ship to Iceland?")).not.toBe(questionKey("Can I get it sent to Iceland?"));
    expect(questionKey(`Email ${MASK.email} please`)).toBe("email email please");
  });
});

describe("the owner's answer", () => {
  it("is titled by the question unless changed, within a document title's length", () => {
    expect(answerTitle("Do you ship to Iceland?")).toBe("Do you ship to Iceland?");
    expect(answerTitle("x".repeat(300)).length).toBeLessThanOrEqual(200);
    expect(answerInput.parse({ answer: " Yes, in 5 days. " })).toEqual({ title: "", answer: "Yes, in 5 days." });
    expect(answerInput.safeParse({ title: "Shipping", answer: "   " }).success).toBe(false);
    expect(answerInput.safeParse({ title: "Shipping", answer: "x".repeat(ANSWER_MAX + 1) }).success).toBe(false);
  });
});

describe("how long questions are kept", () => {
  it("is the retention rule's period, which a test holds equal to the code's", () => {
    const rule = RETENTION_SEED.find((r) => r.kind === "unanswered_questions")!;
    expect(rule).toMatchObject({ periodValue: QUESTION_KEEP_DAYS, periodUnit: "days", countsFrom: "event", basis: "policy" });
    expect(QUESTION_KEEP_DAYS).toBe(90);
  });
});
