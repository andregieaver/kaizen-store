import "server-only";

import { sql } from "drizzle-orm";

import { mainCurrency } from "@/lib/markets";
import { CAUSES, allBalanced, bridgeSentence, reconcile, reconcileMain, refundsLine, type Cause, type CurrencyBridge, type CurrencySums, type MainBridge, type RefundsLine, type Sum } from "@/lib/tax-reconciliation";

import { inPeriod, NOT_EDIT_REFUND, num, PAID, toMainOne, type Row } from "./analytics-sql";
import { setBasedSnapshot, type SetBasedRead } from "./analytics-totals";
import type { Store } from "./stores";
import { checkRange, documentGroups, sellerFacts, vatReportOf, type TaxRange, type VatReportView } from "./tax-reports";

/**
 * The reconciliation of the VAT report against Finance and the orders (D161, `docs/wave-1c-reports.md` 2.2.1 and 4.7). Per document
 * currency, in integer minor units and with no conversion:
 *
 *   report's VAT = Finance's VAT + timing_in + not_captured + edit_in + edit_credited - timing_out - edit_out - invoicing_off - test_mode - waiting
 *                  - edit_waiting - other
 *
 * Finance's VAT is the sum of `tax_minor` of the paid orders (`PAID` of `analytics-sql.ts`: never a copied or a host's order) placed
 * in the range; the report's is the sum of `tax_minor` of the invoices whose supply date is in it. Each difference is a named cause with
 * its orders counted; the bridge is exact, and one that is not says so. THE ONE MODULE OF THIS UNIT THAT NAMES `commerce.invoices`
 * (`document-readers.test.ts` lists it): it reads an invoice's order, supply date, VAT and currency, nothing personal.
 *
 * Refinement of the spec's 4.7, found when building it: `not_captured` is an invoice in the range of an order Finance does not count as
 * paid, wherever the order was placed (the spec's wording said "placed in the range", which leaves one case unnamed); and `timing_out` is a
 * paid order placed in the range whose invoice is dated outside it (after it, as the spec says; before it cannot happen, but would be named too).
 *
 * Needs review: accountant (section 8, item 5).
 */

const CAUSE_SET = new Set<string>(CAUSES);

/**
 * What the applied changes of the order `o` moved its VAT by (D174), as their documents say: an issued change's additional invoice less its credit note,
 * a change whose documents wait by its own `tax_delta`. A change written into the order's own invoice (`in_original`, the invoice was issued after it) or
 * of an order with no invoice moved nothing that needs naming.
 */
const EDIT_MOVED = sql`
  select sum(case when e.documents = 'issued' then coalesce(ei.tax_minor, 0) - coalesce(ec.tax_minor, 0) else e.tax_delta end) as moved
  from commerce.order_edits e
  left join commerce.invoices ei on ei.store_id = e.store_id and ei.order_edit_id = e.id and ei.kind = 'order_edit'
  left join commerce.credit_notes ec on ec.store_id = e.store_id and ec.order_edit_id = e.id and ec.source = 'order_edit'
  where e.store_id = o.store_id and e.order_id = o.id and e.status = 'applied' and e.documents in ('issued', 'waiting')
`;

export type Undocumented = {
  /** Paid orders of the range that have no invoice at all (invoicing off, test mode, waiting, other): the header line's count. */
  orders: number;
  byCause: Partial<Record<Cause, number>>;
};

export type CurrencyRefunds = RefundsLine & { currency: string };

export type ReconciliationView = {
  range: TaxRange;
  /** One bridge per document currency the range has anything in, in currency order. */
  bridges: CurrencyBridge[];
  /** The same in the store's main currency (Finance at today's rates, the report at its stored ones), with its closing lines. */
  main: MainBridge;
  /** Every currency's bridge balances. */
  balanced: boolean;
  /** "Equal: every difference is named." or "Does not reconcile". */
  sentence: string;
  undocumented: Undocumented;
  /** Finance's refunds without VAT against the credit notes' net amounts, per currency: informational, no identity. */
  refunds: CurrencyRefunds[];
};

