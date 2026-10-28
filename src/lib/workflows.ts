import { z } from "zod";

import { EVENTS, type IntegrationEvent } from "./integrations";

/**
 * Workflows (wave 9 unit C, D356, `docs/wave-9-platform.md` section 3, C): the pure parts. A workflow is a trigger (one of the store's events,
 * as unit A's endpoints get them, or a schedule), conditions on the event's fields (all must hold, from a closed list per trigger) and up to
 * `ACTIONS_MAX` actions from a closed list. Saved off; switched on only after a test of the version saved; run once per event, at most
 * `RUNS_PER_HOUR` runs an hour each. Nothing here reads the database.
 */

export const WORKFLOWS_MAX = 50;
export const CONDITIONS_MAX = 10;
export const ACTIONS_MAX = 10;
export const RUNS_PER_HOUR = 100;

export type WorkflowTrigger = IntegrationEvent | "schedule";
export const WORKFLOW_TRIGGERS: readonly WorkflowTrigger[] = [...EVENTS.map((e) => e.id), "schedule"];
export const isWorkflowTrigger = (value: string): value is WorkflowTrigger => (WORKFLOW_TRIGGERS as readonly string[]).includes(value);

/** What an event is about, by its trigger: the key its data is under (`order`, `product`, …). */
export function subjectOf(trigger: WorkflowTrigger): "order" | "customer" | "subscription" | "return" | "withdrawal" | "product" | "stock" | "discount" | "support" | "schedule" {
  if (trigger === "schedule") return "schedule";
  if (trigger.startsWith("order.")) return "order";
  if (trigger.startsWith("subscription.")) return "subscription";
  if (trigger.startsWith("product.")) return "product";
  if (trigger === "customer.created") return "customer";
  if (trigger === "return.requested") return "return";
  if (trigger === "withdrawal.received") return "withdrawal";
  if (trigger === "stock.low") return "stock";
  if (trigger === "discount.created") return "discount";
  return "support";
}

export type FieldKind = "text" | "number" | "yes_no";
export type WorkflowField = { key: string; kind: FieldKind };

/** The fields a condition may test, by what the event is about: paths into the event's data as its payload carries it (amounts in the currency's units). */
export const WORKFLOW_FIELDS: Record<ReturnType<typeof subjectOf>, WorkflowField[]> = {
  order: [
    { key: "order.total", kind: "number" },
    { key: "order.currency", kind: "text" },
    { key: "order.market", kind: "text" },
    { key: "order.status", kind: "text" },
    { key: "order.discount_code", kind: "text" },
    { key: "order.lines.sku", kind: "text" },
    { key: "order.lines.quantity", kind: "number" },
    { key: "order.shipping_address.country", kind: "text" },
    { key: "order.vat_kind", kind: "text" },
  ],
  customer: [
    { key: "customer.email", kind: "text" },
    { key: "customer.email_confirmed", kind: "yes_no" },
  ],
  subscription: [
    { key: "subscription.status", kind: "text" },
    { key: "subscription.currency", kind: "text" },
    { key: "subscription.total_per_renewal", kind: "number" },
  ],
  return: [
    { key: "return.kind", kind: "text" },
    { key: "return.withdrawal", kind: "yes_no" },
    { key: "return.lines.sku", kind: "text" },
  ],
  withdrawal: [{ key: "withdrawal.channel", kind: "text" }],
  product: [
    { key: "product.status", kind: "text" },
    { key: "product.kind", kind: "text" },
    { key: "product.handle", kind: "text" },
  ],
  stock: [
    { key: "stock.sku", kind: "text" },
    { key: "stock.available", kind: "number" },
  ],
  discount: [
    { key: "discount.kind", kind: "text" },
    { key: "discount.percent", kind: "number" },
    { key: "discount.code", kind: "text" },
  ],
  support: [{ key: "support.waiting", kind: "number" }],
  schedule: [],
};

export const fieldsFor = (trigger: WorkflowTrigger) => WORKFLOW_FIELDS[subjectOf(trigger)];

export const OPERATORS = ["is", "is_not", "contains", "more_than", "less_than"] as const;
export type Operator = (typeof OPERATORS)[number];

export type WorkflowCondition = { field: string; op: Operator; value: string };

export const ACTION_KINDS = ["tag_order", "note_order", "tag_customer", "email_staff", "post_slack", "send_request", "ask_ai_manager"] as const;
export type WorkflowActionKind = (typeof ACTION_KINDS)[number];

export type WorkflowAction =
  | { kind: "tag_order"; tag: string }
  | { kind: "note_order"; text: string }
  | { kind: "tag_customer"; tag: string }
  | { kind: "email_staff"; subject: string; text: string }
  | { kind: "post_slack"; text: string }
  | { kind: "send_request"; endpointId: string }
  | { kind: "ask_ai_manager"; question: string };

/** The actions a trigger may take: a tag needs an order or a customer, a request needs an event an endpoint can be sent, asking needs an order. */
export function actionsFor(trigger: WorkflowTrigger): WorkflowActionKind[] {
  const subject = subjectOf(trigger);
  return ACTION_KINDS.filter((kind) => {
    if (kind === "tag_order" || kind === "note_order" || kind === "ask_ai_manager") return subject === "order";
    if (kind === "tag_customer") return subject === "order" || subject === "customer" || subject === "subscription";
    if (kind === "send_request") return subject !== "schedule";
    return true;
  });
}

