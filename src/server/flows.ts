import "server-only";

import { withPicks } from "@/lib/automations";
import { getAutomation, picksFor } from "./automations";
import { refreshBuyFacts } from "./buy-facts";
import { sql, type SQL } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { policyVerdict, type PolicyReason } from "@/lib/contact-policy";
import { DATE_TRIGGER_DAYS, EVENT_TRIGGERS } from "@/lib/flow-triggers";
import { flowFromAutomation, ownFlow, RECIPES, type RecipeKey } from "@/lib/flow-recipes";
import { FLOW_GUARD, flowGuardPauses, guardCountsOf } from "@/lib/flow-guard";
import {
  advance,
  checkFlow,
  findStep,
  flowInputSchema,
  flowStepSchema,
  pathOf,
  pathText,
  type FlowFacts,
  type FlowGoal,
  type FlowPath,
  type FlowStep,
} from "@/lib/flows";
import { linkTarget } from "@/lib/broadcasts";
import type { FlowReport } from "@/lib/flow-report";
import { roomLeft } from "@/lib/limits";
import { siteUrl } from "@/lib/site";
import { nextSendTime } from "@/lib/sms";

import { PAID } from "./analytics-sql";
import { orderCredit } from "./order-credit";
import { audit } from "./auth";
import { getContactPolicy, recentContacts } from "./contact-policy";
import { sendEmail } from "./email";
import { advanceCursor, readEventsAfter } from "./event-log";
import { limitFor, usageNow } from "./limits";
import { clickRef, keepFlowClick } from "./email-clicks";
import { log } from "./log";
import { factsForEmail, marketingEmail, marketSlugFor, resolverFor } from "./marketing-email";
import { segmentsOfAddress } from "./segment-membership";
import { isPaused } from "./sending-guard";
import { storeById, type EmailStore } from "./shopper-emails";
import type { Store } from "./stores";
import { textList } from "./sql-arrays";
import { col, typedRow, typedRows } from "./typed-rows";

/**
 * Flows (D767, `docs/flows.md`, email plan M2.1, slice 1): the only writer of `commerce.flows`, `flow_versions`, `flow_runs` and
 * `flow_run_steps`. People enter from the event log (the reader `flows`), and the every-minute marketing job moves each due run on with
 * `advance()`: an email goes through the sending guard (D730), the plan's room, quiet hours and the contact policy (D764) as automation
 * emails do; a wait sets when the run wakes; a goal or the end of the tree ends it.
 */

const READER = "flows";
const RUN_BATCH = 200;
const RUNS_KEEP_DAYS = 90;
/** A run whose step was held by the sending guard looks again in an hour. */
const PAUSED_RETRY_HOURS = 1;

// ---------------------------------------------------------------------------
// Saving, testing, switching
// ---------------------------------------------------------------------------

export type FlowView = {
  id: string;
  name: string;
  trigger: string;
  enabled: boolean;
  version: number;
  tested: boolean;
  steps: FlowStep[];
  goals: FlowGoal[];
  /** The automation it does the work of (slice 3), or null. */
  replaces: string | null;
  /** A lapse trigger's days (slice 4), or null. */
  triggerDays: number | null;
  /** When the flow guard switched it off and what it counted (M3.9); null once switched on again. */
  guard: { at: string; sent: number; left: number } | null;
};

const flowRow = z.object({
  id: col.uuid,
  name: col.text,
  trigger: col.text,
  enabled: col.bool,
  version: col.int,
  tested_version: z.number().int().nullable(),
  replaces: col.text.nullable(),
  trigger_days: z.number().int().nullable(),
  guard_paused_at: col.timestampOrNull,
  guard_counts: z.unknown(),
  steps: z.unknown(),
  goals: z.unknown(),
});

const viewOf = (r: z.infer<typeof flowRow>): FlowView => ({
  id: r.id,
  name: r.name,
  trigger: r.trigger,
  enabled: r.enabled,
  version: r.version,
  tested: r.tested_version === r.version,
  replaces: r.replaces,
  triggerDays: r.trigger_days,
  guard: (() => {
    const counts = guardCountsOf(r.guard_counts);
    return r.guard_paused_at && counts ? { at: r.guard_paused_at, ...counts } : null;
  })(),
  steps: z.array(flowStepSchema).parse(r.steps),
  goals: z.array(z.object({ kind: z.literal("ordered") })).parse(r.goals),
});

const FLOW_SELECT = sql`select f.id, f.name, f.trigger, f.enabled, f.version, f.tested_version, f.replaces, f.trigger_days, f.guard_paused_at, f.guard_counts, v.steps, v.goals
  from commerce.flows f join commerce.flow_versions v on v.flow_id = f.id and v.version = f.version`;

/** A store's flows, newest first. */
export async function listFlows(storeId: string): Promise<FlowView[]> {
  return (await typedRows(flowRow, sql`${FLOW_SELECT} where f.store_id = ${storeId}::uuid order by f.created_at desc`)).map(viewOf);
}

export async function getFlow(storeId: string, id: string): Promise<FlowView | null> {
  if (!z.uuid().safeParse(id).success) return null;
  const row = await typedRow(flowRow, sql`${FLOW_SELECT} where f.store_id = ${storeId}::uuid and f.id = ${id}::uuid`);
  return row ? viewOf(row) : null;
}

const savedRow = z.object({ id: col.uuid, version: col.int });

export type SaveFlowResult = { ok: true; id: string; version: number } | { ok: false; problem: string };

/** Saves a flow as a new version, switched off until that version is tested. A new trigger ends what it replaced (it no longer does that work). */
export async function saveFlow(storeId: string, accountId: string | null, id: string | null, input: unknown): Promise<SaveFlowResult> {
  const parsed = flowInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, problem: parsed.error.issues[0]?.message ?? "Check the flow." };
  const problems = checkFlow(parsed.data.steps);
  if (problems.length > 0) return { ok: false, problem: problems[0] };
  const { name, trigger, steps, goals, replaces } = parsed.data;
  const days = parsed.data.triggerDays ?? null;
  const saved = await db().transaction(async (tx) => {
    const [raw] = id
      ? await tx.execute(sql`
          update commerce.flows set name = ${name}, trigger = ${trigger}, trigger_days = ${days}, enabled = false, version = version + 1, updated_at = now(),
                 replaces = case when trigger = ${trigger} then replaces end
           where store_id = ${storeId}::uuid and id = ${id}::uuid returning id, version`)
      : await tx.execute(sql`
          insert into commerce.flows (store_id, name, trigger, trigger_days, replaces)
          values (${storeId}::uuid, ${name}, ${trigger}, ${days}, ${replaces ?? null}) returning id, version`);
    if (!raw) return null;
    const row = savedRow.parse(raw);
    await tx.execute(sql`
      insert into commerce.flow_versions (store_id, flow_id, version, steps, goals)
      values (${storeId}::uuid, ${String(row.id)}::uuid, ${Number(row.version)}, ${JSON.stringify(steps)}::jsonb, ${JSON.stringify(goals)}::jsonb)`);
    return { id: String(row.id), version: Number(row.version) };
  });
  if (!saved) return { ok: false, problem: "That flow is not this store's." };
  await audit(accountId, storeId, "marketing.flow_saved", { flow: saved.id, version: saved.version });
  return { ok: true, ...saved };
}

