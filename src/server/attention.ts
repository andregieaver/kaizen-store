import "server-only";

import { sql, type SQL } from "drizzle-orm";
import { z } from "zod";

import { ADMIN_LANGS, type AdminLang } from "@/lib/admin-lang";
import { HOME_WORDS } from "@/lib/admin-words/home";
import { storeAttentionItems, type ActivityFigures, type DisputeFigures, type QueueFigures, type StoreAttentionItem } from "@/lib/control-center";
import { LOSING } from "@/lib/flow-report";
import { DISPUTE_STATUSES, disputeNeedsResponse } from "@/lib/payment-facts";

import { leadCountsRead } from "./leads";
import { OPEN_QUESTION } from "./unanswered-questions";
import { textList, uuidList } from "./sql-arrays";
import type { Store } from "./stores";
import { checkedRows, col, typedRows } from "./typed-rows";
import { dealsOn, storeExtensionOn } from "@/lib/extensions";
import { featureOn } from "@/lib/store-features";

/**
 * One attention source (ecosystem plan E2.1, D713): the queues that wait on a store's people, counted in SQL for any number of stores at
 * once, so the owner's Home across stores, the store's Home (`controlCenter()`) and the morning briefing (`briefingFacts()`) say the same
 * from the same reads. `attentionFor()` and `queueItems()` (`src/lib/control-center.ts`) word them, each with its kind and the page that
 * acts. Counts and ids only, never a customer.
 *
 * Here are the queues E2.1 added: payment disputes waiting for the store's answer, the AI manager's decisions, new leads, the day's calls,
 * meetings and tasks, and blog comments held for a check; the questions the chat assistant could not answer (E4.3); and checklist tasks
 * late or due today (D903 P4.9). The older queues
 * are still counted in `controlCenter()`; the briefing reads those through the store checkup (`checkupFindings()`), whose output the AI
 * manager's `store_checkup` also gives.
 */

/**
 * One queue's read: its statement, the shape of its rows and how they become its figures. `queueCounts()` sends every queue's in one
 * statement (bloat review step 2.32), each read's text unchanged; `heldCounts()` and `leadCounts()` still run theirs alone for their
 * other readers, with the same figures.
 */
type QueueRead<S extends z.ZodType, T> = { schema: S; query: SQL; figures: (rows: z.output<S>[]) => T };

const run = async <S extends z.ZodType, T>(read: QueueRead<S, T> | null, empty: T): Promise<T> =>
  read ? read.figures(await typedRows(read.schema, read.query)) : empty;

/** A dispute the bank waits on the store to answer (`disputeNeedsResponse()`). */
const NEEDS_RESPONSE = DISPUTE_STATUSES.filter(disputeNeedsResponse);

const DISPUTE_ROW = z.object({ store_id: col.uuid, waiting: col.int, due_by: col.timestampOrNull, order_id: col.uuid, dispute_id: col.uuid });

/**
 * Disputes still open whose answer is the store's, and none sent from here (D417): how many, the soonest deadline still ahead, and the
 * order and id of the one with the soonest deadline, which the item opens when it is the only one.
 */
function disputeRead(storeIds: readonly string[], now: Date): QueueRead<typeof DISPUTE_ROW, Map<string, DisputeFigures>> | null {
  if (storeIds.length === 0) return null;
  return {
    schema: DISPUTE_ROW,
    query: sql`
      select d.store_id, count(*)::int as waiting,
        min(d.evidence_due_by) filter (where d.evidence_due_by > ${now.toISOString()}::timestamptz) as due_by,
        (array_agg(d.order_id order by d.evidence_due_by nulls last, d.id))[1] as order_id,
        (array_agg(d.id order by d.evidence_due_by nulls last, d.id))[1] as dispute_id
      from commerce.payment_disputes d
      where d.store_id = any(${uuidList(storeIds)}) and d.closed_at is null and d.status = any(${textList(NEEDS_RESPONSE)})
        and not exists (select 1 from commerce.dispute_evidence e where e.store_id = d.store_id and e.dispute_id = d.id and e.submitted_at is not null)
      group by d.store_id
    `,
    figures: (rows) => new Map(rows.map((r) => [r.store_id, { waiting: r.waiting, dueBy: r.due_by, only: r.waiting === 1 ? { orderId: r.order_id, disputeId: r.dispute_id } : null }])),
  };
}

