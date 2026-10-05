import { NextResponse, type NextRequest } from "next/server";

import { queryRecord } from "@/lib/analytics-export";
import { exportAnalyticsTable, mayExportTable } from "@/server/analytics-export";
import { sameSite } from "@/server/chat-route";
import { checkPermission } from "@/server/permissions";

/**
 * A CSV of one analytics table (D165, `docs/wave-2-data.md` 2.8). A POST from the table's own Download CSV button, for members with
 * `analytics:write` (the top customers and the owner's targets also need the owner role): the file is the table as the page shows it for the
 * period, comparison and sort the form carried, made from the page's own loaders, and an entry is written to the activity log BEFORE the file
 * is handed back, so it is never a link a browser or a crawler could open by itself, and it must come from the admin itself. A person without the
 * role gets a 404 as for any page they cannot open; a table that does not exist is a 404 too. Never cached.
 */
export async function POST(request: NextRequest, { params }: RouteContext<"/admin/[store]/analytics/export">) {
  const { store: slug } = await params;
  const member = await checkPermission(slug, "analytics:write");
  if (!member) return new NextResponse("Not found", { status: 404 });
  if (!sameSite(request)) return new NextResponse("Forbidden", { status: 403 });

  const form = await request.formData().catch(() => null);
  const table = form?.get("table");
  if (typeof table !== "string" || !mayExportTable(member, table)) return new NextResponse("Not found", { status: 404 });

  let result;
  try {
    result = await exportAnalyticsTable(member, table, queryRecord(form?.get("query")), form?.get("dialect"));
  } catch (error) {
    console.error("analytics.export_failed", error instanceof Error ? error.message : error);
    return new NextResponse("The file could not be made. Go back and try again.", { status: 500, headers: { "Cache-Control": "no-store" } });
  }
  if (!result.ok) return new NextResponse(result.message, { status: result.reason === "failed" ? 500 : 404, headers: { "Cache-Control": "no-store" } });
  return new NextResponse(result.csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${result.filename.replace(/[^A-Za-z0-9._-]/g, "_")}"`,
      "Cache-Control": "no-store",
    },
  });
}
