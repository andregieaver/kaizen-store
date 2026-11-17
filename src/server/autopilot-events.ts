import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import {
  ALERT_CHECK_HOURS,
  AUTOPILOT_READER,
  DELIVERY_PROBLEM_PHASES,
  EVENT_ALERT_SEVERITIES,
  EVENT_CLAIM_MINUTES,
  EVENT_KEEP_DAYS,
  EVENT_KINDS,
  EVENT_STALE_HOURS,
  EVENT_TOOLS,
  EVENTS_PER_DAY,
  EVENTS_PER_RUN,
  eventMessage,
  eventRef,
  eventsByKind,
  FAILED_PAYMENTS_HOURS,
  FAILED_PAYMENTS_MIN,
  FAILED_PAYMENTS_SHARE,
  LOG_BATCH,
  LOG_ROUNDS,
  LOGGED_EVENTS,
  ORDER_EVENT_DAYS,
  ORDER_UNSENT_HOURS,
  STOCKOUT_PER_CHECK,
  stockoutCheckDue,
  TEST_ENDED_DAYS,
  type EventFacts,
  type EventKind,
} from "@/lib/autopilot-events";
import { startDecision } from "@/lib/autopilot-reviews";
import { can } from "@/lib/permissions";

import { noticeApproval } from "./assistant-notices";
import { actingAs } from "./actor";
import { aiFor, type AiConnection } from "./ai";
import { alertsForStore } from "./analytics-insights";
import { startPlanByAutopilot, stopPlanIn, type PlanActor } from "./autopilot-plans";
import { principalOf } from "./autopilot-runner";
import { aiBudgetSpent, autonomyFor } from "./autopilot-settings";
import { tracked } from "./cron-runs";
import { consumeEvents } from "./event-log";
import { log } from "./log";
import { restockSuggestions } from "./owner-insights";
import { holderOfPrincipal, keepForApproval, runTurn, type Principal, type TurnInput } from "./owner-assistant";
import { refreshTag } from "./refresh";
import { getStore } from "./stores";
import { col, typedRow, typedRows } from "./typed-rows";
import { skipWhilePaused } from "./ai-pause";

/**
 * The autopilot reacts to what happens (D331, `docs/ai-autopilot.md` 15), the only writer of `commerce.autopilot_events` and
 * `autopilot_event_checks`: from `/api/cron/autopilot`, after the reviews, `detectEvents()` finds a customer waiting for a person, an A/B test
 * that ended by itself and an urgent analytics alert in stores that react, and `runEvents()` answers each once with a headless turn that has
 * only the event's tools, within the owner's levels and budgets. Since E4.2 (D729) what the event log carries (`LOGGED_EVENT_KINDS`) is read
 * from it with the autopilot's own cursor, inside `tracked("autopilot.event-log")`; the scans left are for what time passing makes.
 */

/** The longest an event's turn may take. */
const TURN_MS = 120_000;
/** The most changes made at *Do it and tell me* an event keeps (a turn's few calls; more would be an event doing a plan's work). */
const TOLD_KEPT = 20;
/** Stores whose alerts are read in one run: the read is heavy, and the next run takes the rest. */
const ALERT_STORES_PER_RUN = 3;

export type EventDeps = {
  /** The turn; `runTurn()` unless given (tests). */
  turn?: (input: TurnInput) => Promise<void>;
  /** The AI connection the turn uses; the store's for the feature `autopilot` unless given (tests). */
  connection?: AiConnection | null;
  /** The store's alerts; `alertsForStore()` unless given (tests). */
  alerts?: typeof alertsForStore;
  /** No event is answered after this. */
  deadline?: number;
  /** Check stock for risks in this run, whatever the hour (tests); by the clock unless given (`stockoutCheckDue()`). */
  stockoutCheck?: boolean;
  now?: Date;
};

export type EventRun = { found: number; done: number; planned: number; started: number; skipped: number; failed: number };

const FACTS = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("support_waiting"), conversation: z.string(), waitedMinutes: z.number(), handoffReason: z.string().nullable() }),
  z.object({ kind: z.literal("test_ended"), experiment: z.string(), name: z.string(), stopReason: z.enum(["guardrail", "planned_end"]), stoppedAt: z.string() }),
  z.object({ kind: z.literal("alert"), alert: z.string(), severity: z.string(), text: z.string(), evidence: z.array(z.string()) }),
  z.object({ kind: z.literal("order_unsent"), order: z.string(), orderId: z.string(), hours: z.number() }),
  z.object({ kind: z.literal("delivery_problem"), order: z.string(), orderId: z.string(), shipment: z.string(), phase: z.enum(DELIVERY_PROBLEM_PHASES) }),
  z.object({ kind: z.literal("supplier_problem"), order: z.string(), orderId: z.string(), supplierOrder: z.string(), supplier: z.string(), state: z.enum(["problem", "late"]) }),
  z.object({ kind: z.literal("order_held"), order: z.string(), orderId: z.string(), byRule: z.boolean() }),
  z.object({ kind: z.literal("dispute_opened"), order: z.string(), orderId: z.string(), dispute: z.string(), reason: z.string(), dueBy: z.string().nullable() }),
  z.object({ kind: z.literal("payments_failing"), window: z.string(), failed: z.number(), attempts: z.number() }),
  z.object({ kind: z.literal("stockout_risk"), sku: z.string(), product: z.string(), lastsDays: z.number().nullable(), leadDays: z.number(), suggested: z.number() }),
  z.object({ kind: z.literal("staff_request"), request: z.string(), ask: z.enum(["change_address", "cancel_order"]), order: z.string() }),
  z.object({ kind: z.literal("test_answered"), experiment: z.string(), name: z.string(), answeredAt: z.string() }),
  z.object({ kind: z.literal("exchange_confirmed"), exchange: z.string(), return: z.string(), order: z.string() }),
]);

