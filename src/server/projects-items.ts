import "server-only";

import { sql, type SQL } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { itemFields, itemInput, problemFields, sectionTitle, sequence, subtaskInput, type ItemInput, type ListEntry } from "@/lib/projects";
import { itemMoment } from "@/lib/projects-ops";
import { anchored, nextOccurrence, type Recurrence } from "@/lib/projects-recurrence";
import { parseRecurrence } from "@/lib/projects-recurrence-schema";
import { LINK_COLUMNS, type TaskLink } from "@/lib/projects-sources";

import type { Membership } from "./auth";
import { memberCan } from "./permissions";
import { assignable } from "./projects";
import { projectsGuard, type ProjectsResult } from "./projects-errors";
import { replaceTags } from "./projects-labels";
import { at, reorderSql, setList } from "./projects-sql";
import { uuidList } from "./sql-arrays";
import { col, typedRow, typedRows, type Executor } from "./typed-rows";

/**
 * A checklist's items, sections and subtasks (D903, `docs/projects.md`), written by members who may change projects (`projects:write`).
 * The database keeps the tick and the status in step, a status within its list, and an item moved to another list on a status of the same
 * name (`projects_rules`); this module keeps Life's other habits: a ticked item sinks below the open ones (but in a routine, which keeps its
 * order), a new one goes to the end, and items and sections share one order.
 */

const WRITE = "projects:write" as const;
const MAX_BULK = 500;

/** The next sort order at the end of a list: after its items and its sections. */
async function endOf(runner: Executor, storeId: string, checklistId: string): Promise<number> {
  const row = await typedRow(
    z.object({ n: col.int }),
    sql`
      select greatest(
        (select coalesce(max(sort_order) + 1, 0) from commerce.checklist_items where store_id = ${storeId}::uuid and checklist_id = ${checklistId}::uuid),
        (select coalesce(max(sort_order) + 1, 0) from commerce.checklist_sections where store_id = ${storeId}::uuid and checklist_id = ${checklistId}::uuid)
      )::int as n
    `,
    runner,
  );
  return row?.n ?? 0;
}

async function listExists(storeId: string, checklistId: string): Promise<boolean> {
  const row = await typedRow(
    z.object({ found: col.bool }),
    sql`select exists (select 1 from commerce.checklists where store_id = ${storeId}::uuid and id = ${checklistId}::uuid) as found`,
  );
  return row?.found ?? false;
}

const uuidOrNull = (v: string | null | undefined): SQL | null | undefined => (v === undefined ? undefined : v === null ? null : sql`${v}::uuid`);

/** The columns an item's input writes, only those given. */
function itemColumns(d: Partial<ItemInput>): [SQL, unknown][] {
  return [
    [sql`title`, d.title],
    [sql`description`, d.description],
    [sql`status_id`, uuidOrNull(d.statusId)],
    [sql`assigned_to`, uuidOrNull(d.assignedTo)],
    [sql`start_at`, at(d.startAt)],
    [sql`due_at`, at(d.dueAt)],
    [sql`all_day`, d.allDay],
    [sql`priority`, d.priority],
    [sql`blocked_reason`, d.blockedReason],
    [sql`blocked_by_item_id`, uuidOrNull(d.blockedByItemId)],
    [sql`cost_minor`, d.cost === undefined ? undefined : (d.cost?.minor ?? null)],
    [sql`cost_currency`, d.cost === undefined ? undefined : (d.cost?.currency ?? null)],
    [sql`category_id`, uuidOrNull(d.categoryId)],
    [sql`customer_id`, uuidOrNull(d.customerId)],
  ];
}

/** Naming a task's customer (P4.7) shows who they are, so it needs the right to read customers as well as to change projects. */
const mayName = (member: Membership, customerId: string | null | undefined) => customerId === undefined || memberCan(member, "customers:read");

