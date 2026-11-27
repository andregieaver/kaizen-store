import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { STORE_INCIDENT_DAYS } from "@/lib/incidents";
import { incidentArea, incidentState, type StoreIncidentArea, type StoreIncidentState } from "@/lib/store-incidents";

import { col, typedRows } from "./typed-rows";

/**
 * The problems Kaizena Flow saw on a store in the last 14 days (D895 IA-18), for its owner's home: from `platform_incident_stores`, which
 * the log drain fills; dismissed and won't-fix entries left out; at most five, the latest first. Only where and where it stands: no
 * message, fingerprint or note leaves the platform's log.
 */
export type StoreIncident = { area: StoreIncidentArea; state: StoreIncidentState; firstSeenAt: string; fixedAt: string | null; occurrences: number };

const ROW = z.object({
  route: col.textOrNull,
  status: col.text,
  first_seen_at: col.timestamp,
  fixed_at: col.timestampOrNull,
  occurrences: col.int,
});

export async function storeIncidents(storeId: string, now: Date = new Date()): Promise<StoreIncident[]> {
  const rows = await typedRows(
    ROW,
    sql`select i.facts->>'route' as route, i.status, l.first_seen_at, coalesce(i.done_at, i.fixed_at) as fixed_at, l.occurrences
        from commerce.platform_incident_stores l join commerce.platform_incidents i on i.id = l.incident_id
        where l.store_id = ${storeId}::uuid and i.status not in ('dismissed', 'wont_fix')
          and l.last_seen_at > ${now.toISOString()}::timestamptz - make_interval(days => ${STORE_INCIDENT_DAYS})
        order by l.last_seen_at desc limit 5`,
  );
  return rows.map((r) => ({ area: incidentArea(r.route), state: incidentState(r.status), firstSeenAt: r.first_seen_at, fixedAt: r.fixed_at, occurrences: r.occurrences }));
}
