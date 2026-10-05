import { NextResponse, type NextRequest } from "next/server";

import { tickResponse } from "@/server/data-routes";
import { sameSite } from "@/server/chat-route";
import { checkPermission } from "@/server/permissions";

/** The step an open redirect import page asks for (wave 2, D168): runs the dry run or the apply once and answers with its state. `website:write`, the same site. */
export async function POST(request: NextRequest, { params }: RouteContext<"/admin/[store]/redirects/import/[jobId]/tick">) {
  const { store: slug, jobId } = await params;
  const member = await checkPermission(slug, "website:write");
  if (!member) return new NextResponse("Not found", { status: 404 });
  if (!sameSite(request)) return new NextResponse("Forbidden", { status: 403 });
  return tickResponse(member, jobId, ["redirect_import"]);
}