/**
 * A task from a source names its customer too (P4.7), when the source has one of the store's: an order's or its return's buyer, a review's
 * writer, a conversation's signed-in customer. Read inside the insert; a customer that is not the store's (or is gone) leaves none.
 */
function customerOfLink(storeId: string, link: TaskLink): SQL {
  if (link.kind === "customer") return sql`${link.id}::uuid`;
  const named =
    link.kind === "order"
      ? sql`select customer_id from commerce.orders where store_id = ${storeId}::uuid and id = ${link.id}::uuid`
      : link.kind === "return"
        ? sql`select o.customer_id from commerce.returns r join commerce.orders o on o.store_id = r.store_id and o.id = r.order_id where r.store_id = ${storeId}::uuid and r.id = ${link.id}::uuid`
        : link.kind === "review"
          ? sql`select customer_id from commerce.product_reviews where store_id = ${storeId}::uuid and id = ${link.id}::uuid`
          : sql`select customer_id from commerce.support_conversations where store_id = ${storeId}::uuid and id = ${link.id}::uuid`;
  return sql`(select c.id from commerce.customers c where c.store_id = ${storeId}::uuid and c.id = (${named}))`;
}

/**
 * Who gave the task its person, and when (D904 P8.3d), written with the person: the five-minute job tells the person once by email, unless
 * they took it themselves. A change to the same person leaves the marks as they were, so nobody is told twice.
 */
function giverColumns(assignedTo: string | null | undefined, actorId: string, mode: "insert" | "update"): [SQL, unknown][] {
  if (assignedTo === undefined) return [];
  if (mode === "insert") return assignedTo ? [[sql`assigned_by`, sql`${actorId}::uuid`], [sql`assigned_at`, sql`now()`]] : [];
  const changed = sql`assigned_to is distinct from ${assignedTo}::uuid`;
  return [
    [sql`assigned_by`, sql`case when ${changed} then ${actorId}::uuid else assigned_by end`],
    [sql`assigned_at`, sql`case when ${changed} then ${assignedTo ? sql`now()` : sql`null`} else assigned_at end`],
    [sql`assignee_told_at`, sql`case when ${changed} then null else assignee_told_at end`],
  ];
}

/**
 * The columns a rule writes (P4.1): the rule, counted from today where it counts days or months, and its next time after now; a task given
 * a rule is open again, and one whose rule is taken off forgets its run and its skip.
 */
function repeatColumns(rule: Recurrence | null | undefined, timeZone: string, now = Date.now()): [SQL, unknown][] {
  if (rule === undefined) return [];
  if (rule === null) return [[sql`recurrence`, null], [sql`next_due_at`, null], [sql`streak`, 0], [sql`last_completed_at`, null], [sql`skipped_at`, null]];
  const kept = anchored(rule, now, timeZone);
  return [
    [sql`recurrence`, sql`${JSON.stringify(kept)}::jsonb`],
    [sql`next_due_at`, nextOccurrence(kept, now, timeZone)],
    [sql`done_at`, null],
  ];
}

/**
 * A new item at the end of a list (its status the list's default, by the database). Made from a page's *Tasks* card, it is linked to what the
 * page is about (`link`): a source (P8.3a) and its customer, or a customer (P4.7).
 */
