"use server";

import { refresh } from "next/cache";

import { cancelJob, registerImport, startImportApply, startImportCheck, startImportUpload } from "@/server/data-jobs";
import { requirePermission } from "@/server/permissions";

/**
 * The product import's steps (D165, `docs/wave-2-data.md` 2.2), each for a member with `products:write`: a signed upload for the browser, the file's
 * registration (read, refused with a sentence or kept as a job), the dry run, the apply and the cancel. They only start the work: the job runs after
 * the response, in the open page's ticks and in the five-minute job. Nothing is written to the catalogue except by the apply, through the editor's own door.
 */

type Step = { ok: true } | { ok: false; problem: string };

const text = (value: unknown, max: number): string => (typeof value === "string" ? value.slice(0, max) : "");

export async function startUploadAction(storeSlug: string, fileName: string) {
  const member = await requirePermission(storeSlug, "products:write");
  return startImportUpload(member, text(fileName, 200));
}

export async function registerUploadAction(storeSlug: string, input: { path: string; name: string }) {
  const member = await requirePermission(storeSlug, "products:write");
  const result = await registerImport(member, { path: text(input?.path, 600), name: text(input?.name, 200) });
  if (result.ok) refresh();
  return result;
}

export async function checkImportAction(storeSlug: string, jobId: string, options: unknown): Promise<Step> {
  const member = await requirePermission(storeSlug, "products:write");
  const result = await startImportCheck(member, text(jobId, 60), options);
  if (result.ok) refresh();
  return result;
}

export async function applyImportAction(storeSlug: string, jobId: string): Promise<Step> {
  const member = await requirePermission(storeSlug, "products:write");
  const result = await startImportApply(member, text(jobId, 60));
  if (result.ok) refresh();
  return result;
}

export async function cancelImportAction(storeSlug: string, jobId: string): Promise<Step> {
  const member = await requirePermission(storeSlug, "products:write");
  const result = await cancelJob(member, text(jobId, 60));
  refresh();
  return result;
}
