import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { MAX_ENTRY_MINUTES, TIME_NOTE_MAX } from "@/lib/work-time";

import type { Membership } from "./auth";
import { memberCan } from "./permissions";
import { projectsGuard, type ProjectsResult } from "./projects-errors";
import { col, typedRow, typedRows } from "./typed-rows";
import { listAssignmentChoices } from "./work-choices";
import { logTime } from "./work-time";

/**
 * Projects and Work together (D904, `docs/projects.md` P8.3d), a pair of the octopus: a list's time goes to a Work assignment, and each of
 * its tasks logs time there. Projects holds both links (`checklists.assignment_id`, `checklist_item_time`), so Work's tables know nothing
 * of it; the screens show the pair only while the store has both (`projectsOn()`, `store.workOn`). Time goes in through Work's own
 * `logTime()`, so Work's rules hold: the minutes 1 to 24 hours, the day not later than today where the store is, billable, and drawn on
 * the assignment's draft invoice like any other entry.
 */

/** The pair is lit for the member: Work is on for the store, and the member has Work's right (to see it, or to log time). */
export function workPairOn(member: Membership, log = false): boolean {
  return member.store.workOn && memberCan(member, log ? "settings:write" : "settings:read");
}

export type ListWork = { assignmentId: string; assignment: string; client: string; minutes: number };

/** The assignment a list's time goes to, with the minutes logged from its tasks; null when it has none. */
export async function listWork(storeId: string, checklistId: string): Promise<ListWork | null> {
  const row = await typedRow(
    z.object({ assignment_id: col.uuid, assignment: col.text, client: col.text, minutes: col.int }),
    sql`
      select a.id as assignment_id, a.name as assignment, cl.name as client,
        coalesce((
          select sum(e.minutes) from commerce.checklist_item_time t
          join commerce.checklist_items i on i.store_id = t.store_id and i.id = t.item_id
          join commerce.work_time_entries e on e.store_id = t.store_id and e.id = t.time_entry_id
          where t.store_id = c.store_id and i.checklist_id = c.id
        ), 0)::int as minutes
      from commerce.checklists c
      join commerce.work_assignments a on a.store_id = c.store_id and a.id = c.assignment_id
      join commerce.work_clients cl on cl.store_id = a.store_id and cl.id = a.client_id
      where c.store_id = ${storeId}::uuid and c.id = ${checklistId}::uuid
    `,
  );
  return row ? { assignmentId: row.assignment_id, assignment: row.assignment, client: row.client, minutes: row.minutes } : null;
}

/** The minutes logged on each task of a list that has any. */
export async function taskMinutes(storeId: string, checklistId: string): Promise<Record<string, number>> {
  const rows = await typedRows(
    z.object({ item_id: col.uuid, minutes: col.int }),
    sql`
      select t.item_id, sum(e.minutes)::int as minutes
      from commerce.checklist_item_time t
      join commerce.checklist_items i on i.store_id = t.store_id and i.id = t.item_id
      join commerce.work_time_entries e on e.store_id = t.store_id and e.id = t.time_entry_id
      where t.store_id = ${storeId}::uuid and i.checklist_id = ${checklistId}::uuid
      group by t.item_id
    `,
  );
  return Object.fromEntries(rows.map((r) => [r.item_id, r.minutes]));
}

/** The assignments a list may send its time to: Work's own choices (active and paused, by client), and the one it has. */
export async function assignmentOptions(storeId: string, current: string | null): Promise<{ id: string; label: string }[]> {
  const choices = await listAssignmentChoices(storeId, current ? [current] : []);
  return choices.map((a) => ({ id: a.id, label: `${a.clientName} · ${a.name}` }));
}

/** The lists whose time goes to an assignment, for Work's assignment page while the store has Projects. */
export async function listsOfAssignment(storeId: string, assignmentId: string): Promise<{ id: string; title: string; open: number }[]> {
  return typedRows(
    z.object({ id: col.uuid, title: col.text, open: col.int }),
    sql`
      select c.id, c.title,
        (select count(*) from commerce.checklist_items i
          where i.store_id = c.store_id and i.checklist_id = c.id and i.done_at is null and i.archived_at is null)::int as open
      from commerce.checklists c
      where c.store_id = ${storeId}::uuid and c.assignment_id = ${assignmentId}::uuid
      order by c.title limit 50
    `,
  );
}

export const listAssignmentInput = z.object({ checklistId: z.uuid(), assignmentId: z.uuid().nullable() });

/** A list's time sent to an assignment, or to none. Needs the right to change projects and to see Work. */
export async function setListAssignment(member: Membership, raw: unknown): Promise<ProjectsResult> {
  if (!memberCan(member, "projects:write") || !workPairOn(member)) return { ok: false, problem: "forbidden" };
  const input = listAssignmentInput.safeParse(raw);
  if (!input.success) return { ok: false, problem: "invalid" };
  const { checklistId, assignmentId } = input.data;
  return projectsGuard(async () => {
    const changed = await typedRows(
      z.object({ id: col.uuid }),
      sql`
        update commerce.checklists set assignment_id = ${assignmentId}::uuid
        where store_id = ${member.store.id}::uuid and id = ${checklistId}::uuid returning id
      `,
    );
    return changed.length > 0 ? { ok: true } : { ok: false, problem: "not_found" };
  });
}

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const taskTimeInput = z.object({ itemId: z.uuid(), minutes: z.int().min(1).max(MAX_ENTRY_MINUTES), workDate: day.nullable().optional() });

/**
 * Time logged on a task: a Work time entry on its list's assignment, in the member's name, noted with the task's title, on the day given
 * (today where the store is when none), and the task's link to it. Needs the right to change projects and Work's right to log time.
 */
export async function logTaskTime(member: Membership, raw: unknown): Promise<ProjectsResult<{ id: string }>> {
  if (!memberCan(member, "projects:write") || !workPairOn(member, true)) return { ok: false, problem: "forbidden" };
  const input = taskTimeInput.safeParse(raw);
  if (!input.success) return { ok: false, problem: "invalid", fields: ["minutes"] };
  const storeId = member.store.id;
  const task = await typedRow(
    z.object({ title: col.text, assignment_id: col.uuid.nullable(), today: col.text }),
    sql`
      select i.title, c.assignment_id, commerce.work_today(i.store_id)::text as today
      from commerce.checklist_items i join commerce.checklists c on c.store_id = i.store_id and c.id = i.checklist_id
      where i.store_id = ${storeId}::uuid and i.id = ${input.data.itemId}::uuid
    `,
  );
  if (!task) return { ok: false, problem: "not_found" };
  if (!task.assignment_id) return { ok: false, problem: "invalid" };
  const logged = await logTime(member, {
    assignmentId: task.assignment_id,
    workDate: input.data.workDate ?? task.today,
    minutes: input.data.minutes,
    billable: true,
    note: task.title.slice(0, TIME_NOTE_MAX),
  });
  // Work refuses a day that has not come, or minutes out of its bounds: the form's own field.
  if (!logged.ok) return { ok: false, problem: "invalid", fields: [input.data.workDate ? "workDate" : "minutes"] };
  return projectsGuard(async () => {
    await db().execute(sql`
      insert into commerce.checklist_item_time (store_id, item_id, time_entry_id)
      values (${storeId}::uuid, ${input.data.itemId}::uuid, ${logged.id}::uuid)
    `);
    return { ok: true, id: logged.id };
  });
}
