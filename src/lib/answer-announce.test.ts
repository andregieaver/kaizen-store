import { describe, expect, it } from "vitest";

import { alreadySaid, answerToAnnounce } from "./answer-announce";

const user = { id: "u1", role: "user", content: "How are sales?" };
const answer = { id: "a1", role: "assistant", content: " Sales are up 4 % this week. " };

describe("what a screen reader hears of the AI manager (PSI ACC-08)", () => {
  it("says a finished answer once, trimmed", () => {
    expect(answerToAnnounce([user, answer], null, false)).toEqual({ id: "a1", text: "Sales are up 4 % this week." });
    expect(answerToAnnounce([user, answer], "a1", false)).toBeNull();
  });

  it("says nothing while an answer streams, for the person's own message or an empty answer", () => {
    expect(answerToAnnounce([user, answer], null, true)).toBeNull();
    expect(answerToAnnounce([answer, user], null, false)).toBeNull();
    expect(answerToAnnounce([user, { ...answer, content: "  " }], null, false)).toBeNull();
  });

  it("counts the answers already there when a conversation opens as said", () => {
    expect(alreadySaid([user, answer, { id: "u2", role: "user", content: "And returns?" }])).toBe("a1");
    expect(alreadySaid([])).toBeNull();
  });
});