/** The stores that react now: the switch on, not paused, the store open. */
const REACTING = sql`
  select a.store_id, coalesce((a.planning ->> 'waitMinutes')::int, 15) as wait_minutes
  from commerce.autopilot_settings a
  where a.store_id is not null and not a.paused and coalesce((a.planning ->> 'reacts')::boolean, false)
    and commerce.store_is_active(a.store_id)
`;

/**
 * Finds the events of every store that reacts and keeps each once; returns how many were new. What the event log carries is read from it
 * (`readLoggedEvents()`, E4.2); the scans below are only for what time passing makes (a test's end is the one exception: the log has no
 * event for it yet).
 */
export async function detectEvents(deps: EventDeps = {}): Promise<number> {
  const now = deps.now ?? new Date();
  const logged = await readLog(now);
  // Not an event of the log yet: a test stopped by its guardrail or its planned end (`stopExperiment()`) is found by its row.
  const tests = await db().execute(sql`
    with reacting as (${REACTING})
    insert into commerce.autopilot_events (store_id, kind, ref, facts)
    select e.store_id, 'test_ended', e.id::text,
      jsonb_build_object('kind', 'test_ended', 'experiment', e.id, 'name', e.name, 'stopReason', e.stop_reason, 'stoppedAt', e.stopped_at)
    from commerce.experiments e
    join reacting r on r.store_id = e.store_id
    where e.status = 'stopped' and e.stop_reason in ('guardrail', 'planned_end')
      and e.stopped_at > ${now.toISOString()}::timestamptz - make_interval(days => ${TEST_ENDED_DAYS})
      -- The autopilot's own tests of its changes are decided by the store, by code (E4.1, D729), never by an event's turn.
      and not exists (select 1 from commerce.autopilot_tests t where t.store_id = e.store_id and t.experiment_id = e.id)
    on conflict (store_id, kind, ref) do nothing
    returning id
  `);
  return logged + tests.length + (await detectOrderEvents(now)) + (await detectAlerts(now, deps)) + (await detectStockoutRisks(now, deps));
}

/** The log's reader as a job of its own (`autopilot.event-log` in `commerce.cron_jobs`): a failure is kept and shown, the rest goes on. */
const readLog = async (now: Date): Promise<number> => (await tracked("autopilot.event-log", 60, () => readLoggedEvents(now))) ?? 0;

/**
 * The kinds the event log carries (`LOGGED_EVENT_KINDS`), read with the autopilot's own cursor: a few batches a run, each kind's rows
 * written in one statement from what its events are about, as the scans wrote them (the same reference, `on conflict do nothing`). Only a
 * store that reacts now and is open for jobs (`REACTING`: never a template, a sandbox or a closed store) keeps its events, and only those
 * younger than `EVENT_STALE_HOURS`; the platform's own events (no store) are never the store autopilot's. A batch that fails is read again.
 */
async function readLoggedEvents(now: Date): Promise<number> {
  let found = 0;
  for (let round = 0; round < LOG_ROUNDS; round++) {
    const read = await consumeEvents(AUTOPILOT_READER, { events: LOGGED_EVENTS, limit: LOG_BATCH, claimSeconds: 120 }, async (events) => {
      for (const [kind, of] of eventsByKind(events)) found += await keepLogged(kind, of.map((e) => e.id), now);
    });
    if (read.busy || read.handled < LOG_BATCH) break;
  }
  return found;
}

/** One kind's logged events as autopilot events: what each is about, read where it lives, kept when it still asks for a look. */
async function keepLogged(kind: EventKind, ids: readonly number[], now: Date): Promise<number> {
  if (ids.length === 0) return 0;
  const at = now.toISOString();
  const logged = sql`
    select e.store_id, e.subject_id from commerce.events e
    where e.id = any(${`{${ids.map((id) => Math.trunc(id)).join(",")}}`}::bigint[]) and e.store_id is not null and e.subject_id is not null
      and e.at > ${at}::timestamptz - make_interval(hours => ${EVENT_STALE_HOURS})
  `;
  const query =
    kind === "support_waiting"
      ? // The desk's waiting alert (`support.waiting`): the conversation still waits for a person. `runEvents()` holds the row until the
        // store's own minutes have passed.
        sql`
          with reacting as (${REACTING}), logged as (${logged})
          insert into commerce.autopilot_events (store_id, kind, ref, facts)
          select distinct on (c.id) c.store_id, 'support_waiting', c.id::text,
            jsonb_build_object('kind', 'support_waiting', 'conversation', c.id, 'handoffReason', c.handoff_reason,
              'waitedMinutes', floor(extract(epoch from (${at}::timestamptz - c.queued_at)) / 60)::int)
          from logged l
          join reacting r on r.store_id = l.store_id
          join commerce.support_conversations c on c.store_id = l.store_id and c.id = l.subject_id
          where c.status = 'open' and c.handler = 'queue' and c.anonymised_at is null and c.queued_at is not null
          on conflict (store_id, kind, ref) do nothing
          returning id
        `
      : kind === "test_answered"
        ? // A running test's first answer (D670, `experiment.answered`), kept once per test.
          sql`
            with reacting as (${REACTING}), logged as (${logged})
            insert into commerce.autopilot_events (store_id, kind, ref, facts)
            select distinct on (e.id) e.store_id, 'test_answered', e.id::text,
              jsonb_build_object('kind', 'test_answered', 'experiment', e.id, 'name', e.name, 'answeredAt', e.answered_at)
            from logged l
            join reacting r on r.store_id = l.store_id
            join commerce.experiments e on e.store_id = l.store_id and e.id = l.subject_id
            where e.status = 'running' and e.answered_at is not null
              -- The autopilot's own tests of its changes are decided by the store, by code (E4.1, D729), never by an event's turn.
              and not exists (select 1 from commerce.autopilot_tests t where t.store_id = e.store_id and t.experiment_id = e.id)
            on conflict (store_id, kind, ref) do nothing
            returning id
          `
        : kind === "delivery_problem"
          ? // A parcel whose tracking moved on (`fulfilment.updated`) into trouble: its phase now, so one that moved on again is let go.
            sql`
              with reacting as (${REACTING}), logged as (${logged})
              insert into commerce.autopilot_events (store_id, kind, ref, facts)
              select distinct on (t.shipment_id) t.store_id, 'delivery_problem', t.shipment_id::text || ':' || t.phase,
                jsonb_build_object('kind', 'delivery_problem', 'order', o.number, 'orderId', o.id, 'shipment', t.shipment_id, 'phase', t.phase)
              from logged l
              join reacting r on r.store_id = l.store_id
              join commerce.shipment_tracking t on t.store_id = l.store_id and t.shipment_id = l.subject_id
              join commerce.orders o on o.store_id = t.store_id and o.id = t.order_id
              join commerce.shipments sh on sh.store_id = t.store_id and sh.id = t.shipment_id and sh.undone_at is null
              where t.phase in ('problem', 'attempted', 'returned_to_sender') and o.copied_from is null
              on conflict (store_id, kind, ref) do nothing
              returning id
            `
          : null;
  if (!query) return 0;
  return (await db().execute(query)).length;
}

