import { NextResponse, type NextRequest } from "next/server";

import { tickResponse } from "@/server/data-routes";
import { sameSite } from "@/server/chat-route";
import { checkPermission } from "@/server/permissions";

/** The step an open stock import page asks for (wave 3, D172): runs the dry run or the apply once and answers with its state. `products:write`, the same site. */
export async function POST(request: NextRequest, { params }: RouteContext<"/admin/[store]/inventory/import/[jobId]/tick">) {
  const { store: slug, jobId } = await params;
  const member = await checkPermission(slug, "products:write");
  if (!member) return new NextResponse("Not found", { status: 404 });
  if (!sameSite(request)) return new NextResponse("Forbidden", { status: 403 });
  return tickResponse(member, jobId, ["inventory_import"]);
}
