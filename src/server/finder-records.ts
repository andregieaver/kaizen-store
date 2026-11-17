import "server-only";

import { sql, type SQL } from "drizzle-orm";
import { z } from "zod";

import {
  RECORD_KINDS,
  RECORDS_PER_KIND,
  recordKindsFor,
  type FoundRecord,
  type RecordKind,
  type RecordQuery,
  type RecordScope,
} from "@/lib/finder-records";
import type { Membership } from "./auth";
import { bought } from "./bought-sql";
import { owned } from "./owned";
import { memberCan } from "./permissions";
import { inboxSearch } from "./support";
import { col, typedRows } from "./typed-rows";

/**
 * The page finder's records (ecosystem plan E2.2, D713): the orders, customers, support conversations, deals and products a search matches,
 * in the stores and kinds a person may read, in ONE statement (a `union all` of a bounded read per kind), so a search is one round trip.
 *
 * Each kind asks what its own list asks, bounded by the store's indexes: an order by the start of its number (`orders_number_normalised_idx`,
 * as a range) or its exact email (`orders_email_idx`), never by words inside every order; a customer by their account's name or email (the
 * customers list's and the draft picker's search, over the store's accounts) or, for a guest, their exact email; a conversation by the
 * inbox's own search (`inboxSearch()`); a deal by its title; a product by a title or a SKU, as the products list filters. A person who was
 * erased (D162) is never found by their address and never named. Who may see which kind is decided before (`memberScope()`,
 * `accountScopes()`): a kind is read only in the stores listed for it.
 */

const FOUND_ROW = z.object({
  kind: z.enum(RECORD_KINDS),
  store_id: col.uuid,
  key: col.uuid,
  title: col.textOrNull,
  detail: col.textOrNull,
  rank: col.int,
  minor: col.minorOrNull,
  currency: col.currency.nullable(),
});

/** The stores' rows by an aliased column: one store by equality (`owned()`), several by `= any`, both answered from the stores' indexes. */
function inStores(ids: readonly string[], column: SQL): SQL {
  if (ids.length === 1) return owned(ids[0], column);
  return sql`${column} = any(array[${sql.join(
    ids.map((id) => sql`${id}::uuid`),
    sql`, `,
  )}]::uuid[])`;
}

/** An order's number as `orders_number_normalised_idx` keeps it: without spaces, in upper case. */
const NUMBER = sql`upper(regexp_replace(o.number, '\\s', '', 'g'))`;
/** Neither erased nor restricted (D162): only such an order is found by, or shows, its person's address and name. */
const PERSON_KEPT = sql`(o.restricted_at is null and o.anonymised_at is null)`;

function ordersRead(ids: readonly string[], q: RecordQuery, per: number): SQL | null {
  const arms: SQL[] = [];
  const exact: SQL[] = [];
  if (q.number) {
    const { lo, hi, like, exact: whole } = q.number;
    arms.push(sql`(${NUMBER} >= ${lo} ${hi === null ? sql`` : sql`and ${NUMBER} < ${hi}`} and ${NUMBER} like ${like})`);
    exact.push(sql`${NUMBER} = ${whole}`);
  }
  if (q.email) {
    arms.push(sql`(lower(o.email) = lower(${q.email}) and ${PERSON_KEPT})`);
    exact.push(sql`lower(o.email) = lower(${q.email})`);
  }
  if (arms.length === 0) return null;
  return sql`
    select 'order'::text as kind, o.store_id, o.id as key, o.number as title,
      case when ${PERSON_KEPT} then coalesce(nullif(o.shipping_address ->> 'name', ''), nullif(o.billing_address ->> 'name', ''), nullif(o.email, '')) end as detail,
      (case when ${sql.join(exact, sql` or `)} then 0 else 1 end)::int as rank, o.total_minor::bigint as minor, o.currency::text as currency
    from commerce.orders o
    where ${inStores(ids, sql`o.store_id`)} and (${sql.join(arms, sql` or `)})
    order by rank, o.placed_at desc, o.id
    limit ${per}
  `;
}

