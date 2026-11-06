import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { cleanActivityInput, todayWindow, type ActivityInput, type ActivityKind, type ActivityProblem } from "@/lib/activities";

import { audit, type Membership } from "./auth";
import { log } from "./log";
import { memberCan } from "./permissions";
import { sendActivityPush } from "./push";
import { uuidList } from "./sql-arrays";
import type { Store } from "./stores";
import { col, typedRow, typedRows } from "./typed-rows";

/**
 * Activities (S3 of `docs/own-books-and-sales.md`, D468): the one reader and writer of a store's calls, meetings and tasks. Read by
 * whoever may read customers; written by whoever may change them (`customers:write`), each about the store's own person, company or deal
 * and done by a member whose access has not ended. The dispatcher's `activities` job tells the person an activity is for when a timed one
 * is due, once (`runActivityPushes()`). Audited as `activity.*` with ids only, never a title or a note.
 */

type Row = Record<string, unknown>;
const WRITE = "customers:write" as const;

export type Activity = {
  id: string;
  kind: ActivityKind;
  title: string;
  note: string | null;
  dueAt: string;
  timed: boolean;
  durationMinutes: number | null;
  doneAt: string | null;
  assignee: { id: string; name: string } | null;
  customer: { id: string; name: string } | null;
  company: { id: string; name: string } | null;
  deal: { id: string; title: string } | null;
};

export type ActivityResult = { ok: true; id: string } | { ok: false; problems: (ActivityProblem | "forbidden" | "not_found")[] };

const row = z.object({
  id: col.uuid,
  kind: z.enum(["call", "meeting", "task"]),
  title: col.text,
  note: col.textOrNull,
  due_at: col.timestamp,
  timed: col.bool,
  duration_minutes: col.int.nullable(),
  done_at: col.timestampOrNull,
  assignee_id: col.uuid.nullable(),
  assignee_name: col.textOrNull,
  customer_id: col.uuid.nullable(),
  customer_name: col.textOrNull,
  company_id: col.uuid.nullable(),
  company_name: col.textOrNull,
  deal_id: col.uuid.nullable(),
  deal_title: col.textOrNull,
});

const SELECT = sql`
  select a.id, a.kind, a.title, a.note, a.due_at, a.timed, a.duration_minutes, a.done_at,
    a.assignee_id, coalesce(nullif(ac.name, ''), ac.email) as assignee_name,
    a.customer_id, coalesce(nullif(c.name, ''), c.email) as customer_name,
    a.company_id, k.name as company_name,
    a.deal_id, d.title as deal_title
  from commerce.activities a
  left join commerce.accounts ac on ac.id = a.assignee_id
  left join commerce.customers c on c.store_id = a.store_id and c.id = a.customer_id
  left join commerce.customer_companies k on k.store_id = a.store_id and k.id = a.company_id
  left join commerce.deals d on d.store_id = a.store_id and d.id = a.deal_id`;

const asActivity = (r: z.output<typeof row>): Activity => ({
  id: r.id,
  kind: r.kind,
  title: r.title,
  note: r.note,
  dueAt: r.due_at,
  timed: r.timed,
  durationMinutes: r.duration_minutes,
  doneAt: r.done_at,
  assignee: r.assignee_id ? { id: r.assignee_id, name: r.assignee_name ?? "" } : null,
  customer: r.customer_id ? { id: r.customer_id, name: r.customer_name ?? "" } : null,
  company: r.company_id ? { id: r.company_id, name: r.company_name ?? "" } : null,
  deal: r.deal_id ? { id: r.deal_id, title: r.deal_title ?? "" } : null,
});

/** A deal's, a person's or a company's activities: the open ones by when they are due, then the done ones, the latest first. At most 200. */
export async function activitiesOf(storeId: string, about: { dealId?: string; customerId?: string; companyId?: string }): Promise<Activity[]> {
  const rows = await typedRows(
    row,
    sql`${SELECT}
      where a.store_id = ${storeId}::uuid
        and (${about.dealId ?? null}::uuid is null or a.deal_id = ${about.dealId ?? null}::uuid)
        and (${about.customerId ?? null}::uuid is null or a.customer_id = ${about.customerId ?? null}::uuid)
        and (${about.companyId ?? null}::uuid is null or a.company_id = ${about.companyId ?? null}::uuid)
      order by a.done_at is not null, case when a.done_at is null then a.due_at end, a.done_at desc, a.id
      limit 200`,
  );
  return rows.map(asActivity);
}

