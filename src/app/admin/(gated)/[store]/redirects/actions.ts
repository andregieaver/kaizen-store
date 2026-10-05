"use server";

import { refresh } from "next/cache";
import { z } from "zod";

import type { Finding } from "@/lib/data-job";
import { REDIRECT_BULK_DELETE_MAX } from "@/lib/data-limits";
import { checkRedirect, createRedirect, deleteRedirects, updateRedirect } from "@/server/redirects";
import { NO_ACCESS, checkPermission } from "@/server/permissions";

/**
 * The redirect manager's actions (wave 2, second run, D168, `docs/wave-2-redirects.md` 2.2), each for a member with `website:write` and each taking the
 * store's slug as its first, bound argument. The service (`src/server/redirects.ts`) holds the one check of an address pair and writes the redirect and its
 * activity-log entry in one transaction; these only carry what the form typed to it and what it answered back, as plain data. Saving refreshes the cache
 * the lookup of a missing address is kept in (inside the service) and the page.
 */

export type ExistingRedirect = { kind: "manual"; target: string } | { kind: "automatic" } | null;

export type CheckResult =
  | { ok: true; saveable: boolean; source: string | null; target: string | null; findings: Finding[]; existing: ExistingRedirect }
  | { ok: false; problems: string[] };

export type SaveResult =
  | { ok: true; source: string; target: string; created: boolean; unchanged: boolean; replacedAutomatic: boolean; findings: Finding[] }
  | { ok: false; problems: string[]; findings: Finding[] };

export type DeleteResult = { ok: true; deleted: number } | { ok: false; problems: string[] };

const pair = z.object({ from: z.string().max(2_100), to: z.string().max(2_100) });
const idList = z.array(z.uuid()).max(REDIRECT_BULK_DELETE_MAX);

const unreadable: { ok: false; problems: string[] } = { ok: false, problems: ["The form could not be read. Reload the page and try again."] };

/** Checks an address pair as it is typed; writes nothing. */
export async function checkRedirectAction(storeSlug: string, input: unknown): Promise<CheckResult> {
  const member = await checkPermission(storeSlug, "website:write");
  if (!member) return { ok: false, problems: [NO_ACCESS] };
  const parsed = pair.safeParse(input);
  if (!parsed.success) return unreadable;
  const result = await checkRedirect(member, parsed.data);
  if (!result.ok) return { ok: false, problems: result.problems };
  return { ok: true, saveable: result.ok_to_save, source: result.source, target: result.target, findings: result.findings, existing: result.existing };
}

/** Adds a manual redirect (replacing the target of one from the same address), or, with an id, edits that one. */
export async function saveRedirectAction(storeSlug: string, input: unknown, id?: string): Promise<SaveResult> {
  const member = await checkPermission(storeSlug, "website:write");
  if (!member) return { ok: false, problems: [NO_ACCESS], findings: [] };
  const parsed = pair.safeParse(input);
  if (!parsed.success || (id !== undefined && !z.uuid().safeParse(id).success)) return { ...unreadable, findings: [] };
  const result = id === undefined ? await createRedirect(member, parsed.data, { origin: "editor" }) : await updateRedirect(member, id, parsed.data);
  if (!result.ok) return { ok: false, problems: result.problems, findings: result.findings };
  refresh();
  return { ok: true, source: result.source, target: result.target, created: result.created, unchanged: result.unchanged, replacedAutomatic: result.replacedAutomatic, findings: result.findings };
}

/** Deletes redirects of any kind (the automatic ones too), at most 200 in one request; one entry in the activity log. */
export async function deleteRedirectsAction(storeSlug: string, ids: unknown): Promise<DeleteResult> {
  const member = await checkPermission(storeSlug, "website:write");
  if (!member) return { ok: false, problems: [NO_ACCESS] };
  const parsed = idList.safeParse(ids);
  if (!parsed.success) return { ok: false, problems: [`Choose at most ${REDIRECT_BULK_DELETE_MAX} redirects at a time.`] };
  const result = await deleteRedirects(member, parsed.data);
  if (!result.ok) return { ok: false, problems: result.problems };
  refresh();
  return { ok: true, deleted: result.deleted };
}
