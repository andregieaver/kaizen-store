import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { checklistInput, problemFields } from "@/lib/projects";
import { effectiveFeatures, storedFeatures, type ChecklistFeatures } from "@/lib/projects-features";
import { CHECKLIST_STATES, PRIORITIES, PROJECT_COLOURS, type ChecklistState } from "@/lib/projects-model";
import { parseRecurrence, type Recurrence } from "@/lib/projects-recurrence-schema";
import { sourceOf, type TaskSource } from "@/lib/projects-sources";

import type { Membership } from "./auth";
import { memberCan } from "./permissions";
import { assignable } from "./projects";
import { projectsGuard, type ProjectsResult } from "./projects-errors";
import { isDue, rollOver } from "./projects-repeat";
import { at, everyOnce, reorderSql, setList } from "./projects-sql";
import { allStatuses, effectiveOf, type Status } from "./projects-statuses";
import { col, typedRow, typedRows } from "./typed-rows";

/**
 * Checklists (D903, `docs/projects.md`): a store's lists, standalone or in projects, each a plain list (a title and a box to tick) until
 * *Advanced list*, and one list's page: its items and sections in one order, the Done line, each person's folds, its statuses and its
 * projects. Read by members who may read projects; changed by those who may change them (`projects:write`).
 */

const WRITE = "projects:write" as const;

export type ChecklistSummary = {
  id: string;
  title: string;
  status: ChecklistState;
  dueAt: string | null;
  allDay: boolean | null;
  assignedTo: string | null;
  isRoutine: boolean;
  asTemplate: boolean;
  isAdvanced: boolean;
  projects: { id: string; name: string }[];
  total: number;
  done: number;
  sortOrder: number;
};

export type Subtask = {
  id: string;
  title: string;
  done: boolean;
  isGoal: boolean;
  sortOrder: number;
  dueAt: string | null;
  allDay: boolean | null;
  assignedTo: string | null;
  statusId: string | null;
};

export type ChecklistItem = {
  id: string;
  title: string;
  description: string | null;
  done: boolean;
  doneAt: string | null;
  archived: boolean;
  sortOrder: number;
  statusId: string | null;
  assignedTo: string | null;
  startAt: string | null;
  dueAt: string | null;
  allDay: boolean | null;
  priority: (typeof PRIORITIES)[number] | null;
  /** When it comes back once done (P4.1), its run of times done in a row, when it is next due, when it was last done and skipped. */
  recurrence: Recurrence | null;
  streak: number;
  nextDueAt: string | null;
  lastCompletedAt: string | null;
  skippedAt: string | null;
  blockedReason: string | null;
  blockedByItemId: string | null;
  cost: { minor: number; currency: string } | null;
  /** Its category and tags (P4.6), the store's labels. */
  categoryId: string | null;
  tagIds: string[];
  /** Where it came from (D904 P8.3a): an order, a return, a review or a conversation. */
  source: TaskSource | null;
  /** The customer it is about (P4.7), one of the store's. */
  customerId: string | null;
  subtasks: Subtask[];
  /** The team's comments on it (P4.4), oldest first. */
  comments: ItemComment[];
};

export type ItemComment = { id: string; body: string; writtenBy: string | null; author: string | null; createdAt: string; editedAt: string | null };

export type ChecklistSection = { id: string; title: string; sortOrder: number };

/** A row of a list's open part in its one order: a section or an item. */
export type ChecklistEntry = { kind: "section"; section: ChecklistSection } | { kind: "item"; item: ChecklistItem };

export type ChecklistDetail = {
  id: string;
  title: string;
  description: string | null;
  status: ChecklistState;
  dueAt: string | null;
  allDay: boolean | null;
  assignedTo: string | null;
  isRoutine: boolean;
  asTemplate: boolean;
  isAdvanced: boolean;
  advancedFeatures: unknown;
  goal: string | null;
  primaryProjectId: string | null;
  features: ChecklistFeatures;
  /** The open items and the sections, in their one order. */
  entries: ChecklistEntry[];
  /** The ticked items, below the Done line. */
  done: ChecklistItem[];
  archived: number;
  statuses: Status[];
  ownStatuses: boolean;
  projects: { id: string; name: string }[];
  /** What this person folded: sections by id, `done` for the Done line. */
  folds: string[];
};