export type FlowTest = { ok: true; person: string | null; emails: string[]; ends: "goal" | "done" } | { ok: false; problem: string };

/**
 * Walks the store's newest subscriber through the saved version, as they are now, and sends nothing: the subjects of the emails they would get, in order,
 * taking every wait at once. Marks that version tested, so it may be switched on.
 */
export async function testFlow(storeId: string, id: string): Promise<FlowTest> {
  const flow = await getFlow(storeId, id);
  if (!flow) return { ok: false, problem: "That flow is not this store's." };
  const person = await typedRow(
    z.object({ email: col.text }),
    sql`select email from commerce.marketing_subscribers where store_id = ${storeId}::uuid and status = 'subscribed' order by created_at desc limit 1`,
  );
  const facts: FlowFacts = { orderedSinceEntry: false, clickedFlowEmail: false, segments: new Set() };
  const emails: string[] = [];
  let path: FlowPath | null = ["0"];
  let ends: "goal" | "done" = "done";
  for (let guard = 0; guard < 100; guard++) {
    const move = advance(flow.steps, flow.goals, path, facts);
    if (move.do === "end") {
      ends = move.reason;
      break;
    }
    if (move.do === "email") emails.push(Object.values(move.step.content)[0]?.subject || move.step.id);
    path = move.next;
  }
  await db().execute(sql`update commerce.flows set tested_version = version where store_id = ${storeId}::uuid and id = ${id}::uuid`);
  return { ok: true, person: person?.email ?? null, emails, ends };
}

/** One email of a flow drawn for the person tested (the dry run, M3.5). */
export type DrawnEmail = { stepId: string; subject: string; html: string };

/**
 * Each email the store's newest subscriber would get from the flow as it is saved, drawn for them as it would be sent: in their language
 * and market, with the products picked for them (D653) and the store's facts (D352), its links plain so nothing is counted (the dry run,
 * M3.5). Nothing is sent, entered or marked tested. Their address is returned only to name them on the page; empty without a subscriber.
 */
export async function drawFlowEmails(storeId: string, id: string): Promise<{ person: string | null; emails: DrawnEmail[] }> {
  const [flow, store] = await Promise.all([getFlow(storeId, id), storeById(storeId)]);
  if (!flow || !store) return { person: null, emails: [] };
  const person = await typedRow(
    z.object({ email: col.text, locale: col.text, market_code: col.textOrNull, token: col.text }),
    sql`select email, locale, market_code, token from commerce.marketing_subscribers
         where store_id = ${storeId}::uuid and status = 'subscribed' order by created_at desc limit 1`,
  );
  if (!person) return { person: null, emails: [] };
  const facts: FlowFacts = { orderedSinceEntry: false, clickedFlowEmail: false, segments: new Set() };
  const emails: DrawnEmail[] = [];
  let path: FlowPath | null = ["0"];
  for (let guard = 0; guard < 100 && path; guard++) {
    const move = advance(flow.steps, flow.goals, path, facts);
    if (move.do === "end") break;
    if (move.do === "email") {
      let content = move.step.content;
      if (move.step.picks) {
        const order = await typedRow(
          z.object({ id: col.uuid }),
          sql`select o.id from commerce.orders o where o.store_id = ${storeId}::uuid and lower(o.email) = lower(${person.email})
                and o.restricted_at is null and ${PAID} order by o.placed_at desc limit 1`,
        );
        const picks = order || move.step.picks === "browse" ? await picksFor(storeId, move.step.picks, order?.id ?? null, person.email) : [];
        content = withPicks(content, picks);
      }
      const drawn = marketingEmail({
        store,
        content,
        locale: person.locale,
        marketCode: person.market_code,
        token: person.token,
        facts: await factsForEmail(store, content, person.locale, person.market_code),
      });
      if (drawn) emails.push({ stepId: move.step.id, subject: drawn.subject, html: drawn.html });
    }
    path = move.next;
  }
  return { person: person.email, emails };
}

/**
 * Switches a flow on (only once its saved version is tested) or off. On, a flow that does an automation's work (`replaces`, slice 3) switches
 * that automation off in the same transaction, so nobody gets both: "replaced" says it did. Off leaves the automation off.
 */
export async function switchFlow(storeId: string, accountId: string | null, id: string, on: boolean): Promise<"ok" | "replaced" | "untested" | "missing"> {
  const outcome = await db().transaction(async (tx) => {
    const [row] = await tx.execute(sql`
      update commerce.flows set enabled = ${on}, enabled_at = case when ${on} and not enabled then now() else enabled_at end, updated_at = now(),
             guard_paused_at = case when ${on} then null else guard_paused_at end, guard_counts = case when ${on} then null else guard_counts end
       where store_id = ${storeId}::uuid and id = ${id}::uuid and (${!on} or tested_version = version) returning replaces`);
    if (!row) return null;
    const replaces = z.object({ replaces: col.text.nullable() }).parse(row).replaces;
    if (!on || !replaces) return { replaced: null };
    const off = await tx.execute(sql`
      update commerce.automations set enabled = false, updated_by = ${accountId}::uuid
       where store_id = ${storeId}::uuid and kind = ${replaces} and enabled returning kind`);
    return { replaced: off.length > 0 ? replaces : null };
  });
  if (!outcome) return (await getFlow(storeId, id)) ? "untested" : "missing";
  // Product views are kept only while a browse email is on (D691): the last one off, they go.
  if (!on) await dropProductViewsUnlessBrowsing(storeId);
  // An automation switched off changes what the buy facts say the store sends (as switchAutomation() refreshes them).
  if (outcome.replaced) refreshBuyFacts(storeId);
  await audit(accountId, storeId, on ? "marketing.flow_on" : "marketing.flow_off", { flow: id, ...(outcome.replaced ? { automationOff: outcome.replaced } : {}) });
  return outcome.replaced ? "replaced" : "ok";
}

