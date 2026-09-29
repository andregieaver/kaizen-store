import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { totalOf } from "@/lib/ai-usage";

import { usageRows } from "./ai-usage";
import { listPlans } from "./billing";

type Row = Record<string, unknown>;

/** What the platform overview (D107) shows the operator: counted in code from Kaizen's own data. */
export type PlatformOverview = {
  requests: { waiting: number; oldest: string | null };
  stores: { total: number; suspended: number; notOpen: number; newThisWeek: number; paying: number; overdue: number; withoutPlan: number };
  plans: { total: number };
  emails: { failed: number; sent: number };
  ai: { requests: number; failed: number };
};

export async function platformOverview(): Promise<PlatformOverview> {
  const [[requests], [stores], [emails], plans, usage] = await Promise.all([
    db().execute<Row>(sql`
      select count(*)::int as waiting, min(created_at) as oldest
      from commerce.access_requests where status = 'pending'
    `),
    db().execute<Row>(sql`
      select count(*)::int as total,
        count(*) filter (where s.status = 'suspended')::int as suspended,
        count(*) filter (where s.setup_completed_at is null)::int as not_open,
        count(*) filter (where s.created_at >= now() - interval '7 days')::int as new_this_week,
        count(*) filter (where b.status in ('active', 'trialing'))::int as paying,
        count(*) filter (where b.status in ('past_due', 'unpaid'))::int as overdue,
        count(*) filter (where b.status is null or b.status in ('canceled', 'incomplete', 'incomplete_expired'))::int as without_plan
      from commerce.stores s
      left join commerce.store_billing b on b.store_id = s.id
      where s.status <> 'closed' and not s.is_template
    `),
    db().execute<Row>(sql`
      select count(*) filter (where status in ('failed', 'bounced', 'complained'))::int as failed,
             count(*) filter (where status in ('sent', 'delivered'))::int as sent
      from commerce.email_messages where created_at >= now() - interval '7 days'
    `),
    listPlans(),
    usageRows({ days: 7 }),
  ]);
  const ai = totalOf(usage);
  return {
    requests: { waiting: Number(requests?.waiting ?? 0), oldest: requests?.oldest ? new Date(String(requests.oldest)).toISOString() : null },
    stores: {
      total: Number(stores?.total ?? 0),
      suspended: Number(stores?.suspended ?? 0),
      notOpen: Number(stores?.not_open ?? 0),
      newThisWeek: Number(stores?.new_this_week ?? 0),
      paying: Number(stores?.paying ?? 0),
      overdue: Number(stores?.overdue ?? 0),
      withoutPlan: Number(stores?.without_plan ?? 0),
    },
    plans: { total: plans.length },
    emails: { failed: Number(emails?.failed ?? 0), sent: Number(emails?.sent ?? 0) },
    ai: { requests: ai.requests, failed: ai.failed },
  };
}