const summaryRow = z.object({
  id: col.uuid,
  title: col.text,
  status: z.enum(CHECKLIST_STATES),
  due_at: col.timestampOrNull,
  all_day: col.bool.nullable(),
  assigned_to: col.uuid.nullable(),
  is_routine: col.bool,
  as_template: col.bool,
  is_advanced: col.bool,
  sort_order: col.int,
  total: col.int,
  done: col.int,
  projects: z.array(z.object({ id: col.uuid, name: col.text })),
});

/** The store's lists in their order, each with its items counted and its projects named. */
export async function listChecklists(storeId: string): Promise<ChecklistSummary[]> {
  const rows = await typedRows(
    summaryRow,
    sql`
      select c.id, c.title, c.status, c.due_at, c.all_day, c.assigned_to, c.is_routine, c.as_template, c.is_advanced, c.sort_order,
        (select count(*)::int from commerce.checklist_items i where i.store_id = c.store_id and i.checklist_id = c.id and i.archived_at is null) as total,
        (select count(*)::int from commerce.checklist_items i where i.store_id = c.store_id and i.checklist_id = c.id and i.archived_at is null and i.done_at is not null) as done,
        coalesce((
          select json_agg(json_build_object('id', p.id, 'name', p.name) order by p.id = c.primary_project_id desc, p.name)
          from commerce.project_checklists pc join commerce.projects p on p.store_id = pc.store_id and p.id = pc.project_id
          where pc.store_id = c.store_id and pc.checklist_id = c.id
        ), '[]'::json) as projects
      from commerce.checklists c where c.store_id = ${storeId}::uuid
      order by c.sort_order, c.created_at
    `,
  );
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    status: r.status,
    dueAt: r.due_at,
    allDay: r.all_day,
    assignedTo: r.assigned_to,
    isRoutine: r.is_routine,
    asTemplate: r.as_template,
    isAdvanced: r.is_advanced,
    projects: r.projects,
    total: r.total,
    done: r.done,
    sortOrder: r.sort_order,
  }));
}

const listRow = z.object({
  id: col.uuid,
  title: col.text,
  description: col.textOrNull,
  status: z.enum(CHECKLIST_STATES),
  due_at: col.timestampOrNull,
  all_day: col.bool.nullable(),
  assigned_to: col.uuid.nullable(),
  is_routine: col.bool,
  as_template: col.bool,
  is_advanced: col.bool,
  advanced_features: z.unknown(),
  goal: col.textOrNull,
  primary_project_id: col.uuid.nullable(),
});

const itemRow = z.object({
  id: col.uuid,
  title: col.text,
  description: col.textOrNull,
  done_at: col.timestampOrNull,
  archived_at: col.timestampOrNull,
  sort_order: col.int,
  status_id: col.uuid.nullable(),
  assigned_to: col.uuid.nullable(),
  start_at: col.timestampOrNull,
  due_at: col.timestampOrNull,
  all_day: col.bool.nullable(),
  priority: z.enum(PRIORITIES).nullable(),
  recurrence: z.unknown(),
  streak: col.int,
  next_due_at: col.timestampOrNull,
  last_completed_at: col.timestampOrNull,
  skipped_at: col.timestampOrNull,
  blocked_reason: col.textOrNull,
  blocked_by_item_id: col.uuid.nullable(),
  cost_minor: col.minorOrNull,
  cost_currency: col.currency.nullable(),
  category_id: col.uuid.nullable(),
  order_id: col.uuid.nullable(),
  return_id: col.uuid.nullable(),
  review_id: col.uuid.nullable(),
  conversation_id: col.uuid.nullable(),
  customer_id: col.uuid.nullable(),
});

const subtaskRow = z.object({
  id: col.uuid,
  item_id: col.uuid,
  title: col.text,
  done: col.bool,
  is_goal: col.bool,
  sort_order: col.int,
  due_at: col.timestampOrNull,
  all_day: col.bool.nullable(),
  assigned_to: col.uuid.nullable(),
  status_id: col.uuid.nullable(),
});