const DECISION_ROW = z.object({ store_id: col.uuid, n: col.int });

/**
 * What the AI manager waits on the owner to decide, as the Autopilot page lists it under *Waiting for you* (`autopilotOverview()`): the
 * calls kept for a yes that have not expired, the person's own (`accountId`) and every one the autopilot kept in the store, and the
 * questions of the store's plans still running. Without `accountId`, only the autopilot's, which are the store's rather than one person's.
 */
function decisionRead(storeIds: readonly string[], accountId: string | null): QueueRead<typeof DECISION_ROW, Map<string, number>> | null {
  if (storeIds.length === 0) return null;
  const stores = uuidList(storeIds);
  return {
    schema: DECISION_ROW,
    query: sql`
      select x.store_id, count(*)::int as n
      from (
        select ap.store_id from commerce.assistant_approvals ap
        where ap.store_id = any(${stores}) and ap.status = 'pending' and ap.expires_at > now()
          and (ap.account_id = ${accountId}::uuid
            or exists (select 1 from commerce.assistant_conversations c where c.id = ap.conversation_id and c.source = 'autopilot'))
        union all
        select p.store_id from commerce.assistant_plan_steps st
        join commerce.assistant_plans p on p.id = st.plan_id
        where p.store_id = any(${stores}) and p.status not in ('done', 'stopped') and st.status = 'asking' and st.question is not null
      ) x
      group by x.store_id
    `,
    figures: (rows) => new Map(rows.map((r) => [r.store_id, r.n])),
  };
}

/** A store's flows losing readers (M3.8): how many, and the one's id when there is just one, so the item opens it. */
type LosingFlows = { flows: number; only: string | null };

/**
 * What waits for the store's people that is not an order, in one statement (Home's statements are counted, `admin-statements.int.test.ts`):
 * comments on the stores' articles held for a check (`pending`, the Comments page's first tab), the questions the chat assistant could not
 * answer that are still open (ecosystem plan E4.3, counted as their page lists them, `OPEN_QUESTION`), and flows switched on that are losing
 * readers (D767, email plan M3.8): at least `LOSING.entered` started one in the last 30 days and more than `LOSING.share` of them left the
 * list on the way (their way through ended as stopped), the flow report's `space_out`. Each for its own stores.
 */
export async function heldCounts(
  commentStores: readonly string[],
  questionStores: readonly string[],
  flowStores: readonly string[] = [],
): Promise<HeldFigures> {
  return run(heldRead(commentStores, questionStores, flowStores), noneHeld());
}

type HeldFigures = { comments: Map<string, number>; questions: Map<string, number>; flows: Map<string, LosingFlows>; paused: Map<string, LosingFlows> };
const noneHeld = (): HeldFigures => ({ comments: new Map(), questions: new Map(), flows: new Map(), paused: new Map() });
const HELD_ROW = z.object({ store_id: col.uuid, comments: col.int, questions: col.int, flows: col.int, first_flow: col.uuid.nullable(), paused: col.int, first_paused: col.uuid.nullable() });

