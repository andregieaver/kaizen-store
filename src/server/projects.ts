import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { problemFields, projectInput, statusBar, type StatusBar } from "@/lib/projects";
import { PROJECT_COLOURS, PROJECT_HEALTHS, PROJECT_STATUSES, PRIORITIES, type ProjectHealth, type ProjectStatus } from "@/lib/projects-model";

import type { Membership } from "./auth";
import { memberCan } from "./permissions";
import { projectsGuard, type ProjectsResult } from "./projects-errors";
import { everyOnce, reorderSql, setList } from "./projects-sql";
import { allStatuses, effectiveOf, type Status } from "./projects-statuses";
import { col, typedRow, typedRows } from "./typed-rows";

/**
 * Projects (D903, `docs/projects.md`): a store's projects, the checklists that belong to them (membership: a list may be in several, one
 * its home) and where each item sits in a project's process (its stage, a second axis beside its own status). Read by members who may read
 * projects; changed by those who may change them (`projects:write`). Every statement names the store, so another store's row is
 * `not_found`; the database keeps the home project a member and a stage within its project (`projects_rules`).
 */

const WRITE = "projects:write" as const;

export type Person = { id: string; name: string };

export type ProjectSummary = {
  id: string;
  name: string;
  description: string | null;
  colour: (typeof PROJECT_COLOURS)[number];
  status: ProjectStatus;
  health: ProjectHealth;
  nextAction: string | null;
  targetDate: string | null;
  statusReviewedAt: string | null;
  sortOrder: number;
  lists: number;
  bar: StatusBar;
};

export type BoardItem = {
  id: string;
  title: string;
  checklistId: string;
  checklistTitle: string;
  done: boolean;
  statusId: string | null;
  /** Its stage in this project; null means the project's first. */
  stageId: string | null;
  assignedTo: string | null;
  dueAt: string | null;
  allDay: boolean | null;
  priority: (typeof PRIORITIES)[number] | null;
  subtasks: { total: number; done: number };
};

export type ProjectDetail = ProjectSummary & {
  checklists: { id: string; title: string; status: string; home: boolean; total: number; done: number }[];
  stages: Status[];
  items: BoardItem[];
  /** Each list's statuses (its own or the store's), for an item's own status. */
  statusesByList: Record<string, Status[]>;
};

/** The store's team: who an item, a list or a subtask may be assigned to (members whose access has not ended). */
export async function teamOf(storeId: string): Promise<Person[]> {
  const rows = await typedRows(
    z.object({ id: col.uuid, name: col.textOrNull, email: col.text }),
    sql`
      select a.id, a.name, a.email from commerce.store_members m join commerce.accounts a on a.id = m.account_id
      where m.store_id = ${storeId}::uuid and m.disabled_at is null and (m.expires_at is null or m.expires_at > now())
      order by coalesce(a.name, a.email)
    `,
  );
  return rows.map((r) => ({ id: r.id, name: r.name?.trim() || r.email }));
}

/** Whether an account may be assigned in this store: a member whose access has not ended, or nobody. */
export async function assignable(storeId: string, accountId: string | null | undefined): Promise<boolean> {
  if (!accountId) return true;
  const row = await typedRow(
    z.object({ ok: col.bool }),
    sql`select exists (
      select 1 from commerce.store_members where store_id = ${storeId}::uuid and account_id = ${accountId}::uuid
        and disabled_at is null and (expires_at is null or expires_at > now())
    ) as ok`,
  );
  return row?.ok ?? false;
}

const projectRow = z.object({
  id: col.uuid,
  name: col.text,
  description: col.textOrNull,
  colour: z.enum(PROJECT_COLOURS),
  status: z.enum(PROJECT_STATUSES),
  health: z.enum(PROJECT_HEALTHS),
  next_action: col.textOrNull,
  target_date: col.textOrNull,
  status_reviewed_at: col.timestampOrNull,
  sort_order: col.int,
  lists: col.int,
});

const stageItemRow = z.object({ project_id: col.uuid, item_id: col.uuid, stage_id: col.uuid.nullable(), done: col.bool });