/**
 * What the store's home shows under *Today*: every activity not done that is due before today ends, and those done today; one person's
 * (the viewer's, by default) or the whole team's. The page sorts them with `todayList()`.
 */
export async function todayActivities(store: Store, assigneeId: string | null, now: Date = new Date()): Promise<Activity[]> {
  const { startOfToday, endOfToday } = todayWindow(now, store.timeZone);
  const rows = await typedRows(
    row,
    sql`${SELECT}
      where a.store_id = ${store.id}::uuid
        and (${assigneeId}::uuid is null or a.assignee_id = ${assigneeId}::uuid)
        and ((a.done_at is null and a.due_at < ${endOfToday}::timestamptz) or a.done_at >= ${startOfToday}::timestamptz)
      order by a.due_at, a.id
      limit 200`,
  );
  return rows.map(asActivity);
}

/** Each deal's next step: its earliest activity not done, for the board's cards. */
export async function nextActivities(storeId: string, dealIds: readonly string[]): Promise<Map<string, { kind: ActivityKind; dueAt: string; timed: boolean }>> {
  const out = new Map<string, { kind: ActivityKind; dueAt: string; timed: boolean }>();
  if (dealIds.length === 0) return out;
  const rows = await typedRows(
    z.object({ deal_id: col.uuid, kind: z.enum(["call", "meeting", "task"]), due_at: col.timestamp, timed: col.bool }),
    sql`
      select distinct on (deal_id) deal_id, kind, due_at, timed from commerce.activities
      where store_id = ${storeId}::uuid and deal_id = any(${uuidList(dealIds)}) and done_at is null
      order by deal_id, due_at, id
    `,
  );
  for (const r of rows) out.set(r.deal_id, { kind: r.kind, dueAt: r.due_at, timed: r.timed });
  return out;
}

/** Whether the person, company, deal and assignee named are this store's (the assignee a member whose access has not ended). */
async function namedProblems(storeId: string, a: Pick<ActivityInput, "customerId" | "companyId" | "dealId" | "assigneeId">): Promise<ActivityProblem[]> {
  const facts = await typedRow(
    z.object({ who: col.bool, assignee: col.bool }),
    sql`
      select
        (${a.customerId}::uuid is null or exists (select 1 from commerce.customers where store_id = ${storeId}::uuid and id = ${a.customerId}::uuid))
          and (${a.companyId}::uuid is null or exists (select 1 from commerce.customer_companies where store_id = ${storeId}::uuid and id = ${a.companyId}::uuid))
          and (${a.dealId}::uuid is null or exists (select 1 from commerce.deals where store_id = ${storeId}::uuid and id = ${a.dealId}::uuid)) as who,
        (${a.assigneeId}::uuid is null or exists (select 1 from commerce.store_members where store_id = ${storeId}::uuid and account_id = ${a.assigneeId}::uuid
          and (expires_at is null or expires_at > now()))) as assignee
    `,
  );
  const problems: ActivityProblem[] = [];
  if (!facts?.who) problems.push("who");
  if (!facts?.assignee) problems.push("assignee");
  return problems;
}

/** A new activity (`customers:write`), for the one who made it unless they chose another member. */
export async function createActivity(member: Membership, raw: Record<string, unknown>): Promise<ActivityResult> {
  if (!memberCan(member, WRITE)) return { ok: false, problems: ["forbidden"] };
  const cleaned = cleanActivityInput(raw, member.store.timeZone);
  if (!cleaned.ok) return cleaned;
  const a = { ...cleaned.activity, assigneeId: cleaned.activity.assigneeId ?? member.account.id };
  const problems = await namedProblems(member.store.id, a);
  if (problems.length > 0) return { ok: false, problems };
  const made = await typedRow(
    z.object({ id: col.uuid }),
    sql`
      insert into commerce.activities (store_id, kind, title, note, due_at, timed, duration_minutes, assignee_id, customer_id, company_id, deal_id, created_by)
      values (${member.store.id}::uuid, ${a.kind}, ${a.title}, ${a.note}, ${a.dueAt}::timestamptz, ${a.timed}, ${a.durationMinutes},
        ${a.assigneeId}::uuid, ${a.customerId}::uuid, ${a.companyId}::uuid, ${a.dealId}::uuid, ${member.account.id}::uuid)
      returning id
    `,
  );
  await audit(member.account.id, member.store.id, "activity.created", { activity: made!.id, kind: a.kind }, { area: "customers", target: { type: "activity", id: made!.id } });
  return { ok: true, id: made!.id };
}

