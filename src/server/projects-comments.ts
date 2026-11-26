import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { commentBody } from "@/lib/projects";

import type { Membership } from "./auth";
import { memberCan } from "./permissions";
import { projectsGuard, type ProjectsResult } from "./projects-errors";
import { col, typedRow, typedRows } from "./typed-rows";

/**
 * A task's comments (D903 P4.4, Life's activity thread): the team talking about one task, oldest first. Anyone who may change projects
 * writes one; only who wrote it changes or deletes it. Read with the list (`checklistDetail()`).
 */

const WRITE = "projects:write" as const;

/** A comment added to a task of the store. */
export async function addComment(member: Membership, itemId: string, raw: string): Promise<ProjectsResult<{ id: string }>> {
  if (!memberCan(member, WRITE)) return { ok: false, problem: "forbidden" };
  const body = commentBody.safeParse(raw);
  if (!body.success) return { ok: false, problem: "invalid", fields: ["body"] };
  const storeId = member.store.id;
  return projectsGuard(async () => {
    const made = await typedRow(
      z.object({ id: col.uuid }),
      sql`
        insert into commerce.checklist_item_comments (store_id, item_id, written_by, body)
        select ${storeId}::uuid, i.id, ${member.account.id}::uuid, ${body.data} from commerce.checklist_items i where i.store_id = ${storeId}::uuid and i.id = ${itemId}::uuid
        returning id
      `,
    );
    return made ? { ok: true, id: made.id } : { ok: false, problem: "not_found" };
  });
}

/** A comment changed by who wrote it. */
export async function editComment(member: Membership, id: string, raw: string): Promise<ProjectsResult> {
  if (!memberCan(member, WRITE)) return { ok: false, problem: "forbidden" };
  const body = commentBody.safeParse(raw);
  if (!body.success) return { ok: false, problem: "invalid", fields: ["body"] };
  const changed = await typedRows(
    z.object({ id: col.uuid }),
    sql`
      update commerce.checklist_item_comments set body = ${body.data}, edited_at = now()
      where store_id = ${member.store.id}::uuid and id = ${id}::uuid and written_by = ${member.account.id}::uuid
      returning id
    `,
  );
  return changed.length > 0 ? { ok: true } : { ok: false, problem: "not_found" };
}

/** A comment deleted by who wrote it. */
export async function deleteComment(member: Membership, id: string): Promise<ProjectsResult> {
  if (!memberCan(member, WRITE)) return { ok: false, problem: "forbidden" };
  const gone = await typedRows(
    z.object({ id: col.uuid }),
    sql`delete from commerce.checklist_item_comments where store_id = ${member.store.id}::uuid and id = ${id}::uuid and written_by = ${member.account.id}::uuid returning id`,
  );
  return gone.length > 0 ? { ok: true } : { ok: false, problem: "not_found" };
}
