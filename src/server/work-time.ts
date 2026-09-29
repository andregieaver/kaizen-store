import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db, readDb, type Db } from "@/db/client";
import { isDay } from "@/lib/work-dates";
import {
  alertToRaise,
  elapsedWholeMinutes,
  estimateStage,
  remainingMinutes,
  type EstimateAlertSettings,
  type EstimateStage,
} from "@/lib/work-estimate";
import { startTimerInput, timeEntryInput, timeEntryNoteInput } from "@/lib/work-input";
import {
  MAX_ENTRY_MINUTES,
  billableMinutes,
  filterTimeEntries,
  invoiceableMinutes,
  totalMinutes,
} from "@/lib/work-time";

import type { Membership } from "./auth";
import { workEvent } from "./work";
import { syncTaskHoursToDraftLine } from "./work-draft-sync";
import { problem, workGuard, zodProblems, type WorkResult } from "./work-errors";

type Row = Record<string, unknown>;

/**
 * Time entries and timers (docs/work.md 1.7, 4.2, 4.9, 7.2 WP3). Entries
 * are integer minutes; what a person typed ("1h30") is read with
 * `parseDuration()` (`src/lib/work-time.ts`) before it gets here. A timer is a
 * row in the database (one per person per store), started and stopped by the
 * SQL functions `work_start_timer` / `work_stop_timer`, so switching timers
 * and rounding up are atomic and the same whatever calls them.
 *
 * Who may change what (4.9): owners any entry, admins their own. Time on an
 * issued invoice can no longer change or be deleted (the database refuses it,
 * `work_time.immutable`, and `workErrorMessage()` says so). Time on a draft
 * invoice's line changes only in its date and note: its minutes, billable
 * flag, assignment and task are what the line was made from, so they are
 * changed by taking the time off the invoice first (`releaseTimeFromDrafts()`
 * in `work-invoices.ts`, the invoice actions' `releaseTimeFromInvoiceAction`).
 *
 * Billable time on a task goes onto the task's line on a draft invoice, in the
 * same transaction as the write (`syncTaskHoursToDraftLine()`, docs/work.md
 * 1.4): logging, changing what an unbilled entry is worth, and stopping a timer.
 */

const iso = (value: unknown): string | null => (value ? new Date(String(value)).toISOString() : null);
const text = (value: unknown): string | null => (value === null || value === undefined ? null : String(value));
const int = (value: unknown): number => Number(value ?? 0);
const isUuid = (value: unknown): value is string => z.uuid().safeParse(value).success;

/** Whether the member may change an entry that this account logged: owners any, admins their own. */
export const mayChangeEntry = (member: Pick<Membership, "role" | "account">, entryAccountId: string): boolean =>
  member.role === "owner" || member.account.id === entryAccountId;

// --- Reading entries ---------------------------------------------------------------

export type TimeEntryItem = {
  id: string;
  assignmentId: string;
  assignmentName: string;
  clientId: string;
  clientName: string;
  taskId: string | null;
  taskTitle: string | null;
  /** Who worked. */
  accountId: string;
  accountName: string;
  workDate: string;
  minutes: number;
  billable: boolean;
  note: string | null;
  /** Minutes an hour package covered (later package); 0 until then. */
  prepaidMinutes: number;
  /** What an invoice takes from it: the minutes less what prepaid hours covered. Only billable time is invoiced. */
  invoiceableMinutes: number;
  /** The draft or issued invoice line it is on. */
  invoiceLineId: string | null;
  invoiceId: string | null;
  invoiceStatus: "draft" | "sent" | "paid" | "void" | null;
  /** The invoice's number, once issued. */
  invoiceNumber: string | null;
  /** On an issued invoice: it can no longer be changed or deleted. */
  locked: boolean;
  createdAt: string;
};