/**
 * The flow guard (email plan M3.9, `flowGuardPauses()`): each switched-on flow's readers of the last `FLOW_GUARD.days` (people who got one
 * of its emails) and how many of them left the list within `FLOW_GUARD.withinHours` of it; a flow past the line is switched off, the
 * counts kept on it (`guard_paused_at`, `guard_counts`, which its page and Home say), and audited as the system's
 * (`marketing.flow_guard_paused`). Hourly, in the first five minutes, from the every-minute flows job (`tickFlows()`, which logs a throw).
 */
export async function guardFlows(options: { now?: Date; everyRun?: boolean } = {}): Promise<{ judged: number; paused: number }> {
  const now = options.now ?? new Date();
  if (!options.everyRun && now.getUTCMinutes() >= 5) return { judged: 0, paused: 0 };
  const at = now.toISOString();
  const rows = await typedRows(
    z.object({ store_id: col.uuid, flow_id: col.uuid, sent: col.int, left_list: col.int }),
    sql`
      select f.store_id, f.id as flow_id, count(distinct r.subscriber_id)::int as sent,
        count(distinct r.subscriber_id) filter (
          where m.unsubscribed_at >= st.created_at and m.unsubscribed_at < st.created_at + make_interval(hours => ${FLOW_GUARD.withinHours})
        )::int as left_list
      from commerce.flows f
      join commerce.flow_runs r on r.store_id = f.store_id and r.flow_id = f.id
      join commerce.flow_run_steps st on st.store_id = r.store_id and st.run_id = r.id and st.outcome in ('sent', 'logged')
        and st.created_at > ${at}::timestamptz - make_interval(days => ${FLOW_GUARD.days})
      join commerce.marketing_subscribers m on m.store_id = r.store_id and m.id = r.subscriber_id
      where f.enabled
      group by f.store_id, f.id
    `,
  );
  let paused = 0;
  for (const r of rows) {
    const counts = { sent: r.sent, left: r.left_list };
    if (!flowGuardPauses(counts)) continue;
    const off = await db().execute(sql`
      update commerce.flows set enabled = false, guard_paused_at = ${at}::timestamptz, guard_counts = ${JSON.stringify(counts)}::jsonb, updated_at = now()
       where store_id = ${r.store_id}::uuid and id = ${r.flow_id}::uuid and enabled returning id`);
    if (off.length === 0) continue;
    paused++;
    await dropProductViewsUnlessBrowsing(r.store_id);
    await audit(null, r.store_id, "marketing.flow_guard_paused", { flow: r.flow_id, ...counts });
    log("warn", "flows.guard_paused", { storeId: r.store_id, flowId: r.flow_id, ...counts });
  }
  return { judged: rows.length, paused };
}

/**
 * A flow started from a goal (D767): the owner's own automation for it, when they wrote one, keeps its words, days and follow-ups (slice 3,
 * M2.2); else the recipe; "own" is one email to start from. Saved off and untested, as every new flow. The Flows page's Start and the AI
 * manager's `start_flow` (M3.9) both come here.
 */
export async function startRecipeFlow(store: Store, accountId: string, key: RecipeKey | "own"): Promise<SaveFlowResult> {
  const locale = store.localization.locales[0] ?? "en-GB";
  if (key === "own") return saveFlow(store.id, accountId, null, ownFlow(locale));
  if (!(key in RECIPES)) return { ok: false, problem: "No such goal." };
  if (key === "sunset") return saveFlow(store.id, accountId, null, RECIPES.sunset(locale));
  const own = await getAutomation(store, key);
  const recipe = (own?.saved ? flowFromAutomation(key, own, locale) : null) ?? RECIPES[key](locale);
  return saveFlow(store.id, accountId, null, recipe);
}

/**
 * What each goal would reach in the store's own data (email plan M3.9, the Flows page's proposals): people on the list who joined in the
 * last 30 days (welcome), who bought in the last 30 days (after a purchase, cross-sell), whose latest paid order is 90 days old or more
 * (bring back customers), who bought twice or more (restock), and who pressed no link in 180 days (keep your list awake). Counts only; browse is left out (its views are kept only while it runs).
 */
export async function flowProposals(storeId: string): Promise<Partial<Record<RecipeKey, number>>> {
  const row = await typedRow(
    z.object({ joined: col.int, buyers: col.int, lapsed: col.int, repeat: col.int, asleep: col.int }),
    sql`
      with paid as (
        select lower(o.email) as email, max(o.placed_at) as last_at, count(*) as n from commerce.orders o
         where o.store_id = ${storeId}::uuid and o.restricted_at is null and ${PAID}
         group by lower(o.email)
      )
      select count(*) filter (where s.created_at > now() - interval '30 days')::int as joined,
             count(*) filter (where p.last_at > now() - interval '30 days')::int as buyers,
             count(*) filter (where p.last_at <= now() - interval '90 days')::int as lapsed,
             count(*) filter (where p.n >= 2)::int as repeat,
             count(*) filter (where s.paused_at is null and greatest(s.consented_at, coalesce(
               (select max(c.clicked_at) from commerce.email_clicks c where c.store_id = s.store_id and c.subscriber_id = s.id), s.consented_at))
               <= now() - make_interval(days => ${DATE_TRIGGER_DAYS["subscriber.asleep"].start}))::int as asleep
        from commerce.marketing_subscribers s left join paid p on p.email = lower(s.email)
       where s.store_id = ${storeId}::uuid and s.status = 'subscribed'
    `,
  );
  if (!row) return {};
  return { welcome: row.joined, after_purchase: row.buyers, cross_sell: row.buyers, win_back: row.lapsed, replenish: row.repeat, sunset: row.asleep };
}

/** The switched-on flow of a store that does an automation's work, by name; null for none (an automation stays off while one is on). */
export async function flowReplacing(storeId: string, kind: string): Promise<string | null> {
  const row = await typedRow(
    z.object({ name: col.text }),
    sql`select name from commerce.flows where store_id = ${storeId}::uuid and replaces = ${kind} and enabled order by updated_at desc limit 1`,
  );
  return row?.name ?? null;
}

// ---------------------------------------------------------------------------
// Entering from the event log
// ---------------------------------------------------------------------------

/**
 * The address an event's subject is about (slice 4, M2.3), as one `email` column: the order's, the cart's, the subscription's, a form's
 * contact address, a quote's, a signed-in reviewer's. An erased person's order is never read (`restricted_at`). Null for an event with
 * no person (or a guest's review, kept only as a hash).
 */
function emailOfSubject(event: string, storeId: string, subjectId: string) {
  return emailOfSubjectAt(event, sql`${storeId}::uuid`, sql`${subjectId}::uuid`);
}

