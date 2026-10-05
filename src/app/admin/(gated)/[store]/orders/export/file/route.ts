import { NextResponse, type NextRequest } from "next/server";

import { exportResponse } from "@/server/data-routes";
import { sameSite } from "@/server/chat-route";
import { checkOwnerRole } from "@/server/permissions";

/**
 * The order file (wave 2, D165, `docs/wave-2-data.md` 2.3, 5.2). A POST from the export page's own form, for the OWNER only (the file holds personal
 * data; a custom role can never hold `owner`): a file at once when it has at most 2,000 rows, else a job; `intent=download` gives the signed
 * address of a done job's part, logged first. The file is never emailed. A person who is not the owner gets a 404; another site is refused. Never cached.
 */
export async function POST(request: NextRequest, { params }: RouteContext<"/admin/[store]/orders/export/file">) {
  const { store: slug } = await params;
  const member = await checkOwnerRole(slug);
  if (!member) return new NextResponse("Not found", { status: 404 });
  if (!sameSite(request)) return new NextResponse("Forbidden", { status: 403 });
  return exportResponse(request, member, slug, "orders");
}
