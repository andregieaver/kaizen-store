import "server-only";

import { sql } from "drizzle-orm";

import { db, type Db } from "@/db/client";
import { convertMinor } from "@/lib/currency";
import { renderEmail } from "@/lib/email-layout";
import { emailText } from "@/lib/email-text";
import { mainCurrency } from "@/lib/markets";
import { formatMoney } from "@/lib/money";
import {
  RULE_LIMITS,
  ruleMatches,
  type ActionOutcome,
  type ActionProblem,
  type OrderRule,
  type RuleAction,
  type RuleCondition,
  type RuleFacts,
  type RunOutcome,
} from "@/lib/order-rules";
import { orderRuleInput, ruleOrderInput } from "@/lib/order-rules-schema";
import { normaliseTag } from "@/lib/order-tags";
import { siteUrl } from "@/lib/site";
import { ALERT_KEYS } from "@/lib/staff-alerts";

import { audit } from "./auth";
import { sendEmail, type SendOutcome } from "./email";
import { SYSTEM_ACTOR } from "./order-actor";
import { askAiManager } from "./follow-ups";
import { holdOrder } from "./order-hold";
import { changeOrderTags } from "./order-tags";
import { emailFooter, storeById } from "./shopper-emails";
import { alertRecipients } from "./staff-alerts";
import { textList, uuidList } from "./sql-arrays";
import { readPaymentFacts } from "./payment-facts";

type Row = Record<string, unknown>;

/**
 * Order automation rules (wave 3, D238, `docs/wave-3-notifications.md` 2.5 and 4.9): *when an order is paid and {conditions} then tag, notify staff or hold
 * fulfilment*. The only writer of `order_rules` and `order_rule_runs`. Every query names the store.
 *
 * - **Facts** are read once per event before any rule runs (`ruleFacts()`), so rules never chain: a tag one rule adds does not satisfy another's `has_tag`
 *   for the same event. An amount is compared in the store's main currency at its rates now; an order whose currency has no rate never matches one
 *   (`no_rate`). A guest has no "first order" (`unknown`): orders are never matched to a person by email (D162).
 * - **Once**: each rule's run row is inserted first (`on conflict do nothing` on `(rule_id, event_id)`); only the transaction that inserted it acts. Rules run
 *   in `position` order, each in its own transaction; a switched-off rule is skipped (no row). A rule changed after the event runs as it is when processed
 *   (`rule_version` kept). A failed action is recorded (`ok: false`, a reason) and the others go on; a run is never retried.
 * - **Actions**: a tag through `changeOrderTags()` (the system, not audited: the run is the record), a hold through `holdOrder()` (by the rule), and a
 *   *Notify staff* email (`automation.notify`) to the recipients of `automation`, sent after the run's transaction with a key per run and recipient. The
 *   email holds the rule's name and note and the order's number, total and link (4.8: no shopper's personal field).
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ruleOf = (row: Row): OrderRule => ({
  id: String(row.id),
  name: String(row.name),
  event: "order.paid",
  match: row.match === "any" ? "any" : "all",
  conditions: (Array.isArray(row.conditions) ? row.conditions : []) as RuleCondition[],
  actions: (Array.isArray(row.actions) ? row.actions : []) as RuleAction[],
  enabled: Boolean(row.enabled),
  position: Number(row.position),
  version: Number(row.version),
});

/** The store's rules in their order, with each one's last run. */
export async function listRules(storeId: string): Promise<(OrderRule & { lastRun: { at: string; matched: boolean } | null })[]> {
  const rows = await db().execute<Row>(sql`
    select r.id, r.name, r.match, r.conditions, r.actions, r.enabled, r.position, r.version,
      last.created_at as last_at, last.matched as last_matched
    from commerce.order_rules r
    left join lateral (
      select x.created_at, x.matched from commerce.order_rule_runs x where x.store_id = r.store_id and x.rule_id = r.id order by x.created_at desc limit 1
    ) last on true
    where r.store_id = ${storeId}::uuid
    order by r.position, r.created_at, r.id
  `);
  return rows.map((row) => ({
    ...ruleOf(row),
    lastRun: row.last_at ? { at: new Date(String(row.last_at)).toISOString(), matched: Boolean(row.last_matched) } : null,
  }));
}

