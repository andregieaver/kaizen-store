import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import {
  ALERT_CHECK_HOURS,
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
  TEST_ENDED_DAYS,
  type EventFacts,
  type EventKind,
} from "@/lib/autopilot-events";
import { startDecision } from "@/lib/autopilot-reviews";
import { can } from "@/lib/permissions";

import { actingAs } from "./actor";
import { aiFor, type AiConnection } from "./ai";
import { alertsForStore } from "./analytics-insights";
import { startPlanByAutopilot, stopPlanIn, type PlanActor } from "./autopilot-plans";
import { principalOf } from "./autopilot-runner";
import { aiBudgetSpent, autonomyFor } from "./autopilot-settings";
import { log } from "./log";
import { holderOfPrincipal, keepForApproval, runTurn, type Principal, type TurnInput } from "./owner-assistant";
import { refreshTag } from "./refresh";
import { getStore } from "./stores";
import { col, typedRow, typedRows } from "./typed-rows";

/**
 * The autopilot reacts to what happens (D331, `docs/ai-autopilot.md` 15), the only writer of `commerce.autopilot_events` and
 * `autopilot_event_checks`: from `/api/cron/autopilot`, after the reviews, `detectEvents()` finds a customer waiting for a person, an A/B test
 * that ended by itself and an urgent analytics alert in stores that react, and `runEvents()` answers each once with a headless turn that has
 * only the event's tools, within the owner's levels and budgets.
 */

/** The longest an event's turn may take. */
const TURN_MS = 120_000;
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
  now?: Date;
};

export type EventRun = { found: number; done: number; planned: number; started: number; skipped: number; failed: number };

const FACTS = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("support_waiting"), conversation: z.string(), waitedMinutes: z.number(), handoffReason: z.string().nullable() }),
  z.object({ kind: z.literal("test_ended"), experiment: z.string(), name: z.string(), stopReason: z.enum(["guardrail", "planned_end"]), stoppedAt: z.string() }),
  z.object({ kind: z.literal("alert"), alert: z.string(), severity: z.string(), text: z.string(), evidence: z.array(z.string()) }),
]);

/** The stores that react now: the switch on, not paused, the store open. */
const REACTING = sql`
  select a.store_id, coalesce((a.planning ->> 'waitMinutes')::int, 15) as wait_minutes
  from commerce.autopilot_settings a
  where a.store_id is not null and not a.paused and coalesce((a.planning ->> 'reacts')::boolean, false)
    and commerce.store_is_active(a.store_id)
`;

/** Finds the events of every store that reacts and keeps each once; returns how many were new. */
export async function detectEvents(deps: EventDeps = {}): Promise<number> {
  const now = deps.now ?? new Date();
  const waiting = await db().execute(sql`
    with reacting as (${REACTING})
    insert into commerce.autopilot_events (store_id, kind, ref, facts)
    select c.store_id, 'support_waiting', c.id::text,
      jsonb_build_object('kind', 'support_waiting', 'conversation', c.id, 'handoffReason', c.handoff_reason,
        'waitedMinutes', floor(extract(epoch from (${now.toISOString()}::timestamptz - c.queued_at)) / 60)::int)
    from commerce.support_conversations c
    join reacting r on r.store_id = c.store_id
    where c.status = 'open' and c.handler = 'queue' and c.anonymised_at is null and c.queued_at is not null
      and c.queued_at < ${now.toISOString()}::timestamptz - make_interval(mins => r.wait_minutes)
    on conflict (store_id, kind, ref) do nothing
    returning id
  `);
  const tests = await db().execute(sql`
    with reacting as (${REACTING})
    insert into commerce.autopilot_events (store_id, kind, ref, facts)
    select e.store_id, 'test_ended', e.id::text,
      jsonb_build_object('kind', 'test_ended', 'experiment', e.id, 'name', e.name, 'stopReason', e.stop_reason, 'stoppedAt', e.stopped_at)
    from commerce.experiments e
    join reacting r on r.store_id = e.store_id
    where e.status = 'stopped' and e.stop_reason in ('guardrail', 'planned_end')
      and e.stopped_at > ${now.toISOString()}::timestamptz - make_interval(days => ${TEST_ENDED_DAYS})
    on conflict (store_id, kind, ref) do nothing
    returning id
  `);
  return waiting.length + tests.length + (await detectAlerts(now, deps));
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
        and (
          select count(*) from commerce.autopilot_events d
          where d.store_id = e.store_id and d.status in ('running', 'done', 'failed') and d.created_at > now() - interval '1 day'
        ) < ${EVENTS_PER_DAY}
      order by e.created_at
      limit 20
    `,
  );
  const seen = new Set<string>();
  let taken = 0;
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
    try {
      result[await reactTo(event, settings, deps)]++;
    } catch (error) {
      log("error", "autopilot.event_failed", { event: event.id }, error);
      await finish(event.id, "failed", { outcome: "Something went wrong while reacting." }).catch(() => undefined);
      result.failed++;
    }
  }
  return result;
}

async function finish(
  eventId: string,
  status: "done" | "skipped" | "failed",
  fields: { outcome: string; planId?: string; started?: boolean; accountId?: string; conversationId?: string },
): Promise<void> {
  await db().execute(sql`
    update commerce.autopilot_events set status = ${status}, outcome = ${fields.outcome.slice(0, 500)}, plan_id = ${fields.planId ?? null}::uuid,
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
  return null;
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
  const startedAt = await typedRow(z.object({ at: col.timestamp }), sql`select now() as at`);
  const connection = deps.connection !== undefined ? deps.connection : await aiFor(event.store_id, { feature: "autopilot", accountId: p.account.id });
  const seen: { error: string | null; answer: string } = { error: null, answer: "" };
  const told: string[] = [];
  await actingAs("autopilot", () =>
    (deps.turn ?? runTurn)({
      member: p,
      conversationId,
      message: eventMessage(facts, goals),
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
  const who = { accountId: p.account.id, conversationId };
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
  await keepForApproval({ account: p.account, store: p.store, invalidate: refreshTag }, conversationId, "start_autopilot_plan", "plan", { plan: plan.id });
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
    sql`insert into commerce.assistant_conversations (store_id, account_id, title)
      values (${storeId}::uuid, ${p.account.id}::uuid, 'Autopilot: what happened') returning id`,
  );
  if (!made) throw new Error("The events' conversation could not be made.");
  return made.id;
}

export type ReactedEvent = { id: string; kind: EventKind; status: string; outcome: string | null; at: string };

/** The store's latest events, for the Autopilot page (15.4). */
export async function latestEvents(storeId: string, limit = 10): Promise<ReactedEvent[]> {
  const rows = await typedRows(
    z.object({ id: col.uuid, kind: z.enum(EVENT_KINDS), status: col.text, outcome: col.textOrNull, at: col.timestamp }),
    sql`
      select id, kind, status, outcome, coalesce(finished_at, created_at) as at from commerce.autopilot_events
      where store_id = ${storeId}::uuid order by created_at desc limit ${limit}
    `,
  );
  return rows.map((r) => ({ id: r.id, kind: r.kind, status: r.status, outcome: r.outcome, at: r.at }));
}

/** Events older than `EVENT_KEEP_DAYS` go (the daily job). */
export async function pruneAutopilotEvents(): Promise<number> {
  const gone = await db().execute(sql`
    delete from commerce.autopilot_events where created_at < now() - make_interval(days => ${EVENT_KEEP_DAYS}) and status <> 'running' returning id
  `);
  return gone.length;
}
