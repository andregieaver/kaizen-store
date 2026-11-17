import type { AutomationKind } from "./automation-kinds";
import type { StaffAlertEvent } from "./staff-alerts";

/**
 * Everything in a store that runs by itself, in one place (ecosystem plan E3.3, D718): the facts the overview page reads
 * (`automaticOverview()` in `src/server/automatic.ts`) and, pure here, what is active and what happens, in order, when an order is paid.
 * An owner used to need seven screens to answer *what happens when an order is paid?*; the page answers it in one list, each line leading to
 * where it is changed.
 */

export type AutomaticOverview = {
  /** The online shop is on (D178): orders, rules, staff alerts for orders, cart reminders. */
  shop: boolean;
  workflows: { id: string; name: string; trigger: string; enabled: boolean; schedule: { every: "day" | "week"; at: string } | null; conditions: number; actions: string[]; lastRunAt: string | null; runsLastDay: number }[];
  /** Order rules not moved to workflows yet, in their order. */
  rules: { id: string; name: string; enabled: boolean; lastRunAt: string | null; conditions: number; actions: string[] }[];
  emailAutomations: { kind: AutomationKind; enabled: boolean; lastSentAt: string | null }[];
  cartReminders: { enabled: boolean; activeSteps: number; lastSentAt: string | null };
  /** Null while product reviews are off. */
  reviewRequests: { enabled: boolean; days: number; lastSentAt: string | null } | null;
  /** Each staff email with how many get it now (the defaults while the page was never saved) and when one last went (30 days). */
  staffAlerts: { event: StaffAlertEvent; recipients: number; lastSentAt: string | null }[];
  summary: "off" | "daily" | "weekly";
  push: { devices: number; lastSentAt: string | null };
  endpoints: { id: string; name: string; enabled: boolean; topics: string[]; lastAt: string | null; failing: boolean }[];
  integrations: { provider: "zapier" | "make" | "slack"; enabled: boolean; events: string[]; lastAt: string | null }[];
  /** Null when the autopilot was never set up; `reacts` is its reacting to events (D331), off while paused. */
  autopilot: { reacts: boolean; paused: boolean; lastAt: string | null } | null;
  /** When the order confirmation last went to a customer (30 days). */
  confirmationLastAt: string | null;
};

/** One thing that happens when an order is paid, in the order it happens; `soon` is within the minute after (the jobs), else at once. */
export type PaidStep =
  | { kind: "confirmation"; lastAt: string | null; soon: false }
  | { kind: "workflow"; id: string; name: string; lastAt: string | null; soon: true }
  | { kind: "rule"; id: string; name: string; lastAt: string | null; soon: true }
  | { kind: "staff_email"; recipients: number; lastAt: string | null; soon: true }
  | { kind: "push"; devices: number; lastAt: string | null; soon: true }
  | { kind: "endpoint"; id: string; name: string; lastAt: string | null; soon: true }
  | { kind: "integration"; provider: "zapier" | "make" | "slack"; lastAt: string | null; soon: true };

/**
 * What happens when an order is paid, in order (as `src/app/api/cron/integrations/route.ts` and the payment's own `after()` do it): the
 * customer's order confirmation at once; within the minute the workflows, then the rules not moved yet (each in its order), then the new-order
 * email to staff and the staff's devices; and with them the order sent to the owner's endpoints and services that asked for it. Nothing for a
 * store whose shop is off. A staff email nobody gets is a step all the same (`recipients` 0), so the owner sees that nobody is told.
 */
export function whenPaidSteps(o: AutomaticOverview): PaidStep[] {
  if (!o.shop) return [];
  const paid = "order.paid";
  const newOrder = o.staffAlerts.find((a) => a.event === "new_order");
  return [
    { kind: "confirmation", lastAt: o.confirmationLastAt, soon: false },
    ...o.workflows.filter((w) => w.enabled && w.trigger === paid).map((w) => ({ kind: "workflow" as const, id: w.id, name: w.name, lastAt: w.lastRunAt, soon: true as const })),
    ...o.rules.filter((r) => r.enabled).map((r) => ({ kind: "rule" as const, id: r.id, name: r.name, lastAt: r.lastRunAt, soon: true as const })),
    { kind: "staff_email", recipients: newOrder?.recipients ?? 0, lastAt: newOrder?.lastSentAt ?? null, soon: true },
    ...(o.push.devices > 0 ? [{ kind: "push" as const, devices: o.push.devices, lastAt: o.push.lastSentAt, soon: true as const }] : []),
    ...o.endpoints.filter((e) => e.enabled && e.topics.includes(paid)).map((e) => ({ kind: "endpoint" as const, id: e.id, name: e.name, lastAt: e.lastAt, soon: true as const })),
    ...o.integrations.filter((i) => i.enabled && i.events.includes(paid)).map((i) => ({ kind: "integration" as const, provider: i.provider, lastAt: i.lastAt, soon: true as const })),
  ];
}

