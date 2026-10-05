"use server";

import { refresh } from "next/cache";

import {
  applyGrid,
  batchSummary,
  continueBulk,
  matchingProductIds,
  previewBulk,
  previewGrid,
  startBulk,
  undoBatch,
  type BatchSummary,
  type BulkPreview,
  type BulkProblem,
  type BulkRequest,
  type GridEdit,
  type GridPreview,
  type MatchFilter,
  type UndoResult,
} from "@/server/bulk-edit";
import { requirePermission } from "@/server/permissions";

/**
 * The bulk editor's actions (D165, `docs/wave-2-data.md` 2.6), for members who can change products. A preview writes nothing; a start makes the batch
 * and does the first products; a continue does the next ones until the batch is done; an undo is a batch of its own. Each product is changed through the
 * editor's own door by `src/server/bulk-edit.ts`, which refreshes the catalogue's caches; these only check the member and give the result to the page.
 */

export type BulkRun = { ok: true; batchId: string; done: boolean; processed: number; total: number; summary: BatchSummary | null } | BulkProblem;

export type GridApplied = { ok: true; batchId: string; conflicts: number; invalid: number; summary: BatchSummary | null } | BulkProblem;

const id = (value: unknown): string => (typeof value === "string" ? value.slice(0, 60) : "");

async function runOf(storeId: string, progress: Awaited<ReturnType<typeof startBulk>>): Promise<BulkRun> {
  if (!progress.ok) return progress;
  const summary = progress.done ? await batchSummary(storeId, progress.batchId) : null;
  return { ok: true, batchId: progress.batchId, done: progress.done, processed: progress.processed, total: progress.total, summary };
}

export async function previewBulkAction(storeSlug: string, request: BulkRequest): Promise<BulkPreview | BulkProblem> {
  const member = await requirePermission(storeSlug, "products:write");
  return previewBulk(member, request);
}

export async function startBulkAction(storeSlug: string, request: BulkRequest): Promise<BulkRun> {
  const member = await requirePermission(storeSlug, "products:write");
  const run = await runOf(member.store.id, await startBulk(member, request));
  refresh();
  return run;
}

export async function continueBulkAction(storeSlug: string, batchId: string): Promise<BulkRun> {
  const member = await requirePermission(storeSlug, "products:write");
  const run = await runOf(member.store.id, await continueBulk(member, id(batchId)));
  if (run.ok && run.done) refresh();
  return run;
}

export async function matchingAction(storeSlug: string, filter: MatchFilter): Promise<{ ids: string[]; total: number }> {
  const member = await requirePermission(storeSlug, "products:write");
  const status = filter?.status === "archived" || filter?.status === "active" || filter?.status === "draft" ? filter.status : undefined;
  return matchingProductIds(member.store.id, { status, q: typeof filter?.q === "string" ? filter.q.slice(0, 100) : undefined });
}

export async function previewGridAction(storeSlug: string, edits: GridEdit[], markets: string[]): Promise<GridPreview | BulkProblem> {
  const member = await requirePermission(storeSlug, "products:write");
  return previewGrid(member, edits, markets);
}

export async function applyGridAction(storeSlug: string, edits: GridEdit[], markets: string[]): Promise<GridApplied> {
  const member = await requirePermission(storeSlug, "products:write");
  const result = await applyGrid(member, edits, markets);
  if (!result.ok) return result;
  refresh();
  return { ok: true, batchId: result.batchId, conflicts: result.conflicts, invalid: result.invalid, summary: await batchSummary(member.store.id, result.batchId) };
}

export async function undoBatchAction(storeSlug: string, batchId: string): Promise<UndoResult> {
  const member = await requirePermission(storeSlug, "products:write");
  const result = await undoBatch(member, id(batchId));
  refresh();
  return result;
}