const ENTRY_SELECT = sql`
  select e.id, e.assignment_id, a.name as assignment_name, a.client_id, c.name as client_name,
         e.task_id, t.title as task_title, e.account_id, coalesce(nullif(acc.name, ''), acc.email) as account_name,
         e.work_date::text as work_date, e.minutes, e.billable, e.note, e.prepaid_minutes,
         e.invoice_line_id, l.invoice_id, i.status as invoice_status, i.document_number, e.created_at
  from commerce.work_time_entries e
  join commerce.work_assignments a on a.store_id = e.store_id and a.id = e.assignment_id
  join commerce.work_clients c on c.store_id = a.store_id and c.id = a.client_id
  join commerce.accounts acc on acc.id = e.account_id
  left join commerce.work_tasks t on t.store_id = e.store_id and t.id = e.task_id
  left join commerce.work_invoice_lines l on l.store_id = e.store_id and l.id = e.invoice_line_id
  left join commerce.work_invoices i on i.store_id = l.store_id and i.id = l.invoice_id
`;

const toEntry = (row: Row): TimeEntryItem => {
  const minutes = int(row.minutes);
  const prepaid = int(row.prepaid_minutes);
  const status = text(row.invoice_status) as TimeEntryItem["invoiceStatus"];
  return {
    id: String(row.id),
    assignmentId: String(row.assignment_id),
    assignmentName: String(row.assignment_name),
    clientId: String(row.client_id),
    clientName: String(row.client_name),
    taskId: text(row.task_id),
    taskTitle: text(row.task_title),
    accountId: String(row.account_id),
    accountName: String(row.account_name),
    workDate: String(row.work_date),
    minutes,
    billable: Boolean(row.billable),
    note: text(row.note),
    prepaidMinutes: prepaid,
    invoiceableMinutes: Boolean(row.billable) ? Math.max(0, minutes - prepaid) : 0,
    invoiceLineId: text(row.invoice_line_id),
    invoiceId: text(row.invoice_id),
    invoiceStatus: status,
    invoiceNumber: text(row.document_number),
    locked: status === "sent" || status === "paid",
    createdAt: iso(row.created_at) as string,
  };
};

export type TimeEntryFilter = {
  assignmentId?: string;
  clientId?: string;
  /** A task, or `NO_TASK_FILTER` (`__none__`) for time logged on no task (`filterTimeEntries`). */
  taskId?: string | null;
  /** Who worked. */
  accountId?: string;
  /** Days, `YYYY-MM-DD`, inclusive. */
  from?: string;
  to?: string;
  billable?: boolean;
  /** `unbilled`: billable and on no invoice line; `on_draft`: on a draft's line; `invoiced`: on an issued invoice's. */
  billing?: "all" | "unbilled" | "on_draft" | "invoiced";
  /** Looks in the task's title and the note, ignoring case (`filterTimeEntries`). */
  query?: string;
  /** At most this many (default 500, most recent first); the totals still count them all, up to 5 000. */
  limit?: number;
  offset?: number;
};

export type TimeEntryList = {
  entries: TimeEntryItem[];
  totals: {
    count: number;
    minutes: number;
    billableMinutes: number;
    /** Billable, on no invoice line, less prepaid minutes. */
    unbilledMinutes: number;
  };
  /** There were more entries than the 5 000 counted. */
  truncated: boolean;
};

const LIST_CAP = 5000;