export async function addItem(member: Membership, checklistId: string, raw: unknown, link?: TaskLink): Promise<ProjectsResult<{ id: string }>> {
  if (!memberCan(member, WRITE)) return { ok: false, problem: "forbidden" };
  const input = itemInput.safeParse(raw);
  if (!input.success) return { ok: false, problem: "invalid", fields: problemFields(input.error) };
  if (!mayName(member, input.data.customerId) || (link?.kind === "customer" && !mayName(member, link.id))) return { ok: false, problem: "forbidden" };
  const storeId = member.store.id;
  if (!(await listExists(storeId, checklistId))) return { ok: false, problem: "not_found" };
  if (!(await assignable(storeId, input.data.assignedTo))) return { ok: false, problem: "invalid", fields: ["assignedTo"] };
  // Where it came from (P8.3a): the source's column, from a fixed list, never the caller's words; and who it is about (P4.7), unless given.
  const from: [SQL, unknown][] = !link
    ? []
    : link.kind === "customer"
      ? [[sql`customer_id`, sql`${link.id}::uuid`]]
      : [[sql`${sql.identifier(LINK_COLUMNS[link.kind])}`, sql`${link.id}::uuid`], ...(input.data.customerId === undefined ? [[sql`customer_id`, customerOfLink(storeId, link)] as [SQL, unknown]] : [])];
  const given = [
    ...itemColumns(input.data),
    ...giverColumns(input.data.assignedTo, member.account.id, "insert"),
    ...repeatColumns(input.data.recurrence, member.store.timeZone),
    ...from,
  ].filter(([, v]) => v !== undefined);
  return projectsGuard(() =>
    db().transaction(async (tx): Promise<ProjectsResult<{ id: string }>> => {
      const sortOrder = await endOf(tx, storeId, checklistId);
      const made = await typedRow(
        z.object({ id: col.uuid }),
        sql`
          insert into commerce.checklist_items (store_id, checklist_id, sort_order, created_by${sql.join(given.map(([c]) => sql`, ${c}`), sql``)})
          values (${storeId}::uuid, ${checklistId}::uuid, ${sortOrder}, ${member.account.id}::uuid${sql.join(given.map(([, v]) => sql`, ${v}`), sql``)})
          returning id
        `,
        tx,
      );
      if (!made) return { ok: false, problem: "invalid" };
      if (input.data.tagIds) await replaceTags(tx, storeId, made.id, input.data.tagIds);
      return { ok: true, id: made.id };
    }),
  );
}

/** Several items at once, one a line (a pasted list), at the end of the list. Empty lines are skipped. */
export async function addItems(member: Membership, checklistId: string, titles: readonly string[]): Promise<ProjectsResult<{ added: number }>> {
  if (!memberCan(member, WRITE)) return { ok: false, problem: "forbidden" };
  const clean = titles.map((t) => t.trim()).filter(Boolean);
  if (clean.length === 0) return { ok: true, added: 0 };
  if (clean.length > MAX_BULK) return { ok: false, problem: "invalid", fields: ["title"] };
  const parsed = clean.map((title) => itemInput.safeParse({ title }));
  if (parsed.some((p) => !p.success)) return { ok: false, problem: "invalid", fields: ["title"] };
  const storeId = member.store.id;
  if (!(await listExists(storeId, checklistId))) return { ok: false, problem: "not_found" };
  return projectsGuard(() =>
    db().transaction(async (tx) => {
      const start = await endOf(tx, storeId, checklistId);
      const rows = clean.map((title, i) => sql`(${storeId}::uuid, ${checklistId}::uuid, ${title}, ${start + i}, ${member.account.id}::uuid)`);
      await tx.execute(sql`insert into commerce.checklist_items (store_id, checklist_id, title, sort_order, created_by) values ${sql.join(rows, sql`, `)}`);
      return { ok: true as const, added: clean.length };
    }),
  );
}

