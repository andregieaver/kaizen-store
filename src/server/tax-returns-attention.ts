import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { zonedDate } from "@/lib/booking-slots";
import { buildReturn } from "@/lib/oss-return";
import { candidatePeriods, exportKey, returnsDue, schemesOf, type DueProfile, type ReturnDue } from "@/lib/tax-returns-due";

import { documentGroups, sellerFacts } from "./tax-reports";
import { returnExportKeys } from "./tax-report-exports";

type Row = Record<string, unknown>;

/**
 * The OSS and IOSS returns whose data an owner has not yet exported, for the control center and a store's Home (D161,
 * `docs/wave-1c-reports.md` 2.2, "What needs you"). Of several stores at once: one query for their profiles and their days, one for the
 * exports logged, and a read of the period's documents only for a store that is registered, has a return near or past its deadline and has no
 * export for it. A store with nothing to say is not in the map. The caller passes only stores whose owner is asking.
 *
 * It never says a return is late: Kaizen does not know what was filed, or by whom. A period with nothing to report has nothing to export,
 * so it is left out (the documents of the period are classed exactly as the return would class them).
 */
export async function taxReturnsAttention(storeIds: readonly string[], now: Date = new Date()): Promise<Map<string, ReturnDue[]>> {
  const found = new Map<string, ReturnDue[]>();
  if (storeIds.length === 0) return found;
  const ids = sql.join(storeIds.map((id) => sql`${id}::uuid`), sql`, `);
  const rows = await db().execute<Row>(sql`
    select s.id, s.time_zone, t.oss_scheme, t.oss_registered_on::text as oss_registered_on, t.ioss_number, t.ioss_intermediary, t.ioss_registered_on::text as ioss_registered_on
    from commerce.stores s
    join commerce.store_tax_profile t on t.store_id = s.id
    where s.id in (${ids}) and (t.oss_scheme in ('union', 'non_union') or (t.ioss_number is not null and t.ioss_intermediary is null))
  `);
  if (rows.length === 0) return found;

  const stores = rows.map((r) => ({
    id: String(r.id),
    today: zonedDate(now.getTime(), String(r.time_zone ?? "Europe/Oslo")),
    profile: {
      ossScheme: r.oss_scheme === "union" || r.oss_scheme === "non_union" ? r.oss_scheme : "none",
      ossRegisteredOn: r.oss_registered_on ? String(r.oss_registered_on) : null,
      iossNumber: r.ioss_number ? String(r.ioss_number) : null,
      iossIntermediary: r.ioss_intermediary ? String(r.ioss_intermediary) : null,
      iossRegisteredOn: r.ioss_registered_on ? String(r.ioss_registered_on) : null,
    } satisfies DueProfile,
  }));
  const exported = await returnExportKeys(stores.map((s) => s.id));

  await Promise.all(
    stores.map(async (store) => {
      const done = exported.get(store.id) ?? new Set<string>();
      // Cheap first: the periods that are due and not exported. Only then are documents read, to see whether there was anything to report.
      const due = returnsDue(store.profile, done, store.today);
      if (due.length === 0) return;
      const facts = await sellerFacts(store.id);
      const withSales = new Set<string>();
      for (const scheme of schemesOf(store.profile)) {
        for (const period of candidatePeriods(scheme, store.today)) {
          if (!due.some((d) => d.scheme === scheme && d.period.key === period.key)) continue;
          const groups = await documentGroups(store.id, period);
          const data = buildReturn({ scheme, period, mode: "filing", groups, registration: facts.registration, rateFor: () => null });
          if (data.groups.length > 0) withSales.add(exportKey(scheme, period));
        }
      }
      const items = returnsDue(store.profile, done, store.today, withSales);
      if (items.length > 0) found.set(store.id, items);
    }),
  );
  return found;
}
