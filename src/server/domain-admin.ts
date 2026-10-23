import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";

import { audit, type Account } from "./auth";

type Row = Record<string, unknown>;

/**
 * The platform's view of domains (D315, `/admin/platform/domains`): which stores may buy before buying opens to all (decision 9), every
 * registration, and purchases that need a look. Platform admins only (the page and its actions check).
 */

export async function domainsOpenToAll(): Promise<boolean> {
  const [row] = await db().execute<Row>(sql`select domains_open from commerce.platform_settings limit 1`);
  return row?.domains_open === true;
}

export async function setDomainsOpenToAll(account: Account, open: boolean): Promise<void> {
  await db().execute(sql`update commerce.platform_settings set domains_open = ${open}`);
  await audit(account.id, null, "platform.domains_open_set", { open });
}

export async function storesBuyingDomains(): Promise<{ id: string; slug: string; name: string }[]> {
  const rows = await db().execute<Row>(sql`select id, slug, name from commerce.stores where domain_buying order by name`);
  return rows.map((r) => ({ id: String(r.id), slug: String(r.slug), name: String(r.name) }));
}

/** Opens or closes buying for one store by its address; a template or a store template never buys. */
export async function setStoreDomainBuying(account: Account, slug: string, open: boolean): Promise<{ ok: true } | { ok: false; problems: string[] }> {
  const rows = await db().execute<Row>(sql`
    update commerce.stores set domain_buying = ${open}
     where slug = ${slug.trim().toLowerCase()} and not (is_template or starter)
    returning id
  `);
  if (rows.length === 0) return { ok: false, problems: [`There is no store at ${slug}.`] };
  await audit(account.id, String(rows[0].id), "platform.domain_buying_set", { open });
  return { ok: true };
}

export type AdminRegistration = { store: string; slug: string; apex: string; status: string; expiresAt: string | null; renew: boolean };

export async function allRegistrations(limit = 200): Promise<AdminRegistration[]> {
  const rows = await db().execute<Row>(sql`
    select s.name, s.slug, r.apex, r.status, r.expires_at, r.renew from commerce.domain_registrations r join commerce.stores s on s.id = r.store_id
     order by r.expires_at nulls last limit ${limit}
  `);
  return rows.map((r) => ({
    store: String(r.name),
    slug: String(r.slug),
    apex: String(r.apex),
    status: String(r.status),
    expiresAt: r.expires_at ? new Date(String(r.expires_at)).toISOString() : null,
    renew: r.renew === true,
  }));
}

export type AdminPurchase = { store: string; apex: string; kind: string; status: string; problem: string | null; tries: number; createdAt: string };

/** Purchases that failed, wait with a problem, or wait for payment longer than a week. */
export async function purchasesNeedingALook(limit = 50): Promise<AdminPurchase[]> {
  const rows = await db().execute<Row>(sql`
    select s.name, p.apex, p.kind, p.status, p.problem, p.tries, p.created_at from commerce.domain_purchases p join commerce.stores s on s.id = p.store_id
     where p.status = 'failed' or (p.problem is not null and p.status in ('quoted', 'paid', 'registering'))
        or (p.status = 'invoiced' and p.invoiced_at < now() - interval '7 days')
     order by p.created_at desc limit ${limit}
  `);
  return rows.map((r) => ({
    store: String(r.name),
    apex: String(r.apex),
    kind: String(r.kind),
    status: String(r.status),
    problem: r.problem ? String(r.problem) : null,
    tries: Number(r.tries),
    createdAt: new Date(String(r.created_at)).toISOString(),
  }));
}
