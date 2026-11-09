import { describe, expect, it } from "vitest";

import { PLATFORM_EVENTS } from "./platform-integrations";
import { isPlatformWorkflowTrigger, PLATFORM_WORKFLOWS, platformActionsFor, platformSubjectOf, platformWorkflowInputSchema } from "./platform-workflows";
import { STORE_WORKFLOWS, workflowInputSchema, workflowMatches, workflowProblems } from "./workflows";

const input = (over: Record<string, unknown> = {}) => ({
  name: "Big plans",
  trigger: "plan.started",
  schedule: null,
  conditions: [{ field: "plan.amount", op: "more_than" as const, value: "500" }],
  actions: [{ kind: "post_slack" as const, text: "A big plan started." }],
  ...over,
});

describe("workflows on the platform's events (D516)", () => {
  it("take every platform event and a schedule, and none of a store's", () => {
    for (const event of PLATFORM_EVENTS) expect(isPlatformWorkflowTrigger(event)).toBe(true);
    expect(isPlatformWorkflowTrigger("schedule")).toBe(true);
    expect(isPlatformWorkflowTrigger("order.paid")).toBe(false);
    expect(platformWorkflowInputSchema.safeParse(input()).success).toBe(true);
    expect(platformWorkflowInputSchema.safeParse(input({ trigger: "order.paid" })).success).toBe(false);
    // The store's schema is as it was: its own events, not the platform's.
    expect(workflowInputSchema.safeParse(input({ trigger: "order.paid", conditions: [] })).success).toBe(true);
    expect(workflowInputSchema.safeParse(input()).success).toBe(false);
  });

  it("test the payload's fields of the event, and take only the platform's actions", () => {
    expect(platformSubjectOf("request.received")).toBe("request");
    expect(platformSubjectOf("plan.cancelled")).toBe("plan");
    expect(platformSubjectOf("store.opened")).toBe("store");
    expect(workflowProblems(input(), PLATFORM_WORKFLOWS)).toEqual([]);
    expect(workflowProblems(input({ conditions: [{ field: "order.total", op: "is", value: "1" }] }), PLATFORM_WORKFLOWS)).toEqual(["order.total is not a field of this trigger."]);
    expect(workflowProblems(input({ conditions: [{ field: "store.country", op: "more_than", value: "1" }] }), PLATFORM_WORKFLOWS)).toEqual(["store.country is not a number."]);
    expect(workflowProblems(input({ actions: [{ kind: "tag_order", tag: "x" }] }), PLATFORM_WORKFLOWS)).toEqual(["tag_order cannot follow this trigger."]);
    expect(platformActionsFor("schedule")).toEqual(["email_staff", "post_slack"]);
    expect(platformActionsFor("store.created")).toEqual(["email_staff", "post_slack", "send_request"]);
    // The store's kit is the default, as before.
    expect(workflowProblems(input({ trigger: "order.paid", conditions: [{ field: "order.total", op: "more_than", value: "1" }] }))).toEqual([]);
    expect(STORE_WORKFLOWS.actionsFor("plan.started")).toEqual([]);
  });

  it("match a condition against the payload as the endpoints get it", () => {
    const payload = { event: "plan.started", store: { country: "NO", slug: "kroken" }, plan: { name: "Grow", amount: 790, currency: "NOK", interval: "month" } };
    expect(workflowMatches(input().conditions, payload)).toBe(true);
    expect(workflowMatches([{ field: "plan.amount", op: "more_than", value: "1000" }], payload)).toBe(false);
    expect(workflowMatches([{ field: "store.country", op: "is", value: "no" }], payload)).toBe(true);
  });
});