/**
 * One list as its page shows it to `accountId` (whose folds it carries); null when it is not the store's. Given the store's zone, a
 * repeating task whose time has come is first made due again (P4.1), as the dispatcher would within five minutes, and the list read again.
 */
export async function checklistDetail(storeId: string, checklistId: string, accountId: string, timeZone?: string): Promise<ChecklistDetail | null> {
  const list = await typedRow(
    listRow,
    sql`
      select id, title, description, status, due_at, all_day, assigned_to, is_routine, as_template, is_advanced, advanced_features, goal, primary_project_id
      from commerce.checklists where store_id = ${storeId}::uuid and id = ${checklistId}::uuid
    `,
  );
  if (!list) return null;
  const [items, sections, subtasks, statuses, projects, folds, tags, comments] = await Promise.all([
    typedRows(
      itemRow,
      sql`
        select id, title, description, done_at, archived_at, sort_order, status_id, assigned_to, start_at, due_at, all_day, priority, recurrence,
          streak, next_due_at, last_completed_at, skipped_at, blocked_reason, blocked_by_item_id, cost_minor, cost_currency, category_id,
          order_id, return_id, review_id, conversation_id, customer_id
        from commerce.checklist_items where store_id = ${storeId}::uuid and checklist_id = ${checklistId}::uuid
        order by sort_order, created_at
      `,
    ),
    typedRows(
      z.object({ id: col.uuid, title: col.text, sort_order: col.int }),
      sql`select id, title, sort_order from commerce.checklist_sections where store_id = ${storeId}::uuid and checklist_id = ${checklistId}::uuid order by sort_order, created_at`,
    ),
    typedRows(
      subtaskRow,
      sql`
        select s.id, s.item_id, s.title, s.done_at is not null as done, s.is_goal, s.sort_order, s.due_at, s.all_day, s.assigned_to, s.status_id
        from commerce.checklist_subtasks s join commerce.checklist_items i on i.store_id = s.store_id and i.id = s.item_id
        where s.store_id = ${storeId}::uuid and i.checklist_id = ${checklistId}::uuid
        order by s.sort_order, s.created_at
      `,
    ),
    allStatuses(storeId, "checklist"),
    typedRows(
      z.object({ id: col.uuid, name: col.text }),
      sql`
        select p.id, p.name from commerce.project_checklists pc join commerce.projects p on p.store_id = pc.store_id and p.id = pc.project_id
        where pc.store_id = ${storeId}::uuid and pc.checklist_id = ${checklistId}::uuid
        order by p.id = ${list.primary_project_id}::uuid desc, p.name
      `,
    ),
    typedRows(
      z.object({ section_id: col.uuid.nullable() }),
      sql`select section_id from commerce.checklist_folds where store_id = ${storeId}::uuid and checklist_id = ${checklistId}::uuid and account_id = ${accountId}::uuid`,
    ),
    typedRows(
      z.object({ item_id: col.uuid, label_id: col.uuid }),
      sql`
        select t.item_id, t.label_id from commerce.checklist_item_tags t join commerce.checklist_items i on i.store_id = t.store_id and i.id = t.item_id
        join commerce.project_labels l on l.store_id = t.store_id and l.id = t.label_id
        where t.store_id = ${storeId}::uuid and i.checklist_id = ${checklistId}::uuid
        order by l.sort_order
      `,
    ),
    typedRows(
      z.object({ id: col.uuid, item_id: col.uuid, body: col.text, written_by: col.uuid.nullable(), author: col.textOrNull, created_at: col.timestamp, edited_at: col.timestampOrNull }),
      sql`
        select c.id, c.item_id, c.body, c.written_by, coalesce(nullif(btrim(a.name), ''), a.email) as author, c.created_at, c.edited_at
        from commerce.checklist_item_comments c join commerce.checklist_items i on i.store_id = c.store_id and i.id = c.item_id
        left join commerce.accounts a on a.id = c.written_by
        where c.store_id = ${storeId}::uuid and i.checklist_id = ${checklistId}::uuid
        order by c.created_at
      `,
    ),
  ]);
  const due = timeZone ? items.filter((i) => isDue(i)) : [];
  if (timeZone && due.length > 0 && (await rollOver(storeId, timeZone, due)).length > 0) return checklistDetail(storeId, checklistId, accountId);
  const stepsOf = new Map<string, Subtask[]>();
  for (const s of subtasks) {
    const steps = stepsOf.get(s.item_id) ?? [];
    steps.push({ id: s.id, title: s.title, done: s.done, isGoal: s.is_goal, sortOrder: s.sort_order, dueAt: s.due_at, allDay: s.all_day, assignedTo: s.assigned_to, statusId: s.status_id });
    stepsOf.set(s.item_id, steps);
  }
  const toItem = (r: z.output<typeof itemRow>): ChecklistItem => ({
    id: r.id,
    title: r.title,
    description: r.description,
    done: r.done_at !== null,
    doneAt: r.done_at,
    archived: r.archived_at !== null,
    sortOrder: r.sort_order,
    statusId: r.status_id,
    assignedTo: r.assigned_to,
    startAt: r.start_at,
    dueAt: r.due_at,
    allDay: r.all_day,
    priority: r.priority,
    recurrence: parseRecurrence(r.recurrence),
    streak: r.streak,
    nextDueAt: r.next_due_at,
    lastCompletedAt: r.last_completed_at,
    skippedAt: r.skipped_at,
    blockedReason: r.blocked_reason,
    blockedByItemId: r.blocked_by_item_id,
    cost: r.cost_minor !== null && r.cost_currency ? { minor: r.cost_minor, currency: r.cost_currency } : null,
    categoryId: r.category_id,
    tagIds: tags.filter((t) => t.item_id === r.id).map((t) => t.label_id),
    source: sourceOf(r),
    customerId: r.customer_id,
    subtasks: stepsOf.get(r.id) ?? [],
    comments: comments
      .filter((c) => c.item_id === r.id)
      .map((c) => ({ id: c.id, body: c.body, writtenBy: c.written_by, author: c.author, createdAt: c.created_at, editedAt: c.edited_at })),
  });
  const live = items.filter((i) => i.archived_at === null).map(toItem);
  const entries: ChecklistEntry[] = [
    ...sections.map((s): ChecklistEntry => ({ kind: "section", section: { id: s.id, title: s.title, sortOrder: s.sort_order } })),
    ...live.filter((i) => !i.done).map((item): ChecklistEntry => ({ kind: "item", item })),
  ].sort((a, b) => sortOf(a) - sortOf(b));
  const own = statuses.some((s) => s.scopeId === checklistId);
  return {
    id: list.id,
    title: list.title,
    description: list.description,
    status: list.status,
    dueAt: list.due_at,
    allDay: list.all_day,
    assignedTo: list.assigned_to,
    isRoutine: list.is_routine,
    asTemplate: list.as_template,
    isAdvanced: list.is_advanced,
    advancedFeatures: list.advanced_features,
    goal: list.goal,
    primaryProjectId: list.primary_project_id,
    features: effectiveFeatures({ isAdvanced: list.is_advanced, advancedFeatures: list.advanced_features, isRoutine: list.is_routine }),
    entries,
    done: live.filter((i) => i.done),
    archived: items.length - live.length,
    statuses: effectiveOf(statuses, checklistId),
    ownStatuses: own,
    projects,
    folds: folds.map((f) => f.section_id ?? "done"),
  };
}

