import Link from "next/link";

import { countWords, fillWords } from "@/lib/admin-fill";
import { financeEn, type FinanceMessages } from "@/lib/admin-messages/finance.en";
import { NO_FIGURE } from "@/lib/analytics-core";
import { financeNumbers } from "@/lib/finance-words";
import { formatMoney } from "@/lib/money";
import type { OrderProfitRow, ProfitSummary } from "@/server/order-profit";

import { DataTable, type Column } from "./data-table";
import { AnalyticsSection, Note } from "./section";

/** How many of the least profitable orders the Finance page lists. */
export const LOWEST_ORDERS = 10;

/**
 * Profit by order on the Finance page (D415): the period's orders in one sentence (how many, the average profit, how many lost money, how
 * many wait on cost prices), then the least profitable ones, each a link to its order. Each order's profit is in its own currency; the
 * average is in the store's main currency.
 */
export function OrderProfitsView({
  base,
  locale,
  period,
  rows,
  summary,
  capped,
  cappedAt,
  words = financeEn,
}: {
  base: string;
  locale: string;
  period: string;
  rows: readonly OrderProfitRow[];
  summary: ProfitSummary;
  capped: boolean;
  cappedAt: number;
  words?: FinanceMessages;
}) {
  const w = words.orderProfits;
  const pct = financeNumbers(words).percent;
  const day = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short" });
  const lowest = rows
    .filter((r) => r.profit.profitMinor !== null)
    .sort((a, b) => (a.profit.profitMinor ?? 0) - (b.profit.profitMinor ?? 0))
    .slice(0, LOWEST_ORDERS);
  const columns: Column<OrderProfitRow>[] = [
    {
      key: "order",
      label: w.order,
      cell: (r) => (
        <Link href={`${base}/orders/${r.id}`} className="underline">
          {r.number}
        </Link>
      ),
    },
    { key: "sold", label: w.sold, cell: (r) => day.format(new Date(r.soldAt)) },
    {
      key: "profit",
      label: w.profit,
      align: "right",
      cell: (r) => (
        <span className={(r.profit.profitMinor ?? 0) < 0 ? "text-danger-text" : undefined}>
          {formatMoney(r.profit.profitMinor ?? 0, r.profit.currency, locale)}
          {r.profit.estimated && <span className="ml-1 text-xs text-muted">({w.estimated})</span>}
        </span>
      ),
    },
    { key: "margin", label: w.margin, align: "right", cell: (r) => (r.profit.margin === null ? NO_FIGURE : pct(r.profit.margin)) },
  ];
  return (
    <AnalyticsSection id="finance-order-profit" title={w.title} description={fillWords(w.description, { period })}>
      {summary.orders === 0 ? (
        <p className="text-sm text-muted">{w.none}</p>
      ) : (
        <div className="flex flex-col gap-4">
          <p className="text-sm" data-order-profit-summary>
            {summary.averageMinor !== null && countWords(summary.known, w.summary, { n: summary.known, average: formatMoney(summary.averageMinor, summary.currency, locale) })}{" "}
            {summary.losses > 0 ? countWords(summary.losses, w.losses, { n: summary.losses }) : summary.known > 0 ? w.noLosses : null}{" "}
            {summary.unknown > 0 && (
              <>
                {countWords(summary.unknown, w.unknown, { n: summary.unknown })}{" "}
                <Link href={`${base}/products`} className="underline">
                  {w.addCosts}
                </Link>
              </>
            )}
          </p>
          {lowest.length > 0 && <DataTable caption={w.lowestTitle} showCaption columns={columns} rows={lowest} rowKey={(r) => r.id} exportable={false} exportReason="finance.lowest_orders" />}
          {capped && <Note>{fillWords(w.capped, { n: cappedAt })}</Note>}
        </div>
      )}
    </AnalyticsSection>
  );
}
