import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { PROJECT_LIMITS } from "@/lib/projects-model";

import type { Membership } from "./auth";
import { db } from "@/db/client";
import { memberCan } from "./permissions";
import { createProject, linkChecklist } from "./projects";
import type { ProjectsResult } from "./projects-errors";
import { duplicateChecklist } from "./projects-lists";
import { col, typedRow, typedRows } from "./typed-rows";

/**
 * Projects and Deals together (D904, `docs/projects.md` P8.3b), a pair of the octopus: a won deal starts a project, and each names the
 * other. Projects holds the link (`projects.deal_id`, cleared when the deal is deleted), so Deals' own tables know nothing of it; the pages
 * show it only while the store has both (`projectsOn()`, `dealsOn()`).
 */

const PROJECT_ROW = z.object({ id: col.uuid, name: col.text, status: col.text });

/** A deal's projects, newest first. */
export async function projectsOfDeal(storeId: string, dealId: string): Promise<{ id: string; name: string; status: string }[]> {
  return typedRows(
    PROJECT_ROW,
    sql`select id, name, status from commerce.projects where store_id = ${storeId}::uuid and deal_id = ${dealId}::uuid order by created_at desc limit 20`,
  );
}

/** The deal a project was started from, if any. */
export async function dealOfProject(storeId: string, projectId: string): Promise<{ id: string; title: string } | null> {
  return typedRow(
    z.object({ id: col.uuid, title: col.text }),
    sql`
      select d.id, d.title from commerce.projects p join commerce.deals d on d.store_id = p.store_id and d.id = p.deal_id
       where p.store_id = ${storeId}::uuid and p.id = ${projectId}::uuid
    `,
  );
}

/** The store's lists marked as templates (P4.12), to start a deal's project from. */
export async function listTemplates(storeId: string): Promise<{ id: string; title: string }[]> {
  return typedRows(
    z.object({ id: col.uuid, title: col.text }),
    sql`select id, title from commerce.checklists where store_id = ${storeId}::uuid and as_template order by title limit 50`,
  );
}

/** A project from a deal: which deal, and the template list it starts with (none: an empty project). */
export const dealProjectInput = z.object({ dealId: z.uuid(), templateId: z.uuid().nullable() });

/**
 * Starts a project from a deal: named after the deal, linked to it, and given a copy of the template list chosen. Needs the right to change
 * projects and to read customers (the deal's page's).
 */
export async function startDealProject(member: Membership, raw: unknown): Promise<ProjectsResult<{ id: string }>> {
  if (!memberCan(member, "projects:write") || !memberCan(member, "customers:read")) return { ok: false, problem: "forbidden" };
  const input = dealProjectInput.safeParse(raw);
  if (!input.success) return { ok: false, problem: "invalid" };
  const storeId = member.store.id;
  const deal = await typedRow(
    z.object({ title: col.text }),
    sql`select title from commerce.deals where store_id = ${storeId}::uuid and id = ${input.data.dealId}::uuid`,
  );
  if (!deal) return { ok: false, problem: "not_found" };
  const made = await createProject(member, { name: deal.title.slice(0, PROJECT_LIMITS.projectName) });
  if (!made.ok) return made;
  await db().execute(sql`update commerce.projects set deal_id = ${input.data.dealId}::uuid where store_id = ${storeId}::uuid and id = ${made.id}::uuid`);
  if (input.data.templateId) {
    const copy = await duplicateChecklist(member, input.data.templateId, deal.title.slice(0, PROJECT_LIMITS.checklistTitle));
    if (!copy.ok) return copy;
    const linked = await linkChecklist(member, made.id, copy.id);
    if (!linked.ok) return linked;
    // Its home is the new project, not the template's.
    await db().execute(sql`update commerce.checklists set primary_project_id = ${made.id}::uuid where store_id = ${storeId}::uuid and id = ${copy.id}::uuid`);
  }
  return { ok: true, id: made.id };
}