export type WorkflowSchedule = { every: "day" | "week"; at: string; weekday: number | null };

export type WorkflowInput = {
  name: string;
  trigger: WorkflowTrigger;
  schedule: WorkflowSchedule | null;
  conditions: WorkflowCondition[];
  actions: WorkflowAction[];
};

const tag = z.string().trim().min(1).max(40);
const text = (max: number) => z.string().trim().min(1).max(max);

export const workflowActionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("tag_order"), tag }),
  z.object({ kind: z.literal("note_order"), text: text(1000) }),
  z.object({ kind: z.literal("tag_customer"), tag }),
  z.object({ kind: z.literal("email_staff"), subject: text(120), text: text(2000) }),
  z.object({ kind: z.literal("post_slack"), text: text(2000) }),
  z.object({ kind: z.literal("send_request"), endpointId: z.uuid() }),
  z.object({ kind: z.literal("ask_ai_manager"), question: text(400) }),
]);

export const workflowInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  trigger: z.string().refine(isWorkflowTrigger, "Choose what starts the workflow."),
  schedule: z
    .object({
      every: z.enum(["day", "week"]),
      at: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "A time is HH:MM."),
      weekday: z.int().min(1).max(7).nullable().default(null),
    })
    .nullable()
    .default(null),
  conditions: z.array(z.object({ field: z.string(), op: z.enum(OPERATORS), value: z.string().trim().max(200) })).max(CONDITIONS_MAX).default([]),
  actions: z.array(workflowActionSchema).min(1, "Add at least one action.").max(ACTIONS_MAX),
});

/** What is wrong with a workflow beyond its shape: a field the trigger does not have, an action it cannot take, a schedule where none belongs. */
export function workflowProblems(input: WorkflowInput): string[] {
  const problems: string[] = [];
  const fields = new Map(fieldsFor(input.trigger).map((f) => [f.key, f]));
  if (input.trigger === "schedule") {
    if (!input.schedule) problems.push("A schedule needs its time.");
    else if (input.schedule.every === "week" && input.schedule.weekday === null) problems.push("A weekly schedule needs its day.");
    if (input.conditions.length > 0) problems.push("A schedule has no conditions.");
  } else if (input.schedule) problems.push("Only a schedule has a time.");
  for (const c of input.conditions) {
    const field = fields.get(c.field);
    if (!field) problems.push(`${c.field} is not a field of this trigger.`);
    else if ((c.op === "more_than" || c.op === "less_than") && field.kind !== "number") problems.push(`${c.field} is not a number.`);
    else if (field.kind === "number" && c.op !== "is" && c.op !== "is_not" && Number.isNaN(Number(c.value))) problems.push(`${c.field} compares with a number.`);
    else if (field.kind === "yes_no" && !["yes", "no"].includes(c.value)) problems.push(`${c.field} is yes or no.`);
  }
  const allowed = new Set(actionsFor(input.trigger));
  for (const a of input.actions) if (!allowed.has(a.kind)) problems.push(`${a.kind} cannot follow this trigger.`);
  return [...new Set(problems)];
}

/** Every value at a path into the data: arrays are walked, so `order.lines.sku` gives each line's SKU. */
export function valuesAt(data: unknown, path: string): unknown[] {
  let current: unknown[] = [data];
  for (const key of path.split(".")) {
    current = current.flatMap((value) => {
      if (Array.isArray(value)) return value.map((item) => (item && typeof item === "object" ? (item as Record<string, unknown>)[key] : undefined));
      return value && typeof value === "object" ? [(value as Record<string, unknown>)[key]] : [];
    });
  }
  return current.flatMap((value) => (Array.isArray(value) ? value : [value])).filter((value) => value !== undefined && value !== null);
}

/** Whether a condition holds: any value at the field passes (`is_not`: none equals). Text compares without case. */
export function conditionHolds(condition: WorkflowCondition, data: unknown): boolean {
  const values = valuesAt(data, condition.field);
  const wanted = condition.value.trim().toLowerCase();
  const asText = (value: unknown) => (typeof value === "boolean" ? (value ? "yes" : "no") : String(value).toLowerCase());
  switch (condition.op) {
    case "is":
      return values.some((v) => asText(v) === wanted || (typeof v === "number" && v === Number(wanted)));
    case "is_not":
      return !values.some((v) => asText(v) === wanted || (typeof v === "number" && v === Number(wanted)));
    case "contains":
      return values.some((v) => asText(v).includes(wanted));
    case "more_than":
      return values.some((v) => typeof v === "number" && v > Number(wanted));
    case "less_than":
      return values.some((v) => typeof v === "number" && v < Number(wanted));
  }
}

/** Whether every condition holds (none: always). */
export const workflowMatches = (conditions: WorkflowCondition[], data: unknown) => conditions.every((c) => conditionHolds(c, data));

/**
 * When a schedule is due on a day in the store's time zone: the key that makes it once (`schedule:2026-10-28`), or null when it is not due
 * yet that day or not on its weekday. `local` is the store's wall clock now (`YYYY-MM-DD`, `HH:MM`, ISO weekday 1 to 7).
 */
export function scheduleDue(schedule: WorkflowSchedule, local: { date: string; time: string; weekday: number }): string | null {
  if (schedule.every === "week" && schedule.weekday !== local.weekday) return null;
  return local.time >= schedule.at ? `schedule:${local.date}` : null;
}
