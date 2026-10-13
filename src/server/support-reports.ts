import "server-only";

import { sql, type SQL } from "drizzle-orm";

import { db } from "@/db/client";
import type { AnalyticsPeriod } from "@/lib/analytics-period";
import { supportReport, type ReportConversation, type ReportRequest, type SupportReport } from "@/lib/support-reports";
import type { SupportMode } from "@/lib/support-rules";
import { OUTCOMES, type Outcome } from "@/lib/support-summary";

import type { Desk } from "./support-desk";

type Row = Record<string, unknown>;

/**
 * The rows support's report counts (D216, step 14; `docs/analytics.md`, Support): one per conversation started in the period, with
 * its times, the mode it started in, its handover reason, rating, tone and its summary's outcome and topics, and never its words,
 * names or customer. The figures themselves are `supportReport()`'s. Kaizen's desk counts in Europe/Oslo's days.
 */

export const KAIZEN_TIME_ZONE = "Europe/Oslo";
/** The most conversations one report reads; a period with more says the report is cut. */
export const REPORT_ROWS_MAX = 50_000;

export const startedIn = (period: Pick<AnalyticsPeriod, "from" | "to">, timeZone: string): SQL =>
  sql`c.created_at >= ((${period.from}::date)::timestamp at time zone ${timeZone}) and c.created_at < ((${period.to}::date)::timestamp at time zone ${timeZone})`;

const deskIs = (desk: Desk): SQL => (desk.storeId ? sql`c.store_id = ${desk.storeId}::uuid` : sql`c.store_id is null`);

const ms = (value: unknown): number | null => (value ? new Date(value as string).getTime() : null);

export function toReportConversation(r: Row): ReportConversation {
  const summary = (r.summary ?? null) as { outcome?: unknown; topics?: unknown } | null;
  const outcome = typeof summary?.outcome === "string" && (OUTCOMES as readonly string[]).includes(summary.outcome) ? (summary.outcome as Outcome) : null;
  return {
    mode: r.desk_mode ? (String(r.desk_mode) as SupportMode) : null,
    status: r.status === "ended" ? "ended" : "open",
    createdAt: ms(r.created_at)!,
    queuedAt: ms(r.queued_at),
    claimedAt: ms(r.claimed_at),
    firstAgentAt: ms(r.first_agent_at),
    endedAt: ms(r.ended_at),
    handoffReason: r.handoff_reason ? String(r.handoff_reason) : null,
    rating: r.rating === "good" || r.rating === "bad" ? r.rating : null,
    tone: r.tone === null || r.tone === undefined ? null : Number(r.tone),
    outcome,
    topics: Array.isArray(summary?.topics) ? summary.topics.filter((t): t is string => typeof t === "string").slice(0, 3) : [],
    anonymised: Boolean(r.anonymised_at),
  };
}

/** The counted columns: the summary without its title, text and follow-up (only its outcome and topics are read). */
export const ROW_COLUMNS = sql`c.store_id, c.desk_mode, c.status, c.created_at, c.queued_at, c.claimed_at, c.first_agent_at, c.ended_at, c.handoff_reason, c.rating, c.tone,
  c.summary - 'text' - 'followUp' - 'title' as summary, c.anonymised_at`;

export type DeskReport = { report: SupportReport; cut: boolean; timeZone: string };

/** A desk's report for a period of whole days in the desk's time zone (the store's; Europe/Oslo for Kaizen's). */
export async function deskReport(desk: Desk, period: Pick<AnalyticsPeriod, "from" | "to">, timeZone: string): Promise<DeskReport> {
  const where = sql`${deskIs(desk)} and ${startedIn(period, timeZone)}`;
  const [rows, requests, drafts] = await Promise.all([
    db().execute<Row>(sql`select ${ROW_COLUMNS} from commerce.support_conversations c where ${where} order by c.created_at limit ${REPORT_ROWS_MAX + 1}`),
    db().execute<Row>(sql`
      select a.status, a.created_at, a.decided_at from commerce.support_actions a join commerce.support_conversations c on c.id = a.conversation_id
      where a.confirmer = 'staff' and ${where}
    `),
    db().execute<Row>(sql`
      select
        count(*) filter (where m.author = 'partner' and coalesce(m.data->>'draft', '') <> '')::int as offered,
        count(*) filter (where m.author = 'agent' and m.tools ? 'partner_draft')::int as used
      from commerce.support_messages m join commerce.support_conversations c on c.id = m.conversation_id
      where ${where} and m.author in ('partner', 'agent')
    `),
  ]);
  const cut = rows.length > REPORT_ROWS_MAX;
  const report = supportReport(
    rows.slice(0, REPORT_ROWS_MAX).map(toReportConversation),
    requests.map((r): ReportRequest => ({ status: String(r.status) as ReportRequest["status"], createdAt: ms(r.created_at)!, decidedAt: ms(r.decided_at) })),
    { offered: Number(drafts[0]?.offered ?? 0), used: Number(drafts[0]?.used ?? 0) },
  );
  return { report, cut, timeZone };
}

/** Right now, for the AI manager's overview and the control center: waiting, open by who answers, tone alerts. Counts only. */
export type SupportNow = { waiting: number; withAi: number; withPerson: number; toneAlerts: number; startedToday: number };

export async function supportNow(desk: Desk, timeZone: string, now = new Date()): Promise<SupportNow> {
  const [row] = await db().execute<Row>(sql`
    select
      count(*) filter (where c.status = 'open' and c.handler = 'queue')::int as waiting,
      count(*) filter (where c.status = 'open' and c.handler = 'ai')::int as with_ai,
      count(*) filter (where c.status = 'open' and c.handler = 'human')::int as with_person,
      count(*) filter (where c.status = 'open' and c.tone_alert_at is not null)::int as tone_alerts,
      count(*) filter (where c.created_at >= (((${now.toISOString()}::timestamptz at time zone ${timeZone})::date)::timestamp at time zone ${timeZone}))::int as started_today
    from commerce.support_conversations c
    where ${deskIs(desk)} and (c.status = 'open' or c.created_at > ${now.toISOString()}::timestamptz - interval '2 days')
  `);
  return {
    waiting: Number(row?.waiting ?? 0),
    withAi: Number(row?.with_ai ?? 0),
    withPerson: Number(row?.with_person ?? 0),
    toneAlerts: Number(row?.tone_alerts ?? 0),
    startedToday: Number(row?.started_today ?? 0),
  };
}
