import type { Metadata } from "next";

import { AdminTextScope } from "@/components/admin/admin-text";
import { requireFeature } from "@/components/admin/feature-off";
import { AnalyticsHeader } from "@/components/admin/analytics/analytics-header";
import { OssView } from "@/components/admin/analytics/oss-view";
import { Note } from "@/components/admin/analytics/section";
import { TaxViewTabs } from "@/components/admin/analytics/tax-parts";
import { TaxView } from "@/components/admin/analytics/tax-view";
import { fillWords } from "@/lib/admin-fill";
import { taxReportsEn, type TaxReportsMessages } from "@/lib/admin-messages/tax-reports.en";
import { adminText, adminTexts } from "@/lib/admin-text";
import { addDays, rangeLabel, todayIn } from "@/lib/analytics-period";
import { parseTaxQuery, periodOptions, taxHref, type TaxViewId } from "@/lib/tax-admin";
import type { ReturnMode } from "@/lib/oss-return";
import { parseMonthKey, parseQuarterKey, rangeKey, type TaxPeriod } from "@/lib/tax-periods";
import { driftText, exportProblemText, periodText } from "@/lib/tax-report-words";
import { analyticsContext } from "@/server/analytics-context";
import { memberCan } from "@/server/permissions";
import { driftFor, lastExport, returnTotals, vatTotals } from "@/server/tax-report-exports";
import { reconciliation, taxSnapshot } from "@/server/tax-reconciliation";
import type { Store } from "@/server/stores";
import { returnView, vatReport } from "@/server/tax-reports";

import { fetchEcbRateAction, setRateOverrideAction } from "./actions";

export const metadata: Metadata = { title: "VAT reports" };

/** The VAT view's period is the last month unless the address names one: a return is made for the month or quarter that has ended. */
const hasPeriod = (query: Record<string, string | string[] | undefined>) => query.period !== undefined || query.from !== undefined || query.to !== undefined;

/**
 * The VAT view's figures, its reconciliation and its drift line; null when the report itself could not be read (the reconciliation and the
 * drift are asides). The figures and the reconciliation come from one snapshot (`taxSnapshot()`); when the reconciliation's own reads fail
 * the report is read alone and the page says the reconciliation is not available.
 */
async function loadVat(store: Store, range: { from: string; to: string }, w: TaxReportsMessages) {
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
    return { report, reconciliation: recon, drift: drift ? driftText(drift, w) : null };
  } catch {
    return null;
  }
}

/** One return's figures, when it was last exported and what changed since; null when it could not be read. */
async function loadReturn(store: Store, scheme: "oss" | "ioss", period: TaxPeriod, mode: ReturnMode, today: string, w: TaxReportsMessages) {
  try {
    const view = await returnView(store, scheme, period, mode, { today });
    const [last, drift] = await Promise.all([
      lastExport(store.id, scheme, period.key, mode).catch(() => null),
      driftFor(store.id, scheme, period.key, mode, returnTotals(view.data)).catch(() => null),
    ]);
    return { view, lastExportedAt: last?.exportedAt ?? null, drift: drift ? driftText(drift, w) : null };
  } catch {
    return null;
  }
}

function ProblemCard({ title, w }: { title: string; w: TaxReportsMessages }) {
  return (
    <Note tone="warning" title={title}>
      {w.page.unreadableText}
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
  // Sales analytics are part of the online shop (D178 step 5): hidden while it is off; traffic stays.
  const shopOff = requireFeature(ctx, "shop");
  if (shopOff) return shopOff;
  const { store } = ctx;
  const w = ctx.lang === "en" ? taxReportsEn : adminText(ctx.lang, "taxReports");
  const today = todayIn(ctx.now, store.timeZone);
  const query = parseTaxQuery(raw, today);
  // Amounts are written the way the files write them (a decimal point), whatever the store's first market or the admin's language speaks:
  // an accountant reads the screen against the CSV, whose layout is fixed (`tax-csv.ts`). The words around them follow the admin's language.
  const locale = "en";
  const canExport = memberCan(ctx, "analytics:write");
  const exportProblem = exportProblemText(raw.export, w);
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
    const data = await loadVat(ctx.store, range, w);
    body = data ? (
      <TaxView base={ctx.base} locale={locale} range={range} report={data.report} reconciliation={data.reconciliation} drift={data.drift} canExport={canExport} exportProblem={exportProblem} words={w} />
    ) : (
      <ProblemCard title={w.page.vatUnreadable} w={w} />
    );
  } else {
    const scheme = query.view;
    const chosen = scheme === "oss" ? query.quarter : query.month;
    const data = await loadReturn(ctx.store, scheme, chosen, query.mode, today, w);
    const keyed = (key: string) => (scheme === "oss" ? parseQuarterKey(key) : parseMonthKey(key));
    body = data ? (
      <OssView
        base={ctx.base}
        locale={locale}
        scheme={scheme}
        mode={query.mode}
        view={data.view}
        periods={periodOptions(chosen.kind, today).map((p) => {
          const period = keyed(p.key);
          return period ? { ...p, label: periodText(period, w) } : p;
        })}
        canExport={canExport}
        isOwner={ctx.owner}
        drift={data.drift}
        lastExportedAt={data.lastExportedAt}
        exportProblem={exportProblem}
        actions={ctx.owner ? { fetch: fetchEcbRateAction.bind(null, store.slug), override: setRateOverrideAction.bind(null, store.slug) } : null}
        words={w}
      />
    ) : (
      <ProblemCard title={fillWords(w.page.returnUnreadable, { scheme: scheme === "oss" ? "OSS" : "IOSS" })} w={w} />
    );
  }

  return (
    <AdminTextScope texts={adminTexts(ctx.lang, ["taxReports", "analytics"])}>
    <div className="flex flex-col gap-8">
      <AnalyticsHeader
        ctx={ctx}
        path="/analytics/tax"
        title={w.page.title}
        description={w.page.description}
        picker={query.view === "vat"}
        showCompare={false}
        explicitPeriod
        amountsNote={fillWords(w.page.amountsNote, { range: rangeLabel(period.from, period.to) })}
      >
        <TaxViewTabs current={query.view} hrefs={hrefs} words={w} />
      </AnalyticsHeader>
      {body}
    </div>
    </AdminTextScope>
  );
}
