"use server";

import { refresh } from "next/cache";

import { adminText } from "@/lib/admin-text";
import { actionAdminLang } from "@/server/admin-request-lang";
import { cancelJob, registerInventoryImport, startInventoryApply, startInventoryCheck, startInventoryUpload } from "@/server/data-jobs";
import { checkPermission } from "@/server/permissions";

/**
 * The stock import's steps (wave 3, D172, `docs/wave-3-inventory.md` 2.4), each for a member with `products:write` and each with the store's slug as its
 * bound first argument: a signed upload for the browser, the file's registration (read, refused with sentences or kept as a job), the dry run, the apply and
 * the cancel. They only start the work: the job runs after the response, in the open page's ticks and in the five-minute job. No stock is written except by
 * the apply, a row at a time, each as a movement with the job's id.
 */

/** The refusal before a member is known, in the admin's language (D312 A5). */
const noAccess = async () => adminText(await actionAdminLang(), "inventory").noAccess;

type Step = { ok: true } | { ok: false; problem: string };

const text = (value: unknown, max: number): string => (typeof value === "string" ? value.slice(0, max) : "");

export async function startStockUploadAction(storeSlug: string, fileName: string) {
  const member = await checkPermission(storeSlug, "products:write");
  if (!member) return { ok: false as const, problem: await noAccess() };
  return startInventoryUpload(member, text(fileName, 200));
}

export async function registerStockUploadAction(storeSlug: string, input: { path: string; name: string }) {
  const member = await checkPermission(storeSlug, "products:write");
  if (!member) return { ok: false as const, problems: [await noAccess()] };
  const result = await registerInventoryImport(member, { path: text(input?.path, 600), name: text(input?.name, 200) });
  if (result.ok) refresh();
  return result;
}

export async function checkStockImportAction(storeSlug: string, jobId: string): Promise<Step> {
  const member = await checkPermission(storeSlug, "products:write");
  if (!member) return { ok: false, problem: await noAccess() };
  const result = await startInventoryCheck(member, text(jobId, 60));
  if (result.ok) refresh();
  return result;
}

export async function applyStockImportAction(storeSlug: string, jobId: string): Promise<Step> {
  const member = await checkPermission(storeSlug, "products:write");
  if (!member) return { ok: false, problem: await noAccess() };
  const result = await startInventoryApply(member, text(jobId, 60));
  if (result.ok) refresh();
  return result;
}

export async function cancelStockImportAction(storeSlug: string, jobId: string): Promise<Step> {
  const member = await checkPermission(storeSlug, "products:write");
  if (!member) return { ok: false, problem: await noAccess() };
  const result = await cancelJob(member, text(jobId, 60));
  refresh();
  return result;
}
