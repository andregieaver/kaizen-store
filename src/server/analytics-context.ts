import "server-only";

import { parseAnalyticsParams, type AnalyticsParams } from "@/lib/analytics-period";
import { requireMember } from "./auth";
import { getAnalyticsSettings, type StoredAnalyticsSettings } from "./analytics-settings";

/**
 * What every analytics page starts with (D152): the member (a stranger gets a 404, every page checks for itself), the
 * period and comparison the address asks for, in the store's time zone, and the cost settings.
 */
export type AnalyticsContext = Awaited<ReturnType<typeof requireMember>> & {
  base: string;
  now: Date;
  params: AnalyticsParams;
  settings: StoredAnalyticsSettings;
};

export async function analyticsContext(storeSlug: string, searchParams: Record<string, string | string[] | undefined>): Promise<AnalyticsContext> {
  const member = await requireMember(storeSlug);
  const now = new Date();
  const [settings] = await Promise.all([getAnalyticsSettings(member.store.id)]);
  return {
    ...member,
    base: `/admin/${member.store.slug}`,
    now,
    params: parseAnalyticsParams(searchParams, { now, timeZone: member.store.timeZone }),
    settings,
  };
}
