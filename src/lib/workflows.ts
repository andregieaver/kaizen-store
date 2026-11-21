import { ACTIVITY_KINDS } from "./activities";
import { EVENTS, type IntegrationEvent } from "./integrations";
import { LEAD_KINDS } from "./leads";

/**
 * Workflows (wave 9 unit C, D356, `docs/wave-9-platform.md` section 3, C): the pure parts. A workflow is a trigger (one of the store's events,
 * as unit A's endpoints get them, or a schedule), conditions on the event's fields (all must hold, from a closed list per trigger) and up to
 * `ACTIONS_MAX` actions from a closed list. Saved off; switched on only after a test of the version saved; run once per event, at most
 * `RUNS_PER_HOUR` runs an hour each. Nothing here reads the database.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const WORKFLOWS_MAX = 50;
export const CONDITIONS_MAX = 10;
export const ACTIONS_MAX = 10;
export const RUNS_PER_HOUR = 100;

export type WorkflowTrigger = IntegrationEvent | "schedule";
export const WORKFLOW_TRIGGERS: readonly WorkflowTrigger[] = [...EVENTS.map((e) => e.id), "schedule"];
export const isWorkflowTrigger = (value: string): value is WorkflowTrigger => (WORKFLOW_TRIGGERS as readonly string[]).includes(value);

/** What an event is about, by its trigger: the key its data is under (`order`, `product`, …). */
export function subjectOf(
  trigger: WorkflowTrigger,
):
  | "order"
  | "customer"
  | "subscription"
  | "return"
  | "withdrawal"
  | "product"
  | "stock"
  | "discount"
  | "support"
  | "inventory"
  | "fulfilment"
  | "refund"
  | "draft"
  | "erasure"
  | "gift_card"
  | "review"
  | "experiment"
  | "contract"
  | "deal"
  | "subscriber"
  | "conversation"
  | "checkout"
  | "work_client"
  | "work_invoice"
  | "form_response"
  | "email"
  | "broadcast"
  | "sending_pause"
  | "activity"
  | "lead"
  | "domain"
  | "schedule" {
  if (trigger === "schedule") return "schedule";
  // Ecosystem plan E5.1 (D757).
  if (trigger.startsWith("activity.")) return "activity";
  if (trigger.startsWith("lead.")) return "lead";
  if (trigger.startsWith("domain.")) return "domain";
  // Ecosystem plan E3.2 (D718).
  if (trigger.startsWith("deal.")) return "deal";
  if (trigger.startsWith("subscriber.")) return "subscriber";
  if (trigger.startsWith("conversation.")) return "conversation";
  if (trigger === "review.published") return "review";
  if (trigger === "checkout.abandoned") return "checkout";
  if (trigger === "work_client.created") return "work_client";
  if (trigger.startsWith("work_invoice.")) return "work_invoice";
  if (trigger === "inventory.updated") return "inventory";
  if (trigger.startsWith("fulfilment.")) return "fulfilment";
  if (trigger === "refund.created") return "refund";
  if (trigger === "quote.requested" || trigger === "draft.sent") return "draft";
  if (trigger === "return.updated") return "return";
  if (trigger === "customer.updated") return "customer";
  if (trigger === "customer.erased") return "erasure";
  if (trigger === "gift_card.issued") return "gift_card";
  if (trigger === "review.created") return "review";
  if (trigger === "experiment.answered") return "experiment";
  if (trigger.startsWith("contract.")) return "contract";
  if (trigger === "form.response") return "form_response";
  // Email plan M1.2 (D732).
  if (trigger.startsWith("email.")) return "email";
  if (trigger === "broadcast.sent") return "broadcast";
  if (trigger === "marketing.paused") return "sending_pause";
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

/** `segment`: the customer is (`is`) or is not (`is_not`) in one of the store's saved segments, its id the value; read now, not from the payload. */
export type FieldKind = "text" | "number" | "yes_no" | "segment";
/** A field a condition may test; `choices` are the only values a text field takes (the editor offers them, `workflowProblems()` holds to them). */
export type WorkflowField = { key: string; kind: FieldKind; choices?: readonly string[] };

/**
 * The condition *the customer is in segment X* (ecosystem plan E3.6, D718), for a trigger whose subject has a customer (an order, a customer,
 * a subscription: those whose data carries the address, as a customer's tag reads it). The runner reads the address's segments once, only
 * those its conditions name (`segmentsOfAddress()`), and gives them to `workflowMatches()`.
 */
export const SEGMENT_FIELD = "customer.segment";
const IN_SEGMENT: WorkflowField = { key: SEGMENT_FIELD, kind: "segment" };

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
    IN_SEGMENT,
  ],
  customer: [
    { key: "customer.email", kind: "text" },
    { key: "customer.email_confirmed", kind: "yes_no" },
    IN_SEGMENT,
  ],
  subscription: [
    { key: "subscription.status", kind: "text" },
    { key: "subscription.currency", kind: "text" },
    { key: "subscription.total_per_renewal", kind: "number" },
    IN_SEGMENT,
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
  fulfilment: [
    { key: "fulfilment.carrier", kind: "text" },
    { key: "fulfilment.undone", kind: "yes_no" },
    { key: "fulfilment.lines.sku", kind: "text" },
  ],
  refund: [
    { key: "refund.amount", kind: "number" },
    { key: "refund.currency", kind: "text" },
    { key: "refund.kind", kind: "text" },
  ],
  erasure: [],
  gift_card: [
    { key: "gift_card.currency", kind: "text" },
    { key: "gift_card.initial", kind: "number" },
    { key: "gift_card.source", kind: "text" },
  ],
  review: [
    { key: "review.rating", kind: "number" },
    { key: "review.status", kind: "text" },
    { key: "review.verified", kind: "yes_no" },
  ],
  experiment: [
    { key: "experiment.verdict", kind: "text" },
    { key: "experiment.best", kind: "text" },
    { key: "experiment.goal", kind: "text" },
    { key: "experiment.name", kind: "text" },
  ],
  contract: [
    { key: "contract.title", kind: "text" },
    { key: "contract.language", kind: "text" },
    { key: "contract.template", kind: "text" },
  ],
  // Ecosystem plan E3.2 (D718).
  deal: [
    { key: "deal.value", kind: "number" },
    { key: "deal.stage.name", kind: "text" },
    { key: "deal.pipeline.name", kind: "text" },
    { key: "deal.closed_via", kind: "text" },
  ],
  subscriber: [
    { key: "subscriber.source", kind: "text" },
    { key: "subscriber.unsubscribe_source", kind: "text" },
    { key: "subscriber.market", kind: "text" },
    { key: "subscriber.locale", kind: "text" },
  ],
  conversation: [
    { key: "conversation.rating", kind: "text" },
    { key: "conversation.source", kind: "text" },
    { key: "conversation.ended_by", kind: "text" },
    { key: "conversation.handler", kind: "text" },
  ],
  checkout: [
    { key: "checkout.subtotal", kind: "number" },
    { key: "checkout.currency", kind: "text" },
    { key: "checkout.market", kind: "text" },
    { key: "checkout.lines.sku", kind: "text" },
  ],
  work_client: [
    { key: "work_client.country", kind: "text" },
    { key: "work_client.business", kind: "yes_no" },
    { key: "work_client.currency", kind: "text" },
  ],
  work_invoice: [
    { key: "work_invoice.total", kind: "number" },
    { key: "work_invoice.currency", kind: "text" },
    { key: "work_invoice.status", kind: "text" },
  ],
  form_response: [
    { key: "form_response.form_name", kind: "text" },
    { key: "form_response.form_kind", kind: "text" },
    { key: "form_response.locale", kind: "text" },
    { key: "form_response.path", kind: "text" },
  ],
  email: [
    { key: "email.kind", kind: "text" },
    { key: "email.reason", kind: "text" },
  ],
  broadcast: [
    { key: "broadcast.recipients", kind: "number" },
    { key: "broadcast.failed", kind: "number" },
  ],
  sending_pause: [{ key: "sending_pause.reason", kind: "text", choices: ["bounces", "complaints"] }],
  // Ecosystem plan E5.1 (D757).
  activity: [
    { key: "activity.kind", kind: "text", choices: ACTIVITY_KINDS },
    { key: "activity.title", kind: "text" },
  ],
  lead: [{ key: "lead.requests.kind", kind: "text", choices: LEAD_KINDS }],
  domain: [
    { key: "domain.serving", kind: "text", choices: ["ok", "certificate", "elsewhere"] },
    { key: "domain.primary", kind: "yes_no" },
    { key: "domain.hostname", kind: "text" },
  ],
  draft: [
    { key: "draft.source", kind: "text" },
    { key: "draft.currency", kind: "text" },
    { key: "draft.lines.sku", kind: "text" },
  ],
  inventory: [
    { key: "inventory.sku", kind: "text" },
    { key: "inventory.on_hand", kind: "number" },
    { key: "inventory.available", kind: "number" },
  ],
  schedule: [],
};

