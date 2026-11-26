import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { freeSlug, labelInput, problemFields } from "@/lib/projects";
import { LABEL_KINDS, PROJECT_COLOURS, type LabelKind, type ProjectColour } from "@/lib/projects-model";

import type { Membership } from "./auth";
import { memberCan } from "./permissions";
import { projectsGuard, type ProjectsResult } from "./projects-errors";
import { everyOnce, reorderSql } from "./projects-sql";
import { uuidList } from "./sql-arrays";
import { col, typedRow, typedRows, type Executor } from "./typed-rows";

/**
 * A store's labels for checklist tasks (D903 P4.6, Life's taxonomy): categories (one a task) and tags (several), named once for the store,
 * each with a colour and an order. The database holds a category to its kind, a tag to its, and takes a deleted label off its tasks.
 */

const WRITE = "projects:write" as const;

export type Label = { id: string; kind: LabelKind; name: string; slug: string; colour: ProjectColour; sortOrder: number };

const labelRow = z.object({ id: col.uuid, kind: z.enum(LABEL_KINDS), name: col.text, slug: col.text, colour: z.enum(PROJECT_COLOURS), sort_order: col.int });

/** The store's labels, categories first, each kind in its order. */
export async function labelsOf(storeId: string, runner: Executor = db()): Promise<Label[]> {
  const rows = await typedRows(
    labelRow,
    sql`select id, kind, name, slug, colour, sort_order from commerce.project_labels where store_id = ${storeId}::uuid order by kind, sort_order, created_at`,
    runner,
  );
  return rows.map((r) => ({ id: r.id, kind: r.kind, name: r.name, slug: r.slug, colour: r.colour, sortOrder: r.sort_order }));
}

/** A new label at the end of its kind. */
export async function addLabel(member: Membership, kind: LabelKind, raw: unknown): Promise<ProjectsResult<{ id: string }>> {
  if (!memberCan(member, WRITE)) return { ok: false, problem: "forbidden" };
  const input = labelInput.safeParse(raw);
  if (!input.success) return { ok: false, problem: "invalid", fields: problemFields(input.error) };
  const storeId = member.store.id;
  return projectsGuard(() =>
    db().transaction(async (tx) => {
      const mine = (await labelsOf(storeId, tx)).filter((l) => l.kind === kind);
      const made = await typedRow(
        z.object({ id: col.uuid }),
        sql`
          insert into commerce.project_labels (store_id, kind, name, slug, colour, sort_order)
          values (${storeId}::uuid, ${kind}, ${input.data.name}, ${freeSlug(input.data.name, new Set(mine.map((l) => l.slug)))}, ${input.data.colour}, ${mine.length})
          returning id
        `,
        tx,
      );
      return { ok: true as const, id: made!.id };
    }),
  );
}

/** A label renamed or recoloured (its slug stays). */
export async function updateLabel(member: Membership, id: string, raw: unknown): Promise<ProjectsResult> {
  if (!memberCan(member, WRITE)) return { ok: false, problem: "forbidden" };
  const input = labelInput.safeParse(raw);
  if (!input.success) return { ok: false, problem: "invalid", fields: problemFields(input.error) };
  const storeId = member.store.id;
  return projectsGuard(async () => {
    const changed = await typedRows(
      z.object({ id: col.uuid }),
      sql`update commerce.project_labels set name = ${input.data.name}, colour = ${input.data.colour}, updated_at = now() where store_id = ${storeId}::uuid and id = ${id}::uuid returning id`,
    );
    return changed.length > 0 ? { ok: true } : { ok: false, problem: "not_found" };
  });
}

/** A label deleted, and so taken off its tasks. */
export async function deleteLabel(member: Membership, id: string): Promise<ProjectsResult> {
  if (!memberCan(member, WRITE)) return { ok: false, problem: "forbidden" };
  const storeId = member.store.id;
  const gone = await typedRows(z.object({ id: col.uuid }), sql`delete from commerce.project_labels where store_id = ${storeId}::uuid and id = ${id}::uuid returning id`);
  return gone.length > 0 ? { ok: true } : { ok: false, problem: "not_found" };
}

/** A kind's labels put in the order given: every one of them, once. */
export async function reorderLabels(member: Membership, kind: LabelKind, ids: readonly string[]): Promise<ProjectsResult> {
  if (!memberCan(member, WRITE)) return { ok: false, problem: "forbidden" };
  const storeId = member.store.id;
  const mine = (await labelsOf(storeId)).filter((l) => l.kind === kind);
  if (!everyOnce(ids, mine.map((l) => l.id))) return { ok: false, problem: "invalid" };
  await db().execute(reorderSql(sql`commerce.project_labels`, storeId, ids));
  return { ok: true };
}

/** A task's tags made exactly these (written on `runner`, the item's own transaction). */
export async function replaceTags(runner: Executor, storeId: string, itemId: string, labelIds: readonly string[]): Promise<void> {
  await runner.execute(sql`
    delete from commerce.checklist_item_tags where store_id = ${storeId}::uuid and item_id = ${itemId}::uuid and not (label_id = any(${uuidList(labelIds)}))
  `);
  if (labelIds.length === 0) return;
  await runner.execute(sql`
    insert into commerce.checklist_item_tags (store_id, item_id, label_id)
    select ${storeId}::uuid, ${itemId}::uuid, l from unnest(${uuidList(labelIds)}) as l
    on conflict do nothing
  `);
}
