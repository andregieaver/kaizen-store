import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { limitRefusal } from "@/lib/usage-format";

import { audit, type Account } from "./auth";
import { accountHolder } from "./domain-holder";
import { connectOwnedDomain } from "./domains";
import { serveHolding } from "./holding";
import { take as takeSlot } from "./domain-search";
import { checkLimit } from "./limits";
import { normaliseEmail } from "@/lib/email-address";

type Row = Record<string, unknown>;
type Result<T = object> = ({ ok: true } & T) | { ok: false; problems: string[] };

/**
 * A person's domains (D317, `docs/domains-standalone.md` 2): every registration and kept zone their account holds, whichever store uses it,
 * and linking one to a store they own or taking it from one. Linking is the holder's yes for the store to use it: the store's pages then show
 * it, its owners may change its DNS, and its renewals are billed to the store (decision 6). Only this module and the writers of the domain
 * tables change `store_id` on a domain the account holds.
 */

export type HeldDomain = {
  apex: string;
  /** What the domain shows while no store uses it (D317 8), when its DNS is kept here. */
  holding: { mode: string; redirect: string | null } | null;
  registrationId: string | null;
  zoneId: string | null;
  store: { id: string; slug: string; name: string } | null;
  /** Billed to the account when no store uses it: the VAT terms of a purchase made without a store are on file (D317 6). */
  billable: boolean;
};

/** The account's domains, by name: registered here, or with their DNS kept here, or both. */
export async function heldDomains(accountId: string): Promise<HeldDomain[]> {
  const rows = await db().execute<Row>(sql`
    with names as (
      select r.apex, r.id as registration_id, null::uuid as zone_id, r.store_id from commerce.domain_registrations r
       where r.account_id = ${accountId}::uuid and r.status <> 'transferred_out'
      union all
      select z.apex, null, z.id, z.store_id from commerce.dns_zones z where z.account_id = ${accountId}::uuid and z.status <> 'left'
    )
    select n.apex, max(n.registration_id::text) as registration_id, max(n.zone_id::text) as zone_id, max(n.store_id::text) as store_id,
           max(s.slug) as slug, max(s.name) as name,
           (select z.holding from commerce.dns_zones z where z.account_id = ${accountId}::uuid and z.apex = n.apex and z.status <> 'left' limit 1) as holding,
           (select z.holding_redirect from commerce.dns_zones z where z.account_id = ${accountId}::uuid and z.apex = n.apex and z.status <> 'left' limit 1) as holding_redirect,
           exists (select 1 from commerce.domain_purchases p where p.account_id = ${accountId}::uuid and p.apex = n.apex and p.vat_kind is not null
                    and p.status = 'done') as billable
      from names n left join commerce.stores s on s.id = n.store_id
     group by n.apex order by n.apex
  `);
  return rows.map((r) => ({
    apex: String(r.apex),
    registrationId: r.registration_id ? String(r.registration_id) : null,
    zoneId: r.zone_id ? String(r.zone_id) : null,
    store: r.store_id ? { id: String(r.store_id), slug: String(r.slug), name: String(r.name) } : null,
    holding: r.zone_id ? { mode: String(r.holding ?? "parked"), redirect: r.holding_redirect ? String(r.holding_redirect) : null } : null,
    billable: r.billable === true,
  }));
}

/** Whether the account holds any domain, for its navigation (*Your domains*). */
export async function holdsDomains(accountId: string): Promise<boolean> {
  const [row] = await db().execute<Row>(sql`
    select exists (select 1 from commerce.domain_registrations where account_id = ${accountId}::uuid and status <> 'transferred_out')
        or exists (select 1 from commerce.dns_zones where account_id = ${accountId}::uuid and status <> 'left')
        or exists (select 1 from commerce.domain_purchases where account_id = ${accountId}::uuid and status in ('quoted', 'invoiced', 'paid', 'registering'))
        or exists (select 1 from commerce.accounts where id = ${accountId}::uuid and origin = 'domain') as holds
  `);
  return row?.holds === true;
}

/** The stores a domain may be linked to: open stores the account owns. */
export async function linkableStores(accountId: string): Promise<{ id: string; slug: string; name: string }[]> {
  const rows = await db().execute<Row>(sql`
    select s.id, s.slug, s.name from commerce.store_members m join commerce.stores s on s.id = m.store_id
     where m.account_id = ${accountId}::uuid and m.role = 'owner' and m.disabled_at is null
       and s.status = 'active' and not (s.is_template or s.starter)
     order by s.name
  `);
  return rows.map((r) => ({ id: String(r.id), slug: String(r.slug), name: String(r.name) }));
}

/** The hosts a store has connected on a domain (the domain itself and names under it). */
async function connectedHosts(storeId: string, apex: string): Promise<string[]> {
  const rows = await db().execute<Row>(sql`
    select hostname from commerce.store_domains where store_id = ${storeId}::uuid and (hostname = ${apex} or hostname like ${`%.${apex}`})
  `);
  return rows.map((r) => String(r.hostname));
}