/** Entries of the store, newest first, narrowed by the filter. */
export async function listTimeEntries(storeId: string, filter: TimeEntryFilter = {}): Promise<TimeEntryList> {
  const empty: TimeEntryList = {
    entries: [],
    totals: { count: 0, minutes: 0, billableMinutes: 0, unbilledMinutes: 0 },
    truncated: false,
  };
  for (const id of [filter.assignmentId, filter.clientId, filter.accountId]) {
    if (id !== undefined && !isUuid(id)) return empty;
  }
  for (const day of [filter.from, filter.to]) {
    if (day !== undefined && !isDay(day)) return empty;
  }
  const taskId = filter.taskId && filter.taskId !== "__none__" && !isUuid(filter.taskId) ? "invalid" : filter.taskId;
  if (taskId === "invalid") return empty;
  const billing = filter.billing ?? "all";
  const rows = await readDb().execute<Row>(sql`
    ${ENTRY_SELECT}
    where e.store_id = ${storeId}::uuid
      and (${filter.assignmentId ?? null}::uuid is null or e.assignment_id = ${filter.assignmentId ?? null}::uuid)
      and (${filter.clientId ?? null}::uuid is null or a.client_id = ${filter.clientId ?? null}::uuid)
      and (${filter.accountId ?? null}::uuid is null or e.account_id = ${filter.accountId ?? null}::uuid)
      and (${filter.from ?? null}::date is null or e.work_date >= ${filter.from ?? null}::date)
      and (${filter.to ?? null}::date is null or e.work_date <= ${filter.to ?? null}::date)
      and (${filter.billable ?? null}::boolean is null or e.billable = ${filter.billable ?? null}::boolean)
      and (${billing} = 'all'
           or (${billing} = 'unbilled' and e.billable and e.invoice_line_id is null)
           or (${billing} = 'on_draft' and i.status = 'draft')
           or (${billing} = 'invoiced' and i.status in ('sent', 'paid')))
    order by e.work_date desc, e.created_at desc, e.id
    limit ${LIST_CAP + 1}
  `);
  const all = filterTimeEntries(rows.slice(0, LIST_CAP).map(toEntry), {
    taskId: taskId ?? null,
    query: filter.query ?? "",
  });
  const offset = Math.max(0, filter.offset ?? 0);
  const limit = Math.max(1, Math.min(LIST_CAP, filter.limit ?? 500));
  return {
    entries: all.slice(offset, offset + limit),
    totals: {
      count: all.length,
      minutes: totalMinutes(all),
      billableMinutes: billableMinutes(all),
      unbilledMinutes: invoiceableMinutes(all, { onlyUnbilled: true }),
    },
    truncated: rows.length > LIST_CAP,
  };
}

/** One entry of the store, or null (also for another store's id). */
export async function getTimeEntry(storeId: string, entryId: string): Promise<TimeEntryItem | null> {
  if (!isUuid(entryId)) return null;
  const [row] = await readDb().execute<Row>(
    sql`${ENTRY_SELECT} where e.store_id = ${storeId}::uuid and e.id = ${entryId}::uuid`,
  );
  return row ? toEntry(row) : null;
}

/**
 * The time an invoice can be made from: billable, on no invoice line yet,
 * oldest first. For the invoice server, which attaches what a draft takes
 * (`invoice_line_id`) so nothing is billed twice. `until` is the last day
 * (`YYYY-MM-DD`) to include.
 */
export async function unbilledEntries(
  storeId: string,
  filter: { clientId?: string; assignmentId?: string; until?: string } = {},
): Promise<TimeEntryItem[]> {
  for (const id of [filter.clientId, filter.assignmentId]) if (id !== undefined && !isUuid(id)) return [];
  if (filter.until !== undefined && !isDay(filter.until)) return [];
  const rows = await readDb().execute<Row>(sql`
    ${ENTRY_SELECT}
    where e.store_id = ${storeId}::uuid and e.billable and e.invoice_line_id is null
      and (${filter.clientId ?? null}::uuid is null or a.client_id = ${filter.clientId ?? null}::uuid)
      and (${filter.assignmentId ?? null}::uuid is null or e.assignment_id = ${filter.assignmentId ?? null}::uuid)
      and (${filter.until ?? null}::date is null or e.work_date <= ${filter.until ?? null}::date)
    order by e.work_date, e.created_at, e.id
  `);
  return rows.map(toEntry);
}

// --- Logging and changing entries ------------------------------------------------------

type Runner = Pick<Db, "execute">;

