import { describe, expect, it } from "vitest";

import { activeLines, lineHref, whenPaidSteps, type AutomaticOverview } from "./automatic";

/** Everything that runs by itself (ecosystem plan E3.3, D718), pure: what happens when an order is paid, in order, and what is on. */

const empty: AutomaticOverview = {
  shop: true,
  workflows: [],
  rules: [],
  emailAutomations: [],
  cartReminders: { enabled: false, activeSteps: 0, lastSentAt: null },
  reviewRequests: null,
  staffAlerts: [],
  summary: "off",
  push: { devices: 0, lastSentAt: null },
  endpoints: [],
  integrations: [],
  autopilot: null,
  confirmationLastAt: null,
};

const flow = (id: string, trigger: string, enabled = true) => ({ id, name: `Flow ${id}`, trigger, enabled, schedule: null, conditions: 0, actions: ["tag_order"], lastRunAt: null, runsLastDay: 0 });

const busy: AutomaticOverview = {
  ...empty,
  workflows: [flow("a", "order.paid"), flow("b", "order.sent"), flow("c", "order.paid", false)],
  rules: [
    { id: "r1", name: "Sweden", enabled: true, lastRunAt: "2026-11-16T10:00:00.000Z", conditions: 1, actions: ["tag"] },
    { id: "r2", name: "Off", enabled: false, lastRunAt: null, conditions: 0, actions: ["hold"] },
  ],
  emailAutomations: [
    { kind: "welcome", enabled: true, lastSentAt: null },
    { kind: "win_back", enabled: false, lastSentAt: null },
  ],
  cartReminders: { enabled: true, activeSteps: 2, lastSentAt: null },
  reviewRequests: { enabled: true, days: 14, lastSentAt: null },
  staffAlerts: [
    { event: "new_order", recipients: 2, lastSentAt: "2026-11-17T09:00:00.000Z" },
    { event: "summary", recipients: 1, lastSentAt: null },
    { event: "low_stock", recipients: 0, lastSentAt: null },
  ],
  push: { devices: 3, lastSentAt: null },
  endpoints: [
    { id: "e1", name: "ERP", enabled: true, topics: ["order.paid", "order.sent"], lastAt: null, failing: false },
    { id: "e2", name: "Old", enabled: false, topics: ["order.paid"], lastAt: null, failing: false },
    { id: "e3", name: "Stock", enabled: true, topics: ["stock.low"], lastAt: null, failing: true },
  ],
  integrations: [
    { provider: "slack", enabled: true, events: ["order.paid"], lastAt: null },
    { provider: "zapier", enabled: true, events: ["customer.created"], lastAt: null },
  ],
  autopilot: { reacts: true, paused: false, lastAt: null },
};

describe("when an order is paid", () => {
  it("lists in order: the confirmation, the workflows on it, the rules not moved, the staff's email and devices, endpoints and services", () => {
    expect(whenPaidSteps(busy).map((s) => ("name" in s ? `${s.kind}:${s.name}` : "provider" in s ? `${s.kind}:${s.provider}` : s.kind))).toEqual([
      "confirmation",
      "workflow:Flow a",
      "rule:Sweden",
      "staff_email",
      "push",
      "endpoint:ERP",
      "integration:slack",
    ]);
    expect(whenPaidSteps(busy).find((s) => s.kind === "staff_email")).toMatchObject({ recipients: 2, lastAt: "2026-11-17T09:00:00.000Z" });
    expect(whenPaidSteps(busy)[0].soon).toBe(false);
  });

  it("says nobody is told rather than leaving the staff's email out, and has nothing for a store without the shop", () => {
    expect(whenPaidSteps(empty)).toEqual([
      { kind: "confirmation", lastAt: null, soon: false },
      { kind: "staff_email", recipients: 0, lastAt: null, soon: true },
    ]);
    expect(whenPaidSteps({ ...busy, shop: false })).toEqual([]);
  });
});

describe("what runs by itself", () => {
  it("lists what is on, and leaves out what is off, a staff email nobody gets and the briefing while it is off", () => {
    const kinds = activeLines(busy).map((l) => l.kind);
    expect(kinds).toEqual(["workflow", "workflow", "rule", "email_automation", "cart_reminders", "review_requests", "staff_alert", "push", "endpoint", "endpoint", "integration", "integration", "autopilot"]);
    expect(activeLines(busy).filter((l) => l.kind === "staff_alert").map((l) => l.kind === "staff_alert" && l.event)).toEqual(["new_order"]);
    expect(activeLines({ ...busy, summary: "daily" }).filter((l) => l.kind === "staff_alert")).toHaveLength(2);
    expect(activeLines({ ...busy, autopilot: { reacts: true, paused: true, lastAt: null } }).map((l) => l.kind)).not.toContain("autopilot");
    expect(activeLines(empty)).toEqual([]);
  });

  it("links each line to where it is changed", () => {
    const base = "/admin/kaffe";
    const hrefs = activeLines(busy).map((l) => lineHref(l, base));
    expect(hrefs).toContain("/admin/kaffe/settings/workflows");
    expect(hrefs).toContain("/admin/kaffe/settings/automation/r1");
    expect(hrefs).toContain("/admin/kaffe/automations/welcome");
    expect(hrefs).toContain("/admin/kaffe/integrations/slack");
    expect(hrefs).toContain("/admin/account");
    expect(lineHref(whenPaidSteps(busy)[0], base)).toBe("/admin/kaffe/settings/notifications/order.confirmation");
    expect(lineHref({ kind: "email_automation", automation: "back_in_stock", lastAt: null }, base)).toBe("/admin/kaffe/automations");
  });
});