/** The store's projects in their order, each with its lists counted and its items' stages as a status bar. */
export async function listProjects(storeId: string): Promise<ProjectSummary[]> {
  const [rows, stageItems, stages] = await Promise.all([
    typedRows(
      projectRow,
      sql`
        select p.id, p.name, p.description, p.colour, p.status, p.health, p.next_action, p.target_date::text as target_date, p.status_reviewed_at,
          p.sort_order, (select count(*)::int from commerce.project_checklists pc where pc.store_id = p.store_id and pc.project_id = p.id) as lists
        from commerce.projects p where p.store_id = ${storeId}::uuid
        order by p.sort_order, p.created_at
      `,
    ),
    typedRows(
      stageItemRow,
      sql`
        select pc.project_id, i.id as item_id, st.status_id as stage_id, i.done_at is not null as done
        from commerce.project_checklists pc
        join commerce.checklist_items i on i.store_id = pc.store_id and i.checklist_id = pc.checklist_id and i.archived_at is null
        left join commerce.project_item_stages st on st.store_id = pc.store_id and st.project_id = pc.project_id and st.item_id = i.id
        where pc.store_id = ${storeId}::uuid
      `,
    ),
    allStatuses(storeId, "project"),
  ]);
  return rows.map((r) => {
    const own = effectiveOf(stages, r.id);
    const items = stageItems.filter((s) => s.project_id === r.id).map((s) => ({ statusId: s.stage_id ?? own[0]?.id ?? null, done: s.done }));
    return { ...summaryOf(r), bar: statusBar(own, items) };
  });
}

const summaryOf = (r: z.output<typeof projectRow>): Omit<ProjectSummary, "bar"> => ({
  id: r.id,
  name: r.name,
  description: r.description,
  colour: r.colour,
  status: r.status,
  health: r.health,
  nextAction: r.next_action,
  targetDate: r.target_date,
  statusReviewedAt: r.status_reviewed_at,
  sortOrder: r.sort_order,
  lists: r.lists,
});

const boardRow = z.object({
  id: col.uuid,
  title: col.text,
  checklist_id: col.uuid,
  checklist_title: col.text,
  done: col.bool,
  status_id: col.uuid.nullable(),
  stage_id: col.uuid.nullable(),
  assigned_to: col.uuid.nullable(),
  due_at: col.timestampOrNull,
  all_day: col.bool.nullable(),
  priority: z.enum(PRIORITIES).nullable(),
  subtasks: col.int,
  subtasks_done: col.int,
});

/** One project with its lists, its stages and every item of its lists that is not archived; null when it is not the store's. */
export async function projectDetail(storeId: string, projectId: string): Promise<ProjectDetail | null> {
  const project = (await listProjects(storeId)).find((p) => p.id === projectId);
  if (!project) return null;
  const [lists, items, projectStages, listStatuses] = await Promise.all([
    typedRows(
      z.object({ id: col.uuid, title: col.text, status: col.text, home: col.bool, total: col.int, done: col.int }),
      sql`
        select c.id, c.title, c.status, c.primary_project_id = ${projectId}::uuid as home,
          (select count(*)::int from commerce.checklist_items i where i.store_id = c.store_id and i.checklist_id = c.id and i.archived_at is null) as total,
          (select count(*)::int from commerce.checklist_items i where i.store_id = c.store_id and i.checklist_id = c.id and i.archived_at is null and i.done_at is not null) as done
        from commerce.project_checklists pc join commerce.checklists c on c.store_id = pc.store_id and c.id = pc.checklist_id
        where pc.store_id = ${storeId}::uuid and pc.project_id = ${projectId}::uuid
        order by pc.sort_order, pc.created_at
      `,
    ),
    typedRows(
      boardRow,
      sql`
        select i.id, i.title, i.checklist_id, c.title as checklist_title, i.done_at is not null as done, i.status_id, st.status_id as stage_id,
          i.assigned_to, i.due_at, i.all_day, i.priority,
          (select count(*)::int from commerce.checklist_subtasks s where s.store_id = i.store_id and s.item_id = i.id) as subtasks,
          (select count(*)::int from commerce.checklist_subtasks s where s.store_id = i.store_id and s.item_id = i.id and s.done_at is not null) as subtasks_done
        from commerce.project_checklists pc
        join commerce.checklists c on c.store_id = pc.store_id and c.id = pc.checklist_id
        join commerce.checklist_items i on i.store_id = pc.store_id and i.checklist_id = pc.checklist_id and i.archived_at is null
        left join commerce.project_item_stages st on st.store_id = pc.store_id and st.project_id = pc.project_id and st.item_id = i.id
        where pc.store_id = ${storeId}::uuid and pc.project_id = ${projectId}::uuid
        order by pc.sort_order, i.sort_order
      `,
    ),
    allStatuses(storeId, "project"),
    allStatuses(storeId, "checklist"),
  ]);
  const statusesByList = Object.fromEntries(lists.map((l) => [l.id, effectiveOf(listStatuses, l.id)]));
  return {
    ...project,
    checklists: lists,
    stages: effectiveOf(projectStages, projectId),
    statusesByList,
    items: items.map((i) => ({
      id: i.id,
      title: i.title,
      checklistId: i.checklist_id,
      checklistTitle: i.checklist_title,
      done: i.done,
      statusId: i.status_id,
      stageId: i.stage_id,
      assignedTo: i.assigned_to,
      dueAt: i.due_at,
      allDay: i.all_day,
      priority: i.priority,
      subtasks: { total: i.subtasks, done: i.subtasks_done },
    })),
  };
}