const sortOf = (e: ChecklistEntry): number => (e.kind === "section" ? e.section.sortOrder : e.item.sortOrder);

/**
 * What a list's page was drawn from, in a few characters (P4.10): when any of its tasks, sections, subtasks or comments last changed, and
 * how many there are. Its page asks every twenty seconds while it is shown and is drawn again only when this changed, so a teammate's
 * change appears without a reload. Null when the list is not the store's.
 */
export async function listFingerprint(storeId: string, checklistId: string): Promise<string | null> {
  const row = await typedRow(
    z.object({ found: col.bool, mark: col.textOrNull }),
    sql`
      select exists (select 1 from commerce.checklists where store_id = ${storeId}::uuid and id = ${checklistId}::uuid) as found,
        concat_ws(':',
          (select count(*) || '/' || coalesce(max(updated_at)::text, '') from commerce.checklist_items where store_id = ${storeId}::uuid and checklist_id = ${checklistId}::uuid),
          (select count(*) || '/' || coalesce(max(updated_at)::text, '') from commerce.checklist_sections where store_id = ${storeId}::uuid and checklist_id = ${checklistId}::uuid),
          (select count(*) || '/' || coalesce(max(s.updated_at)::text, '') from commerce.checklist_subtasks s
            join commerce.checklist_items i on i.store_id = s.store_id and i.id = s.item_id where s.store_id = ${storeId}::uuid and i.checklist_id = ${checklistId}::uuid),
          (select count(*) || '/' || coalesce(max(greatest(c.created_at, c.edited_at))::text, '') from commerce.checklist_item_comments c
            join commerce.checklist_items i on i.store_id = c.store_id and i.id = c.item_id where c.store_id = ${storeId}::uuid and i.checklist_id = ${checklistId}::uuid),
          (select updated_at::text from commerce.checklists where store_id = ${storeId}::uuid and id = ${checklistId}::uuid)
        ) as mark
    `,
  );
  return row?.found ? row.mark : null;
}

