import { NextResponse, type NextRequest } from "next/server";

import { exportResponse } from "@/server/data-routes";
import { sameSite } from "@/server/chat-route";
import { checkPermission } from "@/server/permissions";

/**
 * The product file (wave 2, D165, `docs/wave-2-data.md` 2.1, 5.2). A POST from the export page's own form, for members with `products:read`: a file
 * at once when it has at most 2,000 rows, else a job (the page shows it); `intent=download` gives the signed address of a done job's part, logged
 * first. A person without the key gets a 404 as for any page they cannot open; a request from another site is refused. Never cached.
 */
export async function POST(request: NextRequest, { params }: RouteContext<"/admin/[store]/products/export/file">) {
  const { store: slug } = await params;
  const member = await checkPermission(slug, "products:read");
  if (!member) return new NextResponse("Not found", { status: 404 });
  if (!sameSite(request)) return new NextResponse("Forbidden", { status: 403 });
  return exportResponse(request, member, slug, "products");
}
