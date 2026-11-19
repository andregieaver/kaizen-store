"use server";

import { refresh } from "next/cache";

import type { Finding } from "@/lib/data-job";
import { ignoreAddress, redirectFromReport, restoreAddress } from "@/server/not-found";
import { NO_ACCESS, checkPermission } from "@/server/permissions";
import { inAccountWords } from "../answer-words";

/**
 * The report of pages not found: what a member who may change the website does with a row (wave 2, D168, `docs/wave-2-redirects.md` 2.3): make the redirect
 * from the address to a suggestion or to an address typed in the short form (the same one check as the manager's form, origin `report`), hide the address, or
 * bring a hidden one back. Each takes the store's slug as its bound first argument and asks `website:write` itself.
 */

export type ReportStep = { ok: true; target?: string } | { ok: false; problems: string[]; findings?: Finding[] };

const text = (value: unknown, max: number): string => (typeof value === "string" ? value.slice(0, max) : "");

async function redirectMissingActionInEnglish(storeSlug: string, path: string, to: string): Promise<ReportStep> {
  const member = await checkPermission(storeSlug, "website:write");
  if (!member) return { ok: false, problems: [NO_ACCESS] };
  const result = await redirectFromReport(member, { path: text(path, 300), to: text(to, 2_100) });
  if (!result.ok) return { ok: false, problems: result.problems, findings: result.findings };
  refresh();
  return { ok: true, target: result.target };
}

async function ignoreMissingActionInEnglish(storeSlug: string, path: string): Promise<ReportStep> {
  const member = await checkPermission(storeSlug, "website:write");
  if (!member) return { ok: false, problems: [NO_ACCESS] };
  const result = await ignoreAddress(member, text(path, 300));
  if (!result.ok) return result;
  refresh();
  return { ok: true };
}

async function restoreMissingActionInEnglish(storeSlug: string, path: string): Promise<ReportStep> {
  const member = await checkPermission(storeSlug, "website:write");
  if (!member) return { ok: false, problems: [NO_ACCESS] };
  const result = await restoreAddress(member, text(path, 300));
  if (!result.ok) return result;
  refresh();
  return { ok: true };
}

// Each action's answer in the account's words (bloat review step 2.26): the browser draws what it is given, with no English to match.
export async function redirectMissingAction(...args: Parameters<typeof redirectMissingActionInEnglish>): Promise<Awaited<ReturnType<typeof redirectMissingActionInEnglish>>> {
  return inAccountWords(await redirectMissingActionInEnglish(...args));
}
export async function ignoreMissingAction(...args: Parameters<typeof ignoreMissingActionInEnglish>): Promise<Awaited<ReturnType<typeof ignoreMissingActionInEnglish>>> {
  return inAccountWords(await ignoreMissingActionInEnglish(...args));
}
export async function restoreMissingAction(...args: Parameters<typeof restoreMissingActionInEnglish>): Promise<Awaited<ReturnType<typeof restoreMissingActionInEnglish>>> {
  return inAccountWords(await restoreMissingActionInEnglish(...args));
}
