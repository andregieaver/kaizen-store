import { describe, expect, it } from "vitest";

import {
  ACTION_KEYS,
  ACTION_TARGET,
  KIND_KEYS,
  OUTCOME_KEYS,
  RETURN_ACTIONS,
  RETURN_EVENT_TYPES,
  RETURN_OUTCOMES,
  RETURN_STATUSES,
  STATUS_EVENTS,
  STATUS_KEYS,
  TRANSITIONS,
  actionsFor,
  canMove,
  closeWithoutRefundNeedsConfirm,
  isEnded,
  isOpen,
  isReturnKind,
  isReturnStatus,
  nextStatuses,
  startStatus,
  timeline,
  type ActionContext,
} from "./return-status";

const ctx = (over: Partial<ActionContext> = {}): ActionContext => ({ kind: "withdrawal", status: "approved", refunded: false, refundWhen: "received", ...over });

describe("the lifecycle", () => {
  it("goes forward only: no status leads to an earlier one", () => {
    const order = ["requested", "approved", "in_transit", "received", "inspected", "closed"];
    for (const from of order) {
      for (const to of TRANSITIONS[from as keyof typeof TRANSITIONS]) {
        if (order.includes(to)) expect(order.indexOf(to)).toBeGreaterThan(order.indexOf(from));
      }
    }
    expect(TRANSITIONS.closed).toEqual([]);
    expect(TRANSITIONS.declined).toEqual([]);
    expect(TRANSITIONS.cancelled).toEqual([]);
  });

  it("never offers cancelling a withdrawal return either: it is effective on the statement, so it is closed (without a refund) instead", () => {
    for (const from of ["approved", "in_transit", "received"] as const) {
      expect(canMove("withdrawal", from, "cancelled")).toBe(false);
      expect(canMove("withdrawal", from, "closed")).toBe(true);
      expect(canMove("return", from, "cancelled")).toBe(true);
    }
    expect(actionsFor(ctx({ kind: "withdrawal", status: "received" }))).not.toContain("cancel");
    expect(actionsFor(ctx({ kind: "return", status: "received" }))).toContain("cancel");
  });

  it("starts a withdrawal return approved and a voluntary one requested", () => {
    expect(startStatus("withdrawal")).toBe("approved");
    expect(startStatus("return")).toBe("requested");
  });

  it("never offers declining a withdrawal return", () => {
    expect(nextStatuses("return", "requested")).toEqual(["approved", "declined", "cancelled"]);
    expect(nextStatuses("withdrawal", "requested")).toEqual(["approved"]);
    expect(canMove("withdrawal", "requested", "declined")).toBe(false);
    expect(canMove("return", "requested", "declined")).toBe(true);
    expect(canMove("return", "inspected", "received")).toBe(false);
    expect(canMove("return", "approved", "received")).toBe(true);
    expect(canMove("return", "inspected", "closed")).toBe(true);
    expect(canMove("return", "inspected", "cancelled")).toBe(false);
  });

  it("knows what has ended", () => {
    for (const s of ["closed", "declined", "cancelled"] as const) {
      expect(isEnded(s)).toBe(true);
      expect(isOpen(s)).toBe(false);
    }
    expect(isOpen("approved")).toBe(true);
  });

  it("recognises statuses and kinds", () => {
    expect(RETURN_STATUSES.every(isReturnStatus)).toBe(true);
    expect(isReturnStatus("lost")).toBe(false);
    expect(isReturnKind("withdrawal")).toBe(true);
    expect(isReturnKind("exchange")).toBe(false);
  });
});