export async function getRule(storeId: string, ruleId: string): Promise<OrderRule | null> {
  if (!UUID.test(ruleId)) return null;
  const [row] = await db().execute<Row>(sql`
    select id, name, match, conditions, actions, enabled, position, version from commerce.order_rules where store_id = ${storeId}::uuid and id = ${ruleId}::uuid
  `);
  return row ? ruleOf(row) : null;
}

export type SaveRuleResult = { ok: true; rule: OrderRule } | { ok: false; problem: "invalid" | "not_found" | "limit"; message: string };

const isLimit = (error: unknown) => error instanceof Error && /order_rules\.limit/.test(`${error.message} ${(error as { cause?: { message?: string } }).cause?.message ?? ""}`);

/** The refusal for a rule that asks the AI manager, saved by someone who is not an owner. */
export const ASK_OWNER_ONLY = "Only an owner can make a rule that asks the AI manager: it runs in their name.";

/**
 * Creates (`ruleId` null) or changes a rule, checked by `orderRuleInput` (the editor's own schema) and then kept to the store's own: every product of a
 * `has_product` must be the store's and every country one of its markets. A change raises the rule's `version`. At most 50 a store (the database holds
 * it too). Audited `automation.rule_saved`.
 */
export async function saveRule(
  storeId: string,
  ruleId: string | null,
  input: unknown,
  accountId: string | null,
  /** Whether the person saving is an owner: only an owner's rule may ask the AI manager, which runs in their name (PSI AGT-04). */
  options: { owner?: boolean } = {},
): Promise<SaveRuleResult> {
  const parsed = orderRuleInput.safeParse(input);
  if (!parsed.success) return { ok: false, problem: "invalid", message: parsed.error.issues[0]?.message ?? "Check the rule and try again." };
  const rule = parsed.data;
  if (rule.actions.some((a) => a.kind === "ask") && !options.owner) return { ok: false, problem: "invalid", message: ASK_OWNER_ONLY };
  const products = rule.conditions.flatMap((c) => (c.kind === "has_product" ? c.productIds : []));
  if (products.length > 0) {
    const own = await db().execute<Row>(sql`select id from commerce.products where store_id = ${storeId}::uuid and id = any(${uuidList(products)})`);
    const ownIds = new Set(own.map((r) => String(r.id)));
    if (products.some((id) => !ownIds.has(id))) return { ok: false, problem: "invalid", message: "Choose products of this store." };
  }
  const countries = rule.conditions.flatMap((c) => (c.kind === "country_in" ? c.countries : []));
  if (countries.length > 0) {
    const markets = await db().execute<Row>(sql`select code from commerce.markets where store_id = ${storeId}::uuid and code = any(${textList(countries)}::text[])`);
    const codes = new Set(markets.map((r) => String(r.code).trim()));
    if (countries.some((c) => !codes.has(c))) return { ok: false, problem: "invalid", message: "Choose countries the store sells to." };
  }
  try {
    const [row] = ruleId
      ? await db().execute<Row>(sql`
          update commerce.order_rules set name = ${rule.name}, match = ${rule.match}, enabled = ${rule.enabled},
            conditions = ${JSON.stringify(rule.conditions)}::jsonb, actions = ${JSON.stringify(rule.actions)}::jsonb,
            version = version + 1, updated_by = ${accountId}::uuid, updated_at = now()
          where store_id = ${storeId}::uuid and id = ${UUID.test(ruleId) ? ruleId : null}::uuid
          returning id, name, match, conditions, actions, enabled, position, version
        `)
      : await db().execute<Row>(sql`
          insert into commerce.order_rules (store_id, name, match, enabled, conditions, actions, position, created_by, updated_by)
          values (${storeId}::uuid, ${rule.name}, ${rule.match}, ${rule.enabled}, ${JSON.stringify(rule.conditions)}::jsonb, ${JSON.stringify(rule.actions)}::jsonb,
            (select coalesce(max(position) + 1, 0) from commerce.order_rules where store_id = ${storeId}::uuid), ${accountId}::uuid, ${accountId}::uuid)
          returning id, name, match, conditions, actions, enabled, position, version
        `);
    if (!row) return { ok: false, problem: "not_found", message: "This rule no longer exists." };
    await audit(accountId, storeId, "automation.rule_saved", { rule: String(row.id), created: ruleId === null, conditions: rule.conditions.length, actions: rule.actions.length });
    return { ok: true, rule: ruleOf(row) };
  } catch (error) {
    if (isLimit(error)) return { ok: false, problem: "limit", message: `A store has at most ${RULE_LIMITS.rules} automation rules.` };
    throw error;
  }
}

