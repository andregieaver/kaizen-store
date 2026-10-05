import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { isDialect, type Cell, type DialectId } from "@/lib/csv";
import { customerColumns, customerRows, onePerEmail, type CustomerRecord } from "@/lib/customer-csv";

import type { ExportReader } from "./data-export-run";
import { customerCsvFields, customerFieldTexts } from "./field-entities";
import type { Store } from "./stores";

type Row = Record<string, unknown>;

/**
 * The customer export (D165, `docs/wave-2-data.md` 2.4, 2.5, 4.3): one row per customer as the Customers page lists them (`listCustomers()`):
 * everyone with an account and every guest with a paid order, one per email (case-insensitive), the keyset being the lowered email. The store id is
 * on every statement. An order that was copied from another store is history and makes nobody a customer; an erased person's order
 * (`restricted_at`, `anonymised_at`, D162) belongs to nobody and makes nobody one either. The query selects no password hash, auth id, session,
 * sign-in code, avatar path, referral code or token, so the file cannot carry one. The custom fields staff entered about customers are read for the
 * whole batch in ONE query (`customerFieldTexts()`).
 */

export type CustomerExportOptions = { dialect: DialectId };

const schema = z.object({ dialect: z.string().default("excel_nordic") });

export function parseCustomerExportOptions(raw: unknown): { ok: true; options: CustomerExportOptions } | { ok: false; problem: string } {
  const parsed = schema.safeParse(typeof raw === "object" && raw !== null ? raw : {});
  if (!parsed.success || !isDialect(parsed.data.dialect)) return { ok: false, problem: "Choose a file format." };
  return { ok: true, options: { dialect: parsed.data.dialect } };
}

/** An order that was paid, even if it was cancelled and refunded later; not history copied from another store (the Customers page's own `bought`). */
const BOUGHT = sql`(o.copied_from is null and (o.status in ('paid', 'fulfilled', 'closed')
  or (o.status = 'cancelled' and exists (select 1 from commerce.payments p where p.store_id = o.store_id and p.order_id = o.id and p.status = 'captured'))))`;

/** The customers of the store, and how many (for the choice of a download or a job and the limit). */
export async function countCustomers(storeId: string): Promise<number> {
  const [row] = await db().execute<Row>(sql`
    select count(*)::int as n from (
      select lower(email) as k from commerce.customers where store_id = ${storeId}::uuid
      union
      select lower(coalesce(c.email, o.email)) from commerce.orders o
        left join commerce.customers c on c.store_id = o.store_id and c.id = o.customer_id
       where o.store_id = ${storeId}::uuid and (o.email <> '' or c.id is not null) and ${BOUGHT} and o.restricted_at is null and o.anonymised_at is null
    ) t
  `);
  return Number(row?.n ?? 0);
}

const iso = (v: unknown): string | null => (v === null || v === undefined ? null : new Date(String(v)).toISOString());
const text = (v: unknown): string | null => (v === null || v === undefined || String(v) === "" ? null : String(v));

