import { NextResponse, type NextRequest } from "next/server";

import { NOT_FOUND_WINDOWS } from "@/lib/data-limits";
import { notFoundCsv } from "@/server/not-found";
import { sameSite } from "@/server/chat-route";
import { checkPermission } from "@/server/permissions";

/**
 * The report of pages not found as a CSV (wave 2, D168, `docs/wave-2-redirects.md` 2.3): the rows as the screen shows them for the chosen window and switches,
 * up to 5,000, written by the one CSV writer. A POST from the report's own form for members with `website:read`, at once (a direct download); a 404 for anyone
 * else, a refusal from another site. Never cached. The file holds addresses and counts only.
 */
export async function POST(request: NextRequest, { params }: RouteContext<"/admin/[store]/redirects/404s/export">) {
  const { store: slug } = await params;
  const member = await checkPermission(slug, "website:read");
  if (!member) return new NextResponse("Not found", { status: 404 });
  if (!sameSite(request)) return new NextResponse("Forbidden", { status: 403 });
  const data = await request.formData().catch(() => null);
  const field = (name: string) => (data && typeof data.get(name) === "string" ? String(data.get(name)) : "");
  const days = Number.parseInt(field("days"), 10);
  const file = await notFoundCsv(member, {
    days: (NOT_FOUND_WINDOWS as readonly number[]).includes(days) ? days : NOT_FOUND_WINDOWS[0],
    showCovered: field("covered") === "1",
    showIgnored: field("ignored") === "1",
  });
  if (!file) return new NextResponse("Not found", { status: 404 });
  return new NextResponse(file.csv, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${file.filename}"`, "Cache-Control": "no-store" },
  });
}
