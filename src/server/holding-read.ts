import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { apexOf } from "@/lib/domain-health";
import { holdingAnswer, type HoldingAnswer } from "@/lib/holding";

import { forgetRemembered, remembered } from "./short-memory";

type Row = Record<string, unknown>;

/**
 * Held domains answering while no store uses them (D317 8): read by the proxy for a host that is no one else's, at most once a host and
 * instance every 30 seconds, so a change shows within a minute and with no deployment. A zone a store uses is the store's, never held here.
 */
const MEMO_MS = 30_000;

export async function holdingFor(host: string): Promise<HoldingAnswer> {
  const apex = apexOf(host.toLowerCase().split(":")[0].replace(/\.$/, ""));
  return remembered(
    "holding:" + apex,
    async () => {
      const [row] = await db().execute<Row>(sql`
        select z.apex, z.holding, z.holding_redirect, g.country from commerce.dns_zones z
          left join commerce.domain_registrations r on r.apex = z.apex and r.status <> 'transferred_out'
          left join commerce.domain_registrants g on g.id = r.registrant_id
         where z.apex = ${apex} and z.status = 'active' and z.store_id is null and z.arrived_at is not null
         limit 1
      `);
      return holdingAnswer(row ? { apex: String(row.apex), holding: String(row.holding), redirect: row.holding_redirect ? String(row.holding_redirect) : null, country: row.country ? String(row.country) : null } : null);
    },
    MEMO_MS,
  );
}

/** Forgets this instance's answer for a held domain, after its holder changes it (other instances within `MEMO_MS`). */
export function forgetHolding(apex: string): void {
  forgetRemembered("holding:" + apex);
}