function heldRead(commentStores: readonly string[], questionStores: readonly string[], flowStores: readonly string[]): QueueRead<typeof HELD_ROW, HeldFigures> | null {
  if (commentStores.length === 0 && questionStores.length === 0 && flowStores.length === 0) return null;
  return {
    schema: HELD_ROW,
    query: sql`
      select x.store_id, count(*) filter (where x.kind = 'comment')::int as comments, count(*) filter (where x.kind = 'question')::int as questions,
        count(*) filter (where x.kind = 'flow')::int as flows, (array_agg(x.ref order by x.ref) filter (where x.kind = 'flow'))[1] as first_flow,
        count(*) filter (where x.kind = 'paused')::int as paused, (array_agg(x.ref order by x.ref) filter (where x.kind = 'paused'))[1] as first_paused
      from (
        select c.store_id, 'comment' as kind, null::uuid as ref from commerce.blog_comments c
        where c.store_id = any(${uuidList(commentStores)}) and c.status = 'pending'
        union all
        select q.store_id, 'question' as kind, null::uuid as ref from commerce.unanswered_questions q
        where q.store_id = any(${uuidList(questionStores)}) and ${OPEN_QUESTION}
        union all
        select f.store_id, 'flow' as kind, f.id as ref from commerce.flows f
        cross join lateral (
          select count(*) filter (where r.entered_at > now() - interval '30 days') as entered,
                 count(*) filter (where r.status = 'stopped' and r.ended_at > now() - interval '30 days') as left_list
          from commerce.flow_runs r where r.store_id = f.store_id and r.flow_id = f.id
        ) c
        where f.store_id = any(${uuidList(flowStores)}) and f.enabled
          and c.entered >= ${LOSING.entered} and c.left_list > c.entered * ${LOSING.share}::numeric
        union all
        -- Flows the flow guard switched off (M3.9) in the last 14 days and still off: the owner decides whether they go on again.
        select f.store_id, 'paused' as kind, f.id as ref from commerce.flows f
        where f.store_id = any(${uuidList(flowStores)}) and not f.enabled and f.guard_paused_at > now() - interval '14 days'
      ) x
      group by x.store_id
    `,
    figures: (rows) => {
      const of = (key: "comments" | "questions") => new Map(rows.filter((r) => r[key] > 0).map((r) => [r.store_id, r[key]]));
      const flows = new Map(rows.filter((r) => r.flows > 0).map((r) => [r.store_id, { flows: r.flows, only: r.flows === 1 ? r.first_flow : null }]));
      const paused = new Map(rows.filter((r) => r.paused > 0).map((r) => [r.store_id, { flows: r.paused, only: r.paused === 1 ? r.first_paused : null }]));
      return { comments: of("comments"), questions: of("questions"), flows, paused };
    },
  };
}

/** Flows losing readers alone (M3.8), as `heldCounts()` counts them. */
export async function losingFlowCounts(storeIds: readonly string[]): Promise<Map<string, LosingFlows>> {
  return (await heldCounts([], [], storeIds)).flows;
}

const ACTIVITY_ROW = z.object({ store_id: col.uuid, overdue: col.int, today: col.int });

/**
 * Calls, meetings and tasks not done, by the store's own day, as the *Today* card sorts them (`activityWhen()`): overdue is due before
 * today, or timed and more than an hour past; today is the rest due today. One person's (`assigneeId`, the card's *Mine*) or the team's.
 */
function activityRead(storeIds: readonly string[], assigneeId: string | null, now: Date): QueueRead<typeof ACTIVITY_ROW, Map<string, ActivityFigures>> | null {
  if (storeIds.length === 0) return null;
  const at = now.toISOString();
  const late = sql`(commerce.store_day(a.store_id, a.due_at) < commerce.store_day(a.store_id, ${at}::timestamptz)
    or (a.timed and a.due_at < ${at}::timestamptz - interval '1 hour'))`;
  return {
    schema: ACTIVITY_ROW,
    query: sql`
      select a.store_id, count(*) filter (where ${late})::int as overdue, count(*) filter (where not ${late})::int as today
      from commerce.activities a
      where a.store_id = any(${uuidList(storeIds)}) and a.done_at is null
        and (${assigneeId}::uuid is null or a.assignee_id = ${assigneeId}::uuid)
        -- A day and more ahead of any time zone's today, for the index; the store's own day decides.
        and a.due_at < ${at}::timestamptz + interval '2 days'
        and commerce.store_day(a.store_id, a.due_at) <= commerce.store_day(a.store_id, ${at}::timestamptz)
      group by a.store_id
    `,
    figures: (rows) => new Map(rows.filter((r) => r.overdue > 0 || r.today > 0).map((r) => [r.store_id, { overdue: r.overdue, today: r.today, ...(assigneeId ? {} : { team: true }) }])),
  };
}

const TASK_ROW = z.object({ store_id: col.uuid, overdue: col.int, today: col.int });

/**
 * Checklist tasks not done in open lists whose due dates are shown (D903 P4.9), by the store's own day: late is due before today, or timed
 * and already past; today is the rest due today. The reader's own and nobody's (`accountId`), or the team's.
 */