/** What a time entry points at must be in this store: the assignment, and a task that is the assignment's own. */
async function checkTarget(
  run: Runner,
  storeId: string,
  assignmentId: string,
  taskId: string | null,
): Promise<string | null> {
  const [assignment] = await run.execute<Row>(sql`
    select 1 from commerce.work_assignments where store_id = ${storeId}::uuid and id = ${assignmentId}::uuid
  `);
  if (!assignment) return "This assignment no longer exists.";
  if (taskId) {
    const [task] = await run.execute<Row>(sql`
      select 1 from commerce.work_tasks
      where store_id = ${storeId}::uuid and id = ${taskId}::uuid and assignment_id = ${assignmentId}::uuid
    `);
    if (!task) return "That task is not on this assignment.";
  }
  return null;
}

/** Time is logged for a day that has come, in the store's own time zone. */
async function checkDate(run: Runner, storeId: string, workDate: string): Promise<string | null> {
  const [row] = await run.execute<Row>(sql`select commerce.work_today(${storeId}::uuid)::text as today`);
  return workDate > String(row.today) ? "You cannot log time for a day that has not come yet." : null;
}

/**
 * Logs time for the member (any member logs their own). The assignment must
 * be the store's and the task the assignment's; the date not later than today
 * where the store is.
 */
export async function logTime({ account, store }: Membership, raw: unknown): Promise<WorkResult<{ id: string }>> {
  const parsed = timeEntryInput.safeParse(raw);
  if (!parsed.success) return problem(...zodProblems(parsed.error));
  const input = parsed.data;
  return workGuard(() =>
    db().transaction(async (tx): Promise<WorkResult<{ id: string }>> => {
      const wrong =
        (await checkTarget(tx, store.id, input.assignmentId, input.taskId)) ??
        (await checkDate(tx, store.id, input.workDate));
      if (wrong) return problem(wrong);
      const [row] = await tx.execute<Row>(sql`
        insert into commerce.work_time_entries (store_id, assignment_id, task_id, account_id, work_date, minutes, billable, note)
        values (${store.id}::uuid, ${input.assignmentId}::uuid, ${input.taskId}::uuid, ${account.id}::uuid,
                ${input.workDate}::date, ${input.minutes}, ${input.billable}, ${input.note})
        returning id
      `);
      const id = String(row.id);
      await workEvent(
        tx,
        store.id,
        "time",
        id,
        "time.logged",
        { minutes: input.minutes, assignment_id: input.assignmentId, task_id: input.taskId, source: "manual" },
        account.id,
      );
      if (input.taskId && input.billable) await syncTaskHoursToDraftLine(tx, { storeId: store.id, taskId: input.taskId });
      return { ok: true, id };
    }),
  ) as Promise<WorkResult<{ id: string }>>;
}

/** The entry as a change needs to see it, locked for the change. */
async function loadEntryForChange(run: Runner, storeId: string, entryId: string): Promise<Row | undefined> {
  const [row] = await run.execute<Row>(sql`
    select e.account_id, e.assignment_id, e.task_id, e.work_date::text as work_date, e.minutes, e.billable, e.invoice_line_id,
           (select i.status from commerce.work_invoice_lines l
              join commerce.work_invoices i on i.store_id = l.store_id and i.id = l.invoice_id
             where l.store_id = e.store_id and l.id = e.invoice_line_id) as invoice_status
    from commerce.work_time_entries e
    where e.store_id = ${storeId}::uuid and e.id = ${entryId}::uuid
    for update of e
  `);
  return row;
}

const NOT_ALLOWED = "Only an owner can change time logged by someone else.";
const ON_DRAFT =
  "This time is on a draft invoice, so it cannot be changed or deleted as it is. Choose 'Take off invoice' for it (or remove its line from the draft) first, then change or delete it. Only its date and note can be changed while it is on the invoice.";

/**
 * Changes an entry: its date, minutes, billable flag, task and note (and the
 * assignment, with a task of it), owners any entry and admins their own. Time
 * on a draft invoice's line changes only in its date and note; time on an
 * issued invoice does not change at all (`work_time.immutable`).
 */
