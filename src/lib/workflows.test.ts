import { describe, expect, it } from "vitest";

import { z } from "zod";

import {
  actionsFor,
  conditionHolds,
  draftWorkflowInputSchema,
  fieldsFor,
  needsPaidFacts,
  PAID_ORDER_FIELDS,
  scheduleDue,
  valuesAt,
  workflowInputSchema,
  workflowMatches,
  workflowProblems,
  type WorkflowInput,
} from "./workflows";

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
    expect(actionsFor("order.paid")).toEqual(["tag_order", "note_order", "tag_customer", "email_staff", "post_slack", "send_request", "ask_ai_manager", "hold_order"]);
    // A hold is a paid order's (E3.3): an order sent or cancelled has nothing to hold.
    expect(actionsFor("order.sent")).not.toContain("hold_order");
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

describe("what an order rule knew, as fields of a paid order (ecosystem plan E3.3, D718)", () => {
  const base: WorkflowInput = { name: "Big orders", trigger: "order.paid", schedule: null, conditions: [], actions: [{ kind: "hold_order", reason: "Check it" }] };
  const paid = { order: { ...order.order, total_main: 1249.5, first_order: true, buyer: "consumer", products: ["p1", "p2"], delivery: "pickup", backordered: false, gift: true, source: "checkout", tags: ["vip"], seller: "store", risk: null } };

  it("offers the facts on order.paid only, beside the payload's fields, and knows when a run must read them", () => {
    const keys = fieldsFor("order.paid").map((f) => f.key);
    for (const f of PAID_ORDER_FIELDS) expect(keys).toContain(f.key);
    expect(keys).toContain("order.total");
    expect(fieldsFor("order.sent").map((f) => f.key)).not.toContain("order.first_order");
    expect(workflowProblems({ ...base, trigger: "order.cancelled", actions: [{ kind: "tag_order", tag: "x" }], conditions: [{ field: "order.gift", op: "is", value: "yes" }] })).toEqual([
      "order.gift is not a field of this trigger.",
    ]);
    expect(needsPaidFacts([{ field: "order.total" }])).toBe(false);
    expect(needsPaidFacts([{ field: "order.total" }, { field: "order.risk" }])).toBe(true);
  });

  it("compares at least and one of a list, and never holds a value the order does not have (a guest's first order, an unread risk)", () => {
    expect(conditionHolds({ field: "order.total_main", op: "at_least", value: "1249.5" }, paid)).toBe(true);
    expect(conditionHolds({ field: "order.total_main", op: "at_least", value: "1249.51" }, paid)).toBe(false);
    expect(conditionHolds({ field: "order.delivery", op: "is_one_of", value: "shipping, Pickup" }, paid)).toBe(true);
    expect(conditionHolds({ field: "order.products", op: "is_one_of", value: "p9,p2" }, paid)).toBe(true);
    expect(conditionHolds({ field: "order.products", op: "is_one_of", value: "p9" }, paid)).toBe(false);
    expect(conditionHolds({ field: "order.gift", op: "is", value: "yes" }, paid)).toBe(true);
    expect(conditionHolds({ field: "order.risk", op: "is_one_of", value: "elevated, highest" }, paid)).toBe(false);
    const guest = { order: { ...paid.order, first_order: null } };
    expect(conditionHolds({ field: "order.first_order", op: "is", value: "yes" }, guest)).toBe(false);
    expect(conditionHolds({ field: "order.first_order", op: "is", value: "no" }, guest)).toBe(false);
  });

  it("holds a field to its choices, a list to at least one value and at least to a number", () => {
    expect(workflowProblems({ ...base, conditions: [{ field: "order.risk", op: "is", value: "high" }] })).toEqual(["order.risk is one of normal, elevated, highest, none."]);
    expect(workflowProblems({ ...base, conditions: [{ field: "order.delivery", op: "is_one_of", value: "shipping, drone" }] })).toHaveLength(1);
    expect(workflowProblems({ ...base, conditions: [{ field: "order.delivery", op: "is_one_of", value: " , " }] })).toEqual(["order.delivery needs at least one value, with commas between."]);
    expect(workflowProblems({ ...base, conditions: [{ field: "order.gift", op: "is", value: "maybe" }] })).toEqual(["order.gift is yes or no."]);
    expect(workflowProblems({ ...base, conditions: [{ field: "order.buyer", op: "at_least", value: "1" }] })).toEqual(["order.buyer is not a number."]);
    expect(workflowProblems({ ...base, conditions: [{ field: "order.tags", op: "contains", value: "vi" }, { field: "order.delivery", op: "is_one_of", value: "local,none" }] })).toEqual([]);
  });

  it("holds an order only after it is paid, with a reason of at most 200 characters", () => {
    expect(workflowProblems(base)).toEqual([]);
    expect(workflowProblems({ ...base, trigger: "order.sent" })).toEqual(["hold_order cannot follow this trigger."]);
    expect(workflowInputSchema.safeParse({ ...base, actions: [{ kind: "hold_order", reason: "" }] }).success).toBe(false);
    expect(workflowInputSchema.safeParse({ ...base, actions: [{ kind: "hold_order", reason: "x".repeat(201) }] }).success).toBe(false);
  });

  it("keeps the AI manager's draft_workflow as it was until its release step: five operators, 200 characters and no hold", () => {
    expect(draftWorkflowInputSchema.safeParse(base).success).toBe(false);
    expect(draftWorkflowInputSchema.safeParse({ ...base, actions: [{ kind: "tag_order", tag: "x" }], conditions: [{ field: "order.total", op: "at_least", value: "1" }] }).success).toBe(false);
    expect(draftWorkflowInputSchema.safeParse({ ...base, actions: [{ kind: "tag_order", tag: "x" }], conditions: [{ field: "order.total", op: "more_than", value: "1" }] }).success).toBe(true);
    const json = JSON.stringify(z.toJSONSchema(draftWorkflowInputSchema));
    expect(json).toContain('"enum":["is","is_not","contains","more_than","less_than"]');
    expect(json).not.toContain("hold_order");
    // The store's own editor takes a rule's list of products.
    expect(workflowInputSchema.safeParse({ ...base, conditions: [{ field: "order.products", op: "is_one_of", value: "x".repeat(1900) }] }).success).toBe(true);
  });
});