/** One thing that runs by itself now, for the plain list: what it is, its name where it has one, and when it last did something. */
export type ActiveLine =
  | { kind: "workflow"; id: string; name: string; trigger: string; schedule: { every: "day" | "week"; at: string } | null; lastAt: string | null }
  | { kind: "rule"; id: string; name: string; lastAt: string | null }
  | { kind: "email_automation"; automation: AutomationKind; lastAt: string | null }
  | { kind: "cart_reminders"; steps: number; lastAt: string | null }
  | { kind: "review_requests"; days: number; lastAt: string | null }
  | { kind: "staff_alert"; event: StaffAlertEvent; recipients: number; lastAt: string | null }
  | { kind: "push"; devices: number; lastAt: string | null }
  | { kind: "endpoint"; id: string; name: string; topics: number; failing: boolean; lastAt: string | null }
  | { kind: "integration"; provider: "zapier" | "make" | "slack"; events: number; lastAt: string | null }
  | { kind: "autopilot"; lastAt: string | null };

/**
 * Everything switched on that runs by itself: workflows and rules that are on, email automations on, cart reminders on with a step to send,
 * review requests on, each staff email someone gets (the briefing only while it is daily or weekly), devices that get notifications, endpoints
 * and services on, and the autopilot while it reacts and is not paused. What is off is left to the details.
 */
export function activeLines(o: AutomaticOverview): ActiveLine[] {
  const lines: ActiveLine[] = [];
  for (const w of o.workflows) if (w.enabled) lines.push({ kind: "workflow", id: w.id, name: w.name, trigger: w.trigger, schedule: w.schedule, lastAt: w.lastRunAt });
  if (o.shop) for (const r of o.rules) if (r.enabled) lines.push({ kind: "rule", id: r.id, name: r.name, lastAt: r.lastRunAt });
  for (const a of o.emailAutomations) if (a.enabled) lines.push({ kind: "email_automation", automation: a.kind, lastAt: a.lastSentAt });
  if (o.shop && o.cartReminders.enabled && o.cartReminders.activeSteps > 0) lines.push({ kind: "cart_reminders", steps: o.cartReminders.activeSteps, lastAt: o.cartReminders.lastSentAt });
  if (o.reviewRequests?.enabled) lines.push({ kind: "review_requests", days: o.reviewRequests.days, lastAt: o.reviewRequests.lastSentAt });
  for (const a of o.staffAlerts) {
    if (a.recipients === 0 || (a.event === "summary" && o.summary === "off")) continue;
    lines.push({ kind: "staff_alert", event: a.event, recipients: a.recipients, lastAt: a.lastSentAt });
  }
  if (o.push.devices > 0) lines.push({ kind: "push", devices: o.push.devices, lastAt: o.push.lastSentAt });
  for (const e of o.endpoints) if (e.enabled) lines.push({ kind: "endpoint", id: e.id, name: e.name, topics: e.topics.length, failing: e.failing, lastAt: e.lastAt });
  for (const i of o.integrations) if (i.enabled) lines.push({ kind: "integration", provider: i.provider, events: i.events.length, lastAt: i.lastAt });
  if (o.autopilot?.reacts && !o.autopilot.paused) lines.push({ kind: "autopilot", lastAt: o.autopilot.lastAt });
  return lines;
}

/** Where each line is changed: a page of the store's (`base` is `/admin/{store}`), or the person's own account for their devices. */
export function lineHref(line: ActiveLine | PaidStep, base: string): string {
  switch (line.kind) {
    case "confirmation":
      return `${base}/settings/notifications/order.confirmation`;
    case "workflow":
      return `${base}/settings/workflows`;
    case "rule":
      return `${base}/settings/automation/${line.id}`;
    case "email_automation":
      // Back in stock has no page of its own: it is switched on the list.
      return line.automation === "back_in_stock" ? `${base}/automations` : `${base}/automations/${line.automation}`;
    case "cart_reminders":
      return `${base}/cart-reminders`;
    case "review_requests":
      return `${base}/reviews`;
    case "staff_alert":
    case "staff_email":
      return `${base}/settings/notifications/staff`;
    case "push":
      // The devices are each person's own, on their account.
      return "/admin/account";
    case "endpoint":
      return `${base}/integrations/endpoints`;
    case "integration":
      return `${base}/integrations/${line.provider}`;
    case "autopilot":
      return `${base}/assistant/autopilot`;
  }
}
