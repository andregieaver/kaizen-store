import "server-only";

import { siteUrl } from "@/lib/site";
import { kaizenLifeDoor, workSummaryOf, type WorkSummary } from "@/lib/work-summary";

import type { Account } from "./auth";
import { getOwnerOverview, workStoresFor } from "./work-owner";
import { getRunningTimer } from "./work-time";

/**
 * The person's Work across their stores, for Kaizen Life (docs/life-work-summary.md 3.1): the stores they may read Work in
 * (`settings:read`, as Work's screens), their combined overview and their own running timer, read in about five queries and shaped
 * by `workSummaryOf()`. Read only; every link goes through the handoff door (`/admin/sign-in/kaizen-life`). Served to Kaizen Life for a
 * linked account (`/api/kaizen-life/v1/work-summary`) and to outside assistants as the MCP tool `work_summary`, over their stores only.
 */
export async function getWorkSummary(
  account: Pick<Account, "id">,
  options: { now?: Date; onlyStores?: ReadonlySet<string> } = {},
): Promise<WorkSummary> {
  const now = options.now ?? new Date();
  const all = await workStoresFor(account);
  // An outside assistant reaches only its grant's stores (the MCP's `work_summary`): the others are left out, never named.
  const only = options.onlyStores;
  const stores = only ? { using: all.using.filter((s) => only.has(s.slug)), off: all.off.filter((s) => only.has(s.slug)) } : all;
  const [overview, timer] = await Promise.all([getOwnerOverview(stores.using, now.getTime()), getRunningTimer(account.id)]);
  const origin = siteUrl();
  return workSummaryOf({
    stores,
    combined: overview.combined,
    clientNames: overview.clientNames,
    timer,
    now,
    door: (path) => kaizenLifeDoor(origin, path),
  });
}