export async function updateTimeEntry(member: Membership, entryId: string, raw: unknown): Promise<WorkResult> {
  const { account, store } = member;
  if (!isUuid(entryId)) return problem("This time entry no longer exists.");
  const parsed = timeEntryInput.safeParse(raw);
  if (!parsed.success) return problem(...zodProblems(parsed.error));
  const input = parsed.data;
  return workGuard(() =>
    db().transaction(async (tx): Promise<WorkResult> => {
      const current = await loadEntryForChange(tx, store.id, entryId);
      if (!current) return problem("This time entry no longer exists.");
      if (!mayChangeEntry(member, String(current.account_id))) return problem(NOT_ALLOWED);
      const line = current.invoice_line_id ? String(current.invoice_status) : null;
      if (line === "draft") {
        const changes =
          input.assignmentId !== String(current.assignment_id) ||
          input.taskId !== text(current.task_id) ||
          input.minutes !== int(current.minutes) ||
          input.billable !== Boolean(current.billable);
        if (changes) return problem(ON_DRAFT);
      }
      const dateMoved = input.workDate !== String(current.work_date);
      const wrong =
        (await checkTarget(tx, store.id, input.assignmentId, input.taskId)) ??
        (dateMoved ? await checkDate(tx, store.id, input.workDate) : null);
      if (wrong) return problem(wrong);
      await tx.execute(sql`
        update commerce.work_time_entries set
          assignment_id = ${input.assignmentId}::uuid, task_id = ${input.taskId}::uuid, work_date = ${input.workDate}::date,
          minutes = ${input.minutes}, billable = ${input.billable}, note = ${input.note}, updated_at = now()
        where store_id = ${store.id}::uuid and id = ${entryId}::uuid
      `);
      await workEvent(
        tx,
        store.id,
        "time",
        entryId,
        "time.updated",
        { minutes: input.minutes, assignment_id: input.assignmentId },
        account.id,
      );
      // Time on no invoice that now counts for a task (or counts differently) goes onto the task's draft line.
      const worthChanged =
        input.assignmentId !== String(current.assignment_id) ||
        input.taskId !== text(current.task_id) ||
        input.minutes !== int(current.minutes) ||
        input.billable !== Boolean(current.billable);
      if (worthChanged && !current.invoice_line_id && input.taskId && input.billable) {
        await syncTaskHoursToDraftLine(tx, { storeId: store.id, taskId: input.taskId });
      }
      return { ok: true };
    }),
  );
}

/** Changes only an entry's note, the one thing Life let you change after logging (owners any entry, admins their own). */
export async function setEntryNote(member: Membership, entryId: string, raw: unknown): Promise<WorkResult> {
  const { account, store } = member;
  if (!isUuid(entryId)) return problem("This time entry no longer exists.");
  const parsed = timeEntryNoteInput.safeParse(raw);
  if (!parsed.success) return problem(...zodProblems(parsed.error));
  return workGuard(() =>
    db().transaction(async (tx): Promise<WorkResult> => {
      const current = await loadEntryForChange(tx, store.id, entryId);
      if (!current) return problem("This time entry no longer exists.");
      if (!mayChangeEntry(member, String(current.account_id))) return problem(NOT_ALLOWED);
      await tx.execute(sql`
        update commerce.work_time_entries set note = ${parsed.data.note}, updated_at = now()
        where store_id = ${store.id}::uuid and id = ${entryId}::uuid
      `);
      await workEvent(tx, store.id, "time", entryId, "time.updated", { note: true }, account.id);
      return { ok: true };
    }),
  );
}

/**
 * Deletes an entry (owners any entry, admins their own). Refused for time on an
 * issued invoice (`work_time.immutable`) and for time on a draft invoice's line.
 */