function taskRead(storeIds: readonly string[], accountId: string | null, now: Date): QueueRead<typeof TASK_ROW, Map<string, ActivityFigures>> | null {
  if (storeIds.length === 0) return null;
  const at = now.toISOString();
  const late = sql`(commerce.store_day(i.store_id, i.due_at) < commerce.store_day(i.store_id, ${at}::timestamptz)
    or (i.all_day is not true and i.due_at < ${at}::timestamptz))`;
  return {
    schema: TASK_ROW,
    query: sql`
      select i.store_id, count(*) filter (where ${late})::int as overdue, count(*) filter (where not ${late})::int as today
      from commerce.checklist_items i join commerce.checklists c on c.store_id = i.store_id and c.id = i.checklist_id
      where i.store_id = any(${uuidList(storeIds)}) and i.done_at is null and i.archived_at is null and i.due_at is not null
        and (${accountId}::uuid is null or i.assigned_to is null or i.assigned_to = ${accountId}::uuid)
        -- A day and more ahead of any time zone's today, for the index; the store's own day decides.
        and i.due_at < ${at}::timestamptz + interval '2 days'
        and commerce.store_day(i.store_id, i.due_at) <= commerce.store_day(i.store_id, ${at}::timestamptz)
        and c.status = 'open' and c.is_advanced and c.advanced_features ->> 'dueDate' is distinct from 'false'
      group by i.store_id
    `,
    figures: (rows) => new Map(rows.filter((r) => r.overdue > 0 || r.today > 0).map((r) => [r.store_id, { overdue: r.overdue, today: r.today, ...(accountId ? {} : { team: true }) }])),
  };
}

/** The stores each queue is counted for: those where the reader may see it (`controlCenter()` gates them by the member's keys). */
export type QueueGates = {
  disputes: readonly string[];
  decisions: readonly string[];
  leads: readonly string[];
  activities: readonly string[];
  comments: readonly string[];
  /** Where the questions the chat assistant could not answer are counted (ecosystem plan E4.3): those who may read support. */
  questions?: readonly string[];
  /** Where flows losing readers are counted (M3.8): those who may read marketing. */
  flows?: readonly string[];
  /** Where checklist tasks due are counted (D903 P4.9): those with Projects on, for who may read projects. */
  tasks?: readonly string[];
};

export type QueueCounts = {
  disputes: Map<string, DisputeFigures>;
  decisions: Map<string, number>;
  leads: Map<string, number>;
  activities: Map<string, ActivityFigures>;
  tasks: Map<string, ActivityFigures>;
  comments: Map<string, number>;
  questions: Map<string, number>;
  flows: Map<string, LosingFlows>;
  /** Flows the flow guard switched off (M3.9). */
  paused: Map<string, LosingFlows>;
};

/**
 * Every queue of E2.1 for the stores given, in ONE statement whatever their number (bloat review step 2.32): each queue's read is a CTE of
 * its own, its text exactly what its counter sends alone, and its rows come back as JSON tagged with the queue's name, checked against the
 * same row shape and turned into the same figures. A queue with no store to ask is left out of the statement, and with none nothing is
 * sent. `accountId` is the reader: their own activities and calls kept for their yes; null for the team's (everyone's activities, the
 * autopilot's calls).
 */