/** The window failed payments are counted in, as its reference: the day and the hour it began (`FAILED_PAYMENTS_HOURS` long). */
export const paymentsWindow = (now: Date): string => {
  const hour = Math.floor(now.getUTCHours() / FAILED_PAYMENTS_HOURS) * FAILED_PAYMENTS_HOURS;
  return `${now.toISOString().slice(0, 10)}T${String(hour).padStart(2, "0")}`;
};

/**
 * Orders that need a look (`docs/100-day-challenge.md` C5), each kept once: a paid order with goods to send and no parcel after
 * `ORDER_UNSENT_HOURS`; a drop-ship supplier's order refused or late; an order held; a dispute that waits for an answer; failed payments
 * piling up in a window; a customer's request code may carry out; an exchange confirmed. Recent ones only (`ORDER_EVENT_DAYS`); copied orders
 * never. A parcel in trouble is read from the event log since E4.2 (`fulfilment.updated`, `readLoggedEvents()`). What stays here is time
 * passing (unsent, late, a window of payments) or has no event in the log yet (a supplier's refusal, a hold, a dispute, a request, an exchange).
 */
async function detectOrderEvents(now: Date): Promise<number> {
  const at = now.toISOString();
  const since = sql`${at}::timestamptz - make_interval(days => ${ORDER_EVENT_DAYS})`;
  const queries = [
    sql`
      with reacting as (${REACTING})
      insert into commerce.autopilot_events (store_id, kind, ref, facts)
      select o.store_id, 'order_unsent', o.id::text,
        jsonb_build_object('kind', 'order_unsent', 'order', o.number, 'orderId', o.id, 'hours', floor(extract(epoch from (${at}::timestamptz - o.placed_at)) / 3600)::int)
      from commerce.orders o
      join reacting r on r.store_id = o.store_id
      where o.status = 'paid' and o.held_at is null and o.copied_from is null
        and o.placed_at < ${at}::timestamptz - make_interval(hours => ${ORDER_UNSENT_HOURS}) and o.placed_at > ${since}
        and exists (select 1 from commerce.order_lines l where l.store_id = o.store_id and l.order_id = o.id and l.delivery = 'physical')
        and not exists (select 1 from commerce.shipments sh where sh.store_id = o.store_id and sh.order_id = o.id and sh.undone_at is null)
      on conflict (store_id, kind, ref) do nothing
      returning id
    `,
    sql`
      with reacting as (${REACTING})
      insert into commerce.autopilot_events (store_id, kind, ref, facts)
      select so.store_id, 'supplier_problem', so.id::text || ':' || x.state,
        jsonb_build_object('kind', 'supplier_problem', 'order', o.number, 'orderId', o.id, 'supplierOrder', so.id, 'supplier', s.name, 'state', x.state)
      from commerce.supplier_orders so
      join reacting r on r.store_id = so.store_id
      join commerce.suppliers s on s.store_id = so.store_id and s.id = so.supplier_id
      join commerce.orders o on o.store_id = so.store_id and o.id = so.order_id
      cross join lateral (
        select case when so.state = 'problem' then 'problem'
                    when so.state = 'sent' and so.sent_at < ${at}::timestamptz - make_interval(days => (ceil(s.dispatch_days * 7 / 5.0) + 1)::int) then 'late' end as state
      ) x
      where x.state is not null and so.created_at > ${since}
      on conflict (store_id, kind, ref) do nothing
      returning id
    `,
    sql`
      with reacting as (${REACTING})
      insert into commerce.autopilot_events (store_id, kind, ref, facts)
      select o.store_id, 'order_held', o.id::text,
        jsonb_build_object('kind', 'order_held', 'order', o.number, 'orderId', o.id, 'byRule', o.held_by_rule is not null)
      from commerce.orders o
      join reacting r on r.store_id = o.store_id
      where o.held_at is not null and o.held_at > ${since} and o.status in ('paid', 'authorized') and o.copied_from is null
      on conflict (store_id, kind, ref) do nothing
      returning id
    `,
    sql`
      with reacting as (${REACTING})
      insert into commerce.autopilot_events (store_id, kind, ref, facts)
      select d.store_id, 'dispute_opened', d.id::text,
        jsonb_build_object('kind', 'dispute_opened', 'order', o.number, 'orderId', o.id, 'dispute', d.id, 'reason', coalesce(d.reason, 'not given'), 'dueBy', d.evidence_due_by)
      from commerce.payment_disputes d
      join reacting r on r.store_id = d.store_id
      join commerce.orders o on o.store_id = d.store_id and o.id = d.order_id
      where d.status in ('needs_response', 'warning_needs_response') and not d.test_mode and d.opened_at > ${since}
      on conflict (store_id, kind, ref) do nothing
      returning id
    `,
    // A customer confirmed the exchange proposed for their return (B3, D675), still within its time.
    sql`
      with reacting as (${REACTING})
      insert into commerce.autopilot_events (store_id, kind, ref, facts)
      select x.store_id, 'exchange_confirmed', x.id::text, jsonb_build_object('kind', 'exchange_confirmed', 'exchange', x.id, 'return', r.number, 'order', o.number)
      from commerce.return_exchanges x
      join reacting re on re.store_id = x.store_id
      join commerce.returns r on r.store_id = x.store_id and r.id = x.return_id
      join commerce.orders o on o.store_id = x.store_id and o.id = x.order_id and o.restricted_at is null and o.anonymised_at is null
      where x.status = 'confirmed' and x.confirmed_at > ${since} and (x.expires_at is null or x.expires_at > ${at}::timestamptz)
      on conflict (store_id, kind, ref) do nothing
      returning id
    `,
    sql`
      with reacting as (${REACTING}),
      counted as (
        select p.store_id, count(*) filter (where p.status = 'failed')::int as failed, count(*)::int as attempts
        from commerce.payments p join reacting r on r.store_id = p.store_id
        where p.created_at > ${at}::timestamptz - make_interval(hours => ${FAILED_PAYMENTS_HOURS})
        group by p.store_id
      )
      insert into commerce.autopilot_events (store_id, kind, ref, facts)
      select c.store_id, 'payments_failing', ${paymentsWindow(now)},
        jsonb_build_object('kind', 'payments_failing', 'window', ${paymentsWindow(now)}::text, 'failed', c.failed, 'attempts', c.attempts)
      from counted c
      where c.failed >= ${FAILED_PAYMENTS_MIN} and c.failed >= c.attempts * ${FAILED_PAYMENTS_SHARE}::numeric
      on conflict (store_id, kind, ref) do nothing
      returning id
    `,
    // A customer's request code may carry out (B3, D640): an address change (with the new address as fields) or a cancellation, asked on the
    // store's chat by the order's own signed-in customer, or by email and confirmed from the order's own address (D685), the order paid, not
    // held and nothing of it sent. Any other request stays a person's.
    sql`
      with reacting as (${REACTING})
      insert into commerce.autopilot_events (store_id, kind, ref, facts)
      select a.store_id, 'staff_request', a.id::text, jsonb_build_object('kind', 'staff_request', 'request', a.id, 'ask', a.kind, 'order', o.number)
      from commerce.support_actions a
      join reacting r on r.store_id = a.store_id
      join commerce.support_conversations c on c.id = a.conversation_id and c.store_id = a.store_id
      join commerce.orders o on o.store_id = a.store_id and o.number = a.args ->> 'orderNumber' and o.copied_from is null
        and o.restricted_at is null and o.anonymised_at is null
      where a.confirmer = 'staff' and a.status = 'proposed' and a.kind in ('change_address', 'cancel_order') and a.created_at > ${since}
        and (a.kind <> 'change_address' or a.args ? 'address')
        and ((c.source = 'site' and c.customer_id is not null
          and (o.customer_id = c.customer_id
            or exists (select 1 from commerce.customers cu where cu.store_id = c.store_id and cu.id = c.customer_id and lower(cu.email) = lower(o.email))))
          -- By email, once the customer confirmed it from the link sent to the order's own address (D685).
          or (c.source = 'email' and a.customer_confirmed_at is not null and lower(c.contact_email) = lower(o.email)))
        and o.status in ('paid', 'authorized') and o.held_at is null
        and not exists (select 1 from commerce.shipments sh where sh.store_id = o.store_id and sh.order_id = o.id and sh.undone_at is null)
      on conflict (store_id, kind, ref) do nothing
      returning id
    `,
  ];
  let found = 0;
  for (const query of queries) found += (await db().execute(query)).length;
  return found;
}

