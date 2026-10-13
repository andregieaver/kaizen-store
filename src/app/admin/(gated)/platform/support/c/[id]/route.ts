import { NextResponse, type NextRequest } from "next/server";

import { checkKaizenDesk } from "@/server/support-desk";
import { NO_STORE, UUID, afterOf, conversationFeed } from "@/server/support-inbox";

/** One conversation of Kaizen's own desk after the message the page last saw (D216), for platform admins. */
export async function GET(request: NextRequest, { params }: RouteContext<"/admin/platform/support/c/[id]">) {
  const { id } = await params;
  const desk = await checkKaizenDesk();
  if (!desk || !UUID.test(id)) return new NextResponse("Not found", { status: 404, headers: NO_STORE });
  const conversation = await conversationFeed(desk, id, afterOf(request.nextUrl.searchParams));
  if (!conversation) return new NextResponse("Not found", { status: 404, headers: NO_STORE });
  return NextResponse.json(conversation, { headers: NO_STORE });
}