/** An item's fields changed: only those given. */
export async function updateItem(member: Membership, itemId: string, raw: unknown): Promise<ProjectsResult> {
  if (!memberCan(member, WRITE)) return { ok: false, problem: "forbidden" };
  // The dates are checked together on what is kept, so a patch of one date reads the other.
  const input = itemFields.partial().safeParse(raw);
  if (!input.success) return { ok: false, problem: "invalid", fields: problemFields(input.error) };
  if (!mayName(member, input.data.customerId)) return { ok: false, problem: "forbidden" };
  const storeId = member.store.id;
  if (!(await assignable(storeId, input.data.assignedTo))) return { ok: false, problem: "invalid", fields: ["assignedTo"] };
  const set = setList([
    ...itemColumns(input.data),
    ...giverColumns(input.data.assignedTo, member.account.id, "update"),
    ...repeatColumns(input.data.recurrence, member.store.timeZone),
  ]);
  const tags = input.data.tagIds;
  if (!set && tags === undefined) return { ok: true };
  return projectsGuard(() =>
    db().transaction(async (tx): Promise<ProjectsResult> => {
      const found = await typedRows(
        z.object({ id: col.uuid }),
        set
          ? sql`update commerce.checklist_items set ${set} where store_id = ${storeId}::uuid and id = ${itemId}::uuid returning id`
          : sql`select id from commerce.checklist_items where store_id = ${storeId}::uuid and id = ${itemId}::uuid`,
        tx,
      );
      if (found.length === 0) return { ok: false, problem: "not_found" };
      if (tags !== undefined) await replaceTags(tx, storeId, itemId, tags);
      return { ok: true };
    }),
  );
}

/**
 * An item ticked or unticked; its status follows (the database). A ticked item sinks to the end, below the open ones, but in a routine,
 * which keeps the order it is followed in. A repeating task ticked now (P4.1) is due again at its next time, its run one longer.
 */
export async function setItemDone(member: Membership, itemId: string, done: boolean): Promise<ProjectsResult> {
  if (!memberCan(member, WRITE)) return { ok: false, problem: "forbidden" };
  const storeId = member.store.id;
  return projectsGuard(() =>
    db().transaction(async (tx): Promise<ProjectsResult> => {
      const item = await typedRow(
        z.object({ checklist_id: col.uuid, is_routine: col.bool, done: col.bool, recurrence: z.unknown() }),
        sql`
          select i.checklist_id, c.is_routine, i.done_at is not null as done, i.recurrence
          from commerce.checklist_items i join commerce.checklists c on c.store_id = i.store_id and c.id = i.checklist_id
          where i.store_id = ${storeId}::uuid and i.id = ${itemId}::uuid
        `,
        tx,
      );
      if (!item) return { ok: false as const, problem: "not_found" as const };
      const sink = done && !item.is_routine ? await endOf(tx, storeId, item.checklist_id) : null;
      const rule = done && !item.done ? parseRecurrence(item.recurrence) : null;
      const again = rule
        ? sql`, last_completed_at = now(), next_due_at = ${nextOccurrence(rule, Date.now(), member.store.timeZone)}, streak = streak + 1, skipped_at = null`
        : sql``;
      await tx.execute(sql`
        update commerce.checklist_items
        set done_at = case when ${done} then coalesce(done_at, now()) end,
          sort_order = coalesce(${sink}::int, sort_order), updated_at = now()${again}
        where store_id = ${storeId}::uuid and id = ${itemId}::uuid
      `);
      return { ok: true as const };
    }),
  );
}

/**
 * This time of a task passed on (P4.1, Life's `skipChecklistItem`): open, marked skipped, and a repeating one due at its next time with
 * its run broken. A week of skips should look nothing like a week of doing.
 */
export async function skipItem(member: Membership, itemId: string): Promise<ProjectsResult> {
  if (!memberCan(member, WRITE)) return { ok: false, problem: "forbidden" };
  const storeId = member.store.id;
  return projectsGuard(async (): Promise<ProjectsResult> => {
    const item = await typedRow(z.object({ recurrence: z.unknown() }), sql`select recurrence from commerce.checklist_items where store_id = ${storeId}::uuid and id = ${itemId}::uuid`);
    if (!item) return { ok: false, problem: "not_found" };
    const rule = parseRecurrence(item.recurrence);
    const again = rule ? sql`, next_due_at = ${nextOccurrence(rule, Date.now(), member.store.timeZone)}, streak = 0` : sql``;
    await db().execute(sql`
      update commerce.checklist_items set done_at = null, skipped_at = now(), updated_at = now()${again}
      where store_id = ${storeId}::uuid and id = ${itemId}::uuid
    `);
    return { ok: true };
  });
}