/** An activity changed (`customers:write`): what, when, for whom and about whom; a new time of an untold one is told again when due. */
export async function updateActivity(member: Membership, id: string, raw: Record<string, unknown>): Promise<ActivityResult> {
  if (!memberCan(member, WRITE)) return { ok: false, problems: ["forbidden"] };
  const cleaned = cleanActivityInput(raw, member.store.timeZone);
  if (!cleaned.ok) return cleaned;
  const a = cleaned.activity;
  const problems = await namedProblems(member.store.id, a);
  if (problems.length > 0) return { ok: false, problems };
  const [changed] = await db().execute<Row>(sql`
    update commerce.activities set kind = ${a.kind}, title = ${a.title}, note = ${a.note}, due_at = ${a.dueAt}::timestamptz, timed = ${a.timed},
      duration_minutes = ${a.durationMinutes}, assignee_id = ${a.assigneeId}::uuid, customer_id = ${a.customerId}::uuid, company_id = ${a.companyId}::uuid,
      deal_id = ${a.dealId}::uuid, notified_at = case when due_at = ${a.dueAt}::timestamptz then notified_at end, updated_at = now()
    where store_id = ${member.store.id}::uuid and id = ${id}::uuid
    returning id
  `);
  if (!changed) return { ok: false, problems: ["not_found"] };
  await audit(member.account.id, member.store.id, "activity.updated", { activity: id }, { area: "customers", target: { type: "activity", id } });
  return { ok: true, id };
}

/** An activity marked done, or not done again (`customers:write`): who did it and when. */
export async function setActivityDone(member: Membership, id: string, done: boolean): Promise<ActivityResult> {
  if (!memberCan(member, WRITE)) return { ok: false, problems: ["forbidden"] };
  const [changed] = await db().execute<Row>(sql`
    update commerce.activities
    set done_at = case when ${done} then coalesce(done_at, now()) end, done_by = case when ${done} then coalesce(done_by, ${member.account.id}::uuid) end, updated_at = now()
    where store_id = ${member.store.id}::uuid and id = ${id}::uuid
    returning id
  `);
  if (!changed) return { ok: false, problems: ["not_found"] };
  await audit(member.account.id, member.store.id, done ? "activity.done" : "activity.reopened", { activity: id }, { area: "customers", target: { type: "activity", id } });
  return { ok: true, id };
}

/** An activity deleted (`customers:write`). */
export async function deleteActivity(member: Membership, id: string): Promise<ActivityResult> {
  if (!memberCan(member, WRITE)) return { ok: false, problems: ["forbidden"] };
  const [gone] = await db().execute<Row>(sql`delete from commerce.activities where store_id = ${member.store.id}::uuid and id = ${id}::uuid returning id`);
  if (!gone) return { ok: false, problems: ["not_found"] };
  await audit(member.account.id, member.store.id, "activity.deleted", { activity: id }, { area: "customers", target: { type: "activity", id } });
  return { ok: true, id };
}

/** Timed activities due within the last day, not done and not told yet, and their person: a push each, claimed so two runs never both send. */
const DUE_WINDOW_MS = 24 * 3600_000;
const PUSHES_PER_RUN = 200;

/**
 * The dispatcher's `activities` job (D468): for each timed activity that is due (within the last day), not done and not told, its person
 * is told on their devices for the store, once. Never throws. Returns how many were told.
 */
export async function runActivityPushes(now: Date = new Date(), send: Parameters<typeof sendActivityPush>[3] = undefined): Promise<number> {
  try {
    const due = await typedRows(
      z.object({ id: col.uuid, store_id: col.uuid, assignee_id: col.uuid.nullable() }),
      sql`
        update commerce.activities a set notified_at = ${now.toISOString()}::timestamptz
        where a.id in (
          select id from commerce.activities
          where timed and done_at is null and notified_at is null
            and due_at <= ${now.toISOString()}::timestamptz and due_at > ${new Date(now.getTime() - DUE_WINDOW_MS).toISOString()}::timestamptz
          order by due_at limit ${PUSHES_PER_RUN}
          for update skip locked
        )
        returning a.id, a.store_id, a.assignee_id
      `,
    );
    let told = 0;
    for (const a of due) {
      if (!a.assignee_id) continue;
      told += (await sendActivityPush(a.store_id, a.id, a.assignee_id, send)) > 0 ? 1 : 0;
    }
    return told;
  } catch (error) {
    log("error", "activities.push_failed", {}, error);
    return 0;
  }
}
