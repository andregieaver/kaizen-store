import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import type { PrivacyFigures } from "@/lib/control-center";
import { reminderDue } from "@/lib/privacy-request";

type Row = Record<string, unknown>;

/**
 * What waits in the privacy requests log for each of several stores (D162, wave 1g), for the control center and a store's Home: one query
 * for them all, counts only (never a person's email or name). Which request is overdue or due this week is `reminderDue()`, the same
 * rule the daily reminder uses, so the three places agree. A store with nothing to flag is not in the map.
 */
export async function privacyAttention(storeIds: string[], now: Date = new Date()): Promise<Map<string, PrivacyFigures>> {
  if (storeIds.length === 0) return new Map();
  const ids = sql.join(storeIds.map((id) => sql`${id}::uuid`), sql`, `);
  const rows = await db().execute<Row>(sql`
    select store_id, status, received_at, due_at, extended_until
    from commerce.privacy_requests
    where store_id in (${ids}) and status = 'open'
  `);
  const found = new Map<string, PrivacyFigures>();
  for (const r of rows) {
    const flag = reminderDue(
      { status: "open", receivedAt: new Date(String(r.received_at)), dueAt: new Date(String(r.due_at)), extendedUntil: r.extended_until ? new Date(String(r.extended_until)) : null },
      now,
    );
    if (!flag) continue;
    const figures = found.get(String(r.store_id)) ?? { overdue: 0, dueSoon: 0 };
    if (flag === "overdue") figures.overdue += 1;
    else figures.dueSoon += 1;
    found.set(String(r.store_id), figures);
  }
  return found;
}
