import { NextResponse, type NextRequest } from "next/server";

import { tickResponse } from "@/server/data-routes";
import { sameSite } from "@/server/chat-route";
import { checkOwnerRole } from "@/server/permissions";

/** The step an open order export page asks for (wave 2, D165): runs the job once and answers with its state. The owner only, the same site. */
export async function POST(request: NextRequest, { params }: RouteContext<"/admin/[store]/orders/export/[jobId]/tick">) {
  const { store: slug, jobId } = await params;
  const member = await checkOwnerRole(slug);
  if (!member) return new NextResponse("Not found", { status: 404 });
  if (!sameSite(request)) return new NextResponse("Forbidden", { status: 403 });
  return tickResponse(member, jobId, ["order_export"]);
}