/** As `emailOfSubject()`, for a store and subject given as SQL (a column of an outer query, for the dry run's count). */
function emailOfSubjectAt(event: string, store: SQL, id: SQL) {
  switch (event) {
    case "order.paid":
    case "order.sent":
      return sql`select o.email from commerce.orders o where o.store_id = ${store} and o.id = ${id} and o.restricted_at is null`;
    case "checkout.abandoned":
      return sql`select a.email from commerce.abandoned_checkouts a where a.store_id = ${store} and a.id = ${id}`;
    case "subscription.started":
    case "subscription.cancelled":
      return sql`select u.email from commerce.subscriptions u where u.store_id = ${store} and u.id = ${id} and u.email <> ''`;
    case "form.response":
      return sql`select r.contact_email as email from commerce.form_responses r where r.store_id = ${store} and r.id = ${id} and r.contact_email is not null`;
    case "quote.requested":
      return sql`select d.email from commerce.draft_orders d where d.store_id = ${store} and d.id = ${id} and d.email is not null`;
    case "review.created":
      return sql`select c.email from commerce.product_reviews r join commerce.customers c on c.store_id = r.store_id and c.id = r.customer_id
                  where r.store_id = ${store} and r.id = ${id}`;
    default:
      return null;
  }
}

/**
 * Reads the event log's new trigger events (reader `flows`) and makes a run for the subscribed person each names, in every switched-on flow
 * of that store and trigger: once per event, and never a second while one is running. The person is the subscriber the event names, or the
 * subscribed address its subject is about (`emailOfSubject()`). Returns how many runs began.
 */
export async function enterFlows(): Promise<number> {
  const batch = await readEventsAfter(READER, { events: EVENT_TRIGGERS, limit: 500 });
  if (!batch.claim) return 0;
  let entered = 0;
  for (const event of batch.events) {
    if (!event.storeId || !event.subjectId) continue;
    const email = emailOfSubject(event.event, event.storeId, event.subjectId);
    const person =
      event.event === "subscriber.subscribed"
        ? sql`select s.id from commerce.marketing_subscribers s where s.store_id = ${event.storeId}::uuid and s.id = ${event.subjectId}::uuid`
        : email
          ? sql`select s.id from (${email}) e join commerce.marketing_subscribers s on s.store_id = ${event.storeId}::uuid and lower(s.email) = lower(e.email)`
          : null;
    if (!person) continue;
    const rows = await db().execute(sql`
      insert into commerce.flow_runs (store_id, flow_id, version, subscriber_id, entry_key, path)
      select f.store_id, f.id, f.version, p.id, ${String(event.id)}, '0'
        from commerce.flows f, (${person}) p
        join commerce.marketing_subscribers s on s.id = p.id and s.status = 'subscribed'
       where f.store_id = ${event.storeId}::uuid and f.enabled and f.trigger = ${event.event}
      on conflict do nothing
      returning id`);
    entered += rows.length;
  }
  await advanceCursor(READER, batch.lastId, batch.claim);
  return entered;
}

// ---------------------------------------------------------------------------
// Moving on
// ---------------------------------------------------------------------------

const dueRow = z.object({
  id: col.uuid,
  store_id: col.uuid,
  flow_id: col.uuid,
  subscriber_id: col.uuid,
  path: col.textOrNull,
  entered_at: col.timestamp,
  steps: z.unknown(),
  goals: z.unknown(),
  email: col.text,
  locale: col.text,
  market_code: col.textOrNull,
  token: col.text,
  status: col.text,
  person_name: col.text,
  company: col.text,
});

export type FlowRunResult = { sent: number; suppressed: number; waiting: number; ended: number };

/** Moves each due run on, once (a run never takes two steps that send in one turn). Never throws. */
export async function runFlows(options: { now?: Date; only?: string } = {}): Promise<FlowRunResult> {
  const now = options.now ?? new Date();
  const result: FlowRunResult = { sent: 0, suppressed: 0, waiting: 0, ended: 0 };
  let due: z.infer<typeof dueRow>[];
  try {
    due = await typedRows(
      dueRow,
      sql`
        with claimed as (
          update commerce.flow_runs r set claimed_until = ${now.toISOString()}::timestamptz + interval '5 minutes'
           where r.id in (
             select id from commerce.flow_runs
              where status = 'running' and wake_at <= ${now.toISOString()}::timestamptz
                and (claimed_until is null or claimed_until < ${now.toISOString()}::timestamptz)
                ${options.only ? sql`and store_id = ${options.only}::uuid` : sql``}
              order by wake_at limit ${RUN_BATCH} for update skip locked)
          returning r.id, r.store_id, r.flow_id, r.version, r.path, r.entered_at, r.subscriber_id
        )
        select c.id, c.store_id, c.flow_id, c.subscriber_id, c.path, c.entered_at, v.steps, v.goals, s.email, s.locale, s.market_code, s.token, s.status,
          coalesce(nullif(s.name, ''), (select cu.name from commerce.customers cu where cu.store_id = s.store_id and cu.id = s.customer_id), '') as person_name,
          coalesce((select cu.company_name from commerce.customers cu where cu.store_id = s.store_id and cu.id = s.customer_id), '') as company
          from claimed c
          join commerce.flow_versions v on v.flow_id = c.flow_id and v.version = c.version
          join commerce.marketing_subscribers s on s.store_id = c.store_id and s.id = c.subscriber_id`,
    );
  } catch (error) {
    log("error", "flows.claim_failed", {}, error);
    return result;
  }
  const stores = new Map<string, EmailStore | null>();
  const rooms = new Map<string, number>();
  for (const run of due) {
    try {
      await moveOn(run, now, stores, rooms, result);
    } catch (error) {
      log("error", "flows.move_failed", { run: run.id }, error);
    }
  }
  return result;
}

async function settle(run: { id: string; store_id: string }, set: { path: FlowPath | null; wakeAt?: Date; end?: "goal" | "done" | "stopped" }) {
  if (set.end) {
    await db().execute(sql`
      update commerce.flow_runs set status = ${set.end}, ended_at = now(), path = null, claimed_until = null
       where store_id = ${run.store_id}::uuid and id = ${run.id}::uuid`);
    return;
  }
  await db().execute(sql`
    update commerce.flow_runs set path = ${set.path ? pathText(set.path) : null}, wake_at = ${(set.wakeAt ?? new Date()).toISOString()}::timestamptz, claimed_until = null
     where store_id = ${run.store_id}::uuid and id = ${run.id}::uuid`);
}

