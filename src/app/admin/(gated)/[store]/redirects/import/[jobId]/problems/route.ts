import { NextResponse, type NextRequest } from "next/server";

import { redirectProblemsCsv } from "@/server/data-jobs";
import { sameSite } from "@/server/chat-route";
import { checkPermission } from "@/server/permissions";

/**
 * The problems of a redirect import as a CSV (wave 2, D168, `docs/wave-2-redirects.md` 2.2.4): every finding with its rows, address, severity, code and plain
 * sentence, written by the one CSV writer (a sentence never quotes a cell). A POST for members with `website:write`; a 404 for a job that is not the store's.
 * Never cached.
 */
export async function POST(request: NextRequest, { params }: RouteContext<"/admin/[store]/redirects/import/[jobId]/problems">) {
  const { store: slug, jobId } = await params;
  const member = await checkPermission(slug, "website:write");
  if (!member) return new NextResponse("Not found", { status: 404 });
  if (!sameSite(request)) return new NextResponse("Forbidden", { status: 403 });
  const file = await redirectProblemsCsv(member, jobId);
  if (!file.ok) return new NextResponse("Not found", { status: 404 });
  return new NextResponse(file.csv, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${file.filename}"`, "Cache-Control": "no-store" },
  });
}