/** The customers after a lowered email, in email order. */
async function readCustomers(store: Store, after: string | null, limit: number): Promise<{ customers: CustomerRecord[]; position: string | null; more: boolean }> {
  const rows = await db().execute<Row>(sql`
    with bought as (
      select lower(coalesce(c.email, o.email)) as k, coalesce(c.email, o.email) as email, o.id, o.placed_at, o.shipping_address
      from commerce.orders o
      left join commerce.customers c on c.store_id = o.store_id and c.id = o.customer_id
      where o.store_id = ${store.id}::uuid and (o.email <> '' or c.id is not null) and ${BOUGHT} and o.restricted_at is null and o.anonymised_at is null
    ),
    by_email as (
      select k, count(*)::int as orders, max(placed_at) as last_order,
        (array_agg(email order by placed_at desc))[1] as email,
        (array_agg(shipping_address order by placed_at desc))[1] as ship
      from bought group by k
    ),
    accounts as (
      select c.id, c.store_id, c.email, c.name, c.phone, c.locale, c.created_at, c.address, c.email_verified_at, c.company_name, c.organisation_number,
        c.tier_id, c.company_id, c.company_role, c.copied_from, lower(c.email) as k
      from commerce.customers c where c.store_id = ${store.id}::uuid
    ),
    keys as (
      select coalesce(a.k, b.k) as k
      from accounts a full join by_email b on b.k = a.k
      ${after === null ? sql`` : sql`where coalesce(a.k, b.k) > ${after}`}
      order by 1 limit ${limit + 1}
    )
    select keys.k, a.id as customer_id, coalesce(a.email, b.email) as email, a.name, a.phone, a.locale, a.created_at, a.address,
      a.email_verified_at is not null as verified, a.company_name, a.organisation_number, a.company_role,
      coalesce(t.name, ct.name) as customer_group, cc.name as company, a.copied_from is not null as copied,
      coalesce(b.orders, 0) as orders, b.last_order, b.ship,
      exists (select 1 from commerce.email_opt_outs oo where oo.store_id = ${store.id}::uuid and lower(oo.email) = keys.k) as opted_out
    from keys
    left join accounts a on a.k = keys.k
    left join by_email b on b.k = keys.k
    left join commerce.customer_tiers t on t.store_id = a.store_id and t.id = a.tier_id
    left join commerce.customer_companies cc on cc.store_id = a.store_id and cc.id = a.company_id
    left join commerce.customer_tiers ct on ct.store_id = cc.store_id and ct.id = cc.tier_id
    order by keys.k
  `);
  const page = rows.slice(0, limit);
  const defs = await customerCsvFields(store.id);
  const ids = page.flatMap((r) => (r.customer_id ? [String(r.customer_id)] : []));
  const fieldTexts = defs.length > 0 ? await customerFieldTexts(store, defs, ids) : new Map<string, Record<string, string>>();
  const customers: CustomerRecord[] = page.map((r) => {
    const own = (typeof r.address === "object" && r.address !== null ? r.address : {}) as Record<string, unknown>;
    const ship = (typeof r.ship === "object" && r.ship !== null ? r.ship : {}) as Record<string, unknown>;
    // The account's own address, else the latest paid order's shipping address.
    const hasOwn = ["line1", "postalCode", "city"].some((k) => text(own[k]) !== null);
    const a = hasOwn ? own : ship;
    const id = r.customer_id ? String(r.customer_id) : null;
    return {
      id,
      email: String(r.email),
      name: text(r.name) ?? text(ship.name),
      phone: text(r.phone) ?? text(ship.phone),
      account: id ? (r.verified === true ? "verified" : "unverified") : "none",
      locale: text(r.locale),
      createdAt: iso(r.created_at),
      lastOrderAt: iso(r.last_order),
      ordersPaid: Number(r.orders ?? 0),
      address: { line1: text(a.line1), line2: text(a.line2), postalCode: text(a.postalCode), city: text(a.city), country: text(a.country) },
      companyName: text(r.company_name),
      organisationNumber: text(r.organisation_number),
      customerGroup: text(r.customer_group),
      company: text(r.company),
      companyRole: text(r.company_role),
      emailOptOut: r.opted_out === true,
      copied: r.copied === true,
      ...(id && fieldTexts.has(id) ? { fields: fieldTexts.get(id) } : {}),
    };
  });
  const last = page.at(-1);
  return { customers: onePerEmail(customers), position: last ? String(last.k) : after, more: rows.length > limit };
}

/** The reader of a customer export. */
export async function customerExportReader(store: Store, o: CustomerExportOptions): Promise<ExportReader> {
  const defs = await customerCsvFields(store.id);
  return {
    header: customerColumns(defs),
    dialect: o.dialect,
    fileBase: "customers",
    total: () => countCustomers(store.id),
    async read(position, limit) {
      const read = await readCustomers(store, typeof position === "string" ? position : null, Math.max(1, limit));
      const rows: Cell[][] = customerRows(read.customers, defs);
      return { rows, position: read.position, more: read.more, units: read.customers.length };
    },
  };
}