/** An open task as the store's All tasks view shows it (P4.8, Life's *All items*): with its list and what that list uses. */
export type OpenTask = {
  id: string;
  title: string;
  checklistId: string;
  checklistTitle: string;
  features: ChecklistFeatures;
  statusId: string | null;
  status: { name: string; colour: Status["colour"] } | null;
  assignedTo: string | null;
  priority: (typeof PRIORITIES)[number] | null;
  dueAt: string | null;
  allDay: boolean | null;
  categoryId: string | null;
  tagIds: string[];
};

const openTaskRow = z.object({
  id: col.uuid,
  title: col.text,
  checklist_id: col.uuid,
  checklist_title: col.text,
  is_advanced: col.bool,
  advanced_features: z.unknown(),
  is_routine: col.bool,
  status_id: col.uuid.nullable(),
  status_name: col.textOrNull,
  status_colour: z.enum(PROJECT_COLOURS).nullable(),
  assigned_to: col.uuid.nullable(),
  priority: z.enum(PRIORITIES).nullable(),
  due_at: col.timestampOrNull,
  all_day: col.bool.nullable(),
  category_id: col.uuid.nullable(),
});

/** At most this many open tasks in the All tasks view, the soonest due first. */
const MAX_OPEN_TASKS = 1000;

/** The store's open tasks across its open lists (routines apart), the soonest due first, then by list and order. */
export async function openTasks(storeId: string): Promise<OpenTask[]> {
  const [rows, tags] = await Promise.all([
    typedRows(
      openTaskRow,
      sql`
        select i.id, i.title, c.id as checklist_id, c.title as checklist_title, c.is_advanced, c.advanced_features, c.is_routine,
          i.status_id, s.name as status_name, s.colour as status_colour, i.assigned_to, i.priority, i.due_at, i.all_day, i.category_id
        from commerce.checklist_items i
        join commerce.checklists c on c.store_id = i.store_id and c.id = i.checklist_id
        left join commerce.checklist_statuses s on s.store_id = i.store_id and s.id = i.status_id
        where i.store_id = ${storeId}::uuid and i.done_at is null and i.archived_at is null and c.status = 'open' and not c.is_routine and not c.as_template
        order by i.due_at nulls last, c.sort_order, i.sort_order
        limit ${MAX_OPEN_TASKS}
      `,
    ),
    typedRows(
      z.object({ item_id: col.uuid, label_id: col.uuid }),
      sql`
        select t.item_id, t.label_id from commerce.checklist_item_tags t
        join commerce.checklist_items i on i.store_id = t.store_id and i.id = t.item_id
        join commerce.project_labels l on l.store_id = t.store_id and l.id = t.label_id
        where t.store_id = ${storeId}::uuid and i.done_at is null and i.archived_at is null
        order by l.sort_order
      `,
    ),
  ]);
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    checklistId: r.checklist_id,
    checklistTitle: r.checklist_title,
    features: effectiveFeatures({ isAdvanced: r.is_advanced, advancedFeatures: r.advanced_features, isRoutine: r.is_routine }),
    statusId: r.status_id,
    status: r.status_name && r.status_colour ? { name: r.status_name, colour: r.status_colour } : null,
    assignedTo: r.assigned_to,
    priority: r.priority,
    dueAt: r.due_at,
    allDay: r.all_day,
    categoryId: r.category_id,
    tagIds: tags.filter((t) => t.item_id === r.id).map((t) => t.label_id),
  }));
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/** A new list at the end of the store's, plain unless the input says otherwise, in `projectId` when given (its home). */
export async function createChecklist(member: Membership, raw: unknown, projectId: string | null = null): Promise<ProjectsResult<{ id: string }>> {
  if (!memberCan(member, WRITE)) return { ok: false, problem: "forbidden" };
  const input = checklistInput.safeParse(raw);
  if (!input.success) return { ok: false, problem: "invalid", fields: problemFields(input.error) };
  const storeId = member.store.id;
  if (!(await assignable(storeId, input.data.assignedTo))) return { ok: false, problem: "invalid", fields: ["assignedTo"] };
  const d = input.data;
  return projectsGuard(async () => {
    const made = await typedRow(
      z.object({ id: col.uuid }),
      sql`
        insert into commerce.checklists (store_id, title, description, due_at, all_day, assigned_to, goal, primary_project_id, sort_order, created_by)
        values (${storeId}::uuid, ${d.title}, ${d.description ?? null}, ${at(d.dueAt) ?? null}, ${d.allDay ?? null}, ${d.assignedTo ?? null}::uuid, ${d.goal ?? null},
          ${projectId}::uuid, (select coalesce(max(sort_order) + 1, 0) from commerce.checklists where store_id = ${storeId}::uuid), ${member.account.id}::uuid)
        returning id
      `,
    );
    return made ? { ok: true, id: made.id } : { ok: false, problem: "invalid" };
  });
}

