"use server";

import { refresh } from "next/cache";

import type { Finding } from "@/lib/data-job";
import { ignoreAddress, redirectFromReport, restoreAddress } from "@/server/not-found";
import { NO_ACCESS, checkPermission } from "@/server/permissions";

/**
 * The report of pages not found: what a member who may change the website does with a row (wave 2, D168, `docs/wave-2-redirects.md` 2.3): make the redirect
 * from the address to a suggestion or to an address typed in the short form (the same one check as the manager's form, origin `report`), hide the address, or
 * bring a hidden one back. Each takes the store's slug as its bound first argument and asks `website:write` itself.
 */

export type ReportStep = { ok: true; target?: string } | { ok: false; problems: string[]; findings?: Finding[] };

const text = (value: unknown, max: number): string => (typeof value === "string" ? value.slice(0, max) : "");

export async function redirectMissingAction(storeSlug: string, path: string, to: string): Promise<ReportStep> {
  const member = await checkPermission(storeSlug, "website:write");
  if (!member) return { ok: false, problems: [NO_ACCESS] };
  const result = await redirectFromReport(member, { path: text(path, 300), to: text(to, 2_100) });
  if (!result.ok) return { ok: false, problems: result.problems, findings: result.findings };
  refresh();
  return { ok: true, target: result.target };
}

export async function ignoreMissingAction(storeSlug: string, path: string): Promise<ReportStep> {
  const member = await checkPermission(storeSlug, "website:write");
  if (!member) return { ok: false, problems: [NO_ACCESS] };
  const result = await ignoreAddress(member, text(path, 300));
  if (!result.ok) return result;
  refresh();
  return { ok: true };
}

export async function restoreMissingAction(storeSlug: string, path: string): Promise<ReportStep> {
  const member = await checkPermission(storeSlug, "website:write");
  if (!member) return { ok: false, problems: [NO_ACCESS] };
  const result = await restoreAddress(member, text(path, 300));
  if (!result.ok) return result;
  refresh();
  return { ok: true };
}