/** A variant's open purchase orders: a draft, or ordered and not received in full. Stock on its way is not a risk the autopilot answers. */
const OPEN_ORDER = (storeId: string, sku: string) => sql`
  exists (
    select 1 from commerce.purchase_order_lines l
    join commerce.purchase_orders po on po.store_id = l.store_id and po.id = l.purchase_order_id
    join commerce.product_variants v on v.store_id = l.store_id and v.id = l.variant_id
    where l.store_id = ${storeId}::uuid and v.sku = ${sku} and po.status in ('draft', 'ordered') and l.received < l.quantity
  )`;

/**
 * Products that may run out (`docs/100-day-challenge.md` C4): in the first minutes of every `STOCKOUT_CHECK_HOURS` hours, each reacting store's
 * own reorder forecast (`restockSuggestions()`, the same the owner and the AI read), and each variant it says to order now with nothing on its
 * way, at most `STOCKOUT_PER_CHECK` a store, kept once a week.
 */
async function detectStockoutRisks(now: Date, deps: EventDeps): Promise<number> {
  if (!(deps.stockoutCheck ?? stockoutCheckDue(now))) return 0;
  const stores = await typedRows(z.object({ store_id: col.uuid, slug: col.text }), sql`with reacting as (${REACTING}) select r.store_id, s.slug from reacting r join commerce.stores s on s.id = r.store_id`);
  const today = now.toISOString().slice(0, 10);
  let found = 0;
  for (const row of stores) {
    try {
      const store = await getStore(row.slug);
      if (!store || store.id !== row.store_id) continue;
      const suggestions = await restockSuggestions({ store }, { days: 30, cover_days: 30, lead_days: 7 });
      const urgent = suggestions.to_reorder.filter((v) => v.order_now && v.sku.trim() !== "");
      let kept = 0;
      for (const v of urgent) {
        if (kept >= STOCKOUT_PER_CHECK) break;
        const open = await typedRow(z.object({ open: col.bool }), sql`select ${OPEN_ORDER(store.id, v.sku)} as open`);
        if (open?.open) continue;
        const facts: EventFacts = { kind: "stockout_risk", sku: v.sku, product: v.product, lastsDays: v.lasts_days, leadDays: v.delivery_days ?? 7, suggested: v.suggested_order };
        const inserted = await db().execute(sql`
          insert into commerce.autopilot_events (store_id, kind, ref, facts)
          values (${store.id}::uuid, 'stockout_risk', ${eventRef(facts, today)}, ${JSON.stringify(facts)}::jsonb)
          on conflict (store_id, kind, ref) do nothing
          returning id
        `);
        found += inserted.length;
        kept++;
      }
    } catch (error) {
      log("error", "autopilot.stockout_check_failed", { store: row.store_id }, error);
    }
  }
  return found;
}