async function factsFor(run: z.infer<typeof dueRow>, steps: FlowStep[], store: EmailStore | null): Promise<FlowFacts> {
  const ordered = await typedRow(
    z.object({ n: col.int }),
    sql`select count(*)::int as n from commerce.orders o
         where o.store_id = ${run.store_id}::uuid and lower(o.email) = lower(${run.email}) and o.placed_at > ${run.entered_at}::timestamptz
           and o.restricted_at is null and ${PAID}`,
  );
  const named = JSON.stringify(steps).match(/"segmentId":"([0-9a-f-]{36})"/g)?.map((m) => m.slice(13, -1)) ?? [];
  const segments = named.length > 0 && store ? await segmentsOfAddress(store, run.email, named) : new Set<string>();
  // A press on a link in this flow's emails since they entered (D767, kept per person as broadcasts' are, D754).
  const clicked = await typedRow(
    z.object({ n: col.int }),
    sql`select count(*)::int as n from commerce.email_clicks k where k.store_id = ${run.store_id}::uuid and k.flow_id = ${run.flow_id}::uuid
          and k.subscriber_id = ${run.subscriber_id}::uuid and k.clicked_at >= ${run.entered_at}::timestamptz`,
  );
  return { orderedSinceEntry: (ordered?.n ?? 0) > 0, clickedFlowEmail: (clicked?.n ?? 0) > 0, segments };
}

async function moveOn(
  run: z.infer<typeof dueRow>,
  now: Date,
  stores: Map<string, EmailStore | null>,
  rooms: Map<string, number>,
  result: FlowRunResult,
): Promise<void> {
  if (run.status !== "subscribed") {
    await settle(run, { path: null, end: "stopped" });
    result.ended++;
    return;
  }
  const steps = z.array(flowStepSchema).parse(run.steps);
  const goals = z.array(z.object({ kind: z.literal("ordered") })).parse(run.goals);
  if (!stores.has(run.store_id)) stores.set(run.store_id, await storeById(run.store_id));
  const store = stores.get(run.store_id) ?? null;
  const path = run.path === null ? null : pathOf(run.path);
  const move = advance(steps, goals, path, await factsFor(run, steps, store));
  if (move.do === "end") {
    await settle(run, { path: null, end: move.reason });
    result.ended++;
    return;
  }
  if (move.do === "wait") {
    await settle(run, { path: move.next, wakeAt: new Date(now.getTime() + move.hours * 3_600_000) });
    result.waiting++;
    return;
  }
  // An email: held while the store's marketing is paused, waiting for the reader's daytime, then the plan's room and the contact policy.
  if (!store) {
    await settle(run, { path: null, end: "stopped" });
    result.ended++;
    return;
  }
  if (await isPaused(run.store_id)) {
    await settle(run, { path, wakeAt: new Date(now.getTime() + PAUSED_RETRY_HOURS * 3_600_000) });
    result.waiting++;
    return;
  }
  const policy = await getContactPolicy(run.store_id);
  const day = nextSendTime(now, run.market_code ?? store.markets[0]?.code ?? "NO");
  if (policy.quietHours && day.getTime() > now.getTime()) {
    await settle(run, { path, wakeAt: day });
    result.waiting++;
    return;
  }
  const held = await heldBy(run, store, now, policy, rooms);
  const key = `flow:${run.id}:${move.step.id}`;
  let outcome: "sent" | "logged" | "failed" | "suppressed" = "suppressed";
  // Products picked for this reader by code (slice 4, D653): from their latest paid order, or what they looked at; with none, no email.
  let content = move.step.content;
  let picked = true;
  if (!held && move.step.picks) {
    const kind = move.step.picks;
    const order = await typedRow(
      z.object({ id: col.uuid }),
      sql`select o.id from commerce.orders o where o.store_id = ${run.store_id}::uuid and lower(o.email) = lower(${run.email})
            and o.restricted_at is null and ${PAID} order by o.placed_at desc limit 1`,
    );
    const picks = order || kind === "browse" ? await picksFor(run.store_id, kind, order?.id ?? null, run.email) : [];
    if (picks.length === 0) picked = false;
    else content = withPicks(content, picks);
  }
  if (!held && picked) {
    const facts = await factsForEmail(store, content, run.locale, run.market_code);
    // Its links count presses, the reader's kept as theirs (D754); an email with picks keeps its links plain (the picks move its blocks).
    const tracked = !move.step.picks;
    const email = marketingEmail({
      store,
      content,
      locale: run.locale,
      marketCode: run.market_code,
      token: run.token,
      // Personal fields (M2.6): the reader's name and company, theirs on the list, else their account's.
      person: { name: run.person_name, company: run.company },
      facts,
      link: tracked ? (linkKey, _target, marketSlug) => flowClickUrl(run.flow_id, move.step.id, linkKey, marketSlug, run.subscriber_id) : undefined,
    });
    const sent = email
      ? await sendEmail({
          storeId: run.store_id,
          kind: "marketing.automation",
          to: run.email,
          email,
          fromName: store.name,
          replyTo: store.details.contactEmail ?? null,
          idempotencyKey: key,
          headers: email.headers,
        })
      : "failed";
    outcome = sent === "duplicate" ? "sent" : sent === "suppressed" ? "suppressed" : sent;
    rooms.set(run.store_id, (rooms.get(run.store_id) ?? 1) - 1);
  }
  await db().execute(sql`
    insert into commerce.flow_run_steps (store_id, run_id, step_id, outcome, suppressed_reason)
    values (${run.store_id}::uuid, ${run.id}::uuid, ${move.step.id}, ${outcome}, ${held})
    on conflict do nothing`);
  if (outcome === "sent" || outcome === "logged") result.sent++;
  else result.suppressed++;
  // Held or sent, the run goes on to the step after: a held email is not sent later.
  if (move.next) await settle(run, { path: move.next, wakeAt: now });
  else {
    await settle(run, { path: null, end: "done" });
    result.ended++;
  }
}

/** Why an email of a flow is held, or null: the plan's room this month, then the contact policy. */
async function heldBy(
  run: z.infer<typeof dueRow>,
  store: EmailStore,
  now: Date,
  policy: Awaited<ReturnType<typeof getContactPolicy>>,
  rooms: Map<string, number>,
): Promise<PolicyReason | "room" | null> {
  if (!rooms.has(run.store_id)) {
    const allowed = await limitFor(run.store_id, "marketing_emails_month");
    rooms.set(run.store_id, allowed === null ? Infinity : roomLeft(await usageNow(run.store_id, "marketing_emails_month", now), allowed));
  }
  if ((rooms.get(run.store_id) ?? 0) < 1) return "room";
  const [recent] = await recentContacts(store.id, [{ email: run.email, customerId: null }], now);
  return policyVerdict(recent, now, policy, "normal");
}