export async function deleteTimeEntry(member: Membership, entryId: string): Promise<WorkResult> {
  const { account, store } = member;
  if (!isUuid(entryId)) return problem("This time entry no longer exists.");
  return workGuard(() =>
    db().transaction(async (tx): Promise<WorkResult> => {
      const current = await loadEntryForChange(tx, store.id, entryId);
      if (!current) return problem("This time entry no longer exists.");
      if (!mayChangeEntry(member, String(current.account_id))) return problem(NOT_ALLOWED);
      if (current.invoice_line_id && String(current.invoice_status) === "draft") return problem(ON_DRAFT);
      await tx.execute(
        sql`delete from commerce.work_time_entries where store_id = ${store.id}::uuid and id = ${entryId}::uuid`,
      );
      await workEvent(
        tx,
        store.id,
        "time",
        entryId,
        "time.deleted",
        { minutes: int(current.minutes), assignment_id: String(current.assignment_id) },
        account.id,
      );
      return { ok: true };
    }),
  );
}

// --- Timers --------------------------------------------------------------------------------

/**
 * A running timer with what the page needs to tick it and to raise the
 * estimate warning (docs/work.md 1.8): the start, the server's clock (so a
 * browser whose clock is off still counts right), and the estimate it is
 * measured against.
 */
export type RunningTimer = {
  accountId: string;
  assignmentId: string;
  assignmentName: string;
  clientId: string;
  clientName: string;
  taskId: string | null;
  taskTitle: string | null;
  /** ISO time the clock started. */
  startedAt: string;
  /** ISO time on the database's clock when this was read. */
  serverNow: string;
  /** Whole seconds it had run at `serverNow`. */
  elapsedSeconds: number;
  /** What the warning is measured against; null when there is no estimate to warn about. */
  estimate: TimerEstimate | null;
};

export type TimerEstimate = {
  /** The task's estimate when the timer is on a task that has one, else the assignment's. */
  target: "task" | "assignment";
  estimatedMinutes: number;
  /** Minutes already logged on the target, billable or not, not counting this running timer. */
  loggedMinutes: number;
  /** Minutes left when the timer started (negative when already over). */
  remainingAtStartMinutes: number;
  /** The assignment's warning settings (`null` minutes: warnings off). */
  settings: EstimateAlertSettings;
  /** Where the estimate stands at `serverNow`, counting the whole minutes the timer has run. */
  stage: EstimateStage;
  /** The warning to raise now, if one is due and this timer has not raised it (`fired`: none yet); the page remembers each. */
  alert: "near" | "over" | null;
};

const RUNNING_SELECT = sql`
  select w.account_id, w.assignment_id, a.name as assignment_name, a.client_id, c.name as client_name,
         w.task_id, t.title as task_title, w.started_at, now() as server_now,
         floor(extract(epoch from now() - w.started_at))::bigint as elapsed_seconds,
         a.estimated_minutes as assignment_estimate, t.estimated_minutes as task_estimate,
         a.estimate_alert_minutes, a.estimate_alert_popup, a.estimate_alert_sound,
         coalesce((select sum(e.minutes) from commerce.work_time_entries e
                    where e.store_id = w.store_id and e.assignment_id = w.assignment_id), 0)::int as assignment_logged,
         coalesce((select sum(e.minutes) from commerce.work_time_entries e
                    where e.store_id = w.store_id and e.assignment_id = w.assignment_id and e.task_id = w.task_id), 0)::int as task_logged
  from commerce.work_timers w
  join commerce.work_assignments a on a.store_id = w.store_id and a.id = w.assignment_id
  join commerce.work_clients c on c.store_id = a.store_id and c.id = a.client_id
  left join commerce.work_tasks t on t.store_id = w.store_id and t.id = w.task_id
`;

