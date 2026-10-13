import { NextResponse, type NextRequest } from "next/server";

import { checkPermission } from "@/server/permissions";
import { memberDesk } from "@/server/support-desk";
import { NO_STORE, UUID, afterOf, conversationFeed } from "@/server/support-inbox";

/** One conversation of the store's desk after the message the page last saw (D216), polled by the open conversation: `support:read`. */
export async function GET(request: NextRequest, { params }: RouteContext<"/admin/[store]/support/c/[id]">) {
  const { store, id } = await params;
  const member = await checkPermission(store, "support:read");
  if (!member || !UUID.test(id)) return new NextResponse("Not found", { status: 404, headers: NO_STORE });
  const conversation = await conversationFeed(memberDesk(member), id, afterOf(request.nextUrl.searchParams));
  if (!conversation) return new NextResponse("Not found", { status: 404, headers: NO_STORE });
  return NextResponse.json(conversation, { headers: NO_STORE });
}
