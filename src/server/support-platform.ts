import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import type { AnalyticsPeriod } from "@/lib/analytics-period";
import { supportReport, type ReportConversation, type SupportReport } from "@/lib/support-reports";
import type { SupportMode } from "@/lib/support-rules";

import { KAIZEN_TIME_ZONE, REPORT_ROWS_MAX, ROW_COLUMNS, startedIn, toReportConversation } from "./support-reports";

type Row = Record<string, unknown>;

/**
 * The platform's view of the stores' support (D216, 2.8 *Stores*, step 14): counts and rates per store, the same figures as a
 * store's own report. **Never** a store's conversation, message, customer, summary text or request: this module reads only the
 * counted columns (`ROW_COLUMNS`) and the desks' modes, and `support-platform.scan.test.ts` holds it to that.
 */

/** One store's line in the platform's totals: its figures for the period and how many wait now. Counts and rates only. */
export type StoreSupportTotals = { store: { id: string; slug: string; name: string }; mode: SupportMode; waiting: number; report: SupportReport };

/**
 * The platform's per-store totals (2.8, *Stores*): every store with a support desk or a conversation in the period, over Europe/Oslo
 * days. Reads only `support_conversations`' counted columns and `support_settings`' mode: never a message, a summary's words, a
 * customer or a request's text.
 */
export async function storeTotals(period: Pick<AnalyticsPeriod, "from" | "to">): Promise<{ stores: StoreSupportTotals[]; cut: boolean }> {
  const [rows, stores] = await Promise.all([
    db().execute<Row>(sql`
      select ${ROW_COLUMNS} from commerce.support_conversations c
      where c.store_id is not null and ${startedIn(period, KAIZEN_TIME_ZONE)}
      order by c.created_at limit ${REPORT_ROWS_MAX + 1}
    `),
    db().execute<Row>(sql`
      select s.id, s.slug, s.name, coalesce(ss.mode, 'off') as mode,
        (select count(*)::int from commerce.support_conversations w where w.store_id = s.id and w.status = 'open' and w.handler = 'queue') as waiting
      from commerce.stores s left join commerce.support_settings ss on ss.store_id = s.id
      where not (s.is_template or s.starter)
        and (ss.store_id is not null or exists (
          select 1 from commerce.support_conversations c where c.store_id = s.id and ${startedIn(period, KAIZEN_TIME_ZONE)}
        ))
      order by lower(s.name)
    `),
  ]);
  const byStore = new Map<string, ReportConversation[]>();
  for (const r of rows.slice(0, REPORT_ROWS_MAX)) {
    const list = byStore.get(String(r.store_id)) ?? [];
    list.push(toReportConversation(r));
    byStore.set(String(r.store_id), list);
  }
  return {
    cut: rows.length > REPORT_ROWS_MAX,
    stores: stores.map((s) => ({
      store: { id: String(s.id), slug: String(s.slug), name: String(s.name) },
      mode: String(s.mode) as SupportMode,
      waiting: Number(s.waiting ?? 0),
      report: supportReport(byStore.get(String(s.id)) ?? []),
    })),
  };
}
