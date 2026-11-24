import type { Metadata } from "next";

import { AdminTextScope } from "@/components/admin/admin-text";
import { AnalyticsHeader } from "@/components/admin/analytics/analytics-header";
import { CompaniesView, type CompaniesState } from "@/components/admin/analytics/companies-view";
import { ExportScope } from "@/components/admin/analytics/export-scope";
import { fillWords } from "@/lib/admin-fill";
import { areaTexts } from "@/lib/admin-area";
import { ANALYTICS_EXPORT_WORDS } from "@/lib/admin-words/analytics-export";
import { COMPANIES_WORDS } from "@/lib/admin-words/companies";
import { formatCount } from "@/lib/analytics-core";
import { queryText } from "@/lib/analytics-export";
import { addDays } from "@/lib/analytics-period";
import { companySummaries } from "@/lib/company-lookup";
import { analyticsContext } from "@/server/analytics-context";
import { analyticsCaptions } from "@/server/analytics-say";
import { companyLookupSettings } from "@/server/company-lookup-settings";
import { companyReport, hasCompanyVisits } from "@/server/company-visits";

export const metadata: Metadata = { title: "Visiting companies" };

/**
 * Which companies visited (D890, `docs/analytics.md` "Companies"): the companies whose networks the store's counted visits came from over
 * the period picked, each with its facts, its visits per day and the pages it looked at. Thin on purpose: the reads are
 * `companyReport()`, the sums `companySummaries()`, the drawing `CompaniesView`.
 */
export default async function CompaniesPage({ params, searchParams }: PageProps<"/admin/[store]/analytics/companies">) {
  const query = await searchParams;
  const ctx = await analyticsContext((await params).store, query);
  const { store } = ctx;
  const words = COMPANIES_WORDS[ctx.lang];
  const { period } = ctx.params;
  const days = Array.from({ length: period.days }, (_, i) => addDays(period.from, i));
  const [report, connection, counted] = await Promise.all([companyReport(store.id, period), companyLookupSettings(), hasCompanyVisits(store.id)]);
  const summaries = companySummaries(report.days, days);
  const visits = summaries.reduce((total, s) => total + s.visits, 0);
  const state: CompaniesState = !store.companyRecognition ? "off" : !connection ? "not_connected" : counted ? "on" : "waiting";
  return (
    <AdminTextScope texts={areaTexts(ctx.lang, { analyticsExport: ANALYTICS_EXPORT_WORDS })}>
      <ExportScope base={ctx.base} query={queryText(query)} owner={ctx.owner} canExport={ctx.canExport} captions={analyticsCaptions(ctx.lang)}>
        <div className="flex flex-col gap-8">
          <AnalyticsHeader
            ctx={ctx}
            path="/analytics/companies"
            title={words.title}
            description={
              <>
                <span className="sm:hidden">{words.phoneLead}</span>
                <span className="max-sm:hidden">{words.description}</span>
              </>
            }
            lead={summaries.length > 0 ? fillWords(words.lead, { companies: formatCount(summaries.length), visits: formatCount(visits) }) : undefined}
            showCompare={false}
          />
          <CompaniesView
            base={ctx.base}
            lang={ctx.lang}
            timeZone={store.timeZone}
            state={state}
            owner={ctx.owner}
            marketless={Boolean(store.address?.marketless)}
            days={days}
            summaries={summaries}
            companies={report.companies}
            words={words}
          />
        </div>
      </ExportScope>
    </AdminTextScope>
  );
}