/**
 * What an order rule knew about a paid order (`ruleFacts()` in `src/server/order-rules.ts`, D238 4.9), as fields of `order.paid` (ecosystem plan
 * E3.3, D718), so a workflow does what a rule did. They are not in the webhook's payload: the runner reads them for an `order.paid` run whose
 * conditions name one (`paidOrderFacts()` in `src/server/workflows.ts`) and puts them beside it under `order`. As a rule's, the tags are the
 * order's when it was paid (a tag another workflow adds for the same payment never counts: workflows never chain), the total is in the store's
 * main currency at its rates now (none without a rate, so a comparison never holds), and a guest has no first order (orders are never matched
 * to a person by email, D162). `order.products` holds the store's product ids, `order.tags` the tags' keys (as typed, without case).
 */
export const PAID_ORDER_FIELDS: readonly WorkflowField[] = [
  { key: "order.total_main", kind: "number" },
  { key: "order.first_order", kind: "yes_no" },
  { key: "order.buyer", kind: "text", choices: ["business", "consumer"] },
  { key: "order.products", kind: "text" },
  { key: "order.delivery", kind: "text", choices: ["shipping", "pickup", "local", "none"] },
  { key: "order.backordered", kind: "yes_no" },
  { key: "order.gift", kind: "yes_no" },
  { key: "order.source", kind: "text", choices: ["checkout", "draft", "subscription", "delivery"] },
  { key: "order.tags", kind: "text" },
  { key: "order.seller", kind: "text", choices: ["store", "host"] },
  { key: "order.risk", kind: "text", choices: ["normal", "elevated", "highest", "none"] },
];
const PAID_ORDER_KEYS: ReadonlySet<string> = new Set(PAID_ORDER_FIELDS.map((f) => f.key));
/** Whether conditions name a fact only a paid order's run reads (and so whether the runner reads them). */
export const needsPaidFacts = (conditions: readonly Pick<WorkflowCondition, "field">[]) => conditions.some((c) => PAID_ORDER_KEYS.has(c.field));

