import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";

import { audit, type Account } from "./auth";
export { domainsPublic } from "./domain-purchases";

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
    select coalesce(s.name, a.email) as name, coalesce(s.slug, '') as slug, r.apex, r.status, r.expires_at, r.renew from commerce.domain_registrations r
      left join commerce.stores s on s.id = r.store_id left join commerce.accounts a on a.id = r.account_id
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
    select coalesce(s.name, a.email) as name, p.apex, p.kind, p.status, p.problem, p.tries, p.created_at from commerce.domain_purchases p
      left join commerce.stores s on s.id = p.store_id left join commerce.accounts a on a.id = p.account_id
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

/** Turns selling domains to people without a store on or off (D317 decision 5: a quiet launch once the spikes are answered). */
export async function setDomainsPublic(account: Account, on: boolean): Promise<void> {
  await db().execute(sql`update commerce.platform_settings set domains_public = ${on}`);
  await audit(account.id, null, "platform.domains_public_set", { on });
}

export type ReviewPurchase = { id: string; apex: string; holder: string; review: "name" | "risk"; status: string; buyer: string | null; vatNumber: string | null; createdAt: string };

/** Purchases waiting for a platform admin's yes (D317 10): a name that looks like a bank's or a brand's, or a buyer VIES couldn't confirm. */
export async function purchasesInReview(limit = 50): Promise<ReviewPurchase[]> {
  const rows = await db().execute<Row>(sql`
    select p.id, p.apex, a.email, p.review, p.status, p.buyer, p.vat_number, p.created_at from commerce.domain_purchases p
      left join commerce.accounts a on a.id = p.account_id
     where p.review is not null and p.review_outcome is null and p.status in ('quoted', 'invoiced', 'paid')
     order by (p.status = 'paid') desc, p.created_at limit ${limit}
  `);
  return rows.map((r) => ({
    id: String(r.id),
    apex: String(r.apex),
    holder: String(r.email ?? ""),
    review: r.review === "risk" ? "risk" : "name",
    status: String(r.status),
    buyer: r.buyer ? String(r.buyer) : null,
    vatNumber: r.vat_number ? String(r.vat_number) : null,
    createdAt: new Date(String(r.created_at)).toISOString(),
  }));
}

/**
 * A platform admin's answer: approved, the registration goes ahead once paid; refused, a paid purchase fails and is refunded in full by the
 * registration job, and an unpaid one is voided. Audited with who answered.
 */
export async function decideReview(account: Account, purchaseId: string, approve: boolean): Promise<{ ok: true } | { ok: false; problems: string[] }> {
  const [row] = await db().execute<Row>(sql`
    update commerce.domain_purchases set review_outcome = ${approve ? "approved" : "refused"}, reviewed_by = ${account.id}::uuid, reviewed_at = now(),
      next_try_at = null, updated_at = now()
     where id = ${purchaseId}::uuid and review is not null and review_outcome is null
    returning id, apex, status, store_id
  `);
  if (!row) return { ok: false, problems: ["That purchase isn't waiting for an answer."] };
  if (!approve) {
    const paid = row.status === "paid";
    await db().execute(sql`
      update commerce.domain_purchases set status = ${paid ? "failed" : "void"}, auth_code_box = null,
        problem = ${"Kaizena Flow can't register this name, so the payment is refunded."}, updated_at = now()
       where id = ${purchaseId}::uuid and status = ${String(row.status)}
    `);
  }
  await audit(account.id, row.store_id ? String(row.store_id) : null, "platform.domain_review_decided", { domain: String(row.apex), approve });
  return { ok: true };
}

export type DomainLeads = { accounts: number; domainsAlone: number; requested: number; opened: number; openedIn90: number; startedBefore90: number };

/**
 * The lead channel in figures (D317 9, decision 10): accounts that came for a domain, the domains held with no store using them, how many of
 * those accounts asked for a store and opened one, and of the accounts started at least 90 days ago, how many opened a store within 90 days
 * (the owner's bar). Counted, never estimated.
 */
export async function domainLeads(): Promise<DomainLeads> {
  const [row] = await db().execute<Row>(sql`
    with domain_accounts as (select id, email, created_at from commerce.accounts where origin = 'domain'),
    opened as (
      select a.id, a.created_at, min(m.created_at) as first_store from domain_accounts a
        join commerce.store_members m on m.account_id = a.id and m.role = 'owner'
        join commerce.stores s on s.id = m.store_id and not (s.is_template or s.starter)
       group by a.id, a.created_at
    )
    select (select count(*)::int from domain_accounts) as accounts,
           (select count(*)::int from commerce.domain_registrations r where r.store_id is null and r.status in ('active', 'expired')) as domains_alone,
           (select count(distinct a.id)::int from domain_accounts a join commerce.access_requests q on lower(q.email) = lower(a.email)) as requested,
           (select count(*)::int from opened) as opened,
           (select count(*)::int from opened where first_store <= created_at + interval '90 days' and created_at <= now() - interval '90 days') as opened_in_90,
           (select count(*)::int from domain_accounts where created_at <= now() - interval '90 days') as started_before_90
  `);
  return {
    accounts: Number(row?.accounts ?? 0),
    domainsAlone: Number(row?.domains_alone ?? 0),
    requested: Number(row?.requested ?? 0),
    opened: Number(row?.opened ?? 0),
    openedIn90: Number(row?.opened_in_90 ?? 0),
    startedBefore90: Number(row?.started_before_90 ?? 0),
  };
}