/** Switches a rule on or off. Audited `automation.rule_switched`. */
export async function setRuleEnabled(storeId: string, ruleId: string, enabled: boolean, accountId: string | null): Promise<{ ok: boolean }> {
  if (!UUID.test(ruleId)) return { ok: false };
  const rows = await db().execute<Row>(sql`
    update commerce.order_rules set enabled = ${enabled}, updated_by = ${accountId}::uuid, updated_at = now()
    where store_id = ${storeId}::uuid and id = ${ruleId}::uuid returning id
  `);
  if (rows.length === 0) return { ok: false };
  await audit(accountId, storeId, "automation.rule_switched", { rule: ruleId, enabled });
  return { ok: true };
}

/** Puts the store's rules in the given order; the ids must be exactly the store's rules. Audited `automation.rules_ordered`. */
export async function orderRules(storeId: string, ids: unknown, accountId: string | null): Promise<{ ok: true } | { ok: false; message: string }> {
  const parsed = ruleOrderInput.safeParse(ids);
  if (!parsed.success) return { ok: false, message: "The order could not be read. Load the page again." };
  const order = parsed.data;
  return db().transaction(async (tx) => {
    const rows = await tx.execute<Row>(sql`select id from commerce.order_rules where store_id = ${storeId}::uuid for update`);
    const current = new Set(rows.map((r) => String(r.id)));
    if (current.size !== order.length || new Set(order).size !== order.length || order.some((id) => !current.has(id))) {
      return { ok: false as const, message: "The rules changed while you were ordering them. Load the page again." };
    }
    for (const [position, id] of order.entries()) {
      await tx.execute(sql`update commerce.order_rules set position = ${position}, updated_at = now() where store_id = ${storeId}::uuid and id = ${id}::uuid and position <> ${position}`);
    }
    await audit(accountId, storeId, "automation.rules_ordered", { rules: order.length });
    return { ok: true as const };
  });
}

