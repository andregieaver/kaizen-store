import { NextResponse, type NextRequest } from "next/server";

import { sameSite } from "@/server/chat-route";
import { checkPermission } from "@/server/permissions";
import { reviewsCsv } from "@/server/review-import";

/**
 * The store's published and waiting reviews as a CSV (D301 G3b, `docs/wave-5-marketing.md` 9.6), from the Reviews page's own form: members who may
 * read products, a direct download written by the one CSV writer, never cached. Hidden reviews stay out; the file holds the names buyers chose to
 * show, never an email address.
 */
export async function POST(request: NextRequest, { params }: RouteContext<"/admin/[store]/reviews/export">) {
  const { store: slug } = await params;
  const member = await checkPermission(slug, "products:read");
  if (!member) return new NextResponse("Not found", { status: 404 });
  if (!sameSite(request)) return new NextResponse("Forbidden", { status: 403 });
  const csv = await reviewsCsv(member.store.id);
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="reviews-${member.store.slug}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
