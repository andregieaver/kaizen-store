import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { storeZoneOf } from "@/lib/dates";
import { nextOccurrence } from "@/lib/projects-recurrence";
import { parseRecurrence } from "@/lib/projects-recurrence-schema";

import { col, typedRows, type Executor } from "./typed-rows";

/**
 * Repeating tasks coming back (D903 P4.1, Life's `server/services/checklist-recurrence.ts`): when a task's next time has come it is open
 * again, at its time after that, with its subtasks unticked (a new time is a clean sheet, even when the last was half done). A task ticked
 * in time keeps its run; one that was not ticked loses it. A skip is forgotten with the time it skipped.
 *
 * Two callers decide the same and either may be first: a list's page, for the tasks it has just read, and the five-minute dispatcher, for
 * every store. Each write repeats the condition (`next_due_at` still passed), so the second matches nothing and a task ticked in between is
 * never unticked by a late write.
 */

/** A task as the roll needs it: its id and its rule as kept. */
export type DueTask = { id: string; recurrence: unknown };

/** Rolls a store's due tasks on to their next time; the ids of those it moved (none when another caller was first). */
export async function rollOver(storeId: string, timeZone: string, due: readonly DueTask[], now = Date.now(), runner: Executor = db()): Promise<string[]> {
  const plan = due.flatMap((task) => {
    const rule = parseRecurrence(task.recurrence);
    return rule ? [{ id: task.id, next: nextOccurrence(rule, now, timeZone) }] : [];
  });
  if (plan.length === 0) return [];
  const rows = await typedRows(
    z.object({ id: col.uuid }),
    sql`
      with plan (id, next_due) as (values ${sql.join(
        plan.map((p) => sql`(${p.id}::uuid, ${p.next}::timestamptz)`),
        sql`, `,
      )}),
      rolled as (
        update commerce.checklist_items i
        set next_due_at = p.next_due, done_at = null, skipped_at = null,
          streak = case when i.done_at is null then 0 else i.streak end, updated_at = now()
        from plan p
        where i.store_id = ${storeId}::uuid and i.id = p.id and i.recurrence is not null and i.next_due_at <= ${new Date(now)}
        returning i.id
      ),
      steps as (
        update commerce.checklist_subtasks s set done_at = null, updated_at = now()
        from rolled r where s.store_id = ${storeId}::uuid and s.item_id = r.id and s.done_at is not null
        returning s.id
      )
      select id from rolled
    `,
    runner,
  );
  return rows.map((r) => r.id);
}

/** Whether a task read with its rule and its next time is due to come back. */
export const isDue = (task: { recurrence: unknown; next_due_at: string | null }, now = Date.now()): boolean =>
  task.recurrence !== null && task.next_due_at !== null && Date.parse(task.next_due_at) <= now;

const MAX_A_RUN = 500;

/**
 * The dispatcher's part (`repeats`): the repeating tasks of every store whose time has come, oldest first and at most 500 a run, rolled on in
 * each store's zone, only where the store's account has Projects (D904: a list read-only after its grace period rolls on when its page is
 * read, never in the background). Idle, one statement on a partial index.
 */
export async function rollOverDueTasks(now = Date.now()): Promise<{ rolled: number }> {
  const due = await typedRows(
    z.object({ id: col.uuid, store_id: col.uuid, recurrence: z.unknown(), time_zone: col.textOrNull }),
    sql`
      select i.id, i.store_id, i.recurrence, s.time_zone
      from commerce.checklist_items i join commerce.stores s on s.id = i.store_id
      where i.recurrence is not null and i.next_due_at <= ${new Date(now)} and commerce.extension_on(i.store_id, 'projects')
      order by i.next_due_at
      limit ${MAX_A_RUN}
    `,
  );
  let rolled = 0;
  for (const storeId of new Set(due.map((row) => row.store_id))) {
    const rows = due.filter((row) => row.store_id === storeId);
    rolled += (await rollOver(storeId, storeZoneOf(rows[0]?.time_zone), rows, now)).length;
  }
  return { rolled };
}
