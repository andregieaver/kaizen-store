"use server";

import { refresh } from "next/cache";

import { cancelJob, registerRedirectImport, startRedirectApply, startRedirectCheck, startRedirectUpload } from "@/server/data-jobs";
import { NO_ACCESS, checkPermission } from "@/server/permissions";
import { inAccountWords } from "../answer-words";

/**
 * The redirect import's steps (wave 2, second run, D168, `docs/wave-2-redirects.md` 2.2.4), each for a member with `website:write` and each with the store's slug
 * as its bound first argument: a signed upload for the browser, the file's registration (read, refused with sentences or kept as a job), the dry run, the apply
 * and the cancel. They only start the work: the job runs after the response, in the open page's ticks and in the five-minute job. Nothing is written to the
 * redirects except by the apply, through the redirect service.
 */

type Step = { ok: true } | { ok: false; problem: string };

const text = (value: unknown, max: number): string => (typeof value === "string" ? value.slice(0, max) : "");

async function startRedirectUploadActionInEnglish(storeSlug: string, fileName: string) {
  const member = await checkPermission(storeSlug, "website:write");
  if (!member) return { ok: false as const, problem: NO_ACCESS };
  return startRedirectUpload(member, text(fileName, 200));
}

async function registerRedirectUploadActionInEnglish(storeSlug: string, input: { path: string; name: string }) {
  const member = await checkPermission(storeSlug, "website:write");
  if (!member) return { ok: false as const, problems: [NO_ACCESS] };
  const result = await registerRedirectImport(member, { path: text(input?.path, 600), name: text(input?.name, 200) });
  if (result.ok) refresh();
  return result;
}

async function checkRedirectImportActionInEnglish(storeSlug: string, jobId: string, options: unknown): Promise<Step> {
  const member = await checkPermission(storeSlug, "website:write");
  if (!member) return { ok: false, problem: NO_ACCESS };
  const result = await startRedirectCheck(member, text(jobId, 60), options);
  if (result.ok) refresh();
  return result;
}

async function applyRedirectImportActionInEnglish(storeSlug: string, jobId: string): Promise<Step> {
  const member = await checkPermission(storeSlug, "website:write");
  if (!member) return { ok: false, problem: NO_ACCESS };
  const result = await startRedirectApply(member, text(jobId, 60));
  if (result.ok) refresh();
  return result;
}

async function cancelRedirectImportActionInEnglish(storeSlug: string, jobId: string): Promise<Step> {
  const member = await checkPermission(storeSlug, "website:write");
  if (!member) return { ok: false, problem: NO_ACCESS };
  const result = await cancelJob(member, text(jobId, 60));
  refresh();
  return result;
}

// Each action's answer in the account's words (bloat review step 2.26): the browser draws what it is given, with no English to match.
export async function startRedirectUploadAction(...args: Parameters<typeof startRedirectUploadActionInEnglish>): Promise<Awaited<ReturnType<typeof startRedirectUploadActionInEnglish>>> {
  return inAccountWords(await startRedirectUploadActionInEnglish(...args));
}
export async function registerRedirectUploadAction(...args: Parameters<typeof registerRedirectUploadActionInEnglish>): Promise<Awaited<ReturnType<typeof registerRedirectUploadActionInEnglish>>> {
  return inAccountWords(await registerRedirectUploadActionInEnglish(...args));
}
export async function checkRedirectImportAction(...args: Parameters<typeof checkRedirectImportActionInEnglish>): Promise<Awaited<ReturnType<typeof checkRedirectImportActionInEnglish>>> {
  return inAccountWords(await checkRedirectImportActionInEnglish(...args));
}
export async function applyRedirectImportAction(...args: Parameters<typeof applyRedirectImportActionInEnglish>): Promise<Awaited<ReturnType<typeof applyRedirectImportActionInEnglish>>> {
  return inAccountWords(await applyRedirectImportActionInEnglish(...args));
}
export async function cancelRedirectImportAction(...args: Parameters<typeof cancelRedirectImportActionInEnglish>): Promise<Awaited<ReturnType<typeof cancelRedirectImportActionInEnglish>>> {
  return inAccountWords(await cancelRedirectImportActionInEnglish(...args));
}
