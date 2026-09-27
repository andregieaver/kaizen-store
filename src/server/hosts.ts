import "server-only";

import { sql } from "drizzle-orm";
import { notFound } from "next/navigation";
import { cache } from "react";
import { z } from "zod";

import { db } from "@/db/client";

import { audit, getAccount, requireAccount, type Account, type Membership } from "./auth";
import { getStore, type Store } from "./stores";

/**
 * Outside hosts (D71): a store running a marketplace lists stays and
 * rentals for hosts, who sign in with their own accounts and see only
 * their own listings, bookings and calendars, in a host area apart from
 * the store's admin. Hosts are not store members, so `requireMember()`
 * never lets them into the store's own pages.
 */

type Row = Record<string, unknown>;

export type Host = {
  id: string;
  name: string;
  email: string;
  commissionBps: number;
  vatRegistered: boolean;
  disabled: boolean;
  signedInBefore: boolean;
  listings: number;
};

const toHost = (row: Row): Host => ({
  id: String(row.id),
  name: String(row.name),
  email: String(row.email),
  commissionBps: Number(row.commission_bps),
  vatRegistered: Boolean(row.vat_registered),
  disabled: row.disabled_at !== null && row.disabled_at !== undefined,
  signedInBefore: Boolean(row.linked),
  listings: Number(row.listings ?? 0),
});

const hostColumns = sql`
  h.id, h.name, a.email, h.commission_bps, h.vat_registered, h.disabled_at, a.auth_user_id is not null as linked,
  (select count(*)::int from commerce.products p
    where p.store_id = h.store_id and p.host_id = h.id and p.status <> 'archived') as listings
`;

/** The store's hosts: active first, by name. */
export async function listHosts(storeId: string): Promise<Host[]> {
  const rows = await db().execute<Row>(sql`
    select ${hostColumns} from commerce.hosts h join commerce.accounts a on a.id = h.account_id
    where h.store_id = ${storeId}::uuid
    order by h.disabled_at is not null, lower(h.name)
  `);
  return rows.map(toHost);
}

export async function getHost(storeId: string, hostId: string): Promise<Host | null> {
  const [row] = await db().execute<Row>(sql`
    select ${hostColumns} from commerce.hosts h join commerce.accounts a on a.id = h.account_id
    where h.store_id = ${storeId}::uuid and h.id = ${hostId}::uuid
  `);
  return row ? toHost(row) : null;
}

const hostFields = {
  name: z.string().trim().min(1, "Give the host a name.").max(120),
  commissionPercent: z.coerce
    .number()
    .min(0, "The commission cannot be below 0 %.")
    .max(100, "The commission is at most 100 %.")
    .refine((n) => Math.round(n * 100) === n * 100, "Use at most two decimals in the commission."),
  vatRegistered: z.boolean(),
};

export const hostInput = z.object(hostFields);
export const newHostInput = z.object({ ...hostFields, email: z.string().trim().max(200).pipe(z.email("Write the host's email address.")) });

export type HostResult = { ok: true; id: string } | { ok: false; problems: string[] };

const problemsOf = (error: z.ZodError) => [...new Set(error.issues.map((i) => i.message))];

/**
 * Adds a host, creating their account if needed: they sign in with that
 * email, as staff do. An account that is disabled, or already hosts for the
 * store, is refused.
 */
export async function inviteHost({ account, store }: Membership, values: Record<string, unknown>): Promise<HostResult> {
  const parsed = newHostInput.safeParse(values);
  if (!parsed.success) return { ok: false, problems: problemsOf(parsed.error) };
  const { name, email, commissionPercent, vatRegistered } = parsed.data;
  const outcome = await db().transaction(async (tx) => {
    const [invitee] = await tx.execute<Row>(sql`
      insert into commerce.accounts (email) values (${email})
      on conflict ((lower(email))) do update set email = commerce.accounts.email
      returning id, disabled_at
    `);
    if (invitee.disabled_at) return { ok: false as const, problem: `${email} cannot be invited. Contact support.` };
    const [row] = await tx.execute<Row>(sql`
      insert into commerce.hosts (store_id, account_id, name, commission_bps, vat_registered, invited_by)
      values (${store.id}::uuid, ${String(invitee.id)}::uuid, ${name}, ${Math.round(commissionPercent * 100)},
        ${vatRegistered}, ${account.id}::uuid)
      on conflict (store_id, account_id) do nothing
      returning id
    `);
    return row ? { ok: true as const, id: String(row.id) } : { ok: false as const, problem: `${email} is already a host here.` };
  });
  if (!outcome.ok) return { ok: false, problems: [outcome.problem] };
  await audit(account.id, store.id, "host.invited", { id: outcome.id, email, commissionPercent });
  return { ok: true, id: outcome.id };
}