/**
 * A task put back as it was before a tick or a skip (P4.1, Life's `restoreChecklistItemState`): a repeating task's run and next time
 * cannot be worked out from the row afterwards, so the screen keeps them and gives them back. The status is checked by the database like
 * any other.
 */
export async function restoreItem(member: Membership, itemId: string, raw: unknown): Promise<ProjectsResult> {
  if (!memberCan(member, WRITE)) return { ok: false, problem: "forbidden" };
  const input = itemMoment.safeParse(raw);
  if (!input.success) return { ok: false, problem: "invalid" };
  const m = input.data;
  const storeId = member.store.id;
  return projectsGuard(async () => {
    const changed = await typedRows(
      z.object({ id: col.uuid }),
      sql`
        update commerce.checklist_items
        set done_at = ${at(m.doneAt)}, skipped_at = ${at(m.skippedAt)}, last_completed_at = ${at(m.lastCompletedAt)}, next_due_at = ${at(m.nextDueAt)},
          streak = ${m.streak}, sort_order = ${m.sortOrder}, status_id = ${m.statusId}::uuid, updated_at = now()
        where store_id = ${storeId}::uuid and id = ${itemId}::uuid
        returning id
      `,
    );
    return changed.length > 0 ? { ok: true } : { ok: false, problem: "not_found" };
  });
}

/** An item archived (out of the list, kept) or back. */
export async function setItemArchived(member: Membership, itemIds: readonly string[], archived: boolean): Promise<ProjectsResult<{ changed: number }>> {
  if (!memberCan(member, WRITE)) return { ok: false, problem: "forbidden" };
  if (itemIds.length === 0 || itemIds.length > MAX_BULK) return { ok: false, problem: "invalid" };
  const rows = await typedRows(
    z.object({ id: col.uuid }),
    sql`
      update commerce.checklist_items set archived_at = case when ${archived} then coalesce(archived_at, now()) end, updated_at = now()
      where store_id = ${member.store.id}::uuid and id = any(${uuidList(itemIds)}) returning id
    `,
  );
  return { ok: true, changed: rows.length };
}

/** Items deleted with their subtasks and stages. */
export async function deleteItems(member: Membership, itemIds: readonly string[]): Promise<ProjectsResult<{ changed: number }>> {
  if (!memberCan(member, WRITE)) return { ok: false, problem: "forbidden" };
  if (itemIds.length === 0 || itemIds.length > MAX_BULK) return { ok: false, problem: "invalid" };
  const gone = await typedRows(
    z.object({ id: col.uuid }),
    sql`delete from commerce.checklist_items where store_id = ${member.store.id}::uuid and id = any(${uuidList(itemIds)}) returning id`,
  );
  return { ok: true, changed: gone.length };
}

/** Items given one status (Life's bulk status); the tick of each follows it. */
export async function setItemsStatus(member: Membership, itemIds: readonly string[], statusId: string | null): Promise<ProjectsResult<{ changed: number }>> {
  if (!memberCan(member, WRITE)) return { ok: false, problem: "forbidden" };
  if (itemIds.length === 0 || itemIds.length > MAX_BULK) return { ok: false, problem: "invalid" };
  return projectsGuard(async () => {
    const rows = await typedRows(
      z.object({ id: col.uuid }),
      sql`
        update commerce.checklist_items set status_id = ${statusId}::uuid, updated_at = now()
        where store_id = ${member.store.id}::uuid and id = any(${uuidList(itemIds)}) returning id
      `,
    );
    return { ok: true, changed: rows.length };
  });
}

