import { NextResponse, type NextRequest } from "next/server";

import { sameSite } from "@/server/chat-route";
import { checkOwnerRole } from "@/server/permissions";
import { storeExport } from "@/server/store-export";

/**
 * The whole store as one JSON file (wave 10 unit P, D377): its website, look and settings, never a secret or a person (`storeExport()`).
 * A POST from the store's own Close store page, for the owner; anyone else gets a 404. Never cached.
 */
export async function POST(request: NextRequest, { params }: RouteContext<"/admin/[store]/settings/close/export">) {
  const member = await checkOwnerRole((await params).store);
  if (!member) return new NextResponse("Not found", { status: 404 });
  if (!sameSite(request)) return new NextResponse("Forbidden", { status: 403 });
  const file = await storeExport(member);
  if (!file.ok) return new NextResponse("Not found", { status: 404 });
  return new NextResponse(file.json, {
    headers: { "Content-Type": "application/json; charset=utf-8", "Content-Disposition": `attachment; filename="${file.filename}"`, "Cache-Control": "no-store" },
  });
}
