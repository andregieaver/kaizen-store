import "server-only";

import { sql, type SQL } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { DEFAULT_STATUSES, freeSlug, problemFields, statusInput, type DefaultStatusSlug } from "@/lib/projects";
import { PROJECT_COLOURS, STATUS_BUCKETS, type ProjectColour, type StatusBucket } from "@/lib/projects-model";

import type { Membership } from "./auth";
import { memberCan } from "./permissions";
import { projectsGuard, type ProjectsResult } from "./projects-errors";
import { everyOnce, reorderSql } from "./projects-sql";
import { col, typedRow, typedRows, type Executor } from "./typed-rows";

/**
 * Statuses and stages (D903, `docs/projects.md` 4.2): an item's statuses (`checklist_statuses`) and a project's stages (`project_statuses`),
 * each the store's defaults until a list or a project has its own, which then replace them (`checklist_effective_statuses()`,
 * `project_effective_stages()`). The defaults are made in the person's language on the first visit. Every change is `projects:write`;
 * deleting a status moves what used it to another first, and the last status of a scope stays.
 */

export type StatusKind = "checklist" | "project";
export type Status = { id: string; name: string; slug: string; colour: ProjectColour; bucket: StatusBucket; sortOrder: number; scopeId: string | null };

const WRITE = "projects:write" as const;

const table = (kind: StatusKind): SQL => (kind === "checklist" ? sql`commerce.checklist_statuses` : sql`commerce.project_statuses`);
const scopeColumn = (kind: StatusKind): SQL => (kind === "checklist" ? sql`checklist_id` : sql`project_id`);

const statusRow = z.object({
  id: col.uuid,
  name: col.text,
  slug: col.text,
  colour: z.enum(PROJECT_COLOURS),
  bucket: z.enum(STATUS_BUCKETS),
  sort_order: col.int,
  scope_id: col.uuid.nullable(),
});
const toStatus = (r: z.output<typeof statusRow>): Status => ({ id: r.id, name: r.name, slug: r.slug, colour: r.colour, bucket: r.bucket, sortOrder: r.sort_order, scopeId: r.scope_id });

/**
 * The store's default statuses and stages, made once in the words given (the person's language) when the store has none of a kind. Safe to
 * call on every visit: an existing default is never renamed, and two visits at once meet the slug's unique key.
 */
export async function ensureDefaultStatuses(storeId: string, names: Record<DefaultStatusSlug, string>): Promise<void> {
  const facts = await typedRow(
    z.object({ items: col.bool, stages: col.bool }),
    sql`
      select exists (select 1 from commerce.checklist_statuses where store_id = ${storeId}::uuid and checklist_id is null) as items,
        exists (select 1 from commerce.project_statuses where store_id = ${storeId}::uuid and project_id is null) as stages
    `,
  );
  const values = sql.join(
    DEFAULT_STATUSES.map((s, i) => sql`(${storeId}::uuid, ${names[s.slug]}, ${s.slug}, ${s.colour}, ${s.bucket}, ${i})`),
    sql`, `,
  );
  if (!facts?.items) await db().execute(sql`insert into commerce.checklist_statuses (store_id, name, slug, colour, bucket, sort_order) values ${values} on conflict do nothing`);
  if (!facts?.stages) await db().execute(sql`insert into commerce.project_statuses (store_id, name, slug, colour, bucket, sort_order) values ${values} on conflict do nothing`);
}

/** Every status of a kind in the store, defaults and each scope's own, in order. */
export async function allStatuses(storeId: string, kind: StatusKind, runner: Executor = db()): Promise<Status[]> {
  const rows = await typedRows(
    statusRow,
    sql`
      select id, name, slug, colour, bucket, sort_order, ${scopeColumn(kind)} as scope_id
      from ${table(kind)} where store_id = ${storeId}::uuid
      order by ${scopeColumn(kind)} nulls first, sort_order, slug
    `,
    runner,
  );
  return rows.map(toStatus);
}

/** A scope's statuses as its items see them: its own when it has any, else the store's defaults (the database's rule, in code for a page). */
export function effectiveOf(all: readonly Status[], scopeId: string | null): Status[] {
  const own = scopeId ? all.filter((s) => s.scopeId === scopeId) : [];
  return own.length > 0 ? own : all.filter((s) => s.scopeId === null);
}

/** A scope's statuses: a list's (`checklist`) or a project's stages (`project`); `null` for the store's defaults. */
export async function statusesOf(storeId: string, kind: StatusKind, scopeId: string | null, runner: Executor = db()): Promise<Status[]> {
  return effectiveOf(await allStatuses(storeId, kind, runner), scopeId);
}

async function scopeExists(storeId: string, kind: StatusKind, scopeId: string | null): Promise<boolean> {
  if (scopeId === null) return true;
  const row = await typedRow(
    z.object({ found: col.bool }),
    kind === "checklist"
      ? sql`select exists (select 1 from commerce.checklists where store_id = ${storeId}::uuid and id = ${scopeId}::uuid) as found`
      : sql`select exists (select 1 from commerce.projects where store_id = ${storeId}::uuid and id = ${scopeId}::uuid) as found`,
  );
  return row?.found ?? false;
}

