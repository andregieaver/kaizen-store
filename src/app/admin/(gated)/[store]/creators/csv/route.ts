import { NextResponse, type NextRequest } from "next/server";

import { audit } from "@/server/auth";
import { sameSite } from "@/server/chat-route";
import { creatorPayoutsCsv } from "@/server/creators";
import { log } from "@/server/log";
import { checkOwnerRole } from "@/server/permissions";

/**
 * The store's creator payouts as a CSV (D386): a POST from the page's own button, for the owner only (as recording them is), same site,
 * never cached. The activity log gets that it was downloaded, never who is in it.
 */
export async function POST(request: NextRequest, { params }: RouteContext<"/admin/[store]/creators/csv">) {
  const { store: slug } = await params;
  const member = await checkOwnerRole(slug);
  if (!member) return new NextResponse("Not found", { status: 404 });
  if (!sameSite(request)) return new NextResponse("Forbidden", { status: 403 });
  try {
    const csv = await creatorPayoutsCsv(member.store.id);
    await audit(member.account.id, member.store.id, "creator.payouts_exported", {}, { area: "marketing" });
    const file = `creator-payouts-${new Date().toISOString().slice(0, 10)}.csv`;
    return new NextResponse(csv, {
      headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${file}"`, "Cache-Control": "no-store" },
    });
  } catch (error) {
    log("error", "creator.payouts_export_failed", { store: member.store.id }, error);
    return new NextResponse("The file could not be made. Try again.", { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
