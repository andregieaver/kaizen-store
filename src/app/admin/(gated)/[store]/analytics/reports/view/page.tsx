import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { AdminTextScope } from "@/components/admin/admin-text";
import { requireFeature } from "@/components/admin/feature-off";
import { ReportBuilder } from "@/components/admin/reports/report-builder";
import { ReportView } from "@/components/admin/reports/report-view";
import { Card, PageHeader } from "@/components/admin/ui";
import { adminText, adminTexts } from "@/lib/admin-text";
import { analyticsWords } from "@/lib/analytics-words";
import { blankSpec, describeSpec, READY_KEYS, READY_REPORTS, type ReadyKey, type ReportSpec } from "@/lib/report-catalogue";
import { readSpec } from "@/lib/report-catalogue-schema";
import { problemText } from "@/lib/report-words";
import { analyticsContext } from "@/server/analytics-context";
import { memberCan } from "@/server/permissions";
import { labelOf, reportLabels } from "@/server/report-labels";
import { runReport } from "@/server/report-query";
import { getSavedReport } from "@/server/saved-reports";

import { deleteReportAction, saveReportAction } from "../actions";

export const metadata: Metadata = { title: "Report" };

const one = (value: string | string[] | undefined): string | undefined => (Array.isArray(value) ? value[0] : value);

function specFromAddress(raw: string | undefined): ReportSpec | null {
  if (!raw) return null;
  try {
    return readSpec(JSON.parse(raw));
  } catch {
    return null;
  }
}

/**
 * One report (wave 8 unit A, D345): a saved one (`id`), a ready one (`ready`) or a new one, changed in the builder (`q`, the spec in the
 * address, so a report is a link). The result is read on the server through `runReport()`; saving and the CSV need `analytics:write`.
 */
export default async function ReportViewPage({ params, searchParams }: PageProps<"/admin/[store]/analytics/reports/view">) {
  const query = await searchParams;
  const ctx = await analyticsContext((await params).store, query);
  const shopOff = requireFeature(ctx, "shop");
  if (shopOff) return shopOff;
  const w = adminText(ctx.lang, "customReports");
  const aw = analyticsWords();

  const id = one(query.id);
  const saved = id ? await getSavedReport(ctx.store.id, id) : null;
  if (id && !saved) notFound();
  const readyKey = one(query.ready);
  const ready = READY_KEYS.includes(readyKey as ReadyKey) ? (readyKey as ReadyKey) : null;
  const spec = specFromAddress(one(query.q)) ?? saved?.spec ?? (ready ? READY_REPORTS[ready] : blankSpec());
  const title = saved?.title ?? (ready ? w.page.ready[ready] : w.page.newReport);

  const outcome = await runReport(ctx.store, spec, ctx.now).catch((error: unknown) => {
    console.error("analytics.report_failed", error instanceof Error ? error.message : error);
    return null;
  });
  const labels = outcome?.ok ? await reportLabels(ctx.store, outcome.report, ctx.lang, ctx.locale) : null;
  const report = outcome?.ok ? outcome.report : null;
  const description =
    report && labels
      ? describeSpec(spec, w.catalogue, {
          period: report.period.label,
          comparison: report.comparison ? (spec.period.compare === "year" ? aw.compare.theLastYear : aw.compare.thePrevious) : null,
          currency: report.currency,
          filterValue: (d, v) => labelOf(labels, d, v),
        })
      : undefined;
  const canWrite = memberCan(ctx, "analytics:write");
  const path = `${ctx.base}/analytics/reports/view`;

  return (
    <AdminTextScope texts={adminTexts(ctx.lang, ["analytics", "customReports"])}>
      <div className="flex flex-col gap-8">
        <PageHeader back={{ href: `${ctx.base}/analytics/reports`, label: w.page.title }} title={title} description={description} />

        {saved && one(query.saved) === "1" && (
          <p role="status" className="rounded-panel border border-positive-line bg-positive-soft p-3 text-sm text-positive-text">
            {w.save.saved}
          </p>
        )}

        <Card title={w.builder.title}>
          <ReportBuilder
            path={path}
            id={saved?.id ?? null}
            initial={spec}
            words={{ builder: w.builder, catalogue: w.catalogue, problems: w.problems }}
            periodWords={{ presets: aw.period.presets, compare: aw.compare.modes }}
          />
        </Card>

        <Card title={title}>
          {outcome === null ? (
            <div role="alert">
              <p className="text-body-strong">{w.result.unreadable}</p>
              <p className="text-sm text-muted">{w.result.unreadableText}</p>
            </div>
          ) : !outcome.ok ? (
            <ul role="alert" className="flex flex-col gap-1 text-sm text-warning-text">
              {outcome.problems.map((p, i) => (
                <li key={i}>{problemText(p, w)}</li>
              ))}
            </ul>
          ) : (
            <div className="flex flex-col gap-4">
              <ReportView
                report={outcome.report}
                labels={outcome.report.rows.map((row) => spec.dimensions.map((d, i) => labelOf(labels!, d, row.keys[i])))}
                words={w}
                locale={ctx.locale}
              />
              {canWrite && (
                <form method="post" action={`${ctx.base}/analytics/reports/csv`}>
                  <input type="hidden" name="spec" value={JSON.stringify(spec)} />
                  <input type="hidden" name="title" value={title} />
                  <SubmitButton variant="secondary">{w.csv.download}</SubmitButton>
                </form>
              )}
            </div>
          )}
        </Card>

        {canWrite && (
          <Card title={w.save.save}>
            <ActionForm action={saveReportAction.bind(null, ctx.store.slug)} className="flex flex-wrap items-end gap-3">
              <input type="hidden" name="spec" value={JSON.stringify(spec)} />
              <input type="hidden" name="id" value={saved?.id ?? ""} />
              <label className="flex min-w-64 flex-1 flex-col gap-1 text-sm">
                {w.save.name}
                <input name="title" required maxLength={80} defaultValue={saved?.title ?? title} />
              </label>
              {saved && (
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="asNew" value="1" />
                  {w.save.saveAs}
                </label>
              )}
              <SubmitButton>{w.save.save}</SubmitButton>
            </ActionForm>
            {saved && (
              <ActionForm action={deleteReportAction.bind(null, ctx.store.slug)} className="mt-4 flex flex-wrap items-center gap-3">
                <input type="hidden" name="id" value={saved.id} />
                <SubmitButton variant="secondary">{w.save.delete}</SubmitButton>
                <span className="text-caption text-muted">{w.save.deleteNote}</span>
              </ActionForm>
            )}
          </Card>
        )}
      </div>
    </AdminTextScope>
  );
}
