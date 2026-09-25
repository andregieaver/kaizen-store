import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { ON_PLAN_STATUSES } from "@/lib/plans";

type Row = Record<string, unknown>;

/**
 * Kaizen's own customers for platform admins (D35): the people who run
 * stores. Each has their stores with their role, and each store its plan
 * (the platform's subscription) and its invoices (the platform's orders),
 * all linked both ways.
 */

const onPlan = sql.raw(ON_PLAN_STATUSES.map((s) => `'${s}'`).join(", "));

export type PlatformCustomerStore = {
  slug: string;
  name: string;
  role: string;
  planName: string | null;
  status: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  mode: string | null;
};

export type PlatformCustomerRow = {
  id: string;
  email: string;
  name: string;
  createdAt: string;
  disabled: boolean;
  stores: PlatformCustomerStore[];
  onPlan: number;
};

const storesJson = sql`coalesce(json_agg(json_build_object(
    'slug', s.slug, 'name', s.name, 'role', m.role, 'planName', p.name, 'status', b.status,
    'currentPeriodEnd', b.current_period_end, 'cancelAtPeriodEnd', coalesce(b.cancel_at_period_end, false), 'mode', b.mode
  ) order by lower(s.name)) filter (where s.id is not null), '[]')`;

function toRow(row: Row): PlatformCustomerRow {
  const stores = (row.stores ?? []) as PlatformCustomerStore[];
  return {
    id: String(row.id),
    email: String(row.email),
    name: String(row.name ?? ""),
    createdAt: new Date(String(row.created_at)).toISOString(),
    disabled: row.disabled_at !== null && row.disabled_at !== undefined,
    stores,
    onPlan: Number(row.on_plan ?? 0),
  };
}

/** Everyone who works in a store, newest first; optionally matching a search by name, email or store. */
export async function listPlatformCustomers({ q = "", limit = 100 }: { q?: string; limit?: number } = {}): Promise<PlatformCustomerRow[]> {
  const search = q.trim().toLowerCase().slice(0, 100);
  const like = `%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const rows = await db().execute<Row>(sql`
    select a.id, a.email, a.name, a.created_at, a.disabled_at, ${storesJson} as stores,
      count(*) filter (where b.status in (${onPlan}))::int as on_plan
    from commerce.accounts a
    join commerce.store_members m on m.account_id = a.id and m.disabled_at is null
    join commerce.stores s on s.id = m.store_id and s.status <> 'closed' and not s.is_template
    left join commerce.store_billing b on b.store_id = s.id
    left join commerce.plans p on p.id = b.plan_id
    group by a.id
    having ${search ? sql`lower(a.email) like ${like} or lower(coalesce(a.name, '')) like ${like}
      or bool_or(lower(s.name) like ${like} or s.slug like ${like})` : sql`true`}
    order by a.created_at desc
    limit ${limit}
  `);
  return rows.map(toRow);
}

export type PlatformCustomer = PlatformCustomerRow & {
  platformAdmin: boolean;
  planRemindersOptedOut: boolean;
  /** Plans they went to pay for and did not finish (D33), latest per store. */
  unpaidPlans: { storeSlug: string; storeName: string; planName: string; capturedAt: string; remindersSent: number; recovered: boolean }[];
};

export async function getPlatformCustomer(accountId: string): Promise<PlatformCustomer | null> {
  const [row] = await db().execute<Row>(sql`
    select a.id, a.email, a.name, a.created_at, a.disabled_at, a.platform_admin,
      a.plan_reminders_opted_out_at is not null as opted_out, ${storesJson} as stores,
      count(*) filter (where b.status in (${onPlan}))::int as on_plan
    from commerce.accounts a
    left join commerce.store_members m on m.account_id = a.id and m.disabled_at is null
    left join commerce.stores s on s.id = m.store_id and s.status <> 'closed' and not s.is_template
    left join commerce.store_billing b on b.store_id = s.id
    left join commerce.plans p on p.id = b.plan_id
    where a.id = ${accountId}::uuid
    group by a.id
  `);
  if (!row) return null;
  const unpaid = await db().execute<Row>(sql`
    select s.slug, s.name, c.plan_name, c.captured_at, c.reminders_sent, c.recovered_at is not null as recovered
    from commerce.abandoned_plan_checkouts c join commerce.stores s on s.id = c.store_id
    where c.account_id = ${accountId}::uuid order by c.captured_at desc limit 10
  `);
  return {
    ...toRow(row),
    platformAdmin: Boolean(row.platform_admin),
    planRemindersOptedOut: Boolean(row.opted_out),
    unpaidPlans: unpaid.map((u) => ({
      storeSlug: String(u.slug),
      storeName: String(u.name),
      planName: String(u.plan_name),
      capturedAt: new Date(String(u.captured_at)).toISOString(),
      remindersSent: Number(u.reminders_sent),
      recovered: Boolean(u.recovered),
    })),
  };
}

export type StorePerson = { id: string; email: string; name: string; role: string };

/** The people who run a store, owners first: who the platform's subscription and invoices belong to. */
export async function listStorePeople(storeId: string): Promise<StorePerson[]> {
  const rows = await db().execute<Row>(sql`
    select a.id, a.email, a.name, m.role from commerce.store_members m
    join commerce.accounts a on a.id = m.account_id
    where m.store_id = ${storeId}::uuid and m.disabled_at is null
    order by m.role = 'owner' desc, lower(a.email)
  `);
  return rows.map((row) => ({ id: String(row.id), email: String(row.email), name: String(row.name ?? ""), role: String(row.role) }));
}