/** Runs that ended more than 90 days ago, as a statement for a `with` in the daily recipients prune (the daily route's budget holds). */
export const flowRunsPrune = () =>
  sql`delete from commerce.flow_runs where status <> 'running' and ended_at < now() - make_interval(days => ${RUNS_KEEP_DAYS})`;

/** How many days back a lapse is still entered (a pause or a late tick catches up, no further), as automations' catch-up. */
const LAPSE_CATCH_UP_DAYS = 3;

/**
 * Enters the people a lapse flow is for (slice 4, M2.3, win-back): a subscribed person whose latest paid order is the flow's days old,
 * with nothing paid since, once per such order (`lapse:{order}`) and never while a run of theirs is going. Only lapses since the flow
 * was switched on, and at most `LAPSE_CATCH_UP_DAYS` back, so switching it on or a pause never sends to everyone at once. One statement
 * for every store; returns how many runs began.
 */
export async function enterLapsed(now = new Date()): Promise<number> {
  const at = now.toISOString();
  const lapse = sql`(l.placed_at + make_interval(days => f.trigger_days))`;
  const rows = await db().execute(sql`
    insert into commerce.flow_runs (store_id, flow_id, version, subscriber_id, entry_key, path)
    select distinct on (f.id, m.id) f.store_id, f.id, f.version, m.id, 'lapse:' || l.id, '0'
      from commerce.flows f
      join commerce.orders l on l.store_id = f.store_id and l.restricted_at is null
       and l.placed_at <= ${at}::timestamptz - make_interval(days => f.trigger_days)
       and l.placed_at > ${at}::timestamptz - make_interval(days => f.trigger_days + ${LAPSE_CATCH_UP_DAYS})
      join commerce.marketing_subscribers m on m.store_id = f.store_id and lower(m.email) = lower(l.email) and m.status = 'subscribed'
     where f.enabled and f.trigger = 'customer.lapsed' and f.store_id is not null and ${lapse} >= f.enabled_at
       and exists (select 1 from commerce.orders o where o.store_id = l.store_id and o.id = l.id and ${PAID})
       and not exists (select 1 from commerce.orders o where o.store_id = l.store_id and lower(o.email) = lower(l.email)
                        and o.placed_at > l.placed_at and o.restricted_at is null and ${PAID})
     order by f.id, m.id, l.placed_at desc
    on conflict do nothing
    returning id`);
  return rows.length;
}

/** Those already asleep when a sunset flow is switched on enter at most this many a day per flow, so a long-quiet list is asked gently. */
const ASLEEP_PER_DAY = 50;

/**
 * Enters the people a sunset flow is for (email plan M2.8): on the list at least the flow's days, with no press on a link in its emails for
 * that long (presses are kept 180 days), not paused, once per time they fall asleep (`asleep:{subscriber}:{day}`). Those who fall asleep
 * after the flow was switched on enter as they do; those asleep before, at most `ASLEEP_PER_DAY` a day, so switching it on never emails a
 * whole quiet list at once.
 */
export async function enterAsleep(now = new Date()): Promise<number> {
  const at = now.toISOString();
  const rows = await db().execute(sql`
    insert into commerce.flow_runs (store_id, flow_id, version, subscriber_id, entry_key, path)
    select e.store_id, e.flow_id, e.version, e.subscriber_id, 'asleep:' || e.subscriber_id || ':' || to_char(e.slept at time zone 'UTC', 'YYYY-MM-DD'), '0'
      from (
        select f.store_id, f.id as flow_id, f.version, m.id as subscriber_id, s.slept, f.enabled_at,
               row_number() over (partition by f.id order by s.slept) as n
          from commerce.flows f
          join commerce.marketing_subscribers m on m.store_id = f.store_id and m.status = 'subscribed' and m.paused_at is null
          cross join lateral (
            select greatest(m.consented_at, coalesce((select max(c.clicked_at) from commerce.email_clicks c where c.store_id = m.store_id and c.subscriber_id = m.id), m.consented_at))
                   + make_interval(days => f.trigger_days) as slept
          ) s
         where f.enabled and f.trigger = 'subscriber.asleep' and f.store_id is not null and s.slept <= ${at}::timestamptz
           and not exists (select 1 from commerce.flow_runs r where r.flow_id = f.id and r.subscriber_id = m.id and r.entered_at >= s.slept - make_interval(days => f.trigger_days))
      ) e
     where e.slept >= e.enabled_at
        or e.n <= ${ASLEEP_PER_DAY} - (select count(*) from commerce.flow_runs r where r.flow_id = e.flow_id and r.entered_at > ${at}::timestamptz - interval '1 day')
    on conflict do nothing
    returning id`);
  return rows.length;
}

/**
 * The sunset's end (M2.8): a person whose way through a sunset flow ended without a press on any link since they entered is paused
 * (`paused_at`): their marketing email is held from then on (`sendEmail()`), never deleted or unsubscribed; a press clears it.
 */
export async function pauseSunsetRuns(): Promise<number> {
  const rows = await db().execute(sql`
    update commerce.marketing_subscribers m set paused_at = now()
      from commerce.flow_runs r join commerce.flows f on f.store_id = r.store_id and f.id = r.flow_id
     where f.trigger = 'subscriber.asleep' and r.status = 'done' and r.ended_at > now() - interval '7 days'
       and m.store_id = r.store_id and m.id = r.subscriber_id and m.paused_at is null and m.status = 'subscribed'
       and not exists (select 1 from commerce.email_clicks c where c.store_id = m.store_id and c.subscriber_id = m.id and c.clicked_at >= r.entered_at)
    returning m.id`);
  return rows.length;
}

/**
 * Enters the people a browse flow is for (slice 4, D691's browse abandonment): a subscribed customer whose latest product view is the
 * flow's days old with nothing paid since, once per day of viewing (`browse:{customer}:{day}`); only views since the flow was switched on,
 * at most `LAPSE_CATCH_UP_DAYS` back. Views exist only for signed-in subscribers who allowed marketing cookies (`recordProductView()`).
 */