function customersRead(ids: readonly string[], q: RecordQuery, per: number): SQL {
  // A guest has no account: found by their exact address only, their page is their latest bought order's, as the customers list keys them.
  const guests = q.email
    ? sql`
      union all
      (select distinct on (o.store_id) o.store_id, o.id, coalesce(nullif(o.shipping_address ->> 'name', ''), lower(o.email)),
        case when nullif(o.shipping_address ->> 'name', '') is not null then lower(o.email) end, 0, o.placed_at
      from commerce.orders o
      where ${inStores(ids, sql`o.store_id`)} and lower(o.email) = lower(${q.email}) and o.customer_id is null and ${bought} and ${PERSON_KEPT}
        and not exists (select 1 from commerce.customers a where a.store_id = o.store_id and lower(a.email) = lower(${q.email}))
      order by o.store_id, o.placed_at desc)`
    : sql``;
  return sql`
    select 'customer'::text as kind, k.store_id, k.key, k.title, k.detail, k.rank::int as rank, null::bigint as minor, null::text as currency
    from (
      (select c.store_id, c.id as key, coalesce(nullif(c.name, ''), c.email) as title, case when nullif(c.name, '') is not null then c.email end as detail,
        case when lower(c.email) = lower(${q.text}) then 0 when lower(c.name) like lower(${q.starts}) then 1 else 2 end as rank, c.created_at as at
      from commerce.customers c
      where ${inStores(ids, sql`c.store_id`)} and (lower(c.email) like lower(${q.contains}) or lower(c.name) like lower(${q.contains})))
      ${guests}
    ) k
    order by k.rank, k.at desc, k.key
    limit ${per}
  `;
}

function conversationsRead(ids: readonly string[], q: RecordQuery, per: number): SQL {
  return sql`
    select 'conversation'::text as kind, c.store_id, c.id as key,
      coalesce(nullif(cu.name, ''), nullif(c.contact_name, ''), nullif(ra.name, ''), cu.email, c.contact_email, ra.email) as title,
      coalesce(nullif(c.summary ->> 'title', ''), nullif(c.email_subject, '')) as detail,
      (case when lower(coalesce(cu.email, c.contact_email, ra.email)) = lower(${q.text}) then 0 else 1 end)::int as rank,
      null::bigint as minor, null::text as currency
    from commerce.support_conversations c
    left join commerce.customers cu on cu.store_id = c.store_id and cu.id = c.customer_id
    left join commerce.accounts ra on ra.id = c.requester_id
    where ${inStores(ids, sql`c.store_id`)} and c.anonymised_at is null and ${inboxSearch(q.text)}
    order by rank, c.last_message_at desc, c.id
    limit ${per}
  `;
}

function dealsRead(ids: readonly string[], q: RecordQuery, per: number): SQL {
  return sql`
    select 'deal'::text as kind, d.store_id, d.id as key, d.title, coalesce(nullif(k.name, ''), nullif(cu.name, ''), cu.email) as detail,
      (case when lower(d.title) = lower(${q.text}) then 0 when lower(d.title) like lower(${q.starts}) then 1 else 2 end)::int as rank,
      null::bigint as minor, null::text as currency
    from commerce.deals d
    left join commerce.customers cu on cu.store_id = d.store_id and cu.id = d.customer_id
    left join commerce.customer_companies k on k.store_id = d.store_id and k.id = d.company_id
    where ${inStores(ids, sql`d.store_id`)} and lower(d.title) like lower(${q.contains})
    order by rank, (d.status = 'open') desc, d.created_at desc, d.id
    limit ${per}
  `;
}

function productsRead(ids: readonly string[], q: RecordQuery, per: number): SQL {
  return sql`
    select 'product'::text as kind, p.store_id, p.id as key,
      coalesce(tm.title, (select t.title from commerce.product_translations t where t.product_id = p.id order by t.locale limit 1), p.handle) as title,
      vm.sku as detail,
      (case when lower(vm.sku) = lower(${q.text}) or lower(tm.title) = lower(${q.text}) then 0 when lower(tm.title) like lower(${q.starts}) then 1 else 2 end)::int as rank,
      null::bigint as minor, null::text as currency
    from commerce.products p
    left join lateral (
      select t.title from commerce.product_translations t where t.product_id = p.id and lower(t.title) like lower(${q.contains})
      order by (lower(t.title) = lower(${q.text})) desc, t.locale limit 1
    ) tm on true
    left join lateral (
      select v.sku from commerce.product_variants v where v.store_id = p.store_id and v.product_id = p.id and lower(v.sku) like lower(${q.contains})
      order by (lower(v.sku) = lower(${q.text})) desc, v.sku limit 1
    ) vm on true
    where ${inStores(ids, sql`p.store_id`)} and (tm.title is not null or vm.sku is not null)
    order by rank, (p.status = 'archived'), p.updated_at desc, p.id
    limit ${per}
  `;
}