/** Items moved to the end of another list, on its status of the same name (the database), keeping their subtasks. */
export async function moveItems(member: Membership, itemIds: readonly string[], toChecklistId: string): Promise<ProjectsResult<{ changed: number }>> {
  if (!memberCan(member, WRITE)) return { ok: false, problem: "forbidden" };
  if (itemIds.length === 0 || itemIds.length > MAX_BULK) return { ok: false, problem: "invalid" };
  const storeId = member.store.id;
  if (!(await listExists(storeId, toChecklistId))) return { ok: false, problem: "not_found" };
  return projectsGuard(() =>
    db().transaction(async (tx) => {
      const start = await endOf(tx, storeId, toChecklistId);
      const rows = await typedRows(
        z.object({ id: col.uuid }),
        sql`
          update commerce.checklist_items i set checklist_id = ${toChecklistId}::uuid, sort_order = ${start} + o.n - 1, updated_at = now()
          from unnest(${uuidList(itemIds)}) with ordinality as o (id, n)
          where i.store_id = ${storeId}::uuid and i.id = o.id
          returning i.id
        `,
        tx,
      );
      return { ok: true as const, changed: rows.length };
    }),
  );
}

/** A list's items and sections in the order given: one sequence, as Life's separators share the items' order. */
export async function reorderEntries(member: Membership, checklistId: string, entries: readonly ListEntry[]): Promise<ProjectsResult> {
  if (!memberCan(member, WRITE)) return { ok: false, problem: "forbidden" };
  const storeId = member.store.id;
  const ordered = sequence(entries);
  const items = ordered.filter((e) => e.kind === "item");
  const sections = ordered.filter((e) => e.kind === "section");
  await db().transaction(async (tx) => {
    if (items.length > 0) {
      await tx.execute(sql`
        update commerce.checklist_items i set sort_order = o.sort_order, updated_at = now()
        from unnest(${uuidList(items.map((e) => e.id))}, ${sql`array[${sql.join(items.map((e) => sql`${e.sortOrder}`), sql`, `)}]::int[]`}) as o (id, sort_order)
        where i.store_id = ${storeId}::uuid and i.checklist_id = ${checklistId}::uuid and i.id = o.id
      `);
    }
    if (sections.length > 0) {
      await tx.execute(sql`
        update commerce.checklist_sections s set sort_order = o.sort_order, updated_at = now()
        from unnest(${uuidList(sections.map((e) => e.id))}, ${sql`array[${sql.join(sections.map((e) => sql`${e.sortOrder}`), sql`, `)}]::int[]`}) as o (id, sort_order)
        where s.store_id = ${storeId}::uuid and s.checklist_id = ${checklistId}::uuid and s.id = o.id
      `);
    }
  });
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

/** A new section at the end of a list (Life's separator), to drag where it belongs. */
export async function addSection(member: Membership, checklistId: string, title: string): Promise<ProjectsResult<{ id: string }>> {
  if (!memberCan(member, WRITE)) return { ok: false, problem: "forbidden" };
  const clean = sectionTitle.safeParse(title);
  if (!clean.success) return { ok: false, problem: "invalid", fields: ["title"] };
  const storeId = member.store.id;
  if (!(await listExists(storeId, checklistId))) return { ok: false, problem: "not_found" };
  return projectsGuard(async () => {
    const sortOrder = await endOf(db(), storeId, checklistId);
    const made = await typedRow(
      z.object({ id: col.uuid }),
      sql`
        insert into commerce.checklist_sections (store_id, checklist_id, title, sort_order, created_by)
        values (${storeId}::uuid, ${checklistId}::uuid, ${clean.data}, ${sortOrder}, ${member.account.id}::uuid) returning id
      `,
    );
    return made ? { ok: true, id: made.id } : { ok: false, problem: "invalid" };
  });
}

export async function renameSection(member: Membership, sectionId: string, title: string): Promise<ProjectsResult> {
  if (!memberCan(member, WRITE)) return { ok: false, problem: "forbidden" };
  const clean = sectionTitle.safeParse(title);
  if (!clean.success) return { ok: false, problem: "invalid", fields: ["title"] };
  const changed = await typedRows(
    z.object({ id: col.uuid }),
    sql`update commerce.checklist_sections set title = ${clean.data}, updated_at = now() where store_id = ${member.store.id}::uuid and id = ${sectionId}::uuid returning id`,
  );
  return changed.length > 0 ? { ok: true } : { ok: false, problem: "not_found" };
}

/** A section deleted; its items stay where they are. */
export async function deleteSection(member: Membership, sectionId: string): Promise<ProjectsResult> {
  if (!memberCan(member, WRITE)) return { ok: false, problem: "forbidden" };
  const gone = await typedRows(
    z.object({ id: col.uuid }),
    sql`delete from commerce.checklist_sections where store_id = ${member.store.id}::uuid and id = ${sectionId}::uuid returning id`,
  );
  return gone.length > 0 ? { ok: true } : { ok: false, problem: "not_found" };
}

// ---------------------------------------------------------------------------
// Subtasks
// ---------------------------------------------------------------------------

async function itemExists(storeId: string, itemId: string): Promise<boolean> {
  const row = await typedRow(
    z.object({ found: col.bool }),
    sql`select exists (select 1 from commerce.checklist_items where store_id = ${storeId}::uuid and id = ${itemId}::uuid) as found`,
  );
  return row?.found ?? false;
}

/** A new subtask at the end of an item's. */
export async function addSubtask(member: Membership, itemId: string, raw: unknown): Promise<ProjectsResult<{ id: string }>> {
  if (!memberCan(member, WRITE)) return { ok: false, problem: "forbidden" };
  const input = subtaskInput.safeParse(raw);
  if (!input.success) return { ok: false, problem: "invalid", fields: problemFields(input.error) };
  const storeId = member.store.id;
  if (!(await itemExists(storeId, itemId))) return { ok: false, problem: "not_found" };
  if (!(await assignable(storeId, input.data.assignedTo))) return { ok: false, problem: "invalid", fields: ["assignedTo"] };
  const d = input.data;
  return projectsGuard(async () => {
    const made = await typedRow(
      z.object({ id: col.uuid }),
      sql`
        insert into commerce.checklist_subtasks (store_id, item_id, title, due_at, all_day, assigned_to, status_id, is_goal, sort_order, created_by)
        values (${storeId}::uuid, ${itemId}::uuid, ${d.title}, ${at(d.dueAt) ?? null}, ${d.allDay ?? null}, ${d.assignedTo ?? null}::uuid, ${d.statusId ?? null}::uuid,
          ${d.isGoal ?? false}, (select coalesce(max(sort_order) + 1, 0) from commerce.checklist_subtasks where store_id = ${storeId}::uuid and item_id = ${itemId}::uuid),
          ${member.account.id}::uuid)
        returning id
      `,
    );
    return made ? { ok: true, id: made.id } : { ok: false, problem: "invalid" };
  });
}

/** A subtask's fields changed, ticked or unticked (`done`): only what is given. */
export async function updateSubtask(member: Membership, subtaskId: string, raw: unknown & { done?: boolean }): Promise<ProjectsResult> {
  if (!memberCan(member, WRITE)) return { ok: false, problem: "forbidden" };
  const input = subtaskInput.partial().extend({ done: z.boolean().optional() }).safeParse(raw);
  if (!input.success) return { ok: false, problem: "invalid", fields: problemFields(input.error) };
  const d = input.data;
  const storeId = member.store.id;
  if (!(await assignable(storeId, d.assignedTo))) return { ok: false, problem: "invalid", fields: ["assignedTo"] };
  const set = setList([
    [sql`title`, d.title],
    [sql`due_at`, at(d.dueAt)],
    [sql`all_day`, d.allDay],
    [sql`assigned_to`, uuidOrNull(d.assignedTo)],
    [sql`status_id`, uuidOrNull(d.statusId)],
    [sql`is_goal`, d.isGoal],
    [sql`done_at`, d.done === undefined ? undefined : d.done ? sql`coalesce(done_at, now())` : null],
  ]);
  if (!set) return { ok: true };
  return projectsGuard(async () => {
    const changed = await typedRows(z.object({ id: col.uuid }), sql`update commerce.checklist_subtasks set ${set} where store_id = ${storeId}::uuid and id = ${subtaskId}::uuid returning id`);
    return changed.length > 0 ? { ok: true } : { ok: false, problem: "not_found" };
  });
}

/** An item's subtasks in the order given. */
export async function reorderSubtasks(member: Membership, itemId: string, subtaskIds: readonly string[]): Promise<ProjectsResult> {
  if (!memberCan(member, WRITE)) return { ok: false, problem: "forbidden" };
  await db().execute(reorderSql(sql`commerce.checklist_subtasks`, member.store.id, subtaskIds, sql`t.item_id = ${itemId}::uuid`));
  return { ok: true };
}

export async function deleteSubtask(member: Membership, subtaskId: string): Promise<ProjectsResult> {
  if (!memberCan(member, WRITE)) return { ok: false, problem: "forbidden" };
  const gone = await typedRows(
    z.object({ id: col.uuid }),
    sql`delete from commerce.checklist_subtasks where store_id = ${member.store.id}::uuid and id = ${subtaskId}::uuid returning id`,
  );
  return gone.length > 0 ? { ok: true } : { ok: false, problem: "not_found" };
}

/** A subtask made an item of its own (Life's *Promote*), right after its item, with its due date and assignee; the subtask goes. */
export async function promoteSubtask(member: Membership, subtaskId: string): Promise<ProjectsResult<{ id: string }>> {
  if (!memberCan(member, WRITE)) return { ok: false, problem: "forbidden" };
  const storeId = member.store.id;
  return projectsGuard(() =>
    db().transaction(async (tx): Promise<ProjectsResult<{ id: string }>> => {
      const step = await typedRow(
        z.object({ title: col.text, due_at: col.timestampOrNull, all_day: col.bool.nullable(), assigned_to: col.uuid.nullable(), checklist_id: col.uuid, sort_order: col.int }),
        sql`
          select s.title, s.due_at, s.all_day, s.assigned_to, i.checklist_id, i.sort_order
          from commerce.checklist_subtasks s join commerce.checklist_items i on i.store_id = s.store_id and i.id = s.item_id
          where s.store_id = ${storeId}::uuid and s.id = ${subtaskId}::uuid
        `,
        tx,
      );
      if (!step) return { ok: false as const, problem: "not_found" as const };
      // Room right after the item: everything after it moves down one.
      for (const target of [sql`commerce.checklist_items`, sql`commerce.checklist_sections`]) {
        await tx.execute(sql`
          update ${target} set sort_order = sort_order + 1
          where store_id = ${storeId}::uuid and checklist_id = ${step.checklist_id}::uuid and sort_order > ${step.sort_order}
        `);
      }
      const made = await typedRow(
        z.object({ id: col.uuid }),
        sql`
          insert into commerce.checklist_items (store_id, checklist_id, title, due_at, all_day, assigned_to, sort_order, created_by)
          values (${storeId}::uuid, ${step.checklist_id}::uuid, ${step.title}, ${step.due_at}::timestamptz, ${step.all_day}, ${step.assigned_to}::uuid, ${step.sort_order + 1},
            ${member.account.id}::uuid)
          returning id
        `,
        tx,
      );
      if (!made) return { ok: false as const, problem: "invalid" as const };
      await tx.execute(sql`delete from commerce.checklist_subtasks where store_id = ${storeId}::uuid and id = ${subtaskId}::uuid`);
      return { ok: true as const, id: made.id };
    }),
  );
}
