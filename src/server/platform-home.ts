import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { col, typedRow, typedRows } from "./typed-rows";

/**
 * What Kaizena Flow's own Home draws beyond the briefing's snapshot (admin redesign round 1, step 3): recurring revenue month by month, the
 * people waiting for a store, and how owners move from asking to paying. Counted from the platform's rows in Stripe's live mode.
 */

const OSLO = "Europe/Oslo";

const MOVE_ROW = z.object({ month: col.text, moved: col.minor });

/**
 * Recurring revenue at the end of each of the last `months` months, the current month last and equal to `currentMinor`: worked back from the
 * plan moves (`commerce.plan_moves`, live mode), each month's end being the current figure less what moved after it.
 */
export async function mrrByMonth(currency: string, currentMinor: number, months = 6, now = new Date()): Promise<{ month: string; minor: number }[]> {
  const rows = await typedRows(MOVE_ROW, sql`
    select to_char(date_trunc('month', at at time zone ${OSLO}), 'YYYY-MM') as month, coalesce(sum(mrr_after_minor - mrr_before_minor), 0)::bigint as moved
    from commerce.plan_moves
    where mode = 'live' and currency = ${currency} and at >= date_trunc('month', ${now.toISOString()}::timestamptz at time zone ${OSLO}) - make_interval(months => ${months})
    group by 1
  `);
  const moved = new Map(rows.map((r) => [r.month, r.moved]));
  const monthAt = (back: number) => {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 15));
    return d.toISOString().slice(0, 7);
  };
  const out: { month: string; minor: number }[] = [];
  let level = currentMinor;
  for (let back = 0; back < months; back++) {
    const month = monthAt(back);
    out.unshift({ month, minor: Math.max(0, level) });
    // The month before ended at this month's level less what moved during this month.
    level -= moved.get(month) ?? 0;
  }
  return out;
}

const REQUEST_ROW = z.object({ id: col.uuid, name: col.text, store_name: col.text, created_at: col.timestamp });

/** The people waiting for an answer to their request for a store, the oldest first. */
export async function waitingRequests(limit = 4): Promise<{ id: string; name: string; storeName: string; createdAt: string }[]> {
  const rows = await typedRows(REQUEST_ROW, sql`
    select id, name, store_name, created_at from commerce.access_requests where status = 'pending' order by created_at limit ${limit}
  `);
  return rows.map((r) => ({ id: r.id, name: r.name, storeName: r.store_name, createdAt: r.created_at }));
}

const FUNNEL_ROW = z.object({ asked: col.int, opened: col.int, set_up: col.int, paying: col.int });

export type SignUpFunnel = { asked: number; opened: number; setUp: number; paying: number };

/** Of the people who asked for a store in the last `months` months: how many have one, finished setting it up, and pay for a plan. */
export async function signUpFunnel(months = 6, now = new Date()): Promise<SignUpFunnel> {
  const row = await typedRow(FUNNEL_ROW, sql`
    select count(*)::int as asked,
           count(s.id)::int as opened,
           count(s.id) filter (where s.setup_completed_at is not null)::int as set_up,
           count(s.id) filter (where b.mode::text = 'live' and b.status in ('active', 'past_due'))::int as paying
    from commerce.access_requests r
    left join commerce.stores s on s.id = r.store_id
    left join commerce.store_billing b on b.store_id = s.id
    where r.created_at >= ${now.toISOString()}::timestamptz - make_interval(months => ${months})
  `);
  return { asked: row?.asked ?? 0, opened: row?.opened ?? 0, setUp: row?.set_up ?? 0, paying: row?.paying ?? 0 };
}