/** Deletes a rule for good; its runs keep its name. Audited `automation.rule_deleted`. */
export async function deleteRule(storeId: string, ruleId: string, accountId: string | null): Promise<{ ok: boolean }> {
  if (!UUID.test(ruleId)) return { ok: false };
  const rows = await db().execute<Row>(sql`delete from commerce.order_rules where store_id = ${storeId}::uuid and id = ${ruleId}::uuid returning id`);
  if (rows.length === 0) return { ok: false };
  await audit(accountId, storeId, "automation.rule_deleted", { rule: ruleId });
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Facts and runs
// ---------------------------------------------------------------------------

/** What the rules can know about a paid order (4.9), read once; null for an order that is not the store's or is copied. */
export async function ruleFacts(storeId: string, orderId: string): Promise<(RuleFacts & { number: string; locale: string }) | null> {
  const [row] = await db().execute<Row>(sql`
    select o.number, o.total_minor, trim(o.currency) as currency, o.market_code, o.locale, o.company_name is not null as business, o.customer_id,
      o.delivery_method, o.is_gift, o.source, o.host_id, o.copied_from is not null as copied,
      exists (select 1 from commerce.order_lines l where l.store_id = o.store_id and l.order_id = o.id and l.delivery = 'physical') as physical,
      exists (select 1 from commerce.order_lines l where l.store_id = o.store_id and l.order_id = o.id and l.backorder_quantity > 0) as backorder,
      exists (select 1 from commerce.standing_deliveries d where d.store_id = o.store_id and d.order_id = o.id) as box,
      o.subscription_id is not null and exists (
        select 1 from commerce.orders e where e.store_id = o.store_id and e.subscription_id = o.subscription_id and e.id <> o.id and e.placed_at < o.placed_at
      ) as renewal,
      case when o.customer_id is null then null else exists (
        select 1 from commerce.orders e where e.store_id = o.store_id and e.customer_id = o.customer_id and e.id <> o.id and e.copied_from is null
          and e.placed_at < o.placed_at
          and (e.status::text in ('paid', 'fulfilled', 'closed')
               or exists (select 1 from commerce.payments p where p.store_id = e.store_id and p.order_id = e.id and p.status = 'captured'))
      ) end as ordered_before,
      coalesce((select array_agg(distinct v.product_id::text) from commerce.order_lines l
                join commerce.product_variants v on v.store_id = l.store_id and v.id = l.variant_id
                where l.store_id = o.store_id and l.order_id = o.id), '{}') as product_ids,
      coalesce((select array_agg(t.key) from commerce.order_tags t where t.store_id = o.store_id and t.order_id = o.id), '{}') as tag_keys
    from commerce.orders o where o.store_id = ${storeId}::uuid and o.id = ${orderId}::uuid
  `);
  if (!row || row.copied) return null;
  const [store, risk] = await Promise.all([storeById(storeId), riskOf(storeId, orderId)]);
  if (!store) return null;
  const currency = String(row.currency);
  const total = Number(row.total_minor);
  const mainMinor = convertMinor(total, currency, mainCurrency(store), store.localization.rates);
  const method = String(row.delivery_method ?? "ship");
  return {
    number: String(row.number),
    locale: String(row.locale ?? "en-GB"),
    totalMinor: total,
    currency,
    mainMinor,
    marketCode: String(row.market_code).trim(),
    buyer: row.business ? "business" : "consumer",
    firstOrder: row.ordered_before === null || row.ordered_before === undefined ? null : !row.ordered_before,
    productIds: ((row.product_ids ?? []) as string[]).map(String),
    delivery: method === "pickup" ? "pickup" : method === "local" ? "local" : row.physical ? "shipping" : "none",
    backorder: Boolean(row.backorder),
    gift: Boolean(row.is_gift),
    source: row.box ? "delivery" : row.source === "draft" ? "draft" : row.renewal ? "subscription" : "checkout",
    tagKeys: ((row.tag_keys ?? []) as string[]).map(String),
    seller: row.host_id ? "host" : "store",
    risk,
  };
}

/**
 * Stripe's risk outcome on an order (D288): the order's captured Stripe payments whose charge is not read yet are read first (the reply's `after()`
 * usually has), then the highest level of them; `none` when there is no assessed Stripe payment, null when one still cannot be read.
 */
async function riskOf(storeId: string, orderId: string): Promise<RuleFacts["risk"]> {
  const read = async () =>
    db().execute<Row>(sql`
      select provider_reference, risk_level, facts_read_at is not null as read from commerce.payments
       where store_id = ${storeId}::uuid and order_id = ${orderId}::uuid and provider = 'stripe' and status = 'captured'
    `);
  let rows = await read();
  const unread = rows.filter((r) => !r.read);
  if (unread.length > 0) {
    for (const r of unread) await readPaymentFacts(storeId, String(r.provider_reference));
    rows = await read();
  }
  if (rows.some((r) => !r.read)) return null;
  const levels = rows.map((r) => String(r.risk_level ?? ""));
  if (levels.includes("highest")) return "highest";
  if (levels.includes("elevated")) return "elevated";
  if (levels.includes("normal")) return "normal";
  return "none";
}

type EventRef = { id: string; storeId: string; subjectId: string };

/** An action's outcome. */
const outcome = (kind: ActionOutcome["kind"], problem?: ActionProblem): ActionOutcome => (problem ? { kind, ok: false, problem } : { kind, ok: true });

/** Runs one action inside the rule's transaction (tag, hold); a notify is sent after it commits. */
async function act(tx: Db, storeId: string, orderId: string, rule: OrderRule, action: RuleAction, orderNumber: string): Promise<ActionOutcome> {
  switch (action.kind) {
    case "tag": {
      const tag = normaliseTag(action.label);
      if (!tag.ok) return outcome("tag", "invalid");
      const result = await changeOrderTags(storeId, orderId, { add: [tag.tag] }, SYSTEM_ACTOR, { runner: tx, audit: false });
      if (!result.ok) return outcome("tag", "not_found");
      if (result.change.refused.length > 0) return outcome("tag", "limit");
      return outcome("tag");
    }
    case "hold": {
      const held = await holdOrder(storeId, orderId, { reason: action.reason, by: { rule: { id: rule.id } } }, { runner: tx });
      if (held.ok) return outcome("hold");
      const problem: ActionProblem = held.problem === "already_held" ? "already_held" : held.problem === "sent" ? "sent" : held.problem === "not_found" ? "not_found" : held.problem === "invalid" ? "invalid" : "failed";
      return outcome("hold", problem);
    }
    case "notify":
      // Sent after the transaction (below), so an email never goes for a run that did not commit.
      return outcome("notify");
    case "ask": {
      // A follow-up in the rule's transaction, so it exists only for a run that committed; the runner takes it within five minutes (PSI AGT-04).
      const asked = await askAiManager(tx, { storeId, orderId, ruleId: rule.id, ruleName: rule.name, question: action.question, orderNumber });
      return asked === "ok" ? outcome("ask") : outcome("ask", asked);
    }
  }
}

/** The *Notify staff* email (`automation.notify`) of a run, to the recipients of `automation`; whether it reached anyone. */
async function notify(storeId: string, runId: string, orderId: string, rule: OrderRule, note: string, facts: { number: string; totalMinor: number; currency: string; locale: string }): Promise<ActionOutcome> {
  const [targets, store] = await Promise.all([alertRecipients(storeId, "automation"), storeById(storeId)]);
  if (!store) return outcome("notify", "failed");
  if (targets.length === 0) return outcome("notify", "no_recipients");
  const total = formatMoney(facts.totalMinor, facts.currency, facts.locale);
  const email = renderEmail({
    subject: `Automation: ${rule.name} (order ${facts.number})`,
    preview: note,
    lang: "en",
    footer: emailFooter(store, emailText("en")),
    blocks: [
      { type: "heading", text: rule.name },
      { type: "paragraph", text: note },
      { type: "lines", rows: [{ label: `Order ${facts.number}`, value: total, strong: true }] },
      { type: "paragraph", text: "Sent by an automation rule of the store when the order was paid." },
      { type: "button", text: "Open the order", url: `${siteUrl()}/admin/${store.slug}/orders/${orderId}` },
    ],
  });
  const outcomes: SendOutcome[] = [];
  for (const t of targets) {
    outcomes.push(await sendEmail({ storeId, kind: "automation.notify", to: t.to, email, fromName: store.name, idempotencyKey: ALERT_KEYS.ruleNotify(runId, t.recipient), orderId }));
  }
  return outcomes.some((o) => o === "sent" || o === "logged" || o === "duplicate") ? outcome("notify") : outcome("notify", "failed");
}

/**
 * Runs the store's rules for one `order.paid` store event (from `processStoreEvents()`): the facts once, then each enabled rule in its order, once per
 * event (the run's unique key). Throws only when the facts or the rules cannot be read (the event is tried again; runs already made are not repeated).
 */
export async function runRulesFor(event: EventRef): Promise<{ runs: number; matched: number }> {
  const rules = (await listRules(event.storeId)).filter((r) => r.enabled);
  if (rules.length === 0) return { runs: 0, matched: 0 };
  const facts = await ruleFacts(event.storeId, event.subjectId);
  if (!facts) return { runs: 0, matched: 0 };
  let runs = 0;
  let matchedCount = 0;
  for (const rule of rules) {
    const { matched, conditions } = ruleMatches(rule, facts);
    const run = await db().transaction(async (tx) => {
      const [made] = await tx.execute<Row>(sql`
        insert into commerce.order_rule_runs (store_id, rule_id, rule_name, rule_version, event_id, order_id, matched, outcome)
        values (${event.storeId}::uuid, ${rule.id}::uuid, ${rule.name}, ${rule.version}, ${event.id}::uuid, ${event.subjectId}::uuid, ${matched},
          ${JSON.stringify({ conditions, actions: [] } satisfies RunOutcome)}::jsonb)
        on conflict on constraint order_rule_runs_once_key do nothing
        returning id
      `);
      if (!made) return null;
      const actions: ActionOutcome[] = [];
      if (matched) {
        for (const action of rule.actions) {
          try {
            actions.push(await act(tx, event.storeId, event.subjectId, rule, action, facts.number));
          } catch {
            actions.push(outcome(action.kind, "failed"));
          }
        }
      }
      await tx.execute(sql`
        update commerce.order_rule_runs set outcome = ${JSON.stringify({ conditions, actions } satisfies RunOutcome)}::jsonb
        where store_id = ${event.storeId}::uuid and id = ${String(made.id)}::uuid
      `);
      return { id: String(made.id), actions };
    });
    if (!run) continue;
    runs++;
    if (!matched) continue;
    matchedCount++;
    const notes = rule.actions.flatMap((a, i) => (a.kind === "notify" && run.actions[i]?.ok ? [{ i, note: a.note }] : []));
    if (notes.length === 0) continue;
    for (const { i, note } of notes) {
      run.actions[i] = await notify(event.storeId, run.id, event.subjectId, rule, note, facts).catch(() => outcome("notify", "failed"));
    }
    await db().execute(sql`
      update commerce.order_rule_runs set outcome = ${JSON.stringify({ conditions, actions: run.actions } satisfies RunOutcome)}::jsonb
      where store_id = ${event.storeId}::uuid and id = ${run.id}::uuid
    `);
  }
  return { runs, matched: matchedCount };
}

export type RuleRun = {
  id: string;
  at: string;
  ruleId: string;
  ruleName: string;
  ruleVersion: number;
  orderId: string;
  orderNumber: string | null;
  matched: boolean;
  outcome: RunOutcome;
};

/** The log (2.5 point 3): the runs of the last 12 months, newest first, by rule and by matched or not; keyset paging by `before` (a run's time). */
export async function ruleLog(
  storeId: string,
  filter: { ruleId?: string | null; matched?: boolean | null; before?: string | null; limit?: number } = {},
): Promise<RuleRun[]> {
  const limit = Math.min(Math.max(filter.limit ?? 100, 1), 500);
  const rows = await db().execute<Row>(sql`
    select x.id, x.created_at, x.rule_id, x.rule_name, x.rule_version, x.order_id, x.matched, x.outcome, o.number
    from commerce.order_rule_runs x
    left join commerce.orders o on o.store_id = x.store_id and o.id = x.order_id
    where x.store_id = ${storeId}::uuid and x.created_at > now() - interval '12 months'
      ${filter.ruleId && UUID.test(filter.ruleId) ? sql`and x.rule_id = ${filter.ruleId}::uuid` : sql``}
      ${filter.matched === true || filter.matched === false ? sql`and x.matched = ${filter.matched}` : sql``}
      ${filter.before ? sql`and x.created_at < ${filter.before}::timestamptz` : sql``}
    order by x.created_at desc, x.id desc
    limit ${limit}
  `);
  return rows.map((r) => ({
    id: String(r.id),
    at: new Date(String(r.created_at)).toISOString(),
    ruleId: String(r.rule_id),
    ruleName: String(r.rule_name),
    ruleVersion: Number(r.rule_version),
    orderId: String(r.order_id),
    orderNumber: r.number ? String(r.number) : null,
    matched: Boolean(r.matched),
    outcome: (r.outcome ?? { conditions: [], actions: [] }) as RunOutcome,
  }));
}

/** Deletes runs older than 12 months (3.5; application code). Returns how many. */
export async function pruneRuleRuns(now = new Date()): Promise<number> {
  const rows = await db().execute<Row>(sql`
    delete from commerce.order_rule_runs where created_at < ${now.toISOString()}::timestamptz - interval '12 months' returning id
  `);
  return rows.length;
}
