import { notFound } from "next/navigation";

import { CSV_CONTENT_TYPE, csvFileName, withBom, workReportToCsv } from "@/lib/work-csv";
import { todayIn } from "@/lib/work-dates";
import { parseReportParams, periodReportToCsv, reportFileName } from "@/lib/work-reports";
import { requireMember } from "@/server/auth";
import { clientTimeReport, getPeriodReport } from "@/server/work-reports";

/**
 * A Work report as a spreadsheet file (docs/work.md 5.2, WP9), with the settings of the reports page in
 * the address. For any member, like the page. Text goes through `toCsv()` (RFC 4180, formula-safe),
 * amounts are plain decimals, and the file starts with the byte order mark Excel needs for UTF-8.
 * `?format=time` with a client is that client's time entries (Life's client report), with a fixed fee
 * counted once, in the period it was invoiced.
 */
export async function GET(request: Request, { params }: RouteContext<"/admin/account/work/s/[store]/reports/csv">) {
  const { store } = await requireMember((await params).store);
  if (!store.workOn) notFound();
  const query = Object.fromEntries(new URL(request.url).searchParams);
  const settings = parseReportParams(query, todayIn(store.timeZone));
  const headers = (name: string) => ({
    "Content-Type": CSV_CONTENT_TYPE,
    "Content-Disposition": `attachment; filename="${name}"`,
    "Cache-Control": "private, no-store",
  });

  if (query.format === "time") {
    if (!settings.clientId) notFound();
    const report = await clientTimeReport(store.id, settings.clientId, settings.period);
    if (!report) notFound();
    return new Response(withBom(workReportToCsv(report)), {
      headers: headers(csvFileName("work-time", store.slug, report.clientName, report.periodStart, report.periodEnd)),
    });
  }

  const report = await getPeriodReport(store, {
    from: settings.period.from,
    to: settings.period.to,
    by: settings.by,
    clientId: settings.clientId || null,
  });
  return new Response(withBom(periodReportToCsv(report)), { headers: headers(reportFileName(store.slug, report)) });
}