function toRunningTimer(row: Row): RunningTimer {
  const settings: EstimateAlertSettings = {
    minutes: row.estimate_alert_minutes == null ? null : int(row.estimate_alert_minutes),
    popup: Boolean(row.estimate_alert_popup),
    sound: Boolean(row.estimate_alert_sound),
  };
  const elapsedSeconds = int(row.elapsed_seconds);
  const onTask = row.task_estimate != null;
  const estimatedMinutes = onTask
    ? int(row.task_estimate)
    : row.assignment_estimate == null
      ? null
      : int(row.assignment_estimate);
  let estimate: TimerEstimate | null = null;
  if (estimatedMinutes !== null) {
    const loggedMinutes = onTask ? int(row.task_logged) : int(row.assignment_logged);
    const elapsedMs = elapsedSeconds * 1000;
    const remaining = remainingMinutes(estimatedMinutes, loggedMinutes + elapsedWholeMinutes(elapsedMs));
    estimate = {
      target: onTask ? "task" : "assignment",
      estimatedMinutes,
      loggedMinutes,
      remainingAtStartMinutes: estimatedMinutes - loggedMinutes,
      settings,
      stage: estimateStage(remaining, settings.minutes),
      alert: alertToRaise({ estimatedMinutes, loggedMinutes, elapsedMs, settings, fired: new Set() }),
    };
  }
  return {
    accountId: String(row.account_id),
    assignmentId: String(row.assignment_id),
    assignmentName: String(row.assignment_name),
    clientId: String(row.client_id),
    clientName: String(row.client_name),
    taskId: text(row.task_id),
    taskTitle: text(row.task_title),
    startedAt: iso(row.started_at) as string,
    serverNow: iso(row.server_now) as string,
    elapsedSeconds,
    estimate,
  };
}

/** The person's running timer in this store, or null. */
export async function getRunningTimer(storeId: string, accountId: string): Promise<RunningTimer | null> {
  if (!isUuid(accountId)) return null;
  const [row] = await readDb().execute<Row>(sql`
    ${RUNNING_SELECT} where w.store_id = ${storeId}::uuid and w.account_id = ${accountId}::uuid
  `);
  return row ? toRunningTimer(row) : null;
}

export type StoreTimer = RunningTimer & { accountName: string };

/** Everyone's running timers in the store, longest running first (the overview flags one left running). */
export async function listRunningTimers(storeId: string): Promise<StoreTimer[]> {
  const rows = await readDb().execute<Row>(sql`
    select r.*, coalesce(nullif(acc.name, ''), acc.email) as account_name
    from (${RUNNING_SELECT} where w.store_id = ${storeId}::uuid) r
    join commerce.accounts acc on acc.id = r.account_id
    order by r.started_at, r.account_id
  `);
  return rows.map((row) => ({ ...toRunningTimer(row), accountName: String(row.account_name) }));
}

/** An entry a stopped timer made, in brief. */
export type StoppedEntry = {
  id: string;
  assignmentId: string;
  taskId: string | null;
  workDate: string;
  minutes: number;
};

const toStopped = (row: Row): StoppedEntry => ({
  id: String(row.id),
  assignmentId: String(row.assignment_id),
  taskId: text(row.task_id),
  workDate: String(row.work_date),
  minutes: int(row.minutes),
});

/**
 * Starts the member's timer on an assignment (and a task of it). One runs per
 * person per store: a timer that was running is stopped and logged first, in
 * the same transaction, and reported as `stopped`.
 */
export async function startTimer(
  { account, store }: Membership,
  raw: unknown,
): Promise<WorkResult<{ startedAt: string; stopped: StoppedEntry | null }>> {
  const parsed = startTimerInput.safeParse(raw);
  if (!parsed.success) return problem(...zodProblems(parsed.error));
  const input = parsed.data;
  return workGuard(() =>
    db().transaction(async (tx): Promise<WorkResult<{ startedAt: string; stopped: StoppedEntry | null }>> => {
      const wrong = await checkTarget(tx, store.id, input.assignmentId, input.taskId);
      if (wrong) return problem(wrong);
      const [started] = await tx.execute<Row>(sql`
        select timer_started_at, stopped_entry_id
        from commerce.work_start_timer(${store.id}::uuid, ${account.id}::uuid, ${input.assignmentId}::uuid, ${input.taskId}::uuid)
      `);
      let stopped: StoppedEntry | null = null;
      if (started.stopped_entry_id) {
        const [entry] = await tx.execute<Row>(sql`
          select id, assignment_id, task_id, work_date::text as work_date, minutes
          from commerce.work_time_entries where store_id = ${store.id}::uuid and id = ${String(started.stopped_entry_id)}::uuid
        `);
        stopped = entry ? toStopped(entry) : null;
        if (stopped?.taskId) await syncTaskHoursToDraftLine(tx, { storeId: store.id, taskId: stopped.taskId });
      }
      return { ok: true, startedAt: iso(started.timer_started_at) as string, stopped };
    }),
  ) as Promise<WorkResult<{ startedAt: string; stopped: StoppedEntry | null }>>;
}