/** A few stores' alerts, each store at most once in `ALERT_CHECK_HOURS`: the check is claimed before the read, so a failure waits a day. */
async function detectAlerts(now: Date, deps: EventDeps): Promise<number> {
  const due = await typedRows(
    z.object({ store_id: col.uuid, slug: col.text }),
    sql`
      with reacting as (${REACTING}),
      claimed as (
        insert into commerce.autopilot_event_checks (store_id, alerts_at)
        select r.store_id, ${now.toISOString()}::timestamptz from reacting r
        where not exists (
          select 1 from commerce.autopilot_event_checks k
          where k.store_id = r.store_id and k.alerts_at > ${now.toISOString()}::timestamptz - make_interval(hours => ${ALERT_CHECK_HOURS})
        )
        order by r.store_id
        limit ${ALERT_STORES_PER_RUN}
        on conflict (store_id) do update set alerts_at = excluded.alerts_at
        returning store_id
      )
      select c.store_id, s.slug from claimed c join commerce.stores s on s.id = c.store_id
    `,
  );
  let found = 0;
  const today = now.toISOString().slice(0, 10);
  for (const row of due) {
    try {
      const store = await getStore(row.slug);
      if (!store || store.id !== row.store_id) continue;
      const alerts = (await (deps.alerts ?? alertsForStore)(store, now)).filter((a) => (EVENT_ALERT_SEVERITIES as readonly string[]).includes(a.severity));
      for (const alert of alerts) {
        const facts: EventFacts = {
          kind: "alert",
          alert: alert.id,
          severity: alert.severity,
          text: alert.text,
          evidence: alert.evidence.map((e) => `${e.label}: ${e.value}${e.baseline ? ` (against ${e.baseline})` : ""}`),
        };
        const kept = await db().execute(sql`
          insert into commerce.autopilot_events (store_id, kind, ref, facts)
          values (${store.id}::uuid, 'alert', ${eventRef(facts, today)}, ${JSON.stringify(facts)}::jsonb)
          on conflict (store_id, kind, ref) do nothing
          returning id
        `);
        found += kept.length;
      }
    } catch (error) {
      log("error", "autopilot.alerts_check_failed", { store: row.store_id }, error);
    }
  }
  return found;
}

const PENDING = z.object({
  id: col.uuid,
  store_id: col.uuid,
  kind: z.enum(EVENT_KINDS),
  facts: z.unknown(),
  store_slug: col.text,
  store_active: col.bool,
  updated_by: col.uuid.nullable(),
});
type Pending = z.output<typeof PENDING>;