export async function enterBrowsed(now = new Date()): Promise<number> {
  const at = now.toISOString();
  const due = sql`(v.last_at + make_interval(days => f.trigger_days))`;
  const rows = await db().execute(sql`
    insert into commerce.flow_runs (store_id, flow_id, version, subscriber_id, entry_key, path)
    select f.store_id, f.id, f.version, m.id, 'browse:' || c.id || ':' || to_char(v.last_at at time zone 'UTC', 'YYYY-MM-DD'), '0'
      from commerce.flows f
      join lateral (
        select cv.customer_id, max(cv.viewed_at) as last_at from commerce.customer_product_views cv where cv.store_id = f.store_id group by cv.customer_id
      ) v on true
      join commerce.customers c on c.store_id = f.store_id and c.id = v.customer_id
      join commerce.marketing_subscribers m on m.store_id = c.store_id and lower(m.email) = lower(c.email) and m.status = 'subscribed'
     where f.enabled and f.trigger = 'customer.browsed' and f.store_id is not null
       and ${due} <= ${at}::timestamptz and ${due} >= f.enabled_at and ${due} > ${at}::timestamptz - make_interval(days => ${LAPSE_CATCH_UP_DAYS})
       and not exists (select 1 from commerce.orders o where o.store_id = c.store_id and lower(o.email) = lower(c.email)
                        and o.placed_at > v.last_at and o.restricted_at is null and ${PAID})
    on conflict do nothing
    returning id`);
  return rows.length;
}

/**
 * The every-minute job's turn: while no flow is switched on anywhere (one read), nothing more; else people enter from the event log and the
 * due runs move on, whose runs may still be going after their flow was switched off. Never throws.
 */
export async function tickFlows(): Promise<void> {
  try {
    const any = await typedRow(
      z.object({ on: col.bool }),
      sql`select exists (select 1 from commerce.flows where enabled) or exists (select 1 from commerce.flow_runs where status = 'running') as on`,
    );
    if (!any?.on) return;
    await enterFlows();
    await enterLapsed();
    await enterBrowsed();
    await enterAsleep();
    await runFlows();
    // The sunset's end (M2.8): who finished it with no press is paused.
    await pauseSunsetRuns();
    // The flow guard (M3.9): hourly inside, in the first five minutes.
    await guardFlows();
  } catch (error) {
    log("error", "flows.tick_failed", {}, error);
  }
}

const personRunRow = z.object({ flow: col.text, entered_at: col.timestamp, status: col.text, ended_at: col.timestampOrNull });

/** A person's runs for their export: the flow's name, when they entered, how it stands; by the subscriber rows their addresses or account own. */
export async function flowRunsOf(storeId: string, addresses: string[], customerId: string | null): Promise<{ flow: string; enteredAt: string; status: string; endedAt: string | null }[]> {
  const rows = await typedRows(
    personRunRow,
    sql`select f.name as flow, r.entered_at, r.status, r.ended_at from commerce.flow_runs r
          join commerce.flows f on f.store_id = r.store_id and f.id = r.flow_id
          join commerce.marketing_subscribers m on m.store_id = r.store_id and m.id = r.subscriber_id
         where r.store_id = ${storeId}::uuid and (lower(m.email) = any(${textList(addresses)}) or m.customer_id = ${customerId}::uuid)
         order by r.entered_at`,
  );
  return rows.map((r) => ({ flow: r.flow, enteredAt: r.entered_at, status: r.status, endedAt: r.ended_at }));
}

/** Whether the store sends a browse email now: its browse automation, or a switched-on flow that starts from product views (D691). */
export const BROWSE_ON = (store: ReturnType<typeof sql>) => sql`(
  exists (select 1 from commerce.automations a where a.store_id = ${store} and a.kind = 'browse' and a.enabled)
  or exists (select 1 from commerce.flows f where f.store_id = ${store} and f.trigger = 'customer.browsed' and f.enabled))`;

/** Whether the store keeps product views now (D691): a browse email on, so segments may ask what a customer looked at (M2.4). */
export async function viewsKept(storeId: string): Promise<boolean> {
  const row = await typedRow(z.object({ on: col.bool }), sql`select ${BROWSE_ON(sql`${storeId}::uuid`)} as on`);
  return row?.on ?? false;
}

/** Deletes the store's product views when no browse email is on any more (D691: nothing kept for an email that will not go). */
export async function dropProductViewsUnlessBrowsing(storeId: string): Promise<void> {
  await db().execute(sql`delete from commerce.customer_product_views where store_id = ${storeId}::uuid and not ${BROWSE_ON(sql`${storeId}::uuid`)}`);
}

// ---------------------------------------------------------------------------
// Presses on a flow's links (D767): counted through the broadcasts' click route, kept per person (D754)
// ---------------------------------------------------------------------------

/** The click address of a link in a flow's email: the flow, its step and the link (`{step}~{link}`), the market, the reader's signed reference. */
export function flowClickUrl(flowId: string, stepId: string, linkKey: string, marketSlug: string, subscriberId: string): string {
  const ref = clickRef(flowId, subscriberId);
  const query = [marketSlug && `m=${encodeURIComponent(marketSlug)}`, ref && `p=${encodeURIComponent(ref)}`].filter(Boolean).join("&");
  return `${siteUrl()}/api/marketing/c/${flowId}/${encodeURIComponent(`${stepId}~${linkKey}`)}${query ? `?${query}` : ""}`;
}

/**
 * The address a link of a flow's email goes to, keeping the press as the reader's when their reference is genuine; null when there is no
 * such link. The link is looked up in the flow's own saved words (the newest version holding the step), never where the store did not write.
 */
export async function recordFlowClick(flowId: string, key: string, marketSlug: string | null, ref: string | null): Promise<string | null> {
  const tilde = key.indexOf("~");
  const stepId = key.slice(0, tilde);
  const linkKey = key.slice(tilde + 1);
  if (!z.uuid().safeParse(flowId).success || !/^[a-z0-9-]{1,24}$/.test(stepId) || linkKey.length > 20) return null;
  const versions = await typedRows(
    z.object({ store_id: col.uuid, steps: z.unknown() }),
    sql`select v.store_id, v.steps from commerce.flow_versions v where v.flow_id = ${flowId}::uuid order by v.version desc limit 20`,
  );
  for (const v of versions) {
    const parsed = z.array(flowStepSchema).safeParse(v.steps);
    const step = parsed.success ? findStep(parsed.data, stepId) : null;
    if (!step || step.kind !== "email") continue;
    const target = linkTarget(step.content, linkKey);
    if (!target) return null;
    const store = await storeById(v.store_id);
    if (!store) return null;
    const market = marketSlug && store.markets.some((m) => m.code.toLowerCase() === marketSlug) ? marketSlug : marketSlugFor(store, null);
    if (ref) await keepFlowClick(v.store_id, flowId, stepId, linkKey, ref);
    return resolverFor(store, market)(target);
  }
  return null;
}