const add = (sum: Sum | undefined, orders: number, taxMinor: number): Sum => ({ orders: (sum?.orders ?? 0) + orders, taxMinor: (sum?.taxMinor ?? 0) + taxMinor });

/** The sums per currency of the paid orders placed in the range and of the invoices dated in it, split by cause. */
export async function currencySums(store: Store, range: TaxRange, read: SetBasedRead): Promise<CurrencySums[]> {
  checkRange(range);
  const id = store.id;
  const from = range.from;
  const to = range.to;
  // One snapshot, read in turn (one connection): the two sides are the same moment's.
  const orders =
    // Finance's side: every paid order placed in the range, and why it is not in the report's (no invoice, or one dated outside the range).
    await read<Row>(sql`
      select currency, cause, count(*)::int as orders, coalesce(sum(tax_minor), 0)::bigint as tax
      from (
        select o.currency::text as currency,
          -- An edited order (D174): Finance's VAT is the order's now; its original invoice's part is that less what its changes moved (each in
          -- editParts below), so the original invoice bridges on its own. An order with no invoice of its own is one undocumented row, whole.
          o.tax_minor - case when i.id is null then 0 else coalesce(ed.moved, 0) end as tax_minor,
          case
            when i.id is null then
              case commerce.invoice_eligibility(o.id) when 'disabled' then 'invoicing_off' when 'test_mode' then 'test_mode' when 'ok' then 'waiting' else 'other' end
            when i.supply_date >= ${from}::date and i.supply_date < ${to}::date then null
            else 'timing_out'
          end as cause
        from commerce.orders o
        left join commerce.invoices i on i.store_id = o.store_id and i.order_id = o.id and i.kind = 'order'
        left join lateral (${EDIT_MOVED}) ed on true
        where o.store_id = ${id}::uuid and ${PAID} and ${inPeriod(store, sql`o.placed_at`, range)}
      ) t
      group by currency, cause
    `);
  const editParts =
    // Finance's side of the changes (D174): per applied change of a paid order placed in the range that has its own invoice, the VAT its additional
    // invoice added (matched, or `edit_out` when dated outside the range), the VAT its credit note took off (`edit_credited`: in Finance's figure
    // already, never in the report's VAT charged) and the VAT of a change whose documents wait (`edit_waiting`).
    await read<Row>(sql`
      select currency, cause, count(*)::int as orders, coalesce(sum(tax_minor), 0)::bigint as tax
      from (
        select o.currency::text as currency, ei.tax_minor,
          case when ei.supply_date >= ${from}::date and ei.supply_date < ${to}::date then 'edit_matched' else 'edit_out' end as cause
        from commerce.orders o
        join commerce.invoices i on i.store_id = o.store_id and i.order_id = o.id and i.kind = 'order'
        join commerce.order_edits e on e.store_id = o.store_id and e.order_id = o.id and e.status = 'applied' and e.documents = 'issued'
        join commerce.invoices ei on ei.store_id = e.store_id and ei.order_edit_id = e.id and ei.kind = 'order_edit'
        where o.store_id = ${id}::uuid and ${PAID} and ${inPeriod(store, sql`o.placed_at`, range)}
        union all
        select o.currency::text, ec.tax_minor, 'edit_credited'
        from commerce.orders o
        join commerce.invoices i on i.store_id = o.store_id and i.order_id = o.id and i.kind = 'order'
        join commerce.order_edits e on e.store_id = o.store_id and e.order_id = o.id and e.status = 'applied' and e.documents = 'issued'
        join commerce.credit_notes ec on ec.store_id = e.store_id and ec.order_edit_id = e.id and ec.source = 'order_edit'
        where o.store_id = ${id}::uuid and ${PAID} and ${inPeriod(store, sql`o.placed_at`, range)}
        union all
        select o.currency::text, e.tax_delta, 'edit_waiting'
        from commerce.orders o
        join commerce.invoices i on i.store_id = o.store_id and i.order_id = o.id and i.kind = 'order'
        join commerce.order_edits e on e.store_id = o.store_id and e.order_id = o.id and e.status = 'applied' and e.documents = 'waiting'
        where o.store_id = ${id}::uuid and ${PAID} and ${inPeriod(store, sql`o.placed_at`, range)}
      ) t
      group by currency, cause
    `);
  const invoices =
    // The report's side: every invoice dated in the range, and why it is not in Finance's (placed before, or not counted as paid).
    await read<Row>(sql`
      select currency, cause, count(distinct order_id)::int as orders, coalesce(sum(tax_minor), 0)::bigint as tax
      from (
        select i.currency::text as currency, i.tax_minor, i.order_id,
          case
            when not ${PAID} then 'not_captured'
            when ${inPeriod(store, sql`o.placed_at`, range)} then null
            when i.kind = 'order_edit' then 'edit_in'
            else 'timing_in'
          end as cause
        from commerce.invoices i
        join commerce.orders o on o.store_id = i.store_id and o.id = i.order_id
        where i.store_id = ${id}::uuid and i.supply_date >= ${from}::date and i.supply_date < ${to}::date
      ) t
      group by currency, cause
    `);

  const byCurrency = new Map<string, CurrencySums>();
  const of = (currency: string): CurrencySums => {
    let sums = byCurrency.get(currency);
    if (!sums) {
      sums = { currency, finance: { orders: 0, taxMinor: 0 }, report: { orders: 0, taxMinor: 0 }, causes: {} };
      byCurrency.set(currency, sums);
    }
    return sums;
  };
  for (const row of orders) {
    const sums = of(String(row.currency).trim());
    sums.finance = add(sums.finance, num(row, "orders"), num(row, "tax"));
    const cause = row.cause === null || row.cause === undefined ? null : String(row.cause);
    if (cause !== null) {
      if (!CAUSE_SET.has(cause)) throw new Error(`Unknown reconciliation cause: ${cause}`);
      sums.causes[cause as Cause] = add(sums.causes[cause as Cause], num(row, "orders"), num(row, "tax"));
    }
  }
  // The changes' parts of Finance's orders (D174): the order is already counted once above, so these add VAT to Finance's figure (or, for a credit
  // note, take it away) without adding an order; each is a cause unless its additional invoice is dated in the range (matched with the report's row).
  for (const row of editParts) {
    const sums = of(String(row.currency).trim());
    const tax = num(row, "tax");
    const cause = String(row.cause);
    if (cause === "edit_matched") {
      sums.finance = add(sums.finance, 0, tax);
      continue;
    }
    if (!CAUSE_SET.has(cause)) throw new Error(`Unknown reconciliation cause: ${cause}`);
    // A credit note's VAT is already out of the order's figure: Finance holds it as less, the cause names it as more on the way to the report.
    const credit = cause === "edit_credited";
    sums.finance = add(sums.finance, 0, credit ? -tax : tax);
    sums.causes[cause as Cause] = add(sums.causes[cause as Cause], num(row, "orders"), tax);
  }
  for (const row of invoices) {
    const sums = of(String(row.currency).trim());
    sums.report = add(sums.report, num(row, "orders"), num(row, "tax"));
    const cause = row.cause === null || row.cause === undefined ? null : String(row.cause);
    if (cause !== null) {
      if (!CAUSE_SET.has(cause)) throw new Error(`Unknown reconciliation cause: ${cause}`);
      sums.causes[cause as Cause] = add(sums.causes[cause as Cause], num(row, "orders"), num(row, "tax"));
    }
  }
  return [...byCurrency.values()].sort((a, b) => a.currency.localeCompare(b.currency));
}