/** The fields of a trigger: its subject's, and for `order.paid` also what an order rule knew (E3.3). */
export const fieldsFor = (trigger: WorkflowTrigger): WorkflowField[] =>
  trigger === "order.paid" ? [...WORKFLOW_FIELDS.order, ...PAID_ORDER_FIELDS] : WORKFLOW_FIELDS[subjectOf(trigger)];

/**
 * `at_least` and `is_one_of` (values with commas between) came with the order rules' fold (E3.3, D718): a rule's *the total is at least* and
 * *the country is Sweden or Denmark*.
 */
export const OPERATORS = ["is", "is_not", "contains", "more_than", "less_than", "at_least", "is_one_of"] as const;
export type Operator = (typeof OPERATORS)[number];

export type WorkflowCondition = { field: string; op: Operator; value: string };

export const ACTION_KINDS = ["tag_order", "note_order", "tag_customer", "email_staff", "post_slack", "send_request", "ask_ai_manager", "hold_order"] as const;
export type WorkflowActionKind = (typeof ACTION_KINDS)[number];

export type WorkflowAction =
  | { kind: "tag_order"; tag: string }
  | { kind: "note_order"; text: string }
  | { kind: "tag_customer"; tag: string }
  | { kind: "email_staff"; subject: string; text: string }
  | { kind: "post_slack"; text: string }
  | { kind: "send_request"; endpointId: string }
  | { kind: "ask_ai_manager"; question: string }
  /** Holds the order's fulfilment as an order rule's hold did (`holdOrder()`, E3.3): only a paid order can be held. */
  | { kind: "hold_order"; reason: string };

