import { NextResponse, type NextRequest } from "next/server";

import { tickResponse } from "@/server/data-routes";
import { sameSite } from "@/server/chat-route";
import { checkPermission } from "@/server/permissions";

/** The step an open redirect export page asks for (wave 2, D168): runs the export once and answers with its state. `website:read`, the same site. */
export async function POST(request: NextRequest, { params }: RouteContext<"/admin/[store]/redirects/export/[jobId]/tick">) {
  const { store: slug, jobId } = await params;
  const member = await checkPermission(slug, "website:read");
  if (!member) return new NextResponse("Not found", { status: 404 });
  if (!sameSite(request)) return new NextResponse("Forbidden", { status: 403 });
  return tickResponse(member, jobId, ["redirect_export"]);
}