/**
 * A list copied (P4.2, Life's `duplicateChecklistRecord`), at the end of the store's lists, under the title given. The shape of the work
 * comes: its settings, its own statuses, its projects and home, its sections, and its tasks (open and done) with their notes, people,
 * priorities, costs, category and tags, blockers inside the list and subtasks in order. The record of doing it does not: every task is open, in the list's
 * first status, with no run. Due dates and repeats stay behind (a deadline belongs to the occasion, two tasks on one schedule are almost
 * always a mistake), and so do archived tasks.
 */
export async function duplicateChecklist(member: Membership, id: string, title: string): Promise<ProjectsResult<{ id: string }>> {
  if (!memberCan(member, WRITE)) return { ok: false, problem: "forbidden" };
  const input = checklistInput.pick({ title: true }).safeParse({ title });
  if (!input.success) return { ok: false, problem: "invalid", fields: problemFields(input.error) };
  const storeId = member.store.id;
  return projectsGuard(() =>
    db().transaction(async (tx): Promise<ProjectsResult<{ id: string }>> => {
      // Its home first (the database makes it a member), its own statuses before its tasks, so they start in the copy's first one.
      const made = await typedRow(
        z.object({ id: col.uuid }),
        sql`
          insert into commerce.checklists (store_id, title, description, assigned_to, primary_project_id, is_routine, is_advanced, advanced_features, goal, sort_order, created_by)
          select store_id, ${input.data.title}, description, assigned_to, primary_project_id, is_routine, is_advanced, advanced_features, goal,
            (select coalesce(max(sort_order) + 1, 0) from commerce.checklists where store_id = ${storeId}::uuid), ${member.account.id}::uuid
          from commerce.checklists where store_id = ${storeId}::uuid and id = ${id}::uuid
          returning id
        `,
        tx,
      );
      if (!made) return { ok: false, problem: "not_found" };
      const copy = made.id;
      await tx.execute(sql`
        insert into commerce.project_checklists (store_id, project_id, checklist_id, sort_order)
        select pc.store_id, pc.project_id, ${copy}::uuid, (select coalesce(max(o.sort_order) + 1, 0) from commerce.project_checklists o where o.store_id = pc.store_id and o.project_id = pc.project_id)
        from commerce.project_checklists pc where pc.store_id = ${storeId}::uuid and pc.checklist_id = ${id}::uuid
        on conflict do nothing
      `);
      await tx.execute(sql`
        insert into commerce.checklist_statuses (store_id, checklist_id, name, slug, colour, bucket, sort_order)
        select store_id, ${copy}::uuid, name, slug, colour, bucket, sort_order from commerce.checklist_statuses where store_id = ${storeId}::uuid and checklist_id = ${id}::uuid
      `);
      await tx.execute(sql`
        insert into commerce.checklist_sections (store_id, checklist_id, title, sort_order)
        select store_id, ${copy}::uuid, title, sort_order from commerce.checklist_sections where store_id = ${storeId}::uuid and checklist_id = ${id}::uuid
      `);
      // Each task's new id chosen first, so a blocker inside the list and the subtasks find their copies.
      await tx.execute(sql`
        with src as materialized (
          select gen_random_uuid() as new_id, i.id, i.title, i.description, i.sort_order, i.assigned_to, i.priority, i.blocked_reason, i.blocked_by_item_id,
            i.cost_minor, i.cost_currency, i.category_id
          from commerce.checklist_items i
          where i.store_id = ${storeId}::uuid and i.checklist_id = ${id}::uuid and i.archived_at is null
        ),
        tasks as (
          insert into commerce.checklist_items (id, store_id, checklist_id, title, description, sort_order, assigned_to, priority, blocked_reason,
            blocked_by_item_id, cost_minor, cost_currency, category_id, created_by)
          select s.new_id, ${storeId}::uuid, ${copy}::uuid, s.title, s.description, s.sort_order, s.assigned_to, s.priority, s.blocked_reason,
            (select b.new_id from src b where b.id = s.blocked_by_item_id), s.cost_minor, s.cost_currency, s.category_id, ${member.account.id}::uuid
          from src s
          returning id
        ),
        steps as (
          insert into commerce.checklist_subtasks (store_id, item_id, title, sort_order, is_goal, assigned_to)
          select st.store_id, s.new_id, st.title, st.sort_order, st.is_goal, st.assigned_to
          from commerce.checklist_subtasks st join src s on s.id = st.item_id
          where st.store_id = ${storeId}::uuid and s.new_id in (select id from tasks)
          returning id
        )
        insert into commerce.checklist_item_tags (store_id, item_id, label_id)
        select t.store_id, s.new_id, t.label_id
        from commerce.checklist_item_tags t join src s on s.id = t.item_id
        where t.store_id = ${storeId}::uuid and s.new_id in (select id from tasks)
      `);
      return { ok: true, id: copy };
    }),
  );
}