const READS: Record<RecordKind, (ids: readonly string[], q: RecordQuery, per: number) => SQL | null> = {
  order: ordersRead,
  customer: customersRead,
  conversation: conversationsRead,
  deal: dealsRead,
  product: productsRead,
};

/** The records a search matches in these scopes: at most `per` of each kind (across the stores), best match first. One statement. */
export async function findRecords(scopes: readonly RecordScope[], q: RecordQuery, per = RECORDS_PER_KIND): Promise<FoundRecord[]> {
  const parts: SQL[] = [];
  for (const kind of RECORD_KINDS) {
    const ids = scopes.filter((scope) => scope.kinds.includes(kind)).map((scope) => scope.storeId);
    if (ids.length === 0) continue;
    const read = READS[kind](ids, q, per);
    if (read) parts.push(sql`(${read})`);
  }
  if (parts.length === 0) return [];
  const rows = await typedRows(FOUND_ROW, sql.join(parts, sql` union all `));
  return rows.map((row) => ({
    kind: row.kind,
    storeId: row.store_id,
    key: row.key,
    title: row.title,
    detail: row.detail,
    rank: row.rank,
    minor: row.minor,
    currency: row.currency,
  }));
}

/** A store member's scope: the kinds they hold the key for, whose feature is on, in a store that lets them read it (`memberCan()`). */
export function memberScope(member: Pick<Membership, "role" | "kind" | "permissions" | "limit"> & { store: { id: string; status?: string; features: readonly string[] } }): RecordScope {
  return { storeId: member.store.id, kinds: recordKindsFor((key) => memberCan(member, key), member.store) };
}

const MEMBER_ROW = z.object({
  id: col.uuid,
  slug: col.text,
  name: col.text,
  status: col.text,
  features: z.array(z.string()),
  require_two_step: col.bool,
  role: z.enum(["owner", "admin"]),
  kind: col.textOrNull,
  role_id: col.uuid.nullable(),
  role_permissions: z.array(z.string()).nullable(),
});

export type ScopedStore = RecordScope & { slug: string; name: string };

/**
 * An account's scopes at the owner's level: each store it works in (the level switcher's list: not closed, not a template or a sandbox, the
 * membership neither switched off nor run out), with that store's own role and keys, its features and its status, and only where the
 * person passes the store's own requirement of a second step (`mayUse`, given the store's `require_two_step`), as its admin would ask.
 */
export async function accountScopes(accountId: string, mayUse: (storeRequiresTwoStep: boolean) => boolean): Promise<ScopedStore[]> {
  const rows = await typedRows(
    MEMBER_ROW,
    sql`
      select s.id, s.slug, s.name, s.status, s.features, s.require_two_step, m.role, m.kind, m.role_id, r.permissions as role_permissions
      from commerce.store_members m
      join commerce.stores s on s.id = m.store_id
      left join commerce.store_roles r on r.store_id = m.store_id and r.id = m.role_id
      where m.account_id = ${accountId}::uuid and m.disabled_at is null and (m.expires_at is null or m.expires_at > now())
        and s.status <> 'closed' and not s.starter and not s.sandbox
      order by lower(s.name), s.slug
    `,
  );
  return rows
    .filter((row) => mayUse(row.require_two_step))
    .map((row) => {
      const holder = {
        role: row.role,
        kind: row.kind === "collaborator" ? ("collaborator" as const) : ("staff" as const),
        permissions: row.role_id ? (row.role_permissions ?? []) : null,
        store: { id: row.id, status: row.status, features: row.features },
      };
      return { ...memberScope(holder), slug: row.slug, name: row.name };
    })
    .filter((scope) => scope.kinds.length > 0);
}
