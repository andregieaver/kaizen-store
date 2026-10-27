import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { readSpec } from "@/lib/report-catalogue-schema";
import { specProblems, type ReportSpec, type SpecProblem } from "@/lib/report-catalogue";

import { audit } from "./auth";
import { col, typedRows } from "./typed-rows";

/**
 * A store's saved reports (wave 8 unit A, D345, `docs/wave-8-analytics-ai.md` A.3): a name and a spec, never figures, so a saved report
 * reruns on fresh data. The only writer of `commerce.saved_reports`; every query takes the store id, and a report of another store is
 * the same as one that does not exist. A spec is checked when it is saved and again whenever it is read: one that no longer passes
 * (a catalogue key gone) is kept and says why, so the owner can open it in the builder.
 */

/** Saved reports a store may keep. */
export const SAVED_REPORTS_MAX = 200;
export const TITLE_MAX = 80;

export type SavedReport = {
  id: string;
  title: string;
  /** The spec as saved; null when it is no longer one (`problems` then says nothing, the page says it cannot be read). */
  spec: ReportSpec | null;
  /** Why the spec cannot run as saved; empty when it can. */
  problems: SpecProblem[];
  updatedAt: string;
};

export type SaveOutcome = { ok: true; id: string } | { ok: false; reason: "title" | "spec" | "too_many" | "gone"; problems?: SpecProblem[] };

const row = z.object({ id: col.uuid, title: col.text, spec: z.unknown(), updated_at: col.timestamp });

function asSaved(r: z.output<typeof row>): SavedReport {
  const spec = readSpec(r.spec);
  return { id: r.id, title: r.title, spec, problems: spec ? specProblems(spec) : [], updatedAt: r.updated_at };
}

/** The store's saved reports, by name. */
export async function listSavedReports(storeId: string): Promise<SavedReport[]> {
  const rows = await typedRows(row, sql`
    select id, title, spec, updated_at from commerce.saved_reports where store_id = ${storeId}::uuid order by lower(title), created_at
  `);
  return rows.map(asSaved);
}

/** One of the store's saved reports; null for another store's or one that does not exist. */
export async function getSavedReport(storeId: string, id: string): Promise<SavedReport | null> {
  if (!z.uuid().safeParse(id).success) return null;
  const [found] = await typedRows(row, sql`
    select id, title, spec, updated_at from commerce.saved_reports where store_id = ${storeId}::uuid and id = ${id}::uuid
  `);
  return found ? asSaved(found) : null;
}

/**
 * Saves a report under a name: a new one without `id`, else the store's own `id`. The spec is read through the schema and must be one
 * the catalogue allows; a store keeps at most `SAVED_REPORTS_MAX`. Audited without the spec's values (a filter can name a product).
 */
export async function saveReport(storeId: string, accountId: string, input: { title: string; spec: unknown }, id?: string): Promise<SaveOutcome> {
  const title = input.title.trim();
  if (title.length === 0 || title.length > TITLE_MAX) return { ok: false, reason: "title" };
  const spec = readSpec(input.spec);
  if (!spec) return { ok: false, reason: "spec" };
  const problems = specProblems(spec);
  if (problems.length > 0) return { ok: false, reason: "spec", problems };
  const json = JSON.stringify(spec);
  if (id !== undefined) {
    if (!z.uuid().safeParse(id).success) return { ok: false, reason: "gone" };
    const changed = await db().execute(sql`
      update commerce.saved_reports set title = ${title}, spec = ${json}::jsonb, updated_by = ${accountId}::uuid, updated_at = now()
      where store_id = ${storeId}::uuid and id = ${id}::uuid returning id
    `);
    if (changed.length === 0) return { ok: false, reason: "gone" };
    await audit(accountId, storeId, "analytics.report_saved", { report: id, metrics: spec.metrics, dimensions: spec.dimensions }, { area: "analytics" });
    return { ok: true, id };
  }
  // Counted and written in one statement under the store's row lock, so two saves at once cannot pass the limit together.
  const created = await db().transaction(async (tx) => {
    await tx.execute(sql`select 1 from commerce.stores where id = ${storeId}::uuid for update`);
    return tx.execute<{ id: string }>(sql`
      insert into commerce.saved_reports (store_id, title, spec, created_by, updated_by)
      select ${storeId}::uuid, ${title}, ${json}::jsonb, ${accountId}::uuid, ${accountId}::uuid
      where (select count(*) from commerce.saved_reports where store_id = ${storeId}::uuid) < ${SAVED_REPORTS_MAX}
      returning id
    `);
  });
  if (created.length === 0) return { ok: false, reason: "too_many" };
  const newId = String(created[0].id);
  await audit(accountId, storeId, "analytics.report_saved", { report: newId, metrics: spec.metrics, dimensions: spec.dimensions }, { area: "analytics" });
  return { ok: true, id: newId };
}

/** Deletes one of the store's saved reports; false when it is not the store's. The figures it showed are not touched. */
export async function deleteReport(storeId: string, accountId: string, id: string): Promise<boolean> {
  if (!z.uuid().safeParse(id).success) return false;
  const gone = await db().execute(sql`delete from commerce.saved_reports where store_id = ${storeId}::uuid and id = ${id}::uuid returning id`);
  if (gone.length === 0) return false;
  await audit(accountId, storeId, "analytics.report_deleted", { report: id }, { area: "analytics" });
  return true;
}
