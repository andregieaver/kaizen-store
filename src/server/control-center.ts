import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { LOW_STOCK_AT, type SalesFigure, type StoreFigures } from "@/lib/control-center";
import { totalOf } from "@/lib/ai-usage";
import { can, type PermissionKey } from "@/lib/permissions";

import { usageRows } from "./ai-usage";
import type { Account } from "./auth";
import { OWED_LINE } from "./analytics-sql";
import { invoiceAttention } from "./invoices";
import { privacyAttention } from "./privacy-attention";
import { returnAttention } from "./return-attention";
import { taxAttention } from "./tax-attention";
import { taxReturnsAttention } from "./tax-returns-attention";
import { workAttention } from "./work-attention";

type Row = Record<string, unknown>;

/** An order paid for: a captured payment, online or at the venue. */
/** Paid: a captured payment. History copied from another store (D129) has none, and is left out by name as well. */
const paid = sql`(o.copied_from is null and exists (select 1 from commerce.payments p where p.order_id = o.id and p.status = 'captured'))`;

export type LatestOrder = { id: string; number: string; storeSlug: string; storeName: string; name: string | null; status: string; totalMinor: number; currency: string; placedAt: string };

export type ControlCenter = {
  stores: StoreFigures[];
  latest: LatestOrder[];
  ai: { requests: number; failed: number };
};

/** The ids of the stores in which the member holds `key`. */
const idsWith = (rows: Row[], key: PermissionKey) =>
  rows.filter((r) => can({ role: r.role as "owner" | "admin", kind: r.kind === "collaborator" ? "collaborator" : "staff", permissions: r.role_id ? ((r.role_permissions ?? []) as string[]).map(String) : null }, key)).map((r) => String(r.id));