/** Finds new events, then answers a few: at most one per store a run, within the store's events a day. */
export async function runEvents(deps: EventDeps = {}): Promise<EventRun> {
  const result: EventRun = { found: 0, done: 0, planned: 0, started: 0, skipped: 0, failed: 0 };
  const now = deps.now ?? new Date();
  // Every AI that acts on its own waits while a platform admin has paused them (PSI AST-07). Reading the log is not acting: the reader keeps
  // up (so its job is not late), and what it keeps waits as pending, answered once the pause is lifted or let go as stale.
  if (await skipWhilePaused("events")) {
    await readLog(now);
    return result;
  }
  result.found = await detectEvents(deps);
  // A run that died with an event in hand: it failed. An event nobody got to in time is no longer worth a turn.
  await db().execute(sql`
    update commerce.autopilot_events set status = 'failed', outcome = 'The reaction did not finish.', finished_at = now(), claimed_until = null
    where status = 'running' and claimed_until < now()
  `);
  await db().execute(sql`
    update commerce.autopilot_events set status = 'skipped', outcome = 'Too old to react to.', finished_at = now()
    where status = 'pending' and created_at < ${now.toISOString()}::timestamptz - make_interval(hours => ${EVENT_STALE_HOURS})
  `);
  const pending = await typedRows(
    PENDING,
    sql`
      select e.id, e.store_id, e.kind, e.facts, s.slug as store_slug, commerce.store_is_active(s.id) as store_active, a.updated_by
      from commerce.autopilot_events e
      join commerce.stores s on s.id = e.store_id
      left join commerce.autopilot_settings a on a.store_id = e.store_id
      where e.status = 'pending'
        -- A waiting customer comes from the desk's alert (the desk's minutes): the autopilot looks once the owner's own minutes have passed
        -- too, or once the customer no longer waits (then stillOpen() lets it go). Time passing, so held here, not in the log.
        and (e.kind <> 'support_waiting' or not exists (
          select 1 from commerce.support_conversations c
          where c.store_id = e.store_id and c.id::text = e.ref and c.status = 'open' and c.handler = 'queue'
            and c.queued_at > ${now.toISOString()}::timestamptz - make_interval(mins => coalesce((a.planning ->> 'waitMinutes')::int, 15))
        ))
        and (
          select count(*) from commerce.autopilot_events d
          where d.store_id = e.store_id and d.kind = e.kind and d.status in ('running', 'done', 'failed') and d.created_at > now() - interval '1 day'
        ) < (case e.kind ${sql.join(
          EVENT_KINDS.map((kind) => sql`when ${kind} then ${EVENTS_PER_DAY[kind]}::int`),
          sql` `,
        )} else 0 end)
      order by e.created_at
      limit 20
    `,
  );
  const seen = new Set<string>();
  let taken = 0;
  const work: { event: (typeof pending)[number]; settings: Awaited<ReturnType<typeof autonomyFor>> }[] = [];
  for (const event of pending) {
    if (taken >= EVENTS_PER_RUN || (deps.deadline && Date.now() > deps.deadline)) break;
    if (seen.has(event.store_id)) continue;
    const settings = await autonomyFor(event.store_id);
    // Switched off or paused since it was found: left pending, and stale after a day. The month's AI budget spent: nothing is claimed.
    if (settings.paused || !settings.planning.reacts) continue;
    if (await aiBudgetSpent(event.store_id, settings)) continue;
    const claimed = await typedRow(
      z.object({ id: col.uuid }),
      sql`
        update commerce.autopilot_events set status = 'running', claimed_until = now() + make_interval(mins => ${EVENT_CLAIM_MINUTES})
        where id = ${event.id}::uuid and status = 'pending'
        returning id
      `,
    );
    if (!claimed) continue;
    seen.add(event.store_id);
    taken++;
    work.push({ event, settings });
  }
  // Claimed one by one, run side by side: one store's long reaction never holds another's back (`docs/100-day-challenge.md` H1).
  await Promise.all(
    work.map(async ({ event, settings }) => {
      try {
        result[await reactTo(event, settings, deps)]++;
      } catch (error) {
        log("error", "autopilot.event_failed", { event: event.id }, error);
        await finish(event.id, "failed", { outcome: "Something went wrong while reacting." }).catch(() => undefined);
        result.failed++;
      }
    }),
  );
  return result;
}

async function finish(
  eventId: string,
  status: "done" | "skipped" | "failed",
  fields: { outcome: string; planId?: string; started?: boolean; accountId?: string; conversationId?: string; told?: readonly string[] },
): Promise<void> {
  // The changes made at *Do it and tell me* (D309 7.4) are kept with the event's facts, code-written summaries, for the page and the digest.
  const told = fields.told?.length ? JSON.stringify(fields.told.slice(0, TOLD_KEPT).map((t) => t.slice(0, 300))) : null;
  await db().execute(sql`
    update commerce.autopilot_events set status = ${status}, outcome = ${fields.outcome.slice(0, 500)}, plan_id = ${fields.planId ?? null}::uuid,
      facts = case when ${told}::jsonb is null then facts else facts || jsonb_build_object('told', ${told}::jsonb) end,
      started = ${fields.started ?? false}, account_id = coalesce(${fields.accountId ?? null}::uuid, account_id),
      conversation_id = coalesce(${fields.conversationId ?? null}::uuid, conversation_id), finished_at = now(), claimed_until = null
    where id = ${eventId}::uuid and status = 'running'
  `);
}

