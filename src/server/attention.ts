import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { ADMIN_LANGS, type AdminLang } from "@/lib/admin-lang";
import { HOME_WORDS } from "@/lib/admin-words/home";
import { storeAttentionItems, type ActivityFigures, type DisputeFigures, type QueueFigures, type StoreAttentionItem } from "@/lib/control-center";
import { LOSING } from "@/lib/flow-report";
import { DISPUTE_STATUSES, disputeNeedsResponse } from "@/lib/payment-facts";

import { leadCounts } from "./leads";
import { OPEN_QUESTION } from "./unanswered-questions";
import { textList, uuidList } from "./sql-arrays";
import type { Store } from "./stores";
import { col, typedRows } from "./typed-rows";
import { dealsOn } from "@/lib/extensions";

/**
 * One attention source (ecosystem plan E2.1, D713): the queues that wait on a store's people, counted in SQL for any number of stores at
 * once, so the owner's Home across stores, the store's Home (`controlCenter()`) and the morning briefing (`briefingFacts()`) say the same
 * from the same reads. `attentionFor()` and `queueItems()` (`src/lib/control-center.ts`) word them, each with its kind and the page that
 * acts. Counts and ids only, never a customer.
 *
 * Here are the queues E2.1 added: payment disputes waiting for the store's answer, the AI manager's decisions, new leads, the day's calls,
 * meetings and tasks, and blog comments held for a check; and the questions the chat assistant could not answer (E4.3). The older queues
 * are still counted in `controlCenter()`; the briefing reads those through the store checkup (`checkupFindings()`), whose output the AI
 * manager's `store_checkup` also gives.
 */

/** A dispute the bank waits on the store to answer (`disputeNeedsResponse()`). */
const NEEDS_RESPONSE = DISPUTE_STATUSES.filter(disputeNeedsResponse);

/**
 * Disputes still open whose answer is the store's, and none sent from here (D417): how many, the soonest deadline still ahead, and the
 * order and id of the one with the soonest deadline, which the item opens when it is the only one.
 */
export async function disputeCounts(storeIds: readonly string[], now: Date = new Date()): Promise<Map<string, DisputeFigures>> {
  if (storeIds.length === 0) return new Map();
  const rows = await typedRows(
    z.object({ store_id: col.uuid, waiting: col.int, due_by: col.timestampOrNull, order_id: col.uuid, dispute_id: col.uuid }),
    sql`
      select d.store_id, count(*)::int as waiting,
        min(d.evidence_due_by) filter (where d.evidence_due_by > ${now.toISOString()}::timestamptz) as due_by,
        (array_agg(d.order_id order by d.evidence_due_by nulls last, d.id))[1] as order_id,
        (array_agg(d.id order by d.evidence_due_by nulls last, d.id))[1] as dispute_id
      from commerce.payment_disputes d
      where d.store_id = any(${uuidList(storeIds)}) and d.closed_at is null and d.status = any(${textList(NEEDS_RESPONSE)})
        and not exists (select 1 from commerce.dispute_evidence e where e.store_id = d.store_id and e.dispute_id = d.id and e.submitted_at is not null)
      group by d.store_id
    `,
  );
  return new Map(rows.map((r) => [r.store_id, { waiting: r.waiting, dueBy: r.due_by, only: r.waiting === 1 ? { orderId: r.order_id, disputeId: r.dispute_id } : null }]));
}

/**
 * What the AI manager waits on the owner to decide, as the Autopilot page lists it under *Waiting for you* (`autopilotOverview()`): the
 * calls kept for a yes that have not expired, the person's own (`accountId`) and every one the autopilot kept in the store, and the
 * questions of the store's plans still running. Without `accountId`, only the autopilot's, which are the store's rather than one person's.
 */