/**
 * Lets one of the account's stores use a domain the account holds, and connects the store to it when its DNS is kept here (so nothing is
 * left to do at a DNS provider). A domain another store still uses is disconnected there first, by its owner; the plan's room is checked.
 */
export async function linkDomain(account: Account, apex: string, storeId: string, deps: { connect?: typeof connectOwnedDomain } = {}): Promise<Result<{ connected: boolean }>> {
  const name = apex.trim().toLowerCase();
  const held = (await heldDomains(account.id)).find((d) => d.apex === name);
  if (!held) return { ok: false, problems: [`${name} isn't one of your domains.`] };
  const store = (await linkableStores(account.id)).find((s) => s.id === storeId);
  if (!store) return { ok: false, problems: ["Choose one of your open stores."] };
  if (held.store?.id === store.id) return { ok: true, connected: (await connectedHosts(store.id, name)).length > 0 };
  if (held.store && (await connectedHosts(held.store.id, name)).length > 0) {
    return { ok: false, problems: [`${held.store.name} still uses ${name}. Disconnect it there first.`] };
  }
  const room = await checkLimit(store.id, "custom_domains");
  if (!room.ok) return { ok: false, problems: [limitRefusal("custom_domains", room.limit)] };
  await db().transaction(async (tx) => {
    await tx.execute(sql`
      update commerce.domain_registrations set store_id = ${store.id}::uuid, updated_at = now()
       where account_id = ${account.id}::uuid and apex = ${name} and status <> 'transferred_out'
    `);
    await tx.execute(sql`update commerce.dns_zones set store_id = ${store.id}::uuid, updated_at = now() where account_id = ${account.id}::uuid and apex = ${name} and status <> 'left'`);
  });
  await audit(account.id, store.id, "store.domain_linked", { domain: name, from: held.store?.id ?? null });
  // DNS kept here (bought here, or moved in): the store is connected at once, as after a purchase.
  let connected = false;
  if (held.zoneId) {
    const made = await (deps.connect ?? connectOwnedDomain)(account, store.id, name);
    connected = made.ok;
    if (!made.ok) await audit(account.id, store.id, "store.domain_connect_failed", { domain: name, problem: made.problems.join(" ").slice(0, 300) });
  }
  return { ok: true, connected };
}

/**
 * Takes a domain from the store using it, back to the account alone. Refused while the store is connected to it (disconnect it there
 * first), and for a domain whose renewals only a store can be billed for: one bought for a store has no VAT terms of the account on file,
 * so it can move to another of the account's stores instead.
 */
export async function unlinkDomain(account: Account, apex: string): Promise<Result> {
  const name = apex.trim().toLowerCase();
  const held = (await heldDomains(account.id)).find((d) => d.apex === name);
  if (!held?.store) return { ok: false, problems: [`No store uses ${name}.`] };
  if ((await connectedHosts(held.store.id, name)).length > 0) return { ok: false, problems: [`${held.store.name} still uses ${name}. Disconnect it there first.`] };
  if (held.registrationId && !held.billable) {
    return { ok: false, problems: [`${name} is billed to ${held.store.name}. It can move to another of your stores instead.`] };
  }
  await db().transaction(async (tx) => {
    await tx.execute(sql`
      update commerce.domain_registrations set store_id = null, updated_at = now()
       where account_id = ${account.id}::uuid and apex = ${name} and status <> 'transferred_out'
    `);
    await tx.execute(sql`update commerce.dns_zones set store_id = null, updated_at = now() where account_id = ${account.id}::uuid and apex = ${name} and status <> 'left'`);
  });
  await audit(account.id, held.store.id, "store.domain_unlinked", { domain: name });
  if (held.zoneId) await serveHolding(name);
  return { ok: true };
}

/** The holder an account's domain pages act as. */
export const accountDomains = (account: Account) => accountHolder(account.id);

/** Accounts a visitor may start in an hour, per address and in all: an account is only a row, but each start emails a link. */
export const DOMAIN_STARTS_PER_VISITOR_PER_HOUR = 5;
export const DOMAIN_STARTS_PER_HOUR = 200;

/**
 * Starting to buy a domain without a store (D317 4): the account for the email, made with `origin = 'domain'` when there is none (an
 * existing account is used as it is, never changed). The caller emails a sign-in link to it and answers the same whatever the email
 * was, so the form never tells who has an account. False when over the limits.
 */
export async function startDomainAccount(email: string, visitor: string, deps: { take?: (bucket: string) => Promise<number> } = {}): Promise<boolean> {
  const take = deps.take ?? ((bucket: string) => takeSlot(null, bucket));
  if ((await take(`domains:start:${visitor}`)) > DOMAIN_STARTS_PER_VISITOR_PER_HOUR) return false;
  if ((await take("domains:start:all")) > DOMAIN_STARTS_PER_HOUR) return false;
  const address = normaliseEmail(email);
  await db().execute(sql`
    insert into commerce.accounts (email, origin)
    select ${address}, 'domain' where not exists (select 1 from commerce.accounts where lower(email) = ${address})
    on conflict do nothing
  `);
  return true;
}