export async function queueCounts(gates: QueueGates, accountId: string | null, now: Date = new Date()): Promise<QueueCounts> {
  const reads = {
    q_disputes: disputeRead(gates.disputes, now),
    q_decisions: decisionRead(gates.decisions, accountId),
    q_leads: leadCountsRead(gates.leads),
    q_activities: activityRead(gates.activities, accountId, now),
    q_tasks: taskRead(gates.tasks ?? [], accountId, now),
    q_held: heldRead(gates.comments, gates.questions ?? [], gates.flows ?? []),
  };
  const asked = (Object.entries(reads) as [keyof typeof reads, { query: SQL } | null][]).filter((entry): entry is [keyof typeof reads, { query: SQL }] => entry[1] !== null);
  const rowsOf = new Map<string, unknown[]>();
  if (asked.length > 0) {
    const rows = await typedRows(
      z.object({ part: z.string(), row: z.record(z.string(), z.unknown()) }),
      sql`
        with ${sql.join(asked.map(([name, read]) => sql`${sql.identifier(name)} as (${read.query})`), sql`, `)}
        ${sql.join(asked.map(([name]) => sql`select ${name}::text as part, to_jsonb(${sql.identifier(name)}) as row from ${sql.identifier(name)}`), sql` union all `)}
      `,
    );
    for (const r of rows) rowsOf.set(r.part, [...(rowsOf.get(r.part) ?? []), r.row]);
  }
  const figures = <S extends z.ZodType, T>(name: keyof typeof reads, read: QueueRead<S, T> | null, empty: T): T =>
    read ? read.figures(checkedRows(read.schema, rowsOf.get(name) ?? [])) : empty;
  const { comments, questions, flows, paused } = figures("q_held", reads.q_held, noneHeld());
  return {
    disputes: figures("q_disputes", reads.q_disputes, new Map()),
    decisions: figures("q_decisions", reads.q_decisions, new Map()),
    leads: figures("q_leads", reads.q_leads, new Map()),
    activities: figures("q_activities", reads.q_activities, new Map()),
    tasks: figures("q_tasks", reads.q_tasks, new Map()),
    comments,
    questions,
    flows,
    paused,
  };
}

/** A store's figures of the queues, only those that wait: what `queueItems()` reads, spread into its `StoreFigures`. */
export function queueFiguresOf(storeId: string, counts: QueueCounts): Pick<QueueFigures, "disputes" | "leads" | "aiDecisions" | "blogComments" | "activities" | "tasks" | "unansweredQuestions" | "flowsLosing" | "flowsPaused"> {
  const disputes = counts.disputes.get(storeId);
  const leads = counts.leads.get(storeId) ?? 0;
  const decisions = counts.decisions.get(storeId) ?? 0;
  const comments = counts.comments.get(storeId) ?? 0;
  const activities = counts.activities.get(storeId);
  const tasks = counts.tasks.get(storeId);
  const questions = counts.questions.get(storeId) ?? 0;
  const flows = counts.flows.get(storeId);
  const paused = counts.paused.get(storeId);
  return {
    ...(disputes && disputes.waiting > 0 ? { disputes } : {}),
    ...(decisions > 0 ? { aiDecisions: decisions } : {}),
    ...(leads > 0 ? { leads } : {}),
    ...(activities ? { activities } : {}),
    ...(tasks ? { tasks } : {}),
    ...(comments > 0 ? { blogComments: comments } : {}),
    ...(questions > 0 ? { unansweredQuestions: questions } : {}),
    ...(flows && flows.flows > 0 ? { flowsLosing: flows } : {}),
    ...(paused && paused.flows > 0 ? { flowsPaused: paused } : {}),
  };
}

/** A store's attention items in each admin language, already worded (the readers beside Home pick their reader's). */
export type StoreAttention = Record<AdminLang, StoreAttentionItem[]>;

/**
 * One store's attention for everyone who works it, read once (the briefing goes to several people): the queues of E2.1 as the store's
 * owner sees them, but the team's activities and only the autopilot's calls, as no one person's are the store's. Leads and activities only
 * while Deals (`sales`) is on. Each language's items are said inside the store, most urgent first.
 */
export async function storeAttention(store: Store, now: Date = new Date()): Promise<StoreAttention> {
  const ids = [store.id];
  const sales = dealsOn(store) ? ids : [];
  const counts = await queueCounts(
    { disputes: ids, decisions: ids, leads: sales, activities: sales, comments: ids, questions: ids, flows: storeExtensionOn(store, "email_automation", now) ? ids : [], tasks: featureOn(store, "projects") ? ids : [] },
    null,
    now,
  );
  const figures: QueueFigures = { slug: store.slug, name: store.name, role: "owner", ...queueFiguresOf(store.id, counts) };
  return Object.fromEntries(ADMIN_LANGS.map((lang) => [lang, storeAttentionItems(figures, now.getTime(), HOME_WORDS[lang].attention)])) as StoreAttention;
}