/** Finance's refunds without VAT (each scaled by its order's share, as Finance does) against the credit notes' net amounts, per currency. */
async function refundComparison(store: Store, range: TaxRange, read: SetBasedRead): Promise<CurrencyRefunds[]> {
  const id = store.id;
  const finance = await read<Row>(sql`
      select rp.currency::text as currency, count(*)::int as n,
        coalesce(sum(round(r.amount_minor::numeric * (o.total_minor - o.tax_minor) / nullif(o.total_minor, 0))), 0)::bigint as amount
      from commerce.refunds r
      join commerce.payments rp on rp.store_id = r.store_id and rp.id = r.payment_id
      join commerce.orders o on o.store_id = rp.store_id and o.id = rp.order_id
      where r.store_id = ${id}::uuid and r.status = 'succeeded' and ${NOT_EDIT_REFUND} and ${inPeriod(store, sql`r.created_at`, range)}
        and o.copied_from is null and o.host_id is null
      group by rp.currency
    `);
  const notes = await read<Row>(sql`
      select c.currency::text as currency, count(*)::int as n, coalesce(sum(c.net_minor), 0)::bigint as net
      from commerce.credit_notes c
      where c.store_id = ${id}::uuid and c.source = 'refund' and c.issued_on >= ${range.from}::date and c.issued_on < ${range.to}::date
      group by c.currency
    `);
  const currencies = [...new Set([...finance.map((r) => String(r.currency).trim()), ...notes.map((r) => String(r.currency).trim())])].sort();
  return currencies.map((currency) => {
    const f = finance.find((r) => String(r.currency).trim() === currency);
    const n = notes.find((r) => String(r.currency).trim() === currency);
    return { currency, ...refundsLine(num(f, "amount"), num(n, "net"), num(f, "n")) };
  });
}

