import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { checkupFindings } from "@/lib/tax-profile";

import { toProfile } from "./tax-profile";

type Row = Record<string, unknown>;

/**
 * What is wrong with each of several stores' tax profiles (D157), for the control center and a store's Home: one query for them all.
 * A store with a profile that has nothing to fix, or none at all (a store that has not said it is registered for anything), is not in the
 * map. The wording is `checkupFindings()`'s, the same the store checkup and the tax screen's readiness use.
 */
export async function taxAttention(storeIds: string[]): Promise<Map<string, string[]>> {
  if (storeIds.length === 0) return new Map();
  const ids = sql.join(storeIds.map((id) => sql`${id}::uuid`), sql`, `);
  const rows = await db().execute<Row>(sql`
    select store_id, vat_registered, vat_number, vat_number_check_id, vat_number_checked_at, vat_number_valid,
           dispatch_country::text as dispatch_country, oss_scheme, oss_member_state::text as oss_member_state, oss_number,
           oss_registered_on::text as oss_registered_on, ioss_number, ioss_intermediary, ioss_markets,
           ioss_registered_on::text as ioss_registered_on
    from commerce.store_tax_profile
    where store_id in (${ids})
  `);
  const found = new Map<string, string[]>();
  for (const row of rows) {
    const messages = checkupFindings(toProfile(row)).map((finding) => finding.message);
    if (messages.length > 0) found.set(String(row.store_id), messages);
  }
  return found;
}
