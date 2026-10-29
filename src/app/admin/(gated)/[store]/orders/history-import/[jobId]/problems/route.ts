import { NextResponse, type NextRequest } from "next/server";

import { historyProblemsCsv } from "@/server/data-jobs";
import { sameSite } from "@/server/chat-route";
import { checkPermission } from "@/server/permissions";

/**
 * The problems of an order history import as a CSV (wave 11 unit E, D384): every finding with its rows, the order's old name, severity, code
 * and plain sentence, written by the one CSV writer (a sentence never quotes a cell, so no person's email, name or address is in it). A POST for the owner; a 404
 * for a job that is not the store's. Never cached.
 */
export async function POST(request: NextRequest, { params }: RouteContext<"/admin/[store]/orders/history-import/[jobId]/problems">) {
  const { store: slug, jobId } = await params;
  const member = await checkPermission(slug, "owner");
  if (!member) return new NextResponse("Not found", { status: 404 });
  if (!sameSite(request)) return new NextResponse("Forbidden", { status: 403 });
  const file = await historyProblemsCsv(member, jobId);
  if (!file.ok) return new NextResponse("Not found", { status: 404 });
  return new NextResponse(file.csv, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${file.filename}"`, "Cache-Control": "no-store" },
  });
}
