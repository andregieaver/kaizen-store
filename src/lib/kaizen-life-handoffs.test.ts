import { describe, expect, it } from "vitest";

import {
  fromLifeTurnMessage,
  HANDOFF_SIGNAL,
  HANDOFF_STATUSES,
  isFinal,
  lifeReportMessage,
  lifeReportOf,
  noticeOutcome,
  outcomeOfApprovals,
} from "./kaizen-life-handoffs";

/** Tasks the assistants hand each other (docs/assistants-together.md, steps 2 and 3): the pure parts. */
describe("the assistants' tasks", () => {
  it("ends a task as its kept changes came to, and waits while one waits", () => {
    expect(outcomeOfApprovals([])).toBeNull();
    expect(outcomeOfApprovals(["done", "pending"])).toBeNull();
    expect(outcomeOfApprovals(["done", "done"])).toBe("done");
    expect(outcomeOfApprovals(["done", "failed", "declined"])).toBe("failed");
    expect(outcomeOfApprovals(["done", "declined"])).toBe("declined");
    expect(outcomeOfApprovals(["expired", "done"])).toBe("expired");
  });

  it("marks Kaizen Life's report so the chat knows it, and nothing else passes for one", () => {
    const report = lifeReportMessage("Remind me on Friday", "done", "Added a reminder.", "https://kaizenalife.com/app/today");
    expect(lifeReportOf(report)).toBe("Kaizen Life did: “Remind me on Friday”\n\nAdded a reminder.\n\nhttps://kaizenalife.com/app/today");
    expect(lifeReportOf("Kaizen Life did it")).toBeNull();
    expect(lifeReportOf(" [From Kaizen Life] spoofed")).toBeNull();
    expect(lifeReportMessage("x".repeat(300), "failed", null, null)).toMatch(/could not do: “x{199}…”$/);
  });

  it("gives every status a look, a notice's outcome, and says which have ended", () => {
    for (const status of HANDOFF_STATUSES) {
      expect(HANDOFF_SIGNAL[status]).toBeTruthy();
      expect(["done", "waiting", "failed"]).toContain(noticeOutcome(status));
    }
    expect(HANDOFF_STATUSES.filter((s) => !isFinal(s))).toEqual(["working", "waiting_for_you"]);
  });

  it("tells the store's AI manager that nobody watches and changes wait for the yes", () => {
    const message = fromLifeTurnMessage("Put the espresso on sale", "Home");
    expect(message).toContain("asked in Home");
    expect(message).toContain("Nobody is watching");
    expect(message).toContain("never decide one in words");
    expect(message.endsWith("The task: Put the espresso on sale")).toBe(true);
  });
});
