import "server-only";

import { parseAnalyticsParams, type AnalyticsParams } from "@/lib/analytics-period";
import type { PermissionKey } from "@/lib/permissions";

import type { Membership } from "./auth";
import { memberCan, requirePermission } from "./permissions";
import { getAnalyticsSettings, type StoredAnalyticsSettings } from "./analytics-settings";

/**
 * What every analytics page starts with (D152): the member (a stranger gets a 404, every page checks for itself), the
 * period and comparison the address asks for, in the store's time zone, and the cost settings.
 */
export type AnalyticsContext = Membership & {
  /** Whether the member holds the owner role: the pages show what only an owner can change (costs, targets) to them alone. */
  owner: boolean;
  /** Whether the member holds `analytics:write`: only they may download a table as CSV (an export is logged). */
  canExport: boolean;
  base: string;
  now: Date;
  params: AnalyticsParams;
  settings: StoredAnalyticsSettings;
};

/** A guard (wave 1, 1f): the pages of the cockpit need `analytics:read`; the settings page passes `owner`. */
export async function analyticsContext(
  storeSlug: string,
  searchParams: Record<string, string | string[] | undefined>,
  key: PermissionKey = "analytics:read",
): Promise<AnalyticsContext> {
  return analyticsContextFor(await requirePermission(storeSlug, key), searchParams);
}

/** The same for a member a route has already checked (the export route answers a 404 itself instead of throwing one). */
export async function analyticsContextFor(
  member: Membership,
  searchParams: Record<string, string | string[] | undefined>,
  now: Date = new Date(),
): Promise<AnalyticsContext> {
  const [settings] = await Promise.all([getAnalyticsSettings(member.store.id)]);
  return {
    ...member,
    owner: memberCan(member, "owner"),
    canExport: memberCan(member, "analytics:write"),
    base: `/admin/${member.store.slug}`,
    now,
    params: parseAnalyticsParams(searchParams, { now, timeZone: member.store.timeZone }),
    settings,
  };
}