/** A list's details changed: only the fields given. */
export async function updateChecklist(member: Membership, id: string, raw: unknown): Promise<ProjectsResult> {
  if (!memberCan(member, WRITE)) return { ok: false, problem: "forbidden" };
  const input = checklistInput.partial().safeParse(raw);
  if (!input.success) return { ok: false, problem: "invalid", fields: problemFields(input.error) };
  const d = input.data;
  if (!(await assignable(member.store.id, d.assignedTo))) return { ok: false, problem: "invalid", fields: ["assignedTo"] };
  const set = setList([
    [sql`title`, d.title],
    [sql`description`, d.description],
    [sql`due_at`, at(d.dueAt)],
    [sql`all_day`, d.allDay],
    [sql`assigned_to`, d.assignedTo === undefined ? undefined : d.assignedTo === null ? null : sql`${d.assignedTo}::uuid`],
    [sql`goal`, d.goal],
    [sql`status`, d.status],
  ]);
  if (!set) return { ok: true };
  return projectsGuard(async () => {
    const changed = await typedRows(z.object({ id: col.uuid }), sql`update commerce.checklists set ${set} where store_id = ${member.store.id}::uuid and id = ${id}::uuid returning id`);
    return changed.length > 0 ? { ok: true } : { ok: false, problem: "not_found" };
  });
}

/**
 * How a list works: plain or advanced (with the fields switched off stored, never cleared), a routine or not, and its home project. Hiding a
 * field keeps its data, so trying a switch out never costs anything.
 */