/** Changes a host's name, commission or VAT registration. */
export async function updateHost({ account, store }: Membership, hostId: string, values: Record<string, unknown>): Promise<HostResult> {
  const parsed = hostInput.safeParse(values);
  if (!parsed.success) return { ok: false, problems: problemsOf(parsed.error) };
  const { name, commissionPercent, vatRegistered } = parsed.data;
  const [row] = await db().execute<Row>(sql`
    update commerce.hosts set name = ${name}, commission_bps = ${Math.round(commissionPercent * 100)},
      vat_registered = ${vatRegistered}, updated_at = now()
    where store_id = ${store.id}::uuid and id = ${hostId}::uuid
    returning id
  `);
  if (!row) return { ok: false, problems: ["The host is no longer in the store."] };
  await audit(account.id, store.id, "host.updated", { id: hostId, commissionPercent, vatRegistered });
  return { ok: true, id: hostId };
}

/** Stops or restores a host's access. Their listings stay, and can be given to another host or the store. */
export async function setHostDisabled({ account, store }: Membership, hostId: string, disabled: boolean): Promise<boolean> {
  const rows = await db().execute<Row>(sql`
    update commerce.hosts set disabled_at = ${disabled ? sql`now()` : sql`null`}, updated_at = now()
    where store_id = ${store.id}::uuid and id = ${hostId}::uuid returning id
  `);
  if (rows.length === 0) return false;
  await audit(account.id, store.id, disabled ? "host.disabled" : "host.enabled", { id: hostId });
  return true;
}

/** The store's active hosts, for choosing a listing's or room's host. */
export async function hostChoices(storeId: string): Promise<{ id: string; name: string }[]> {
  const rows = await db().execute<Row>(sql`
    select id, name from commerce.hosts where store_id = ${storeId}::uuid and disabled_at is null order by lower(name)
  `);
  return rows.map((row) => ({ id: String(row.id), name: String(row.name) }));
}

// ---------------------------------------------------------------------------
// The host's own area
// ---------------------------------------------------------------------------

/** A signed-in host's place in one store. */
export type Hosting = { account: Account; store: Store; host: { id: string; name: string; commissionBps: number } };

/** The stores the account hosts for, by name. */
export async function listHostings(account: Account): Promise<{ slug: string; name: string; hostName: string }[]> {
  const rows = await db().execute<Row>(sql`
    select s.slug, s.name, h.name as host_name from commerce.hosts h
    join commerce.stores s on s.id = h.store_id
    where h.account_id = ${account.id}::uuid and h.disabled_at is null and s.status <> 'closed'
    order by lower(s.name)
  `);
  return rows.map((row) => ({ slug: String(row.slug), name: String(row.name), hostName: String(row.host_name) }));
}

export const getHosting = cache(async (storeSlug: string): Promise<Hosting | null> => {
  const account = await getAccount();
  if (!account) return null;
  const store = await getStore(storeSlug);
  if (!store || store.status === "closed") return null;
  const [row] = await db().execute<Row>(sql`
    select id, name, commission_bps from commerce.hosts
    where store_id = ${store.id}::uuid and account_id = ${account.id}::uuid and disabled_at is null
  `);
  return row
    ? { account, store, host: { id: String(row.id), name: String(row.name), commissionBps: Number(row.commission_bps) } }
    : null;
});

/**
 * For the host area's pages and actions: the host's place in the store, a
 * redirect to sign in, or a 404 for a store the account does not host for.
 */
export async function requireHost(storeSlug: string): Promise<Hosting> {
  await requireAccount();
  const hosting = await getHosting(storeSlug);
  if (!hosting) notFound();
  return hosting;
}

export type HostListing = { id: string; handle: string; title: string; kind: string; status: string };

/** The host's listings, by title. */
export async function hostListings(storeId: string, hostId: string): Promise<HostListing[]> {
  const rows = await db().execute<Row>(sql`
    select p.id, p.handle, p.kind, p.status,
      coalesce((select t.title from commerce.product_translations t where t.product_id = p.id order by t.locale limit 1), p.handle) as title
    from commerce.products p
    where p.store_id = ${storeId}::uuid and p.host_id = ${hostId}::uuid and p.status <> 'archived'
    order by title
  `);
  return rows.map((row) => ({
    id: String(row.id),
    handle: String(row.handle),
    title: String(row.title),
    kind: String(row.kind),
    status: String(row.status),
  }));
}

/** The host's rooms and items, whose calendars they keep. */
export async function hostResources(storeId: string, hostId: string): Promise<{ id: string; name: string; kind: string }[]> {
  const rows = await db().execute<Row>(sql`
    select id, name, kind from commerce.booking_resources
    where store_id = ${storeId}::uuid and host_id = ${hostId}::uuid and active
    order by position, name
  `);
  return rows.map((row) => ({ id: String(row.id), name: String(row.name), kind: String(row.kind) }));
}

/** Whether a resource is the host's own: a host changes only their own calendars. */
export async function hostOwnsResource(storeId: string, hostId: string, resourceId: string): Promise<boolean> {
  const [row] = await db().execute<Row>(sql`
    select 1 from commerce.booking_resources
    where store_id = ${storeId}::uuid and id = ${resourceId}::uuid and host_id = ${hostId}::uuid
  `);
  return Boolean(row);
}