// ---------------------------------------------------------------------------
// The dry run's reach (email plan M3.5)
// ---------------------------------------------------------------------------

/** The days the dry run looks back over to judge the next as many. */
export const REACH_DAYS = 30;

/**
 * About how many people would start a flow in the next `REACH_DAYS` days, from real data (M3.5): for an event, the people on the list behind
 * its events of the last as many days (`emailOfSubjectAt()`); for a lapse, the customers whose lapse falls in the next as many days; for
 * browsing, the signed-in subscribers with views kept now (they are kept a week, D691). Read only; nothing is sent or entered.
 */
export async function flowReach(storeId: string, trigger: string, triggerDays: number | null): Promise<number> {
  const store = sql`${storeId}::uuid`;
  const n = z.object({ n: col.int });
  if (trigger === "subscriber.subscribed") {
    const row = await typedRow(n, sql`
      select count(distinct s.id)::int as n from commerce.events e
        join commerce.marketing_subscribers s on s.store_id = e.store_id and s.id = e.subject_id and s.status = 'subscribed'
       where e.store_id = ${store} and e.event = ${trigger} and e.at > now() - make_interval(days => ${REACH_DAYS})`);
    return row?.n ?? 0;
  }
  if (trigger === "customer.lapsed") {
    const days = triggerDays ?? 90;
    const row = await typedRow(n, sql`
      select count(distinct s.id)::int as n from commerce.orders l
        join commerce.marketing_subscribers s on s.store_id = l.store_id and lower(s.email) = lower(l.email) and s.status = 'subscribed'
       where l.store_id = ${store} and l.restricted_at is null
         and l.placed_at + make_interval(days => ${days}) between now() and now() + make_interval(days => ${REACH_DAYS})
         and exists (select 1 from commerce.orders o where o.store_id = l.store_id and o.id = l.id and ${PAID})
         and not exists (select 1 from commerce.orders o where o.store_id = l.store_id and lower(o.email) = lower(l.email) and o.placed_at > l.placed_at and ${PAID})`);
    return row?.n ?? 0;
  }
  if (trigger === "customer.browsed") {
    const row = await typedRow(n, sql`
      select count(distinct s.id)::int as n from commerce.customer_product_views cv
        join commerce.customers c on c.store_id = cv.store_id and c.id = cv.customer_id
        join commerce.marketing_subscribers s on s.store_id = c.store_id and lower(s.email) = lower(c.email) and s.status = 'subscribed'
       where cv.store_id = ${store}`);
    return row?.n ?? 0;
  }
  const email = emailOfSubjectAt(trigger, sql`e.store_id`, sql`e.subject_id`);
  if (!email) return 0;
  const row = await typedRow(n, sql`
    select count(distinct s.id)::int as n from commerce.events e
      cross join lateral (${email}) em
      join commerce.marketing_subscribers s on s.store_id = e.store_id and lower(s.email) = lower(em.email) and s.status = 'subscribed'
     where e.store_id = ${store} and e.event = ${trigger} and e.at > now() - make_interval(days => ${REACH_DAYS})`);
  return row?.n ?? 0;
}

/**
 * The flow's own past for each step's reach (M3.5, `stepReach()`): its ways through that have ended (kept 90 days, RUNS_KEEP_DAYS), and how
 * many of them came to each step, whatever happened there. A way still running is left out: it has not come to its later steps yet.
 */
export async function flowStepPast(storeId: string, flowId: string): Promise<{ ended: number; reached: Map<string, number> }> {
  const [ended, rows] = await Promise.all([
    typedRow(
      z.object({ n: col.int }),
      sql`select count(*)::int as n from commerce.flow_runs r where r.store_id = ${storeId}::uuid and r.flow_id = ${flowId}::uuid and r.status <> 'running'`,
    ),
    typedRows(
      z.object({ step_id: z.string(), n: col.int }),
      sql`select st.step_id, count(*)::int as n from commerce.flow_run_steps st
            join commerce.flow_runs r on r.store_id = st.store_id and r.id = st.run_id
           where st.store_id = ${storeId}::uuid and r.flow_id = ${flowId}::uuid and r.status <> 'running'
           group by st.step_id`,
    ),
  ]);
  return { ended: ended?.n ?? 0, reached: new Map(rows.map((r) => [r.step_id, r.n])) };
}

// ---------------------------------------------------------------------------
// The report in words (email plan M3.8)
// ---------------------------------------------------------------------------

/**
 * A flow's last `REACH_DAYS` days (M3.8): who started it, its emails sent, the paid orders credited to them by the one rule (each order to
 * the latest message its buyer got, D761, `orderCredit()`), the step that took the most, and who left the list on the way (runs ended as
 * stopped). The page says it in words with one suggestion (`flowSuggestion()`).
 */
export async function flowReport(storeId: string, flowId: string): Promise<FlowReport> {
  const now = new Date();
  const from = new Date(now.getTime() - REACH_DAYS * 86_400_000);
  const [counts, credit] = await Promise.all([
    typedRow(
      z.object({ entered: col.int, left: col.int, sent: col.int }),
      sql`select
            (select count(*)::int from commerce.flow_runs r where r.store_id = ${storeId}::uuid and r.flow_id = ${flowId}::uuid and r.entered_at >= ${from.toISOString()}::timestamptz) as entered,
            (select count(*)::int from commerce.flow_runs r where r.store_id = ${storeId}::uuid and r.flow_id = ${flowId}::uuid and r.status = 'stopped' and r.ended_at >= ${from.toISOString()}::timestamptz) as left,
            (select count(*)::int from commerce.flow_run_steps st join commerce.flow_runs r on r.store_id = st.store_id and r.id = st.run_id
              where st.store_id = ${storeId}::uuid and r.flow_id = ${flowId}::uuid and st.outcome in ('sent', 'logged') and st.created_at >= ${from.toISOString()}::timestamptz) as sent`,
    ),
    orderCredit(storeId, from, now),
  ]);
  const prefix = `flow:${flowId}:`;
  let orders = 0;
  const minor: Record<string, number> = {};
  let topStep: FlowReport["topStep"] = null;
  for (const [key, c] of credit) {
    if (!key.startsWith(prefix)) continue;
    orders += c.orders;
    for (const [cur, amount] of Object.entries(c.minor)) minor[cur] = (minor[cur] ?? 0) + amount;
    if (!topStep || c.orders > topStep.orders) topStep = { id: key.slice(prefix.length), orders: c.orders };
  }
  return { entered: counts?.entered ?? 0, sent: counts?.sent ?? 0, orders, minor, topStep, left: counts?.left ?? 0 };
}