export async function setChecklistMode(
  member: Membership,
  id: string,
  mode: { isAdvanced?: boolean; features?: Partial<ChecklistFeatures>; isRoutine?: boolean; asTemplate?: boolean; primaryProjectId?: string | null },
): Promise<ProjectsResult> {
  if (!memberCan(member, WRITE)) return { ok: false, problem: "forbidden" };
  const home = mode.primaryProjectId;
  const set = setList([
    [sql`is_advanced`, mode.isAdvanced],
    [sql`advanced_features`, mode.features === undefined ? undefined : sql`${JSON.stringify(storedFeatures(mode.features))}::jsonb`],
    [sql`is_routine`, mode.isRoutine],
    [sql`as_template`, mode.asTemplate],
    [sql`primary_project_id`, home === undefined ? undefined : home === null ? null : sql`${home}::uuid`],
  ]);
  if (!set) return { ok: true };
  return projectsGuard(async () => {
    const changed = await typedRows(z.object({ id: col.uuid }), sql`update commerce.checklists set ${set} where store_id = ${member.store.id}::uuid and id = ${id}::uuid returning id`);
    return changed.length > 0 ? { ok: true } : { ok: false, problem: "not_found" };
  });
}

/** Every item of a list unticked (Life's *Reset*), for a list used again: a packing list, a routine, an opening check. */
export async function resetChecklist(member: Membership, id: string): Promise<ProjectsResult<{ reset: number }>> {
  if (!memberCan(member, WRITE)) return { ok: false, problem: "forbidden" };
  const rows = await typedRows(
    z.object({ id: col.uuid }),
    sql`
      update commerce.checklist_items set done_at = null, updated_at = now()
      where store_id = ${member.store.id}::uuid and checklist_id = ${id}::uuid and done_at is not null and archived_at is null
      returning id
    `,
  );
  return { ok: true, reset: rows.length };
}

/** A list deleted with its items, sections, subtasks, statuses and folds; its projects lose it. */
export async function deleteChecklist(member: Membership, id: string): Promise<ProjectsResult> {
  if (!memberCan(member, WRITE)) return { ok: false, problem: "forbidden" };
  const gone = await typedRows(z.object({ id: col.uuid }), sql`delete from commerce.checklists where store_id = ${member.store.id}::uuid and id = ${id}::uuid returning id`);
  return gone.length > 0 ? { ok: true } : { ok: false, problem: "not_found" };
}

/** The store's lists in the order given (every one of them, once). */
export async function reorderChecklists(member: Membership, ids: readonly string[]): Promise<ProjectsResult> {
  if (!memberCan(member, WRITE)) return { ok: false, problem: "forbidden" };
  const storeId = member.store.id;
  const known = await typedRows(z.object({ id: col.uuid }), sql`select id from commerce.checklists where store_id = ${storeId}::uuid`);
  if (!everyOnce(ids, known.map((k) => k.id))) return { ok: false, problem: "invalid" };
  await db().execute(reorderSql(sql`commerce.checklists`, storeId, ids));
  return { ok: true };
}

/** A section, or the Done line (`sectionId` null), folded or opened for the person: their own view, nobody else's. */
export async function setFold(member: Membership, checklistId: string, sectionId: string | null, folded: boolean): Promise<ProjectsResult> {
  if (!memberCan(member, "projects:read")) return { ok: false, problem: "forbidden" };
  const storeId = member.store.id;
  const accountId = member.account.id;
  return projectsGuard(async () => {
    if (folded) {
      await db().execute(sql`
        insert into commerce.checklist_folds (store_id, checklist_id, account_id, section_id)
        values (${storeId}::uuid, ${checklistId}::uuid, ${accountId}::uuid, ${sectionId}::uuid)
        on conflict do nothing
      `);
    } else {
      await db().execute(sql`
        delete from commerce.checklist_folds
        where store_id = ${storeId}::uuid and checklist_id = ${checklistId}::uuid and account_id = ${accountId}::uuid
          and ${sectionId === null ? sql`section_id is null` : sql`section_id = ${sectionId}::uuid`}
      `);
    }
    return { ok: true };
  });
}
