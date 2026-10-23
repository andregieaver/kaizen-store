import { NextResponse, type NextRequest } from "next/server";

import { exportZone } from "@/server/domain-move";
import { checkOwnerRole } from "@/server/permissions";

/**
 * A kept zone's records to take to another DNS provider (D315 8.2): `?format=bind` (a zone file) or `csv`. Owners only, as moving is; anyone
 * else gets a 404. Read live from Vercel each time, never cached or stored.
 */
export async function GET(request: NextRequest, { params }: RouteContext<"/admin/[store]/settings/domains/move/[domain]/export">) {
  const { store: slug, domain } = await params;
  const member = await checkOwnerRole(slug);
  if (!member) return new NextResponse("Not found", { status: 404 });
  const format = request.nextUrl.searchParams.get("format") === "csv" ? "csv" : "bind";
  const file = await exportZone(member.store.id, decodeURIComponent(domain), format);
  if (!file.ok) return new NextResponse(file.problems.join(" "), { status: 409, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
  return new NextResponse(file.body, {
    headers: {
      "content-type": file.type,
      "content-disposition": `attachment; filename="${file.filename.replace(/[^a-z0-9.-]/gi, "_")}"`,
      "cache-control": "no-store",
    },
  });
}
