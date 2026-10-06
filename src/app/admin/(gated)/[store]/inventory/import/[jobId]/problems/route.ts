import { NextResponse, type NextRequest } from "next/server";

import { inventoryProblemsCsv } from "@/server/data-jobs";
import { sameSite } from "@/server/chat-route";
import { checkPermission } from "@/server/permissions";

/**
 * The problems of a stock import as a CSV (wave 3, D172, `docs/wave-3-inventory.md` 2.4): every finding with its row, SKU, severity, code, column and plain
 * sentence, written by the one CSV writer (a sentence never quotes a cell). A POST for members with `products:write`; a 404 for a job that is not the store's.
 * Never cached.
 */
export async function POST(request: NextRequest, { params }: RouteContext<"/admin/[store]/inventory/import/[jobId]/problems">) {
  const { store: slug, jobId } = await params;
  const member = await checkPermission(slug, "products:write");
  if (!member) return new NextResponse("Not found", { status: 404 });
  if (!sameSite(request)) return new NextResponse("Forbidden", { status: 403 });
  const file = await inventoryProblemsCsv(member, jobId);
  if (!file.ok) return new NextResponse("Not found", { status: 404 });
  return new NextResponse(file.csv, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${file.filename}"`, "Cache-Control": "no-store" },
  });
}