const idList = (ids: string[]) => sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `);

/**
 * The bird's-eye view of every store an account works in (D107): status,
 * plan, payments, the last 7 days' sales against the 7 before, orders waiting
 * to be sent, stock running out, Work's attention items for the stores that use it, and the latest orders (`onlyStore`: one
 * store's, for its own overview). A handful of queries
 * for all stores together, counted here in code (D94), never per store.
 *
 * What a member sees follows what they may open (wave 1, 1f review): a collaborator whose time has run out is not a member of the store
 * at all (`expires_at`, whether or not the daily job has marked it), and a figure is counted only for a store where the member holds
 * the key of the area it comes from: sales, orders waiting and the latest orders (with customers' names) need `orders:read`, stock
 * `products:read`, the plan `billing:read`. A store's figure the member may not see is left out and named in `hides`, never shown as zero.
 */
export async function controlCenter(account: Account, onlyStore?: string): Promise<ControlCenter> {
  const storeRows = await db().execute<Row>(sql`
    select s.id, s.slug, s.name, s.status, s.setup_completed_at, s.modules, s.time_zone, m.role, m.kind, m.role_id, sr.permissions as role_permissions,
           p.name as plan_name, b.status as billing_status, b.current_period_end, coalesce(b.cancel_at_period_end, false) as cancelling,
           pr.enabled as payments_on, pr.active_mode,
           exists (select 1 from commerce.stripe_accounts a where a.store_id = s.id and a.mode = 'live' and a.card_payments = 'active') as live_ready
    from commerce.store_members m
    join commerce.stores s on s.id = m.store_id and s.status <> 'closed'
    left join commerce.store_roles sr on sr.store_id = m.store_id and sr.id = m.role_id
    left join commerce.store_billing b on b.store_id = s.id
    left join commerce.plans p on p.id = b.plan_id
    left join commerce.payment_providers pr on pr.store_id = s.id and pr.provider = 'stripe'
    where m.account_id = ${account.id}::uuid and m.disabled_at is null and (m.expires_at is null or m.expires_at > now())${onlyStore ? sql` and s.slug = ${onlyStore}` : sql``}
    order by (m.role = 'owner') desc, lower(s.name), s.slug
  `);
  if (storeRows.length === 0) return { stores: [], latest: [], ai: { requests: 0, failed: 0 } };
  const ids = storeRows.map((r) => String(r.id));
  const onlyId = onlyStore ? ids[0] : null;
  // Where the member may see each kind of figure.
  const orderIds = idsWith(storeRows, "orders:read");
  const productIds = idsWith(storeRows, "products:read");
  const billingIds = new Set(idsWith(storeRows, "billing:read"));
  const orderSet = new Set(orderIds);
  const productSet = new Set(productIds);

  // Work's own attention items, for the stores that have it switched on (D122): one set of queries for them all.
  const workStores = storeRows
    .filter((r) => ((r.modules ?? []) as string[]).includes("work"))
    .map((r) => ({ id: String(r.id), slug: String(r.slug), name: String(r.name), timeZone: String(r.time_zone ?? "Europe/Oslo") }));

  // Invoices that wait are the owner's to fix (they change the seller's details or tax profile): other roles are not asked.
  const ownerIds = idsWith(storeRows, "owner");
  // Privacy requests (D162) are shown to those who may open the log: `customers:read`, like the page.
  const customerIds = idsWith(storeRows, "customers:read");

  const none = <T>() => Promise.resolve<T[]>([]);
  const [salesRows, sendRows, stockRows, owedRows, latestRows, usage, workItems, returnItems, taxItems, invoiceItems, taxReturnItems, privacyItems] = await Promise.all([
    orderIds.length === 0 ? none<Row>() : db().execute<Row>(sql`
      select o.store_id, o.currency,
        coalesce(sum(o.total_minor) filter (where o.placed_at >= now() - interval '7 days'), 0)::bigint as week,
        count(*) filter (where o.placed_at >= now() - interval '7 days')::int as orders,
        coalesce(sum(o.total_minor) filter (where o.placed_at < now() - interval '7 days'), 0)::bigint as prior,
        count(*) filter (where o.placed_at < now() - interval '7 days')::int as prior_orders
      from commerce.orders o
      where o.store_id in (${idList(orderIds)}) and o.placed_at >= now() - interval '14 days'
        and o.status <> 'cancelled' and ${paid}
      group by o.store_id, o.currency
    `),
    orderIds.length === 0 ? none<Row>() : db().execute<Row>(sql`
      select o.store_id, count(*)::int as n, min(o.placed_at) as oldest
      from commerce.orders o
      where o.store_id in (${idList(orderIds)}) and o.status = 'paid' and o.copied_from is null
        and exists (select 1 from commerce.order_lines l where l.order_id = o.id and l.delivery = 'physical')
      group by o.store_id
    `),
    // Stock (D172, docs/analytics.md "On hand", "Warning level"): the sum over ACTIVE locations only (a deactivated one is not for sale), a
    // variant out is one that cannot be sold (`deny` at zero or below), a variant at or below its own warning level is a `low` row of
    // `stock_alerts`, the fixed "3 or fewer" is for variants with no level of their own that still have some (a variant that is gone is out, not low). Draft products count for the warning level, as on the
    // Inventory page's own count (`inventoryCounts().low`); the other two read active products, as before.
    productIds.length === 0 ? none<Row>() : db().execute<Row>(sql`
      select x.store_id,
        count(*) filter (where x.product_status = 'active' and x.threshold is null and x.stock > 0 and x.stock <= ${LOW_STOCK_AT})::int as low,
        count(*) filter (where x.product_status = 'active' and x.policy = 'deny' and x.stock <= 0)::int as out,
        count(*) filter (where x.alert = 'low')::int as below_level
      from (
        select v.store_id, v.id, v.stock_policy as policy, v.low_stock_threshold as threshold, p.status as product_status, a.state as alert,
               coalesce(sum(l.on_hand) filter (where loc.active), 0) as stock
        from commerce.product_variants v
        join commerce.products p on p.store_id = v.store_id and p.id = v.product_id and p.status in ('active', 'draft')
        left join commerce.inventory_levels l on l.store_id = v.store_id and l.variant_id = v.id
        left join commerce.inventory_locations loc on loc.store_id = l.store_id and loc.id = l.location_id
        left join commerce.stock_alerts a on a.store_id = v.store_id and a.variant_id = v.id
        where v.store_id in (${idList(productIds)}) and v.active and v.delivery = 'physical'
        group by v.store_id, v.id, v.stock_policy, v.low_stock_threshold, p.status, a.state
      ) x
      group by x.store_id
    `),
    // Units owed on backorder: what paid orders wait for (`OWED_LINE`, the Inventory page's own figure), for the variants it lists.
    productIds.length === 0 ? none<Row>() : db().execute<Row>(sql`
      select o.store_id, coalesce(sum(ol.backorder_quantity), 0)::int as owed
      from commerce.orders o
      join commerce.order_lines ol on ol.store_id = o.store_id and ol.order_id = o.id
      join commerce.product_variants v on v.store_id = ol.store_id and v.id = ol.variant_id and v.active and v.delivery = 'physical'
      join commerce.products p on p.store_id = v.store_id and p.id = v.product_id and p.status in ('active', 'draft')
      where o.store_id in (${idList(productIds)}) and ${OWED_LINE}
      group by o.store_id
    `),
    orderIds.length === 0 ? none<Row>() : db().execute<Row>(sql`
      select o.id, o.number, o.status, o.total_minor, o.currency, o.placed_at, s.slug, s.name as store_name,
             nullif(o.shipping_address ->> 'name', '') as name
      from commerce.orders o
      join commerce.stores s on s.id = o.store_id
      where o.store_id in (${idList(orderIds)}) and o.status not in ('pending_payment', 'cancelled') and o.copied_from is null
      order by o.placed_at desc
      limit 8
    `),
    usageRows({ days: 7, ownedBy: account.id, storeId: onlyId }),
    workAttention(workStores),
    // Withdrawals waiting for a refund, an acknowledgement or an answer (D153).
    returnAttention(orderIds),
    // A VAT number not checked, or an IOSS or OSS registration left half done (D157).
    taxAttention(ids),
    // Paid orders still waiting for an invoice (D159): asked only for the stores where the member is an owner.
    invoiceAttention(ownerIds),
    // OSS and IOSS data not yet exported (D161): the owner's too, asked only for the stores that have such a registration.
    taxReturnsAttention(ownerIds),
    // Privacy requests past their one-month clock or due this week (D162, wave 1g): counts only.
    privacyAttention(customerIds),
  ]);

  const salesBy = new Map<string, SalesFigure[]>();
  for (const r of salesRows) {
    const list = salesBy.get(String(r.store_id)) ?? [];
    list.push({ currency: String(r.currency), week: Number(r.week), prior: Number(r.prior), orders: Number(r.orders), priorOrders: Number(r.prior_orders) });
    salesBy.set(String(r.store_id), list);
  }
  const sendBy = new Map(sendRows.map((r) => [String(r.store_id), r]));
  const stockBy = new Map(stockRows.map((r) => [String(r.store_id), r]));
  const owedBy = new Map(owedRows.map((r) => [String(r.store_id), Number(r.owed)]));

  const stores: StoreFigures[] = storeRows.map((r) => {
    const id = String(r.id);
    const on = Boolean(r.payments_on);
    const live = r.active_mode === "live";
    const send = sendBy.get(id);
    const stock = stockBy.get(id);
    return {
      slug: String(r.slug),
      name: String(r.name),
      role: r.role as StoreFigures["role"],
      suspended: r.status === "suspended",
      open: Boolean(r.setup_completed_at),
      plan: r.billing_status && billingIds.has(id)
        ? {
            name: r.plan_name ? String(r.plan_name) : "Plan",
            status: String(r.billing_status),
            endsAt: r.current_period_end ? new Date(String(r.current_period_end)).toISOString() : null,
            cancelling: Boolean(r.cancelling),
          }
        : null,
      payments: !on ? "off" : live ? (r.live_ready ? "live" : "setup") : "test",
      sales: (salesBy.get(id) ?? []).sort((a, b) => b.week - a.week),
      toSend: Number(send?.n ?? 0),
      oldestToSend: send?.oldest ? new Date(String(send.oldest)).toISOString() : null,
      lowStock: Number(stock?.low ?? 0),
      outOfStock: Number(stock?.out ?? 0),
      belowLevel: Number(stock?.below_level ?? 0),
      owedUnits: owedBy.get(id) ?? 0,
      ...(orderSet.has(id) && productSet.has(id) && billingIds.has(id) ? {} : { hides: [...(orderSet.has(id) ? [] : (["sales"] as const)), ...(productSet.has(id) ? [] : (["stock"] as const)), ...(billingIds.has(id) ? [] : (["plan"] as const))] }),
      ...(workItems.has(id) ? { work: workItems.get(id) } : {}),
      ...(returnItems.has(id) ? { returns: returnItems.get(id) } : {}),
      ...(taxItems.has(id) ? { tax: taxItems.get(id) } : {}),
      ...(invoiceItems.has(id) ? { invoices: invoiceItems.get(id) } : {}),
      ...(taxReturnItems.has(id) ? { taxReturns: taxReturnItems.get(id)!.map((r) => ({ text: r.text, path: r.path })) } : {}),
      ...(privacyItems.has(id) ? { privacy: privacyItems.get(id) } : {}),
    };
  });

  const ai = totalOf(usage);
  return {
    stores,
    latest: latestRows.map((r) => ({
      id: String(r.id),
      number: String(r.number),
      storeSlug: String(r.slug),
      storeName: String(r.store_name),
      name: r.name ? String(r.name) : null,
      status: String(r.status),
      totalMinor: Number(r.total_minor),
      currency: String(r.currency),
      placedAt: new Date(String(r.placed_at)).toISOString(),
    })),
    ai: { requests: ai.requests, failed: ai.failed },
  };
}