/** Whether the event still asks for a turn: the customer still waits for a person; the test is still stopped and undecided. */
async function stillOpen(storeId: string, facts: EventFacts): Promise<string | null> {
  if (facts.kind === "support_waiting") {
    const row = await typedRow(
      z.object({ waiting: col.bool }),
      sql`select (status = 'open' and handler = 'queue') as waiting from commerce.support_conversations where id = ${facts.conversation}::uuid and store_id = ${storeId}::uuid`,
    );
    return row?.waiting ? null : "A person answered, or the conversation ended, before the autopilot looked.";
  }
  if (facts.kind === "test_ended") {
    const row = await typedRow(
      z.object({ status: col.text }),
      sql`select status from commerce.experiments where id = ${facts.experiment}::uuid and store_id = ${storeId}::uuid`,
    );
    return row?.status === "stopped" ? null : "The test was decided before the autopilot looked.";
  }
  if (facts.kind === "test_answered") {
    const row = await typedRow(
      z.object({ status: col.text }),
      sql`select status from commerce.experiments where id = ${facts.experiment}::uuid and store_id = ${storeId}::uuid`,
    );
    return row?.status === "running" || row?.status === "stopped" ? null : "The test was decided before the autopilot looked.";
  }
  if (facts.kind === "order_unsent" || facts.kind === "order_held") {
    const row = await typedRow(
      z.object({ status: col.text, held: col.bool, sent: col.bool }),
      sql`select o.status::text as status, o.held_at is not null as held,
                 exists (select 1 from commerce.shipments sh where sh.store_id = o.store_id and sh.order_id = o.id and sh.undone_at is null) as sent
          from commerce.orders o where o.id = ${facts.orderId}::uuid and o.store_id = ${storeId}::uuid`,
    );
    if (facts.kind === "order_held") return row?.held ? null : "The order was released before the autopilot looked.";
    return row?.status === "paid" && !row.sent && !row.held ? null : "The order was sent, held or cancelled before the autopilot looked.";
  }
  if (facts.kind === "delivery_problem") {
    const row = await typedRow(z.object({ phase: col.text }), sql`select phase from commerce.shipment_tracking where shipment_id = ${facts.shipment}::uuid and store_id = ${storeId}::uuid`);
    return row?.phase === facts.phase ? null : "The parcel's tracking moved on before the autopilot looked.";
  }
  if (facts.kind === "supplier_problem") {
    const row = await typedRow(z.object({ state: col.text }), sql`select state from commerce.supplier_orders where id = ${facts.supplierOrder}::uuid and store_id = ${storeId}::uuid`);
    const open = facts.state === "problem" ? row?.state === "problem" : row?.state === "sent";
    return open ? null : "The supplier's order was sent again, shipped or cancelled before the autopilot looked.";
  }
  if (facts.kind === "dispute_opened") {
    const row = await typedRow(z.object({ status: col.text }), sql`select status from commerce.payment_disputes where id = ${facts.dispute}::uuid and store_id = ${storeId}::uuid`);
    return row?.status === "needs_response" || row?.status === "warning_needs_response" ? null : "The dispute was answered or closed before the autopilot looked.";
  }
  if (facts.kind === "staff_request") {
    const row = await typedRow(z.object({ status: col.text }), sql`select status from commerce.support_actions where id = ${facts.request}::uuid and store_id = ${storeId}::uuid`);
    return row?.status === "proposed" ? null : "A person decided the request before the autopilot looked.";
  }
  if (facts.kind === "exchange_confirmed") {
    const row = await typedRow(z.object({ status: col.text }), sql`select status from commerce.return_exchanges where id = ${facts.exchange}::uuid and store_id = ${storeId}::uuid`);
    return row?.status === "confirmed" ? null : "The exchange was processed, cancelled or ran out before the autopilot looked.";
  }
  if (facts.kind === "stockout_risk") {
    const row = await typedRow(z.object({ open: col.bool }), sql`select ${OPEN_ORDER(storeId, facts.sku)} as open`);
    return row?.open ? "A purchase order for it was made before the autopilot looked." : null;
  }
  return null;
}

/** How long a conversation has waited for a person by now, in whole minutes; what the event said when it cannot be read. */
async function waitedMinutes(storeId: string, conversationId: string, fallback: number): Promise<number> {
  const row = await typedRow(
    z.object({ minutes: col.int.nullable() }),
    sql`select floor(extract(epoch from (now() - queued_at)) / 60)::int as minutes from commerce.support_conversations where id = ${conversationId}::uuid and store_id = ${storeId}::uuid`,
  );
  return row?.minutes ?? fallback;
}

type Outcome = Exclude<keyof EventRun, "found">;

