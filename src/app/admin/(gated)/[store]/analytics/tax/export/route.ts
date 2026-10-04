import { NextResponse, type NextRequest } from "next/server";

import { exportBackHref, parseExportForm, type ExportProblem } from "@/lib/tax-admin";
import { sameSite } from "@/server/chat-route";
import { checkPermission } from "@/server/permissions";
import { exportReconciliation, exportReturnData, exportVatReport, type ExportResult } from "@/server/tax-report-exports";

/**
 * The CSV files of the VAT, OSS and IOSS page (D161, `docs/wave-1c-reports.md` 2.2.2 and 4.8). A POST from the page's own forms, for
 * members with `analytics:write`: an export is written to the export log and the activity log before the file is handed back, so it is
 * never a link a browser or a crawler could open by itself, and it must come from the admin itself. A person without the role gets a
 * 404 as for any page they cannot open. A refusal goes back to the page with a code the page turns into a fixed sentence (never text
 * from the address): a bad period, a return that is incomplete (a euro rate is missing), no write access, or a log that could not be
 * written (then no file is made). Never cached.
 *
 * THE FILES ARE THE OWNER'S OWN DATA FOR THE OWNER'S ACCOUNTANT. They are not a tax return and Kaizen files nothing.
 */
export async function POST(request: NextRequest, { params }: RouteContext<"/admin/[store]/analytics/tax/export">) {
  const { store: slug } = await params;
  const member = await checkPermission(slug, "analytics:write");
  if (!member) return new NextResponse("Not found", { status: 404 });
  if (!sameSite(request)) return new NextResponse("Forbidden", { status: 403 });

  const form = await request.formData().catch(() => null);
  const asked = parseExportForm({ get: (name: string) => form?.get(name) ?? null });
  const base = `/admin/${slug}`;
  const back = (problem: ExportProblem) => NextResponse.redirect(new URL(exportBackHref(base, asked, problem), request.url), 303);
  if (!asked.ok) return back("period");

  let result: ExportResult;
  try {
    if ("scheme" in asked) result = await exportReturnData(member, asked.scheme, asked.period, asked.mode, asked.detail);
    else if (asked.kind === "vat") result = await exportVatReport(member, asked.range);
    else result = await exportReconciliation(member, asked.range);
  } catch (error) {
    console.error("tax_report.export_failed", error instanceof Error ? error.message : error);
    return back("failed");
  }
  if (!result.ok) return back(result.reason);
  return new NextResponse(`﻿${result.csv}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${result.filename.replace(/[^A-Za-z0-9._-]/g, "_")}"`,
      "Cache-Control": "no-store",
    },
  });
}
