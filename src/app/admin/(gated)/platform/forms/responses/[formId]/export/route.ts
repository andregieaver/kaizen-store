import { NextResponse, type NextRequest } from "next/server";

import { sameSite } from "@/lib/same-site";
import { getAccount, platformCan } from "@/server/auth";
import { exportResponses } from "@/server/forms-admin";
import { log } from "@/server/log";

/** One of Kaizena Flow's forms' responses as CSV (D705): a POST from its own page, same site, never cached; audited with the count only. */
export async function POST(request: NextRequest, { params }: RouteContext<"/admin/platform/forms/responses/[formId]/export">) {
  const account = await getAccount();
  if (!account || !platformCan(account, "website", "read")) return new NextResponse("Not found", { status: 404 });
  if (!sameSite(request)) return new NextResponse("Forbidden", { status: 403 });
  try {
    const file = await exportResponses({ accountId: account.id, storeId: null }, (await params).formId, "Europe/Oslo");
    if (!file) return new NextResponse("Not found", { status: 404 });
    return new NextResponse(file.csv, {
      headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${file.name}"`, "Cache-Control": "no-store" },
    });
  } catch (error) {
    log("error", "forms.export_failed", {}, error);
    return new NextResponse("The file could not be made. Try again.", { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