async function reactTo(event: Pending, settings: Awaited<ReturnType<typeof autonomyFor>>, deps: EventDeps): Promise<Outcome> {
  const parsed = FACTS.safeParse(event.facts);
  if (!parsed.success || parsed.data.kind !== event.kind) {
    await finish(event.id, "skipped", { outcome: "What happened could not be read." });
    return "skipped";
  }
  const facts = parsed.data as EventFacts;
  if (!event.updated_by) {
    await finish(event.id, "skipped", { outcome: "Nobody is named to run the autopilot for: save its settings again." });
    return "skipped";
  }
  const p = await principalOf({ accountId: event.updated_by, storeId: event.store_id, storeSlug: event.store_slug, storeActive: event.store_active });
  if (p === "gone" || p === "closed") {
    await finish(event.id, "skipped", { outcome: "The person who switched this on can no longer use the AI manager here." });
    return "skipped";
  }
  const holder = holderOfPrincipal(p);
  if (!holder || !can(holder, "owner")) {
    await finish(event.id, "skipped", { outcome: "The person who switched this on is no longer an owner of the store." });
    return "skipped";
  }
  const closed = await stillOpen(event.store_id, facts);
  if (closed) {
    await finish(event.id, "skipped", { outcome: closed, accountId: p.account.id });
    return "skipped";
  }

  const conversationId = await eventConversation(p);
  const goals = facts.kind === "alert" ? await activeGoals(event.store_id) : [];
  // A waiting customer's event is kept when the desk's alert is logged and answered once the owner's minutes passed (E4.2): the turn is told
  // how long they have waited by now.
  const turnFacts: EventFacts = facts.kind === "support_waiting" ? { ...facts, waitedMinutes: await waitedMinutes(event.store_id, facts.conversation, facts.waitedMinutes) } : facts;
  const startedAt = await typedRow(z.object({ at: col.timestamp }), sql`select now() as at`);
  const connection = deps.connection !== undefined ? deps.connection : await aiFor(event.store_id, { feature: "autopilot", accountId: p.account.id });
  const seen: { error: string | null; answer: string } = { error: null, answer: "" };
  const told: string[] = [];
  await actingAs("autopilot", () =>
    (deps.turn ?? runTurn)({
      member: p,
      conversationId,
      message: eventMessage(turnFacts, goals),
      emit: (e) => {
        if (e.type === "error") seen.error = e.message;
        if (e.type === "done") seen.answer = e.message.content;
      },
      invalidate: refreshTag,
      signal: AbortSignal.timeout(TURN_MS),
      scheduled: true,
      autopilot: { event: event.kind as EventKind, tools: EVENT_TOOLS[event.kind], settings, told },
      connection,
    }),
  );
  const who = { accountId: p.account.id, conversationId, told };
  if (seen.error) {
    await finish(event.id, "failed", { outcome: seen.error, ...who });
    return "failed";
  }
  const said = seen.answer.trim() || "Looked; nothing to add.";
  if (facts.kind !== "alert") {
    await finish(event.id, "done", { outcome: said, ...who });
    return "done";
  }

  // An alert's plan is a review's (D328): one kept, tied to nothing new, started or kept for a yes by the owner's setting.
  const made = await typedRows(
    z.object({ id: col.uuid, title: col.text, version: col.int }),
    sql`
      select id, title, version from commerce.assistant_plans
      where conversation_id = ${conversationId}::uuid and status = 'draft' and created_at >= ${startedAt?.at ?? new Date().toISOString()}::timestamptz
      order by created_at
    `,
  );
  if (made.length === 0) {
    await finish(event.id, "done", { outcome: `Nothing to do now: ${said}`, ...who });
    return "done";
  }
  const plan = made[made.length - 1];
  for (const extra of made.slice(0, -1)) await stopPlanIn(db(), extra.id, "draft");
  const actor: PlanActor = { account: p.account, store: p.store, holder };
  const decision = startDecision(settings, await plansStartedThisWeek(event.store_id));
  if (decision.start && (await startPlanByAutopilot(actor, plan.id, plan.version))) {
    await finish(event.id, "done", { outcome: `Made and started "${plan.title}". ${said}`, planId: plan.id, started: true, ...who });
    return "started";
  }
  const kept = await keepForApproval({ account: p.account, store: p.store, invalidate: refreshTag }, conversationId, "start_autopilot_plan", "plan", { plan: plan.id });
  await noticeApproval(kept, conversationId, p.account.id, p.store?.id ?? null);
  await finish(event.id, "done", { outcome: `Made "${plan.title}"; it waits for your yes to start. ${said}`, planId: plan.id, ...who });
  return "planned";
}

/** Plans the autopilot started itself in seven days, from reviews and events alike: one weekly limit (`plansPerWeek`). */
async function plansStartedThisWeek(storeId: string): Promise<number> {
  const row = await typedRow(
    z.object({ n: col.int }),
    sql`select (
      (select count(*) from commerce.autopilot_reviews where store_id = ${storeId}::uuid and started and created_at > now() - interval '7 days')
      + (select count(*) from commerce.autopilot_events where store_id = ${storeId}::uuid and started and created_at > now() - interval '7 days')
    )::int as n`,
  );
  return row?.n ?? 0;
}

async function activeGoals(storeId: string) {
  return typedRows(
    z.object({ id: col.uuid, title: col.text }),
    sql`select id, title from commerce.assistant_goals where store_id = ${storeId}::uuid and status = 'active' order by created_at limit 5`,
  );
}

/** The store's one conversation for events, kept from the first on; a new one when it was deleted. */
async function eventConversation(p: Principal): Promise<string> {
  const storeId = p.store!.id;
  const kept = await typedRow(
    z.object({ id: col.uuid }),
    sql`
      select c.id from commerce.autopilot_events e
      join commerce.assistant_conversations c on c.id = e.conversation_id and c.account_id = ${p.account.id}::uuid
      where e.store_id = ${storeId}::uuid
      order by e.created_at desc limit 1
    `,
  );
  if (kept) return kept.id;
  const made = await typedRow(
    z.object({ id: col.uuid }),
    sql`insert into commerce.assistant_conversations (store_id, account_id, title, source)
      values (${storeId}::uuid, ${p.account.id}::uuid, 'Autopilot: what happened', 'autopilot') returning id`,
  );
  if (!made) throw new Error("The events' conversation could not be made.");
  return made.id;
}

export type ReactedEvent = { id: string; kind: EventKind; status: string; outcome: string | null; at: string; told: string[] };

/** The store's latest events, for the Autopilot page (15.4). */
export async function latestEvents(storeId: string, limit = 10): Promise<ReactedEvent[]> {
  const rows = await typedRows(
    z.object({ id: col.uuid, kind: z.enum(EVENT_KINDS), status: col.text, outcome: col.textOrNull, at: col.timestamp, told: z.array(z.string()).catch([]) }),
    sql`
      select id, kind, status, outcome, coalesce(finished_at, created_at) as at, coalesce(facts->'told', '[]'::jsonb) as told from commerce.autopilot_events
      where store_id = ${storeId}::uuid order by created_at desc limit ${limit}
    `,
  );
  return rows.map((r) => ({ id: r.id, kind: r.kind, status: r.status, outcome: r.outcome, at: r.at, told: r.told }));
}

/** Events older than `EVENT_KEEP_DAYS` go (the daily job). */
export async function pruneAutopilotEvents(): Promise<number> {
  const gone = await db().execute(sql`
    delete from commerce.autopilot_events where created_at < now() - make_interval(days => ${EVENT_KEEP_DAYS}) and status <> 'running' returning id
  `);
  return gone.length;
}
