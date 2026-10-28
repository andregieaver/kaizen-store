import { NextResponse, type NextRequest } from "next/server";

import { RFM_SEGMENTS, type RfmSegment } from "@/lib/analytics-customers";
import type { SegmentRules } from "@/lib/segments";
import { audit } from "@/server/auth";
import { sameSite } from "@/server/chat-route";
import { log } from "@/server/log";
import { checkOwnerRole } from "@/server/permissions";
import { getSegment, segmentCsv } from "@/server/segments";

/**
 * Everyone in a segment, or in one customer type from analytics, as a CSV (D380): a POST from the page's own button, for the owner only (the
 * file holds people's addresses, as the customer file does, D165), same site, never cached. The activity log gets the segment and how many
 * rows, never who; a person without the owner's key gets a 404.
 */
export async function POST(request: NextRequest, { params }: RouteContext<"/admin/[store]/segments/csv">) {
  const { store: slug } = await params;
  const member = await checkOwnerRole(slug);
  if (!member) return new NextResponse("Not found", { status: 404 });
  if (!sameSite(request)) return new NextResponse("Forbidden", { status: 403 });
  const form = await request.formData().catch(() => null);
  const segmentId = String(form?.get("segment") ?? "");
  const group = String(form?.get("rfm") ?? "");

  let rules: SegmentRules | null = null;
  let name = "";
  if (segmentId) {
    const segment = /^[0-9a-f-]{36}$/.test(segmentId) ? await getSegment(member.store.id, segmentId) : null;
    rules = segment?.rules ?? null;
    name = segment ? "segment" : "";
  } else if ((RFM_SEGMENTS as readonly string[]).includes(group)) {
    rules = { match: "all", conditions: [{ kind: "rfm", groups: [group as RfmSegment] }] };
    name = `customers-${group.toLowerCase().replace(/\s+/g, "-")}`;
  }
  if (!rules) return new NextResponse("Not found", { status: 404 });

  try {
    const { csv, rows } = await segmentCsv(member.store, rules);
    await audit(
      member.account.id,
      member.store.id,
      "segment.exported",
      { segment: segmentId || null, customerType: segmentId ? null : group, rows },
      { area: "marketing", target: segmentId ? { type: "segment", id: segmentId } : undefined },
    );
    const file = `${name}-${new Date().toISOString().slice(0, 10)}.csv`;
    return new NextResponse(csv, {
      headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${file}"`, "Cache-Control": "no-store" },
    });
  } catch (error) {
    log("error", "segment.export_failed", { store: member.store.id }, error);
    return new NextResponse("The file could not be made. Try again.", { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
