import type { Metadata } from "next";

import { AnalyticsHeader } from "@/components/admin/analytics/analytics-header";
import { OssView } from "@/components/admin/analytics/oss-view";
import { Note } from "@/components/admin/analytics/section";
import { TaxViewTabs } from "@/components/admin/analytics/tax-parts";
import { TaxView } from "@/components/admin/analytics/tax-view";
import { addDays, rangeLabel, todayIn } from "@/lib/analytics-period";
import { exportProblemOf, parseTaxQuery, periodOptions, taxHref, type TaxViewId } from "@/lib/tax-admin";
import type { ReturnMode } from "@/lib/oss-return";
import { rangeKey, type TaxPeriod } from "@/lib/tax-periods";
import { analyticsContext } from "@/server/analytics-context";
import { memberCan } from "@/server/permissions";
import { driftFor, driftSentence, lastExport, returnTotals, vatTotals } from "@/server/tax-report-exports";
import { reconciliation, taxSnapshot } from "@/server/tax-reconciliation";
import type { Store } from "@/server/stores";
import { returnView, vatReport } from "@/server/tax-reports";

import { fetchEcbRateAction, setRateOverrideAction } from "./actions";

export const metadata: Metadata = { title: "VAT reports" };

const DESCRIPTION = "VAT by delivery country and rate, the quarterly OSS return data and the monthly IOSS return data, all made from your own invoices and credit notes, and how they agree with Finance and your orders.";

/** The VAT view's period is the last month unless the address names one: a return is made for the month or quarter that has ended. */
const hasPeriod = (query: Record<string, string | string[] | undefined>) => query.period !== undefined || query.from !== undefined || query.to !== undefined;

/**
 * The VAT view's figures, its reconciliation and its drift line; null when the report itself could not be read (the reconciliation and the
 * drift are asides). The figures and the reconciliation come from one snapshot (`taxSnapshot()`); when the reconciliation's own reads fail
 * the report is read alone and the page says the reconciliation is not available.
 */
async function loadVat(store: Store, range: { from: string; to: string }) {
  try {
    let report: Awaited<ReturnType<typeof vatReport>>["report"];
    let recon: Awaited<ReturnType<typeof reconciliation>> | null = null;
    try {
      const snapshot = await taxSnapshot(store, range);
      report = snapshot.view.report;
      recon = snapshot.reconciliation;
    } catch {
      report = (await vatReport(store, range)).report;
    }
    const drift = await driftFor(store.id, "vat", rangeKey(range.from, range.to), null, vatTotals(report)).catch(() => null);
    return { report, reconciliation: recon, drift: drift ? driftSentence(drift) : null };
  } catch {
    return null;
  }
}

/** One return's figures, when it was last exported and what changed since; null when it could not be read. */
async function loadReturn(store: Store, scheme: "oss" | "ioss", period: TaxPeriod, mode: ReturnMode, today: string) {
  try {
    const view = await returnView(store, scheme, period, mode, { today });
    const [last, drift] = await Promise.all([
      lastExport(store.id, scheme, period.key, mode).catch(() => null),
      driftFor(store.id, scheme, period.key, mode, returnTotals(view.data)).catch(() => null),
    ]);
    return { view, lastExportedAt: last?.exportedAt ?? null, drift: drift ? driftSentence(drift) : null };
  } catch {
    return null;
  }
}

function ProblemCard({ title }: { title: string }) {
  return (
    <Note tone="warning" title={title}>
      The other views and the rest of the admin are not affected. Reload the page to try again.
    </Note>
  );
}

/**
 * VAT, OSS and IOSS reports (D161, `docs/wave-1c-reports.md`): three views, `?view=vat|oss|ioss`, made from the store's invoices and
 * credit notes only. Thin on purpose: it reads the address, the figures and the export log and hands them to the views. The guard is
 * `analyticsContext` (`analytics:read`); exports are a POST to `export/` (`analytics:write`) and the euro rates are owner-only actions.
 * A view whose figures cannot be read shows a card saying so and never breaks the page.
 *
 * THESE ARE THE OWNER'S OWN FIGURES, FOR THE OWNER'S ACCOUNTANT. They are not a tax return and Kaizen files nothing.
 */
export default async function AnalyticsTaxPage({ params, searchParams }: PageProps<"/admin/[store]/analytics/tax">) {
  const raw = await searchParams;
  const ctx = await analyticsContext((await params).store, hasPeriod(raw) ? raw : { ...raw, period: "last_month" });
  const { store } = ctx;
  const today = todayIn(ctx.now, store.timeZone);
  const query = parseTaxQuery(raw, today);
  // Amounts are written the way the files write them (a decimal point), whatever the store's first market speaks: the admin is English only
  // and an accountant reads the screen against the CSV.
  const locale = "en";
  const canExport = memberCan(ctx, "analytics:write");
  const exportProblem = exportProblemOf(raw.export);
  const { period } = ctx.params;
  const range = { from: period.from, to: period.to };

  const hrefs: Record<TaxViewId, string> = {
    // A custom range is typed as its last day, as the address carries it.
    vat: taxHref(ctx.base, { view: "vat" }, { period: period.preset, ...(period.preset === "custom" ? { from: period.from, to: addDays(period.to, -1) } : {}) }),
    oss: taxHref(ctx.base, { view: "oss", quarter: query.quarter.key, mode: query.mode }),
    ioss: taxHref(ctx.base, { view: "ioss", month: query.month.key, mode: query.mode }),
  };

  // What each view reads is read here, and its drawing is below: a card that says it could not be read stands in for a view whose figures failed.
  let body;
  if (query.view === "vat") {
    const data = await loadVat(ctx.store, range);
    body = data ? (
      <TaxView base={ctx.base} locale={locale} range={range} report={data.report} reconciliation={data.reconciliation} drift={data.drift} canExport={canExport} exportProblem={exportProblem} />
    ) : (
      <ProblemCard title="The VAT report could not be read" />
    );
  } else {
    const scheme = query.view;
    const chosen = scheme === "oss" ? query.quarter : query.month;
    const data = await loadReturn(ctx.store, scheme, chosen, query.mode, today);
    body = data ? (
      <OssView
        base={ctx.base}
        locale={locale}
        scheme={scheme}
        mode={query.mode}
        view={data.view}
        periods={periodOptions(chosen.kind, today)}
        canExport={canExport}
        isOwner={ctx.owner}
        drift={data.drift}
        lastExportedAt={data.lastExportedAt}
        exportProblem={exportProblem}
        actions={ctx.owner ? { fetch: fetchEcbRateAction.bind(null, store.slug), override: setRateOverrideAction.bind(null, store.slug) } : null}
      />
    ) : (
      <ProblemCard title={`The ${scheme === "oss" ? "OSS" : "IOSS"} return data could not be read`} />
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <AnalyticsHeader
        ctx={ctx}
        path="/analytics/tax"
        title="VAT, OSS and IOSS"
        description={DESCRIPTION}
        picker={query.view === "vat"}
        showCompare={false}
        explicitPeriod
        amountsNote={`${rangeLabel(period.from, period.to)} · VAT in each document's currency and in your main currency`}
      >
        <TaxViewTabs current={query.view} hrefs={hrefs} />
      </AnalyticsHeader>
      {body}
    </div>
  );
}
