import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { auditProblems } from "@/lib/order-numbers";

import { listIntegrations } from "./integrations";
import { inventoryCounts, ledgerProblems } from "./inventory";
import { invoiceCheckupFindings } from "./invoices";
import { orderNumberAudit } from "./order-numbers";
import { restockSuggestions } from "./owner-insights";
import { getSetupProgress } from "./setup";
import { onHandActive } from "./stock-sql";
import type { Store } from "./stores";
import { taxCheckupFindings } from "./tax-profile";

type Row = Record<string, unknown>;

/**
 * The store checkup (the AI manager's `store_checkup`, and the briefing's findings since D348): a check of the store's health worked out in code from
 * its own rows. Each finding has a key, a count, its words in English (what the AI manager is told) and the page that acts on it, a path after the
 * store's admin base. The briefing words each finding by its key in the recipient's language and never shows the English. `accountId` is the person the
 * approvals waiting are counted for.
 */

export const CHECKUP_KEYS = [
  "setup",
  "late_orders",
  "to_send",
  "to_collect",
  "local_waiting",
  "stock_low",
  "stock_level",
  "backorder_owed",
  "restock",
  "searches_missed",
  "approvals",
  "numbering",
  "stock_history",
  "tax",
  "documents",
  "drafts",
  "payments_test",
  "integration",
] as const;
export type CheckupKey = (typeof CHECKUP_KEYS)[number];

export type CheckupFinding = { key: CheckupKey; count: number; what: string; page: string };

