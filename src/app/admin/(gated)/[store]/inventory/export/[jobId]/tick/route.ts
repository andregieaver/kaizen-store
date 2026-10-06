import { NextResponse, type NextRequest } from "next/server";

import { tickResponse } from "@/server/data-routes";
import { sameSite } from "@/server/chat-route";
import { checkPermission } from "@/server/permissions";

/** The step an open stock export page asks for (wave 3, D172): runs the job once and answers with its state. `products:read`, the same site. */
export async function POST(request: NextRequest, { params }: RouteContext<"/admin/[store]/inventory/export/[jobId]/tick">) {
  const { store: slug, jobId } = await params;
  const member = await checkPermission(slug, "products:read");
  if (!member) return new NextResponse("Not found", { status: 404 });
  if (!sameSite(request)) return new NextResponse("Forbidden", { status: 403 });
  return tickResponse(member, jobId, ["inventory_export"]);
}