/**
 * The actions a trigger may take: a tag needs an order or a customer, a request needs an event an endpoint can be sent, asking needs an order,
 * a hold a paid one.
 */
export function actionsFor(trigger: WorkflowTrigger): WorkflowActionKind[] {
  const subject = subjectOf(trigger);
  return ACTION_KINDS.filter((kind) => {
    if (kind === "hold_order") return trigger === "order.paid";
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

/** A workflow of the store's or the platform's (D516): the same shape, its trigger from either list. */
export type AnyWorkflowInput = Omit<WorkflowInput, "trigger"> & { trigger: string };

/**
 * What a list of triggers offers (D516): the store's (`STORE_WORKFLOWS`) and the platform's (`PLATFORM_WORKFLOWS`, its events) share the
 * editor, the checks and the runner's rules through it.
 */
export type WorkflowKit = {
  triggers: readonly string[];
  isTrigger: (value: string) => boolean;
  fieldsFor: (trigger: string) => WorkflowField[];
  actionsFor: (trigger: string) => WorkflowActionKind[];
};

export const STORE_WORKFLOWS: WorkflowKit = {
  triggers: WORKFLOW_TRIGGERS,
  isTrigger: isWorkflowTrigger,
  fieldsFor: (trigger) => (isWorkflowTrigger(trigger) ? fieldsFor(trigger) : []),
  actionsFor: (trigger) => (isWorkflowTrigger(trigger) ? actionsFor(trigger) : []),
};

/** A condition's value: up to 2000 characters, room for a rule's list of products (E3.3). */
export const VALUE_MAX = 2000;

/** What is wrong with a workflow beyond its shape: a field the trigger does not have, an action it cannot take, a schedule where none belongs. */
export function workflowProblems(input: AnyWorkflowInput, kit: WorkflowKit = STORE_WORKFLOWS): string[] {
  const problems: string[] = [];
  const fields = new Map(kit.fieldsFor(input.trigger).map((f) => [f.key, f]));
  if (input.trigger === "schedule") {
    if (!input.schedule) problems.push("A schedule needs its time.");
    else if (input.schedule.every === "week" && input.schedule.weekday === null) problems.push("A weekly schedule needs its day.");
    if (input.conditions.length > 0) problems.push("A schedule has no conditions.");
  } else if (input.schedule) problems.push("Only a schedule has a time.");
  for (const c of input.conditions) {
    const field = fields.get(c.field);
    const values = c.op === "is_one_of" ? listValues(c.value) : [c.value.trim().toLowerCase()];
    if (!field) problems.push(`${c.field} is not a field of this trigger.`);
    else if (field.kind === "segment") {
      if (!(c.op === "is" || c.op === "is_not") || !UUID.test(c.value)) problems.push("Choose one of your segments.");
    } else if ((c.op === "more_than" || c.op === "less_than" || c.op === "at_least") && field.kind !== "number") problems.push(`${c.field} is not a number.`);
    else if (field.kind === "number" && c.op !== "is" && c.op !== "is_not" && c.op !== "is_one_of" && Number.isNaN(Number(c.value))) problems.push(`${c.field} compares with a number.`);
    else if (c.op === "is_one_of" && values.length === 0) problems.push(`${c.field} needs at least one value, with commas between.`);
    else if (field.kind === "yes_no" && !values.every((v) => v === "yes" || v === "no")) problems.push(`${c.field} is yes or no.`);
    else if (field.choices && c.op !== "contains" && !values.every((v) => field.choices!.includes(v))) problems.push(`${c.field} is one of ${field.choices.join(", ")}.`);
  }
  const allowed = new Set(kit.actionsFor(input.trigger));
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

/** The values of an `is_one_of`: split on commas, trimmed, without case, empty ones left out. */
export const listValues = (value: string): string[] =>
  value
    .split(",")
    .map((v) => v.trim().toLowerCase())
    .filter((v) => v !== "");

/**
 * What a condition reads beside the event's data: the segments the event's customer is in now (`SEGMENT_FIELD`), by id; null when the event
 * has no customer or nobody read them, and then *in a segment* and *not in it* both fail, as a fact not known holds for no condition.
 */
export type WorkflowFacts = { segments?: ReadonlySet<string> | null };

/** The segments a workflow's conditions name (the runner reads only those for the event's customer). */
export const segmentsNamed = (conditions: readonly WorkflowCondition[]): string[] => [...new Set(conditions.filter((c) => c.field === SEGMENT_FIELD).map((c) => c.value))];

/** Whether a condition holds: any value at the field passes (`is_not`: none equals). Text compares without case. */
export function conditionHolds(condition: WorkflowCondition, data: unknown, facts: WorkflowFacts = {}): boolean {
  if (condition.field === SEGMENT_FIELD) {
    if (!facts.segments) return false;
    const inIt = facts.segments.has(condition.value);
    return condition.op === "is" ? inIt : condition.op === "is_not" ? !inIt : false;
  }
  const values = valuesAt(data, condition.field);
  const wanted = condition.value.trim().toLowerCase();
  const asText = (value: unknown) => (typeof value === "boolean" ? (value ? "yes" : "no") : String(value).toLowerCase());
  const equals = (v: unknown, want: string) => asText(v) === want || (typeof v === "number" && v === Number(want));
  switch (condition.op) {
    case "is":
      return values.some((v) => equals(v, wanted));
    case "is_not":
      return !values.some((v) => equals(v, wanted));
    case "is_one_of": {
      const list = listValues(condition.value);
      return values.some((v) => list.some((want) => equals(v, want)));
    }
    case "at_least":
      return values.some((v) => typeof v === "number" && v >= Number(wanted));
    case "contains":
      return values.some((v) => asText(v).includes(wanted));
    case "more_than":
      return values.some((v) => typeof v === "number" && v > Number(wanted));
    case "less_than":
      return values.some((v) => typeof v === "number" && v < Number(wanted));
  }
}

/** Whether every condition holds (none: always). */
export const workflowMatches = (conditions: WorkflowCondition[], data: unknown, facts: WorkflowFacts = {}) => conditions.every((c) => conditionHolds(c, data, facts));

/**
 * When a schedule is due on a day in the store's time zone: the key that makes it once (`schedule:2026-10-28`), or null when it is not due
 * yet that day or not on its weekday. `local` is the store's wall clock now (`YYYY-MM-DD`, `HH:MM`, ISO weekday 1 to 7).
 */
export function scheduleDue(schedule: WorkflowSchedule, local: { date: string; time: string; weekday: number }): string | null {
  if (schedule.every === "week" && schedule.weekday !== local.weekday) return null;
  return local.time >= schedule.at ? `schedule:${local.date}` : null;
}
