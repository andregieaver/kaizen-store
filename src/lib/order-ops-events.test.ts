import { describe, expect, it } from "vitest";

import { UNARCHIVE_RETURN_NOTE } from "./order-archive";
import { COPIED_ORDER_EVENTS, ORDER_AUDIT_ACTIONS, ORDER_AUDIT_ALL, ORDER_OPS_EVENTS, ORDER_OPS_EVENT_LABELS, allInOrdersArea } from "./order-ops-events";

describe("the events and audit actions of the order operations", () => {
  it("are the names of the spec, all under the order. prefix", () => {
    expect(Object.values(ORDER_OPS_EVENTS)).toEqual(["order.tags_changed", "order.archived", "order.unarchived", "order.paid_outside", "order.refunded_outside"]);
    for (const e of Object.values(ORDER_OPS_EVENTS)) expect(e.startsWith("order."), e).toBe(true);
    expect(UNARCHIVE_RETURN_NOTE).toBe("A return was started");
  });

  it("let a copied order take tagging and archiving and no payment event", () => {
    expect([...COPIED_ORDER_EVENTS]).toEqual(["order.tags_changed", "order.archived", "order.unarchived"]);
    expect(COPIED_ORDER_EVENTS).not.toContain(ORDER_OPS_EVENTS.paidOutside);
    expect(COPIED_ORDER_EVENTS).not.toContain(ORDER_OPS_EVENTS.refundedOutside);
  });

  it("have a label each", () => {
    for (const event of Object.values(ORDER_OPS_EVENTS)) expect(ORDER_OPS_EVENT_LABELS[event].length, event).toBeGreaterThan(5);
  });

  it("name audit actions that all belong to the orders area of the activity log, once each", () => {
    expect(allInOrdersArea()).toBe(true);
    expect(new Set(ORDER_AUDIT_ALL).size).toBe(ORDER_AUDIT_ALL.length);
    expect(ORDER_AUDIT_ACTIONS.bulkSent).toBe("order.bulk_sent");
    expect(ORDER_AUDIT_ACTIONS.draftPaidOutside).toBe("order.draft_paid_outside");
  });
});