describe("what staff can do next", () => {
  it("approves or declines a voluntary return that waits, and a withdrawal return has nothing to approve", () => {
    expect(actionsFor(ctx({ kind: "return", status: "requested" }))).toEqual(["approve", "decline", "set_instructions", "cancel"]);
    expect(actionsFor(ctx({ kind: "withdrawal", status: "approved" }))).toEqual(["set_instructions", "mark_in_transit", "mark_received", "close"]);
  });

  it("refunds after the goods are there, or at once when the store does not wait for them, and only once", () => {
    expect(actionsFor(ctx({ status: "received" }))).toContain("refund");
    expect(actionsFor(ctx({ status: "inspected" }))).toContain("refund");
    expect(actionsFor(ctx({ status: "approved" }))).not.toContain("refund");
    expect(actionsFor(ctx({ status: "approved", refundWhen: "request" }))).toContain("refund");
    // Art. 13(3): the hold ends with the goods OR the proof of sending, whichever is first, so the refund is there once they are in transit.
    expect(actionsFor(ctx({ status: "in_transit" }))).toContain("refund");
    expect(actionsFor(ctx({ status: "in_transit", refundWhen: "request" }))).toContain("refund");
    expect(actionsFor(ctx({ status: "received", refunded: true }))).not.toContain("refund");
    expect(actionsFor(ctx({ kind: "return", status: "requested", refundWhen: "request" }))).not.toContain("refund");
  });

  it("refunds a withdrawal made before anything was sent at once: nothing to wait for", () => {
    expect(actionsFor(ctx({ status: "approved", nothingToSendBack: true }))).toContain("refund");
    expect(actionsFor(ctx({ status: "approved", nothingToSendBack: false }))).not.toContain("refund");
    // With the store set to wait for the goods, that still holds only for goods that were sent.
    expect(actionsFor(ctx({ status: "approved", refundWhen: "received", nothingToSendBack: true }))).toContain("refund");
  });

  it("inspects after receipt, and offers closing only where the database accepts it", () => {
    expect(actionsFor(ctx({ kind: "return", status: "received" }))).toEqual(["inspect", "refund", "close", "cancel"]);
    expect(actionsFor(ctx({ status: "received" }))).toEqual(["inspect", "refund", "close"]);
    expect(actionsFor(ctx({ status: "inspected" }))).toEqual(["refund", "close"]);
    expect(actionsFor(ctx({ status: "in_transit" }))).toEqual(["set_instructions", "mark_received", "refund", "close"]);
  });

  it("offers nothing on an ended return, but sending the acknowledgement again when it was not sent", () => {
    for (const status of ["closed", "declined", "cancelled"] as const) expect(actionsFor(ctx({ status }))).toEqual([]);
    expect(actionsFor(ctx({ status: "closed", acknowledgementPending: true }))).toEqual(["send_acknowledgement"]);
    expect(actionsFor(ctx({ status: "approved", acknowledgementPending: true }))).toContain("send_acknowledgement");
    expect(actionsFor(ctx({ kind: "return", status: "approved", acknowledgementPending: true }))).not.toContain("send_acknowledgement");
  });

  it("only offers actions whose target the lifecycle allows", () => {
    for (const kind of ["withdrawal", "return"] as const) {
      for (const status of RETURN_STATUSES) {
        for (const action of actionsFor(ctx({ kind, status, refundWhen: "request" }))) {
          const target = ACTION_TARGET[action];
          if (target) expect([kind, status, action, canMove(kind, status, target)]).toEqual([kind, status, action, true]);
        }
      }
    }
  });

  it("warns about closing a withdrawal return that was not refunded", () => {
    expect(closeWithoutRefundNeedsConfirm("withdrawal", false)).toBe(true);
    expect(closeWithoutRefundNeedsConfirm("withdrawal", true)).toBe(false);
    expect(closeWithoutRefundNeedsConfirm("return", false)).toBe(false);
  });
});

describe("the timeline", () => {
  it("marks the steps done, the one it is at, and what is to come", () => {
    expect(timeline("return", "in_transit").map((s) => [s.step, s.state])).toEqual([
      ["requested", "done"],
      ["approved", "done"],
      ["in_transit", "current"],
      ["received", "upcoming"],
      ["inspected", "upcoming"],
      ["closed", "upcoming"],
    ]);
  });

  it("starts a withdrawal at approved, finishes closed as all done, and skips what a declined or cancelled return never reached", () => {
    expect(timeline("withdrawal", "approved")[0]).toEqual({ step: "approved", state: "current" });
    expect(timeline("withdrawal", "approved")).toHaveLength(5);
    expect(timeline("return", "closed").every((s) => s.state === "done")).toBe(true);
    expect(timeline("return", "declined").map((s) => s.state)).toEqual(["done", "skipped", "skipped", "skipped", "skipped", "skipped"]);
    expect(timeline("withdrawal", "cancelled")[0].state).toBe("done");
  });
});

describe("keys and events", () => {
  it("has a key for every status, kind, outcome and action, and an event for every step", () => {
    expect(Object.keys(STATUS_KEYS)).toEqual([...RETURN_STATUSES]);
    expect(Object.keys(KIND_KEYS)).toEqual(["withdrawal", "return"]);
    expect(Object.keys(OUTCOME_KEYS)).toEqual([...RETURN_OUTCOMES]);
    expect(Object.keys(ACTION_KEYS)).toEqual([...RETURN_ACTIONS]);
    expect(Object.keys(ACTION_TARGET)).toEqual([...RETURN_ACTIONS]);
    for (const event of Object.values(STATUS_EVENTS)) expect(RETURN_EVENT_TYPES).toContain(event);
    expect(new Set(RETURN_EVENT_TYPES).size).toBe(RETURN_EVENT_TYPES.length);
    expect(RETURN_EVENT_TYPES).toContain("return.refund_overridden");
  });
});
