import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import type { DrainError } from "@/lib/drain-errors";

import { logIncident } from "./incidents";
import { log } from "./log";
import { textList } from "./sql-arrays";

/** Finds the store a request was for, as the usage counting does (`storeResolver()`): its id, null for Kaizena Flow's own, undefined for none. */
export type StoreOf = (host: string, path: string) => string | null | undefined;

/**
 * Runtime errors from the log drain into the incident log (D895 IA-17): one entry per fingerprint, as the autopilot's runbook pulls them by
 * hand, so the two meet one row; a repeat only counts (`logIncident()`), and a new or returning one wakes the autopilot. Each entry is linked
 * to the stores it was seen on (IA-18, `platform_incident_stores`), so their owners see it. Never throws: the drain's usage counting must not
 * fail for this.
 */
export async function logDrainErrors(errors: readonly DrainError[], storeOf: StoreOf = () => undefined): Promise<number> {
  let logged = 0;
  for (const e of errors) {
    try {
      const row = await logIncident({
        kind: e.kind,
        source: "runtime",
        fingerprint: e.fingerprint,
        title: e.title,
        facts: { route: e.route, name: e.name, message: e.message, count: e.count, ...(e.deployment ? { deployment: e.deployment } : {}) },
      });
      if (!row) continue;
      logged += 1;
      const stores = [...new Set(e.places.map((p) => storeOf(p.host, p.path)).filter((id): id is string => typeof id === "string"))];
      if (stores.length > 0) await linkStores(row.id, stores);
    } catch (error) {
      // A warning, not an error: the drain would bring an error line back here.
      log("warn", "drain.incident_failed", {}, error);
    }
  }
  return logged;
}

/** Links an incident to stores it was seen on: a new link, or one more sighting of a known one. One statement, so no transaction. */
async function linkStores(incidentId: string, storeIds: readonly string[]): Promise<void> {
  await db().execute(sql`
    insert into commerce.platform_incident_stores as l (incident_id, store_id)
    select ${incidentId}::uuid, s::uuid from unnest(${textList([...storeIds].sort())}) as s
    on conflict (incident_id, store_id) do update set occurrences = l.occurrences + 1, last_seen_at = now()
  `);
}