/** Paid orders of the range with no invoice at all, by cause: the VAT view's header line. */
export function undocumentedOf(sums: readonly CurrencySums[]): Undocumented {
  const byCause: Partial<Record<Cause, number>> = {};
  let orders = 0;
  for (const s of sums) {
    for (const cause of ["invoicing_off", "test_mode", "waiting", "other"] as const) {
      const n = s.causes[cause]?.orders ?? 0;
      if (n === 0) continue;
      byCause[cause] = (byCause[cause] ?? 0) + n;
      orders += n;
    }
  }
  return { orders, byCause };
}

/** The VAT view and the reconciliation of one range, read in one snapshot so the table and the bridge's report line are the same figures. */
export type TaxSnapshot = { view: VatReportView; reconciliation: ReconciliationView };

/**
 * The VAT view and the reconciliation of a range of store days, from one read-only `REPEATABLE READ` transaction: an invoice the cron issues
 * while the page is being made is in both or in neither, so a render never shows a spurious "Does not reconcile" nor a table that disagrees
 * with the bridge's report line. The seller facts (settings, not documents) are read beside it.
 */
export async function taxSnapshot(store: Store, range: TaxRange): Promise<TaxSnapshot> {
  checkRange(range);
  const [read, seller] = await Promise.all([
    setBasedSnapshot(async (query) => ({
      groups: await documentGroups(store.id, range, query),
      sums: await currencySums(store, range, query),
      refunds: await refundComparison(store, range, query),
    })),
    sellerFacts(store.id),
  ]);
  const view = vatReportOf(store, range, read.groups, seller);
  const bridges = read.sums.map(reconcile);
  const main = reconcileMain(mainCurrency(store), read.sums, view.report.totals.vatChargedMainMinor, (currency, minor) => toMainOne(store, currency, minor), view.report.notConverted.leftOut);
  return {
    view,
    reconciliation: {
      range,
      bridges,
      main,
      balanced: allBalanced(bridges),
      sentence: bridgeSentence(bridges),
      undocumented: undocumentedOf(read.sums),
      refunds: read.refunds,
    },
  };
}

/** The reconciliation of a range of store days (the VAT view's other half: `taxSnapshot()` gives both from one read). */
export async function reconciliation(store: Store, range: TaxRange): Promise<ReconciliationView> {
  return (await taxSnapshot(store, range)).reconciliation;
}
