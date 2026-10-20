import { NextResponse, type NextRequest } from "next/server";

import { sameSite } from "@/server/chat-route";
import { subscribersCsv } from "@/server/marketing-subscribers";
import { checkOwnerRole } from "@/server/permissions";

/**
 * The subscriber list as a CSV (D295, `docs/wave-5-marketing.md` 3.4): a POST from the Subscribers page's own form, for the OWNER only (personal
 * data), with every row's consent facts; audited with the count only. Never emailed, never cached.
 */
export async function POST(request: NextRequest, { params }: RouteContext<"/admin/[store]/subscribers/export">) {
  const { store: slug } = await params;
  const member = await checkOwnerRole(slug);
  if (!member) return new NextResponse("Not found", { status: 404 });
  if (!sameSite(request)) return new NextResponse("Forbidden", { status: 403 });
  const { csv } = await subscribersCsv(member.store.id, member.account.id);
  const day = new Date().toISOString().slice(0, 10);
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="subscribers-${member.store.slug}-${day}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