/** A new status at the end of its scope. A list or a project without statuses of its own gets them first, copied from the defaults. */
export async function addStatus(member: Membership, kind: StatusKind, scopeId: string | null, raw: unknown): Promise<ProjectsResult<{ id: string }>> {
  if (!memberCan(member, WRITE)) return { ok: false, problem: "forbidden" };
  const input = statusInput.safeParse(raw);
  if (!input.success) return { ok: false, problem: "invalid", fields: problemFields(input.error) };
  const storeId = member.store.id;
  if (!(await scopeExists(storeId, kind, scopeId))) return { ok: false, problem: "not_found" };
  return projectsGuard(() =>
    db().transaction(async (tx) => {
      if (scopeId) await ownStatusesIn(tx, storeId, kind, scopeId);
      const mine = (await allStatuses(storeId, kind, tx)).filter((s) => s.scopeId === scopeId);
      const slug = freeSlug(input.data.name, new Set(mine.map((s) => s.slug)));
      const made = await typedRow(
        z.object({ id: col.uuid }),
        sql`
          insert into ${table(kind)} (store_id, ${scopeColumn(kind)}, name, slug, colour, bucket, sort_order)
          values (${storeId}::uuid, ${scopeId}::uuid, ${input.data.name}, ${slug}, ${input.data.colour}, ${input.data.bucket}, ${mine.length})
          returning id
        `,
        tx,
      );
      return { ok: true as const, id: made!.id };
    }),
  );
}

/** A status renamed, recoloured or moved to another bucket (its slug stays: items moved between lists find it by its first name). */
export async function updateStatus(member: Membership, kind: StatusKind, id: string, raw: unknown): Promise<ProjectsResult> {
  if (!memberCan(member, WRITE)) return { ok: false, problem: "forbidden" };
  const input = statusInput.safeParse(raw);
  if (!input.success) return { ok: false, problem: "invalid", fields: problemFields(input.error) };
  const storeId = member.store.id;
  return projectsGuard(() =>
    db().transaction(async (tx): Promise<ProjectsResult> => {
      const changed = await typedRows(
        z.object({ id: col.uuid }),
        sql`
          update ${table(kind)} set name = ${input.data.name}, colour = ${input.data.colour}, bucket = ${input.data.bucket}, updated_at = now()
          where store_id = ${storeId}::uuid and id = ${id}::uuid returning id
        `,
        tx,
      );
      if (changed.length === 0) return { ok: false as const, problem: "not_found" as const };
      if (kind === "checklist") {
        // A status moved to another bucket takes its items' ticks along, so the tick and the status still agree.
        const finished = input.data.bucket !== "active";
        for (const target of [sql`commerce.checklist_items`, sql`commerce.checklist_subtasks`]) {
          await tx.execute(sql`
            update ${target} set done_at = case when ${finished} then now() end, updated_at = now()
            where store_id = ${storeId}::uuid and status_id = ${id}::uuid and (done_at is null) = ${finished}
          `);
        }
      }
      return { ok: true as const };
    }),
  );
}

/** A scope's statuses in the order given; ids of another scope are refused. */
export async function reorderStatuses(member: Membership, kind: StatusKind, scopeId: string | null, ids: readonly string[]): Promise<ProjectsResult> {
  if (!memberCan(member, WRITE)) return { ok: false, problem: "forbidden" };
  const storeId = member.store.id;
  const mine = (await allStatuses(storeId, kind)).filter((s) => s.scopeId === scopeId);
  if (!everyOnce(ids, mine.map((s) => s.id))) return { ok: false, problem: "invalid" };
  await db().execute(reorderSql(table(kind), storeId, ids));
  return { ok: true };
}

/**
 * A status deleted, what used it moved to `replacementId` first (another status of the same scope). The last status of a scope stays; a list
 * or project's last own status cannot go either: *Use the store's statuses* is the way back.
 */
export async function deleteStatus(member: Membership, kind: StatusKind, id: string, replacementId: string): Promise<ProjectsResult> {
  if (!memberCan(member, WRITE)) return { ok: false, problem: "forbidden" };
  const storeId = member.store.id;
  const all = await allStatuses(storeId, kind);
  const gone = all.find((s) => s.id === id);
  const next = all.find((s) => s.id === replacementId);
  if (!gone || !next || next.id === gone.id || next.scopeId !== gone.scopeId) return { ok: false, problem: "not_found" };
  return projectsGuard(() =>
    db().transaction(async (tx) => {
      if (kind === "checklist") {
        await tx.execute(sql`update commerce.checklist_items set status_id = ${next.id}::uuid, updated_at = now() where store_id = ${storeId}::uuid and status_id = ${id}::uuid`);
        await tx.execute(sql`update commerce.checklist_subtasks set status_id = ${next.id}::uuid, updated_at = now() where store_id = ${storeId}::uuid and status_id = ${id}::uuid`);
      } else {
        await tx.execute(sql`update commerce.project_item_stages set status_id = ${next.id}::uuid, updated_at = now() where store_id = ${storeId}::uuid and status_id = ${id}::uuid`);
      }
      await tx.execute(sql`delete from ${table(kind)} where store_id = ${storeId}::uuid and id = ${id}::uuid`);
      return { ok: true as const };
    }),
  );
}

