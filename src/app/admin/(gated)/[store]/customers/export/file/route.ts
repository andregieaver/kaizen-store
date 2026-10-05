import { NextResponse, type NextRequest } from "next/server";

import { exportResponse } from "@/server/data-routes";
import { sameSite } from "@/server/chat-route";
import { checkOwnerRole } from "@/server/permissions";

/**
 * The customer file (wave 2, D165, `docs/wave-2-data.md` 2.4, 2.5, 5.2). A POST from the export page's own form, for the OWNER only (personal data):
 * a file at once when it has at most 2,000 customers, else a job; `intent=download` gives the signed address of a done job's part, logged first.
 * `marketing_consent` is always `not_recorded`: Kaizen records no marketing consent yet. Never emailed, never cached.
 */
export async function POST(request: NextRequest, { params }: RouteContext<"/admin/[store]/customers/export/file">) {
  const { store: slug } = await params;
  const member = await checkOwnerRole(slug);
  if (!member) return new NextResponse("Not found", { status: 404 });
  if (!sameSite(request)) return new NextResponse("Forbidden", { status: 403 });
  return exportResponse(request, member, slug, "customers");
}
