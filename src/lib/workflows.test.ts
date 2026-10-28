import { describe, expect, it } from "vitest";

import { actionsFor, conditionHolds, scheduleDue, valuesAt, workflowInputSchema, workflowMatches, workflowProblems, type WorkflowInput } from "./workflows";

/** Workflows (D356): fields, conditions, actions by trigger and schedules, pure. */
const order = { order: { number: "1001", total: 1249.5, currency: "NOK", market: "NO", lines: [{ sku: "MUG", quantity: 2 }, { sku: "TOTE", quantity: 1 }], shipping_address: { country: "NO" } } };

describe("conditions", () => {
  it("walks arrays, so a line's SKU is any line's", () => {
    expect(valuesAt(order, "order.lines.sku")).toEqual(["MUG", "TOTE"]);
    expect(conditionHolds({ field: "order.lines.sku", op: "is", value: "tote" }, order)).toBe(true);
    expect(conditionHolds({ field: "order.lines.sku", op: "is_not", value: "MUG" }, order)).toBe(false);
    expect(conditionHolds({ field: "order.lines.sku", op: "contains", value: "MU" }, order)).toBe(true);
  });

  it("compares numbers as numbers", () => {
    expect(conditionHolds({ field: "order.total", op: "more_than", value: "1000" }, order)).toBe(true);
    expect(conditionHolds({ field: "order.total", op: "less_than", value: "1000" }, order)).toBe(false);
    expect(conditionHolds({ field: "order.total", op: "is", value: "1249.5" }, order)).toBe(true);
    expect(conditionHolds({ field: "order.lines.quantity", op: "more_than", value: "1" }, order)).toBe(true);
  });

  it("needs every condition, and none means always", () => {
    expect(workflowMatches([], order)).toBe(true);
    expect(workflowMatches([{ field: "order.currency", op: "is", value: "nok" }, { field: "order.total", op: "more_than", value: "2000" }], order)).toBe(false);
    expect(conditionHolds({ field: "order.missing", op: "is", value: "x" }, order)).toBe(false);
  });
});

describe("what a workflow may hold", () => {
  const base: WorkflowInput = { name: "Big orders", trigger: "order.paid", schedule: null, conditions: [], actions: [{ kind: "tag_order", tag: "big" }] };

  it("takes only actions the trigger allows", () => {
    expect(actionsFor("order.paid")).toEqual(["tag_order", "note_order", "tag_customer", "email_staff", "post_slack", "send_request", "ask_ai_manager"]);
    expect(actionsFor("product.updated")).toEqual(["email_staff", "post_slack", "send_request"]);
    expect(actionsFor("schedule")).toEqual(["email_staff", "post_slack"]);
    expect(workflowProblems({ ...base, trigger: "stock.low" })).toContain("tag_order cannot follow this trigger.");
  });

  it("refuses a field the trigger lacks, a number compared with words and a schedule without its time", () => {
    expect(workflowProblems({ ...base, conditions: [{ field: "product.status", op: "is", value: "active" }] })).toHaveLength(1);
    expect(workflowProblems({ ...base, conditions: [{ field: "order.currency", op: "more_than", value: "5" }] })).toEqual(["order.currency is not a number."]);
    expect(workflowProblems({ ...base, trigger: "schedule", actions: [{ kind: "email_staff", subject: "s", text: "t" }] })).toEqual(["A schedule needs its time."]);
    expect(workflowProblems({ ...base, trigger: "schedule", schedule: { every: "week", at: "08:00", weekday: null }, actions: [{ kind: "email_staff", subject: "s", text: "t" }] })).toEqual(["A weekly schedule needs its day."]);
    expect(workflowProblems(base)).toEqual([]);
  });

  it("keeps the shape: at most ten actions, at least one, a time as HH:MM", () => {
    expect(workflowInputSchema.safeParse({ ...base, actions: [] }).success).toBe(false);
    expect(workflowInputSchema.safeParse({ ...base, actions: Array(11).fill({ kind: "tag_order", tag: "x" }) }).success).toBe(false);
    expect(workflowInputSchema.safeParse({ ...base, trigger: "order.exploded" }).success).toBe(false);
    expect(workflowInputSchema.safeParse({ ...base, trigger: "schedule", schedule: { every: "day", at: "8am" } }).success).toBe(false);
  });
});

describe("schedules", () => {
  it("is due once its time has come that day, on its weekday for a week", () => {
    expect(scheduleDue({ every: "day", at: "08:00", weekday: null }, { date: "2026-10-28", time: "07:59", weekday: 3 })).toBeNull();
    expect(scheduleDue({ every: "day", at: "08:00", weekday: null }, { date: "2026-10-28", time: "08:00", weekday: 3 })).toBe("schedule:2026-10-28");
    expect(scheduleDue({ every: "week", at: "08:00", weekday: 1 }, { date: "2026-10-28", time: "09:00", weekday: 3 })).toBeNull();
    expect(scheduleDue({ every: "week", at: "08:00", weekday: 3 }, { date: "2026-10-28", time: "09:00", weekday: 3 })).toBe("schedule:2026-10-28");
  });
});
