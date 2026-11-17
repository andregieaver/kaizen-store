import { NextResponse, type NextRequest } from "next/server";

import { sameSite } from "@/lib/same-site";
import { exportResponses } from "@/server/forms-admin";
import { log } from "@/server/log";
import { checkPermission } from "@/server/permissions";

/**
 * A form's responses as CSV (D705): a POST from the responses page's own button, for those who may read customers (the file holds people's
 * words), same site, never cached. The activity log gets the count, never who.
 */
export async function POST(request: NextRequest, { params }: RouteContext<"/admin/[store]/forms/responses/[formId]/export">) {
  const { store: slug, formId } = await params;
  const member = await checkPermission(slug, "customers:read");
  if (!member) return new NextResponse("Not found", { status: 404 });
  if (!sameSite(request)) return new NextResponse("Forbidden", { status: 403 });
  try {
    const file = await exportResponses({ accountId: member.account.id, storeId: member.store.id }, formId, member.store.timeZone);
    if (!file) return new NextResponse("Not found", { status: 404 });
    return new NextResponse(file.csv, {
      headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${file.name}"`, "Cache-Control": "no-store" },
    });
  } catch (error) {
    log("error", "forms.export_failed", { store: member.store.id }, error);
    return new NextResponse("The file could not be made. Try again.", { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