/** The projects a list can be put in, for its *Projects* choice. */
export async function projectChoices(storeId: string): Promise<{ id: string; name: string; status: ProjectStatus }[]> {
  return (await listProjects(storeId)).map((p) => ({ id: p.id, name: p.name, status: p.status }));
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/** A new project at the end of the store's, active unless the input says otherwise. */
export async function createProject(member: Membership, raw: unknown): Promise<ProjectsResult<{ id: string }>> {
  if (!memberCan(member, WRITE)) return { ok: false, problem: "forbidden" };
  const input = projectInput.safeParse(raw);
  if (!input.success) return { ok: false, problem: "invalid", fields: problemFields(input.error) };
  const storeId = member.store.id;
  const d = input.data;
  return projectsGuard(async () => {
    const made = await typedRow(
      z.object({ id: col.uuid }),
      sql`
        insert into commerce.projects (store_id, name, description, colour, status, health, next_action, target_date, sort_order, created_by)
        values (${storeId}::uuid, ${d.name}, ${d.description ?? null}, ${d.colour ?? "chart-1"}, ${d.status ?? "active"}, ${d.health ?? "green"},
          ${d.nextAction ?? null}, ${d.targetDate ?? null}::date,
          (select coalesce(max(sort_order) + 1, 0) from commerce.projects where store_id = ${storeId}::uuid), ${member.account.id}::uuid)
        returning id
      `,
    );
    return made ? { ok: true, id: made.id } : { ok: false, problem: "invalid" };
  });
}

/** A project's details changed: only the fields given. */
export async function updateProject(member: Membership, id: string, raw: unknown): Promise<ProjectsResult> {
  if (!memberCan(member, WRITE)) return { ok: false, problem: "forbidden" };
  const input = projectInput.partial().safeParse(raw);
  if (!input.success) return { ok: false, problem: "invalid", fields: problemFields(input.error) };
  const d = input.data;
  // Saying where a project stands is reviewing it (Life's `set_project_status`).
  const reviewed = d.status !== undefined || d.health !== undefined ? sql`now()` : undefined;
  const set = setList([
    [sql`name`, d.name],
    [sql`description`, d.description],
    [sql`colour`, d.colour],
    [sql`status`, d.status],
    [sql`health`, d.health],
    [sql`next_action`, d.nextAction],
    [sql`target_date`, d.targetDate === undefined ? undefined : d.targetDate === null ? null : sql`${d.targetDate}::date`],
    [sql`status_reviewed_at`, reviewed],
  ]);
  if (!set) return { ok: true };
  return projectsGuard(async () => {
    const changed = await typedRows(z.object({ id: col.uuid }), sql`update commerce.projects set ${set} where store_id = ${member.store.id}::uuid and id = ${id}::uuid returning id`);
    return changed.length > 0 ? { ok: true } : { ok: false, problem: "not_found" };
  });
}

/** Someone looked at a project's status and health and they stand (Life's `review_project`). */
export async function reviewProject(member: Membership, id: string): Promise<ProjectsResult> {
  if (!memberCan(member, WRITE)) return { ok: false, problem: "forbidden" };
  const changed = await typedRows(
    z.object({ id: col.uuid }),
    sql`update commerce.projects set status_reviewed_at = now(), updated_at = now() where store_id = ${member.store.id}::uuid and id = ${id}::uuid returning id`,
  );
  return changed.length > 0 ? { ok: true } : { ok: false, problem: "not_found" };
}

/** The store's projects in the order given (every one of them, once). */
export async function reorderProjects(member: Membership, ids: readonly string[]): Promise<ProjectsResult> {
  if (!memberCan(member, WRITE)) return { ok: false, problem: "forbidden" };
  const storeId = member.store.id;
  const known = await typedRows(z.object({ id: col.uuid }), sql`select id from commerce.projects where store_id = ${storeId}::uuid`);
  if (!everyOnce(ids, known.map((k) => k.id))) return { ok: false, problem: "invalid" };
  await db().execute(reorderSql(sql`commerce.projects`, storeId, ids));
  return { ok: true };
}

/** A project deleted. Its lists stay (membership, not containment): they lose the project, and a list whose home it was moves home. */
export async function deleteProject(member: Membership, id: string): Promise<ProjectsResult> {
  if (!memberCan(member, WRITE)) return { ok: false, problem: "forbidden" };
  const gone = await typedRows(z.object({ id: col.uuid }), sql`delete from commerce.projects where store_id = ${member.store.id}::uuid and id = ${id}::uuid returning id`);
  return gone.length > 0 ? { ok: true } : { ok: false, problem: "not_found" };
}

/** A list put in a project, at the end of its lists; the first project of a list becomes its home (the database's rule). */
export async function linkChecklist(member: Membership, projectId: string, checklistId: string): Promise<ProjectsResult> {
  if (!memberCan(member, WRITE)) return { ok: false, problem: "forbidden" };
  const storeId = member.store.id;
  return projectsGuard(async () => {
    await db().execute(sql`
      insert into commerce.project_checklists (store_id, project_id, checklist_id, sort_order)
      values (${storeId}::uuid, ${projectId}::uuid, ${checklistId}::uuid,
        (select coalesce(max(sort_order) + 1, 0) from commerce.project_checklists where store_id = ${storeId}::uuid and project_id = ${projectId}::uuid))
      on conflict do nothing
    `);
    return { ok: true };
  });
}

/** A list taken out of a project: its items' stages there are forgotten, and its home moves to another project or none. */
export async function unlinkChecklist(member: Membership, projectId: string, checklistId: string): Promise<ProjectsResult> {
  if (!memberCan(member, WRITE)) return { ok: false, problem: "forbidden" };
  const gone = await typedRows(
    z.object({ project_id: col.uuid }),
    sql`
      delete from commerce.project_checklists
      where store_id = ${member.store.id}::uuid and project_id = ${projectId}::uuid and checklist_id = ${checklistId}::uuid
      returning project_id
    `,
  );
  return gone.length > 0 ? { ok: true } : { ok: false, problem: "not_found" };
}

/** A project's lists in the order given. */
export async function reorderProjectChecklists(member: Membership, projectId: string, checklistIds: readonly string[]): Promise<ProjectsResult> {
  if (!memberCan(member, WRITE)) return { ok: false, problem: "forbidden" };
  await db().execute(reorderSql(sql`commerce.project_checklists`, member.store.id, checklistIds, sql`t.project_id = ${projectId}::uuid`, { idColumn: sql`checklist_id`, touch: false }));
  return { ok: true };
}

/** Where an item sits in a project's process; a stage of none puts it back in the first. Refused for an item of a list not in it. */
export async function setItemStage(member: Membership, projectId: string, itemId: string, stageId: string | null): Promise<ProjectsResult> {
  if (!memberCan(member, WRITE)) return { ok: false, problem: "forbidden" };
  const storeId = member.store.id;
  return projectsGuard(async () => {
    if (stageId === null) {
      await db().execute(sql`delete from commerce.project_item_stages where store_id = ${storeId}::uuid and project_id = ${projectId}::uuid and item_id = ${itemId}::uuid`);
      return { ok: true };
    }
    await db().execute(sql`
      insert into commerce.project_item_stages (store_id, project_id, item_id, status_id) values (${storeId}::uuid, ${projectId}::uuid, ${itemId}::uuid, ${stageId}::uuid)
      on conflict (store_id, project_id, item_id) do update set status_id = excluded.status_id, updated_at = now()
    `);
    return { ok: true };
  });
}
