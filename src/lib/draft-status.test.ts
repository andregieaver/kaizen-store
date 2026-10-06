import { describe, expect, it } from "vitest";

import {
  DRAFT_STATUSES,
  DRAFT_TRANSITIONS,
  canMoveDraft,
  canReopenDraft,
  draftFollowsOrder,
  draftPruneCutoffs,
  isDraftDeletable,
  isDraftEditable,
  isDraftFinal,
  isDraftStatus,
} from "./draft-status";

describe("a draft's life", () => {
  it("is the table of the spec: open to sent, sent to paid, expired, cancelled or open, paid final", () => {
    expect(DRAFT_TRANSITIONS.open).toEqual(["sent"]);
    expect([...DRAFT_TRANSITIONS.sent].sort()).toEqual(["cancelled", "expired", "open", "paid"]);
    expect(DRAFT_TRANSITIONS.paid).toEqual([]);
    expect(isDraftFinal("paid")).toBe(true);
    for (const s of DRAFT_STATUSES.filter((x) => x !== "paid")) expect(isDraftFinal(s), s).toBe(false);
  });

  it("allows every move of the table and no other, and never a move to itself", () => {
    for (const from of DRAFT_STATUSES) {
      for (const to of DRAFT_STATUSES) {
        expect(canMoveDraft(from, to), `${from} to ${to}`).toBe(DRAFT_TRANSITIONS[from].includes(to));
      }
      expect(canMoveDraft(from, from)).toBe(false);
    }
  });

  it("lets a draft whose order was paid late (after it expired or was cancelled) become paid, and reopen otherwise", () => {
    expect(canMoveDraft("expired", "paid")).toBe(true);
    expect(canMoveDraft("cancelled", "paid")).toBe(true);
    expect(canReopenDraft("sent")).toBe(true);
    expect(canReopenDraft("expired")).toBe(true);
    expect(canReopenDraft("cancelled")).toBe(true);
    expect(canReopenDraft("open")).toBe(false);
    expect(canReopenDraft("paid")).toBe(false);
  });

  it("is editable only while open, and deletable unless sent (a sent draft's order waits: reopen first)", () => {
    expect(DRAFT_STATUSES.filter(isDraftEditable)).toEqual(["open"]);
    expect(DRAFT_STATUSES.filter(isDraftDeletable)).toEqual(["open", "paid", "expired", "cancelled"]);
  });

  it("recognises its own statuses only", () => {
    expect(isDraftStatus("sent")).toBe(true);
    expect(isDraftStatus("Sent")).toBe(false);
    expect(isDraftStatus(null)).toBe(false);
  });

  it("follows its order: paid makes a sent (or late) draft paid, a cancelled unpaid order makes a sent draft expired, nothing else moves it", () => {
    expect(draftFollowsOrder("sent", "paid", true)).toBe("paid");
    expect(draftFollowsOrder("expired", "paid", false)).toBe("paid");
    expect(draftFollowsOrder("cancelled", "paid", false)).toBe("paid");
    expect(draftFollowsOrder("sent", "cancelled", true)).toBe("expired");
    // A paid order that is cancelled later (a refund) leaves the draft as it is.
    expect(draftFollowsOrder("paid", "cancelled", false)).toBeNull();
    expect(draftFollowsOrder("sent", "cancelled", false)).toBeNull();
    // An open draft (reopened) is not named by the order any more.
    expect(draftFollowsOrder("open", "paid", true)).toBeNull();
    expect(draftFollowsOrder("open", "cancelled", true)).toBeNull();
    expect(draftFollowsOrder("sent", "fulfilled", false)).toBeNull();
  });

  it("deletes an open draft 90 days after its last edit and a finished one 30 days after it ended", () => {
    const now = new Date("2026-10-06T12:00:00Z");
    const { open, done } = draftPruneCutoffs(now);
    expect(open.toISOString()).toBe("2026-07-08T12:00:00.000Z");
    expect(done.toISOString()).toBe("2026-09-06T12:00:00.000Z");
  });
});
