import "server-only";

import { sql } from "drizzle-orm";

import { readDb } from "@/db/client";

type Row = Record<string, unknown>;

/**
 * What the Work screens offer to choose from (docs/work.md 5.2): the
 * assignments time can be logged on and a timer started on, with their tasks,
 * and the people who work in the store. Small readers for the log-time
 * form, the timer starter and the Time page's filters; every query takes the
 * store's id. Nothing is written.
 */

export type ChoiceTask = { id: string; title: string; done: boolean };

export type AssignmentChoice = {
  id: string;
  name: string;
  clientId: string;
  clientName: string;
  status: "active" | "paused" | "done";
  tasks: ChoiceTask[];
};

/**
 * Assignments of the store that are `active` or `paused`, for a client that is
 * not archived, by client and then assignment, with each one's tasks in
 * their order (done ones last). `also` adds assignments that are done, or
 * whose client is archived, that a page is already about.
 */
export async function listAssignmentChoices(storeId: string, also: string[] = []): Promise<AssignmentChoice[]> {
  const extra = also.filter((id) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id));
  const alsoIds =
    extra.length > 0
      ? sql`array[${sql.join(
          extra.map((id) => sql`${id}::uuid`),
          sql`, `,
        )}]`
      : sql`array[]::uuid[]`;
  const rows = await readDb().execute<Row>(sql`
    select a.id, a.name, a.client_id, c.name as client_name, a.status,
      coalesce((
        select json_agg(json_build_object('id', t.id, 'title', t.title, 'done', t.status = 'done')
                        order by (t.status = 'done'), t.sort_order, t.created_at, t.id)
        from commerce.work_tasks t where t.store_id = a.store_id and t.assignment_id = a.id
      ), '[]'::json) as tasks
    from commerce.work_assignments a
    join commerce.work_clients c on c.store_id = a.store_id and c.id = a.client_id
    where a.store_id = ${storeId}::uuid
      and ((a.status in ('active', 'paused') and c.archived_at is null)
           or a.id = any(${alsoIds}))
    order by lower(c.name), c.id, a.sort_order, a.created_at, a.id
  `);
  return rows.map((row) => ({
    id: String(row.id),
    name: String(row.name),
    clientId: String(row.client_id),
    clientName: String(row.client_name),
    status: String(row.status) as AssignmentChoice["status"],
    tasks: (Array.isArray(row.tasks) ? row.tasks : []).map((task: Record<string, unknown>) => ({
      id: String(task.id),
      title: String(task.title),
      done: Boolean(task.done),
    })),
  }));
}

export type Person = { id: string; name: string };

/** The people who work in the store (owners and admins), by name; who a time entry can be filtered by. */
export async function listPeople(storeId: string): Promise<Person[]> {
  const rows = await readDb().execute<Row>(sql`
    select a.id, coalesce(nullif(a.name, ''), a.email) as label
    from commerce.store_members m
    join commerce.accounts a on a.id = m.account_id
    where m.store_id = ${storeId}::uuid and m.disabled_at is null and (m.expires_at is null or m.expires_at > now())
    order by lower(coalesce(nullif(a.name, ''), a.email)), a.id
  `);
  return rows.map((row) => ({ id: String(row.id), name: String(row.label) }));
}
