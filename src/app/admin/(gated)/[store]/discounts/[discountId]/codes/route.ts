import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { sameSite } from "@/server/chat-route";
import { exportCodeItems } from "@/server/discounts";
import { checkPermission } from "@/server/permissions";

/**
 * A code's single-use codes as a CSV (D299 E1, `docs/wave-5-marketing.md` 7.1): a POST from the code's own page, for staff who may change
 * marketing; audited without any code's text. Never cached.
 */
export async function POST(request: NextRequest, { params }: RouteContext<"/admin/[store]/discounts/[discountId]/codes">) {
  const { store: slug, discountId } = await params;
  const member = await checkPermission(slug, "marketing:write");
  if (!member || !z.uuid().safeParse(discountId).success) return new NextResponse("Not found", { status: 404 });
  if (!sameSite(request)) return new NextResponse("Forbidden", { status: 403 });
  const file = await exportCodeItems(member, discountId);
  if (!file) return new NextResponse("Not found", { status: 404 });
  return new NextResponse(file.csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${file.name}"`,
      "Cache-Control": "no-store",
    },
  });
}