export async function checkupFindings(store: Store, accountId: string): Promise<CheckupFinding[]> {
  const [[counts], [low], progress, integrations, restock, numbering, taxFindings, documentFindings, ledger, levels] = await Promise.all([
    db().execute<Row>(sql`
      select
        (select count(*)::int from commerce.orders o where o.store_id = ${store.id}::uuid and o.status = 'paid' and o.copied_from is null
           and o.placed_at < now() - interval '2 days' and o.delivery_method = 'ship'
           and exists (select 1 from commerce.order_lines l where l.order_id = o.id and l.delivery = 'physical')) as late_orders,
        (select count(*)::int from commerce.orders o where o.store_id = ${store.id}::uuid and o.status = 'paid' and o.copied_from is null
           and o.delivery_method = 'ship'
           and exists (select 1 from commerce.order_lines l where l.order_id = o.id and l.delivery = 'physical')) as to_send,
        -- Handed over by the store itself (D237): collected at a place, or its own local delivery not delivered yet (the Orders page's views).
        (select count(*)::int from commerce.orders o where o.store_id = ${store.id}::uuid and o.copied_from is null and o.archived_at is null
           and o.delivery_method = 'pickup' and o.status = 'paid') as to_collect,
        (select count(*)::int from commerce.orders o where o.store_id = ${store.id}::uuid and o.copied_from is null and o.archived_at is null
           and o.delivery_method = 'local' and o.status in ('paid', 'fulfilled') and o.delivered_at is null) as local_waiting,
        (select count(distinct lower(q.query))::int from commerce.search_queries q
           where q.store_id = ${store.id}::uuid and q.results = 0 and not q.redirected and q.created_at > now() - interval '7 days') as searches_missed,
        (select count(*)::int from commerce.assistant_approvals a
           where a.store_id = ${store.id}::uuid and a.account_id = ${accountId}::uuid and a.status = 'pending') as approvals,
        (select count(*)::int from commerce.products p where p.store_id = ${store.id}::uuid and p.status = 'draft') as drafts
    `),
    db().execute<Row>(sql`
      select count(*)::int as n from commerce.product_variants v
      join commerce.products p on p.store_id = v.store_id and p.id = v.product_id
      where v.store_id = ${store.id}::uuid and p.status = 'active' and v.active and v.delivery = 'physical' and p.kind = 'goods'
        and ${onHandActive(sql`v.id`)} <= 3
    `),
    getSetupProgress(store),
    listIntegrations(store.id),
    restockSuggestions({ store }, { days: 30, cover_days: 30, lead_days: 7 }),
    orderNumberAudit(store.id),
    taxCheckupFindings(store.id),
    invoiceCheckupFindings(store.id),
    ledgerProblems(store.id),
    inventoryCounts(store.id),
  ]);
  const findings: CheckupFinding[] = [];
  const add = (when: boolean, key: CheckupKey, count: number, what: string, page: string) => when && findings.push({ key, count, what, page });
  add(!progress.readyToOpen, "setup", 1, "The store is not ready to open yet: setup_progress says what is left.", "");
  add(Number(counts.late_orders) > 0, "late_orders", Number(counts.late_orders), `${counts.late_orders} paid order(s) have waited more than two days to be sent.`, "/orders?show=to-send");
  add(Number(counts.to_send) > 0 && Number(counts.late_orders) === 0, "to_send", Number(counts.to_send), `${counts.to_send} paid order(s) are waiting to be sent.`, "/orders?show=to-send");
  add(Number(counts.to_collect) > 0, "to_collect", Number(counts.to_collect), `${counts.to_collect} paid order(s) are waiting to be collected at a pickup place: pickup_orders lists them.`, "/orders?show=to-hand-over");
  add(Number(counts.local_waiting) > 0, "local_waiting", Number(counts.local_waiting), `${counts.local_waiting} ${Number(counts.local_waiting) === 1 ? "local delivery is" : "local deliveries are"} not delivered yet: pickup_orders lists them.`, "/orders?show=local");
  add(Number(low.n) > 0, "stock_low", Number(low.n), `${low.n} variant(s) have 3 or fewer left in stock.`, "/products");
  // The owner's own levels and what is owed on backorder (D172): the Inventory page's own counts.
  add(levels.low > 0, "stock_level", levels.low, `${levels.low} variant(s) are at or below the warning level you set: stock_levels with status low lists them.`, "/inventory?status=low");
  add(levels.owed > 0, "backorder_owed", levels.owed, `${levels.owed} unit(s) are owed to customers on backorder, on orders that are paid and not sent.`, "/inventory?status=backorder");
  add(restock.urgent > 0, "restock", restock.urgent, `${restock.urgent} variant(s) will run out within a week at the current pace: restock_suggestions says how many to order.`, "/products");
  add(Number(counts.searches_missed) > 0, "searches_missed", Number(counts.searches_missed), `${counts.searches_missed} different search(es) found nothing this week.`, "/search");
  add(Number(counts.approvals) > 0, "approvals", Number(counts.approvals), `${counts.approvals} change(s) you asked me for are waiting for your approval.`, "/assistant");
  for (const problem of auditProblems(numbering)) add(true, "numbering", 1, `Order numbering is not in sequence: ${problem}`, "/orders");
  // The history of stock (D172): the movements of a variant at a location add up to its level; a pair that does not is a level written in a way no trigger saw.
  add(ledger.length > 0, "stock_history", ledger.length, `The stock history does not add up for ${ledger.length === 50 ? "50 or more" : ledger.length} variant(s) at a location. Tell Kaizena Flow's support.`, "/inventory/history");
  // The tax profile (D157): registered without a number, a number never checked valid, IOSS or OSS half filled in.
  for (const finding of taxFindings) add(true, "tax", 1, finding.message, "/settings/tax");
  // Invoices and credit notes (D159): numbering in sequence, invoices waiting, a refund with no credit note, PDFs that could not be made.
  for (const finding of documentFindings) add(true, "documents", 1, finding.message, "/invoices");
  add(Number(counts.drafts) > 0, "drafts", Number(counts.drafts), `${counts.drafts} product(s) are drafts, not on the site.`, "/products");
  add(store.paymentsTest && store.paymentsOn, "payments_test", 1, "Payments are in test mode: shoppers cannot really pay yet.", "/settings/payments");
  for (const i of integrations) add(i.enabled && i.recentFailures > 0, "integration", i.recentFailures, `${i.provider} failed ${i.recentFailures} send(s) this week.`, `/integrations/${i.provider}`);
  return findings;
}

