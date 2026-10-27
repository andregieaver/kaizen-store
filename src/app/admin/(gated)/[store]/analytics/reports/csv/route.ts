import { NextResponse, type NextRequest } from "next/server";

import { adminLangOf, ADMIN_LANG_FACTS } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { readSpec } from "@/lib/report-catalogue-schema";
import { audit } from "@/server/auth";
import { sameSite } from "@/server/chat-route";
import { log } from "@/server/log";
import { checkPermission } from "@/server/permissions";
import { reportCsv } from "@/server/report-export";
import { reportLabels } from "@/server/report-labels";
import { runReport } from "@/server/report-query";

/**
 * A report as a CSV (wave 8 unit A, D345): a POST from the report's own Download CSV button, for members with `analytics:write`, the spec
 * read through the schema and the catalogue again, the store the member's own. The activity log gets an entry (the spec's keys, never its
 * filter values) before the file is handed back, as the analytics tables' export does, so it is never a link a browser could open by
 * itself. A person without the role gets a 404; never cached.
 */
export async function POST(request: NextRequest, { params }: RouteContext<"/admin/[store]/analytics/reports/csv">) {
  const { store: slug } = await params;
  const member = await checkPermission(slug, "analytics:write");
  if (!member) return new NextResponse("Not found", { status: 404 });
  if (!sameSite(request)) return new NextResponse("Forbidden", { status: 403 });
  const lang = adminLangOf(member.account.adminLocale);
  const failed = () => new NextResponse(adminText(lang, "customReports").csv.failed, { status: 500, headers: { "Cache-Control": "no-store" } });

  const form = await request.formData().catch(() => null);
  let spec = null;
  try {
    spec = readSpec(JSON.parse(String(form?.get("spec") ?? "")));
  } catch {
    spec = null;
  }
  if (!spec) return new NextResponse("Not found", { status: 404 });

  try {
    const outcome = await runReport(member.store, spec);
    if (!outcome.ok) return new NextResponse("Not found", { status: 404 });
    const labels = await reportLabels(member.store, outcome.report, lang, ADMIN_LANG_FACTS[lang].locale);
    const csv = reportCsv(outcome.report, labels);
    await audit(member.account.id, member.store.id, "analytics.report_exported", {
      metrics: spec.metrics,
      dimensions: spec.dimensions,
      from: outcome.report.period.from,
      to: outcome.report.period.to,
      rows: outcome.report.rows.length,
    }, { area: "analytics" });
    const name = `report-${outcome.report.period.from}.csv`;
    return new NextResponse(csv, {
      headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "no-store" },
    });
  } catch (error) {
    log("error", "analytics.report_export_failed", { store: member.store.id }, error);
    return failed();
  }
}
