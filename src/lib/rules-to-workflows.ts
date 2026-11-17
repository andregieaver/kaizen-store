import { minorUnitDigits } from "./money";
import type { OrderRule, RuleAction, RuleCondition, RuleFacts } from "./order-rules";
import { workflowInputSchema, workflowProblems, type WorkflowAction, type WorkflowCondition, type WorkflowInput } from "./workflows";

/**
 * Order rules folded into workflows (ecosystem plan E3.3, D718; the wave-9 plan's intent, `docs/wave-9-platform.md` C): what a rule knew about a
 * paid order as the fields of a workflow on `order.paid` (`PAID_ORDER_FIELDS`), and each rule written as the workflow that does the same. Pure:
 * the server moves a store's rules with these (`src/server/rules-to-workflows.ts`) and its runner fills the fields (`paidOrderFacts()`).
 *
 * A rule whose conditions are joined by *any* (one of several is enough) cannot be one workflow, whose conditions must all hold: it stays a
 * rule, and the order-rules engine keeps running it, until the owner makes it again as workflows.
 */

/** Why a rule stays a rule: *any* of several conditions, a list with nothing in it, or a store with as many workflows as it may have. */
export type KeptWhy = "any" | "empty" | "invalid" | "limit";

export type RuleMove = { ok: true; workflow: WorkflowInput } | { ok: false; why: Exclude<KeptWhy, "limit"> };

/** An amount in the store's main currency's units, as the field `order.total_main` holds it. */
const units = (minor: number, currency: string) => minor / 10 ** minorUnitDigits(currency);

/** What an order rule knew about a paid order (`ruleFacts()`), as the fields of `order.paid` under `order` (`PAID_ORDER_FIELDS`). */
export function paidFactsData(facts: RuleFacts & { mainCurrency: string }): Record<string, unknown> {
  return {
    total_main: facts.mainMinor === null ? null : units(facts.mainMinor, facts.mainCurrency),
    // A guest's is null: never matched, as a rule's `unknown`.
    first_order: facts.firstOrder,
    buyer: facts.buyer,
    products: [...facts.productIds],
    delivery: facts.delivery,
    backordered: facts.backorder,
    gift: facts.gift,
    source: facts.source,
    tags: [...facts.tagKeys],
    seller: facts.seller,
    // Null while Stripe's outcome is not read, and left out when no condition asks: never matched, as a rule's `unread`.
    risk: facts.risk ?? null,
  };
}

const oneOf = (field: string, values: readonly string[]): WorkflowCondition | null =>
  values.length === 0 ? null : values.length === 1 ? { field, op: "is", value: values[0] } : { field, op: "is_one_of", value: values.join(", ") };

/** One of a rule's conditions as a workflow's: the same test on the same fact. Null for a list with nothing in it (it never matched). */
export function conditionToWorkflow(c: RuleCondition, mainCurrency: string): WorkflowCondition | null {
  switch (c.kind) {
    case "total_at_least":
      return { field: "order.total_main", op: "at_least", value: String(units(c.amountMinor, mainCurrency)) };
    case "total_below":
      return { field: "order.total_main", op: "less_than", value: String(units(c.amountMinor, mainCurrency)) };
    case "country_in":
      return oneOf("order.market", c.countries);
    case "buyer_is":
      return { field: "order.buyer", op: "is", value: c.buyer };
    case "first_order":
      return { field: "order.first_order", op: "is", value: c.value ? "yes" : "no" };
    case "has_product":
      return oneOf("order.products", c.productIds);
    case "delivery_is":
      return oneOf("order.delivery", c.deliveries);
    case "has_backorder":
      return { field: "order.backordered", op: "is", value: "yes" };
    case "is_gift":
      return { field: "order.gift", op: "is", value: "yes" };
    case "source_is":
      return oneOf("order.source", c.sources);
    case "has_tag":
      return { field: "order.tags", op: "is", value: c.tagKey };
    case "seller_is":
      return { field: "order.seller", op: "is", value: c.seller };
    case "risk":
      return c.level === "highest" ? { field: "order.risk", op: "is", value: "highest" } : { field: "order.risk", op: "is_one_of", value: "elevated, highest" };
  }
}

/**
 * One of a rule's actions as a workflow's: a tag, a hold with its reason and a question to the AI manager are the same; *Notify staff* is an
 * email to staff, the rule's name its subject and its note the message, to the same people (those chosen for automation emails).
 */
export function actionToWorkflow(a: RuleAction, ruleName: string): WorkflowAction {
  switch (a.kind) {
    case "tag":
      return { kind: "tag_order", tag: a.label };
    case "notify":
      return { kind: "email_staff", subject: ruleName, text: a.note };
    case "hold":
      return { kind: "hold_order", reason: a.reason };
    case "ask":
      return { kind: "ask_ai_manager", question: a.question };
  }
}

/** A rule as the workflow that does the same on `order.paid`, checked as any workflow is; or why it stays a rule. */
export function ruleToWorkflow(rule: Pick<OrderRule, "name" | "match" | "conditions" | "actions">, mainCurrency: string): RuleMove {
  if (rule.match === "any" && rule.conditions.length > 1) return { ok: false, why: "any" };
  const conditions = rule.conditions.map((c) => conditionToWorkflow(c, mainCurrency));
  if (conditions.some((c) => c === null)) return { ok: false, why: "empty" };
  const workflow: WorkflowInput = {
    name: rule.name,
    trigger: "order.paid",
    schedule: null,
    conditions: conditions as WorkflowCondition[],
    actions: rule.actions.map((a) => actionToWorkflow(a, rule.name)),
  };
  const parsed = workflowInputSchema.safeParse(workflow);
  if (!parsed.success || workflowProblems(workflow).length > 0) return { ok: false, why: "invalid" };
  return { ok: true, workflow };
}
