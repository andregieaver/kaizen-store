import Link from "next/link";
import type { ReactNode } from "react";

import { fillWords } from "@/lib/admin-fill";
import type { ReportsMessages } from "@/lib/admin-messages/reports.en";
import { formatCount, formatPercent, NO_FIGURE } from "@/lib/analytics-core";
import { formatTimes } from "@/lib/analytics-format";
import { campaignRows, type CampaignRow } from "@/lib/analytics-campaigns";
import type { CampaignReport } from "@/server/analytics-traffic-data";

import { DataTable, type Column } from "./data-table";
import { moneyWriter } from "./overview-view";
import { AnalyticsSection, Note } from "./section";

/**
 * The Marketing page's campaigns (wave 5 unit I3, D303, `docs/analytics.md` "Campaign"): per source and campaign its sessions, paid orders,
 * revenue, new customers, the spend entered for the campaign, CAC and ROAS, by the last visit or the first visit in 30 days (`model`, a link
 * that keeps the rest of the address). Under the first visit it says how many orders know theirs. Plain props; reads nothing itself.
 */
export function CampaignsView({
  report,
  currency,
  locale,
  modelHref,
  words: w,
  children,
}: {
  report: CampaignReport;
  currency: string;
  locale: string;
  /** The page's address with `model` set to the one given. */
  modelHref: (model: "last" | "first") => string;
  words: ReportsMessages["campaigns"];
  /** The link builder and the import, drawn under the table. */
  children?: ReactNode;
}) {
  const money = moneyWriter(currency, locale);
  const rows = campaignRows(report.rows);
  const columns: Column<CampaignRow>[] = [
    { key: "campaign", label: w.columns.campaign, cell: (r) => r.campaign || NO_FIGURE },
    { key: "source", label: w.columns.source, cell: (r) => r.source || NO_FIGURE },
    { key: "sessions", label: w.columns.sessions, align: "right", cell: (r) => formatCount(r.sessions) },
    { key: "orders", label: w.columns.orders, align: "right", cell: (r) => formatCount(r.orders) },
    { key: "revenue", label: w.columns.revenue, align: "right", cell: (r) => money(r.revenueMinor) },
    { key: "conversion", label: w.columns.conversion, align: "right", cell: (r) => (r.conversion === null ? NO_FIGURE : formatPercent(r.conversion)) },
    { key: "newCustomers", label: w.columns.newCustomers, align: "right", cell: (r) => formatCount(r.newCustomers) },
    { key: "spend", label: w.columns.spend, align: "right", cell: (r) => (r.spendMinor > 0 ? money(r.spendMinor) : NO_FIGURE) },
    { key: "cac", label: w.columns.cac, align: "right", cell: (r) => (r.cacMinor === null ? NO_FIGURE : money(r.cacMinor)) },
    { key: "roas", label: w.columns.roas, align: "right", cell: (r) => (r.roas === null ? NO_FIGURE : formatTimes(r.roas)) },
  ];
  const tab = (model: "last" | "first", label: string) => (
    <Link
      href={modelHref(model)}
      aria-current={report.model === model ? "true" : undefined}
      className={`rounded-pill px-3 py-1 text-sm ${report.model === model ? "bg-inverse text-inverse-ink" : "border border-line text-ink-2"}`}
    >
      {label}
    </Link>
  );
  return (
    <AnalyticsSection
      id="campaigns"
      title={w.title}
      description={w.description}
      action={
        <div className="flex gap-2" role="group" aria-label={w.modelLabel}>
          {tab("last", w.lastVisit)}
          {tab("first", w.firstVisit)}
        </div>
      }
    >
      {!report.counting ? (
        <p className="rounded-panel border border-dashed border-line px-4 py-6 text-center text-sm text-muted">{w.notCounting}</p>
      ) : (
        <>
          <DataTable caption={w.caption} columns={columns} rows={rows} rowKey={(r) => `${r.source}|${r.campaign}`} empty={w.empty} exportId="marketing.campaigns" />
          {report.covered ? (
            <p className="max-w-prose text-sm text-muted">
              {fillWords(w.coverage, { known: formatCount(report.covered.known), orders: formatCount(report.covered.orders) })}
            </p>
          ) : null}
          {report.missingCurrencies.length > 0 ? <Note title={w.missingTitle}>{fillWords(w.missing, { currencies: report.missingCurrencies.join(", ") })}</Note> : null}
        </>
      )}
      {children}
    </AnalyticsSection>
  );
}