/**
 * Stops a running timer and logs it as a billable entry: every started minute
 * counts, at least 1 and at most 24 hours (`capped` says a longer clock was
 * cut, so the person can correct it). Nothing running is not an error: `entry`
 * is null. Stopping someone else's timer, a forgotten one, is for owners.
 */
export async function stopTimer(
  member: Membership,
  options: { note?: unknown; forAccountId?: string } = {},
): Promise<WorkResult<{ entry: StoppedEntry | null; capped: boolean }>> {
  const { store } = member;
  const target = options.forAccountId ?? member.account.id;
  if (!isUuid(target)) return problem("There is no timer to stop.");
  if (target !== member.account.id && member.role !== "owner")
    return problem("Only an owner can stop someone else's timer.");
  const note = timeEntryNoteInput.safeParse({ note: options.note });
  if (!note.success) return problem(...zodProblems(note.error));
  return workGuard(() =>
    db().transaction(async (tx): Promise<WorkResult<{ entry: StoppedEntry | null; capped: boolean }>> => {
      const [running] = await tx.execute<Row>(sql`
        select ceil(extract(epoch from now() - started_at) / 60)::int as minutes
        from commerce.work_timers where store_id = ${store.id}::uuid and account_id = ${target}::uuid
      `);
      const [entry] = await tx.execute<Row>(sql`
        select id, assignment_id, task_id, work_date::text as work_date, minutes
        from commerce.work_stop_timer(${store.id}::uuid, ${target}::uuid, ${note.data.note})
      `);
      // The stopped entry is billable time on its task: the task's draft line takes it.
      if (entry?.task_id) await syncTaskHoursToDraftLine(tx, { storeId: store.id, taskId: String(entry.task_id) });
      return {
        ok: true,
        entry: entry ? toStopped(entry) : null,
        capped: Boolean(entry) && int(running?.minutes) > MAX_ENTRY_MINUTES,
      };
    }),
  ) as Promise<WorkResult<{ entry: StoppedEntry | null; capped: boolean }>>;
}

/**
 * Throws away the member's own running timer without logging anything (a timer started by mistake).
 * Someone else's timer is not thrown away: an owner stops it, which logs its time. Nothing running is
 * not an error (`discarded: false`). The database's timer functions take the same lock, so a discard
 * cannot cross a start or a stop of the same person's timer.
 */
export async function discardTimer({ account, store }: Membership): Promise<WorkResult<{ discarded: boolean }>> {
  return workGuard(() =>
    db().transaction(async (tx): Promise<WorkResult<{ discarded: boolean }>> => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended('work_timer:' || ${store.id}::text || ${account.id}::text, 0))`,
      );
      const [timer] = await tx.execute<Row>(sql`
        delete from commerce.work_timers where store_id = ${store.id}::uuid and account_id = ${account.id}::uuid
        returning assignment_id, task_id, started_at,
                  floor(extract(epoch from now() - started_at) / 60)::int as minutes
      `);
      if (!timer) return { ok: true, discarded: false };
      await workEvent(
        tx,
        store.id,
        "time",
        null,
        "timer.discarded",
        {
          assignment_id: String(timer.assignment_id),
          task_id: text(timer.task_id),
          started_at: iso(timer.started_at),
          minutes: int(timer.minutes),
        },
        account.id,
      );
      return { ok: true, discarded: true };
    }),
  ) as Promise<WorkResult<{ discarded: boolean }>>;
}