/**
 * A list or a project gets statuses of its own, copied from the store's defaults, and its items, their subtasks (or the project's stages)
 * move to the copies of the statuses they had. Nothing happens when it has its own already.
 */
async function ownStatusesIn(tx: Executor, storeId: string, kind: StatusKind, scopeId: string): Promise<void> {
  const all = await allStatuses(storeId, kind, tx);
  if (all.some((s) => s.scopeId === scopeId)) return;
  await tx.execute(sql`
    insert into ${table(kind)} (store_id, ${scopeColumn(kind)}, name, slug, colour, bucket, sort_order)
    select store_id, ${scopeId}::uuid, name, slug, colour, bucket, sort_order from ${table(kind)}
    where store_id = ${storeId}::uuid and ${scopeColumn(kind)} is null
  `);
  await remap(tx, storeId, kind, scopeId, "own");
}

/** Moves a scope's rows between the defaults and its own statuses, by slug: `own` to its copies, `store` back to the defaults. */
async function remap(tx: Executor, storeId: string, kind: StatusKind, scopeId: string, to: "own" | "store"): Promise<void> {
  const from = to === "own" ? sql`d.checklist_id is null and mine.checklist_id = ${scopeId}::uuid` : sql`d.checklist_id = ${scopeId}::uuid and mine.checklist_id is null`;
  if (kind === "checklist") {
    await tx.execute(sql`
      update commerce.checklist_items t set status_id = mine.id, updated_at = now()
      from commerce.checklist_statuses d, commerce.checklist_statuses mine
      where t.store_id = ${storeId}::uuid and t.checklist_id = ${scopeId}::uuid
        and d.store_id = t.store_id and d.id = t.status_id and mine.store_id = t.store_id and mine.slug = d.slug and ${from}
    `);
    await tx.execute(sql`
      update commerce.checklist_subtasks t set status_id = mine.id, updated_at = now()
      from commerce.checklist_items i, commerce.checklist_statuses d, commerce.checklist_statuses mine
      where t.store_id = ${storeId}::uuid and i.store_id = t.store_id and i.id = t.item_id and i.checklist_id = ${scopeId}::uuid
        and d.store_id = t.store_id and d.id = t.status_id and mine.store_id = t.store_id and mine.slug = d.slug and ${from}
    `);
  } else {
    const stageFrom = to === "own" ? sql`d.project_id is null and mine.project_id = ${scopeId}::uuid` : sql`d.project_id = ${scopeId}::uuid and mine.project_id is null`;
    await tx.execute(sql`
      update commerce.project_item_stages t set status_id = mine.id, updated_at = now()
      from commerce.project_statuses d, commerce.project_statuses mine
      where t.store_id = ${storeId}::uuid and t.project_id = ${scopeId}::uuid
        and d.store_id = t.store_id and d.id = t.status_id and mine.store_id = t.store_id and mine.slug = d.slug and ${stageFrom}
    `);
  }
}

/** Lisa's *Statuses of its own* for a list or a project: copies of the store's, to change for it alone. */
export async function useOwnStatuses(member: Membership, kind: StatusKind, scopeId: string): Promise<ProjectsResult> {
  if (!memberCan(member, WRITE)) return { ok: false, problem: "forbidden" };
  const storeId = member.store.id;
  if (!(await scopeExists(storeId, kind, scopeId))) return { ok: false, problem: "not_found" };
  return projectsGuard(() =>
    db().transaction(async (tx) => {
      await ownStatusesIn(tx, storeId, kind, scopeId);
      return { ok: true as const };
    }),
  );
}

/**
 * Back to the store's statuses: what used the list's or project's own moves to the default of the same name, else to its default, and
 * its own statuses go.
 */
export async function useStoreStatuses(member: Membership, kind: StatusKind, scopeId: string): Promise<ProjectsResult> {
  if (!memberCan(member, WRITE)) return { ok: false, problem: "forbidden" };
  const storeId = member.store.id;
  if (!(await scopeExists(storeId, kind, scopeId))) return { ok: false, problem: "not_found" };
  return projectsGuard(() =>
    db().transaction(async (tx) => {
      await remap(tx, storeId, kind, scopeId, "store");
      if (kind === "checklist") {
        // An item whose status had no default of the same name takes the list's default once its own statuses are gone.
        await tx.execute(sql`delete from commerce.checklist_statuses where store_id = ${storeId}::uuid and checklist_id = ${scopeId}::uuid`);
        await tx.execute(sql`
          update commerce.checklist_items set status_id = commerce.checklist_default_status(store_id, checklist_id, done_at is not null), updated_at = now()
          where store_id = ${storeId}::uuid and checklist_id = ${scopeId}::uuid and status_id is null
        `);
      } else {
        await tx.execute(sql`delete from commerce.project_statuses where store_id = ${storeId}::uuid and project_id = ${scopeId}::uuid`);
      }
      return { ok: true as const };
    }),
  );
}
