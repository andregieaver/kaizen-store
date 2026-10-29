"use server";

import { refresh } from "next/cache";

import { adminText } from "@/lib/admin-text";
import { actionAdminLang } from "@/server/admin-request-lang";
import { cancelJob, registerHistoryImport, startHistoryApply, startHistoryCheck, startHistoryUpload } from "@/server/data-jobs";
import { checkPermission } from "@/server/permissions";

/**
 * The order history import's steps (wave 11 unit E, D384), each with the store's slug as its bound first argument: the owner's alone, as the
 * order file is (an order carries a person's name, address and email). The steps only start the work: the job runs after the response, in the
 * open page's ticks and in the five-minute job.
 */

const noAccess = async () => adminText(await actionAdminLang(), "customers").saved.noAccess;

type Step = { ok: true } | { ok: false; problem: string };

const text = (value: unknown, max: number): string => (typeof value === "string" ? value.slice(0, max) : "");

export async function startHistoryUploadAction(storeSlug: string, fileName: string) {
  const member = await checkPermission(storeSlug, "owner");
  if (!member) return { ok: false as const, problem: await noAccess() };
  return startHistoryUpload(member, text(fileName, 200));
}

export async function registerHistoryUploadAction(storeSlug: string, input: { path: string; name: string }) {
  const member = await checkPermission(storeSlug, "owner");
  if (!member) return { ok: false as const, problems: [await noAccess()] };
  const result = await registerHistoryImport(member, { path: text(input?.path, 600), name: text(input?.name, 200) });
  if (result.ok) refresh();
  return result;
}

export async function checkHistoryImportAction(storeSlug: string, jobId: string): Promise<Step> {
  const member = await checkPermission(storeSlug, "owner");
  if (!member) return { ok: false, problem: await noAccess() };
  const result = await startHistoryCheck(member, text(jobId, 60));
  if (result.ok) refresh();
  return result;
}

export async function applyHistoryImportAction(storeSlug: string, jobId: string): Promise<Step> {
  const member = await checkPermission(storeSlug, "owner");
  if (!member) return { ok: false, problem: await noAccess() };
  const result = await startHistoryApply(member, text(jobId, 60));
  if (result.ok) refresh();
  return result;
}

export async function cancelHistoryImportAction(storeSlug: string, jobId: string): Promise<Step> {
  const member = await checkPermission(storeSlug, "owner");
  if (!member) return { ok: false, problem: await noAccess() };
  const result = await cancelJob(member, text(jobId, 60));
  refresh();
  return result;
}