export async function decisionCounts(storeIds: readonly string[], accountId: string | null): Promise<Map<string, number>> {
  if (storeIds.length === 0) return new Map();
  const stores = uuidList(storeIds);
  const rows = await typedRows(
    z.object({ store_id: col.uuid, n: col.int }),
    sql`
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
  );
  return new Map(rows.map((r) => [r.store_id, r.n]));
}

/**
 * What visitors left that waits for the store's people, in one statement (Home's statements are counted, `admin-statements.int.test.ts`):
 * comments on the stores' articles held for a check (`pending`, the Comments page's first tab), and the questions the chat assistant could
 * not answer that are still open (ecosystem plan E4.3, counted as their page lists them, `OPEN_QUESTION`). Each for its own stores.
 */
export async function heldCounts(commentStores: readonly string[], questionStores: readonly string[]): Promise<{ comments: Map<string, number>; questions: Map<string, number> }> {
  if (commentStores.length === 0 && questionStores.length === 0) return { comments: new Map(), questions: new Map() };
  const rows = await typedRows(
    z.object({ store_id: col.uuid, comments: col.int, questions: col.int }),
    sql`
      select x.store_id, count(*) filter (where x.kind = 'comment')::int as comments, count(*) filter (where x.kind = 'question')::int as questions
      from (
        select c.store_id, 'comment' as kind from commerce.blog_comments c
        where c.store_id = any(${uuidList(commentStores)}) and c.status = 'pending'
        union all
        select q.store_id, 'question' as kind from commerce.unanswered_questions q
        where q.store_id = any(${uuidList(questionStores)}) and ${OPEN_QUESTION}
      ) x
      group by x.store_id
    `,
  );
  const of = (key: "comments" | "questions") => new Map(rows.filter((r) => r[key] > 0).map((r) => [r.store_id, r[key]]));
  return { comments: of("comments"), questions: of("questions") };
}

/**
 * Calls, meetings and tasks not done, by the store's own day, as the *Today* card sorts them (`activityWhen()`): overdue is due before
 * today, or timed and more than an hour past; today is the rest due today. One person's (`assigneeId`, the card's *Mine*) or the team's.
 */
export async function activityCounts(storeIds: readonly string[], assigneeId: string | null, now: Date = new Date()): Promise<Map<string, ActivityFigures>> {
  if (storeIds.length === 0) return new Map();
  const at = now.toISOString();
  const late = sql`(commerce.store_day(a.store_id, a.due_at) < commerce.store_day(a.store_id, ${at}::timestamptz)
    or (a.timed and a.due_at < ${at}::timestamptz - interval '1 hour'))`;
  const rows = await typedRows(
    z.object({ store_id: col.uuid, overdue: col.int, today: col.int }),
    sql`
      select a.store_id, count(*) filter (where ${late})::int as overdue, count(*) filter (where not ${late})::int as today
      from commerce.activities a
      where a.store_id = any(${uuidList(storeIds)}) and a.done_at is null
        and (${assigneeId}::uuid is null or a.assignee_id = ${assigneeId}::uuid)
        -- A day and more ahead of any time zone's today, for the index; the store's own day decides.
        and a.due_at < ${at}::timestamptz + interval '2 days'
        and commerce.store_day(a.store_id, a.due_at) <= commerce.store_day(a.store_id, ${at}::timestamptz)
      group by a.store_id
    `,
  );
  return new Map(rows.filter((r) => r.overdue > 0 || r.today > 0).map((r) => [r.store_id, { overdue: r.overdue, today: r.today, ...(assigneeId ? {} : { team: true }) }]));
}

/**
 * Flows switched on that are losing readers (D767, email plan M3.8): at least `LOSING.entered` started one in the last 30 days and more than
 * `LOSING.share` of them left the list on the way (their way through ended as stopped), the flow report's `space_out`. How many per store,
 * and the one's id when there is just one.
 */
export async function losingFlowCounts(storeIds: readonly string[]): Promise<Map<string, { flows: number; only: string | null }>> {
  if (storeIds.length === 0) return new Map();
  const rows = await typedRows(
    z.object({ store_id: col.uuid, flows: col.int, first: col.uuid }),
    sql`
      select f.store_id, count(*)::int as flows, (array_agg(f.id order by f.id))[1] as first
      from commerce.flows f
      cross join lateral (
        select count(*) filter (where r.entered_at > now() - interval '30 days') as entered,
               count(*) filter (where r.status = 'stopped' and r.ended_at > now() - interval '30 days') as left_list
        from commerce.flow_runs r where r.store_id = f.store_id and r.flow_id = f.id
      ) c
      where f.store_id = any(${uuidList(storeIds)}) and f.enabled
        and c.entered >= ${LOSING.entered} and c.left_list > c.entered * ${LOSING.share}::numeric
      group by f.store_id
    `,
  );
  return new Map(rows.map((r) => [r.store_id, { flows: r.flows, only: r.flows === 1 ? r.first : null }]));
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
};

export type QueueCounts = {
  disputes: Map<string, DisputeFigures>;
  decisions: Map<string, number>;
  leads: Map<string, number>;
  activities: Map<string, ActivityFigures>;
  comments: Map<string, number>;
  questions: Map<string, number>;
  flows: Map<string, { flows: number; only: string | null }>;
};

/**
 * Every queue of E2.1 for the stores given, one query each whatever their number. `accountId` is the reader: their own activities and
 * calls kept for their yes; null for the team's (everyone's activities, the autopilot's calls).
 */
export async function queueCounts(gates: QueueGates, accountId: string | null, now: Date = new Date()): Promise<QueueCounts> {
  const [disputes, decisions, leads, activities, { comments, questions }, flows] = await Promise.all([
    disputeCounts(gates.disputes, now),
    decisionCounts(gates.decisions, accountId),
    leadCounts(gates.leads),
    activityCounts(gates.activities, accountId, now),
    heldCounts(gates.comments, gates.questions ?? []),
    losingFlowCounts(gates.flows ?? []),
  ]);
  return { disputes, decisions, leads, activities, comments, questions, flows };
}

/** A store's figures of the queues, only those that wait: what `queueItems()` reads, spread into its `StoreFigures`. */
export function queueFiguresOf(storeId: string, counts: QueueCounts): Pick<QueueFigures, "disputes" | "leads" | "aiDecisions" | "blogComments" | "activities" | "unansweredQuestions" | "flowsLosing"> {
  const disputes = counts.disputes.get(storeId);
  const leads = counts.leads.get(storeId) ?? 0;
  const decisions = counts.decisions.get(storeId) ?? 0;
  const comments = counts.comments.get(storeId) ?? 0;
  const activities = counts.activities.get(storeId);
  const questions = counts.questions.get(storeId) ?? 0;
  const flows = counts.flows.get(storeId);
  return {
    ...(disputes && disputes.waiting > 0 ? { disputes } : {}),
    ...(decisions > 0 ? { aiDecisions: decisions } : {}),
    ...(leads > 0 ? { leads } : {}),
    ...(activities ? { activities } : {}),
    ...(comments > 0 ? { blogComments: comments } : {}),
    ...(questions > 0 ? { unansweredQuestions: questions } : {}),
    ...(flows && flows.flows > 0 ? { flowsLosing: flows } : {}),
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
  const counts = await queueCounts({ disputes: ids, decisions: ids, leads: sales, activities: sales, comments: ids, questions: ids, flows: ids }, null, now);
  const figures: QueueFigures = { slug: store.slug, name: store.name, role: "owner", ...queueFiguresOf(store.id, counts) };
  return Object.fromEntries(ADMIN_LANGS.map((lang) => [lang, storeAttentionItems(figures, now.getTime(), HOME_WORDS[lang].attention)])) as StoreAttention;
}
