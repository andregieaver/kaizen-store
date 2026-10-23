import { NextResponse, type NextRequest } from "next/server";

import { checkPermission } from "@/server/permissions";
import { memberDesk } from "@/server/support-desk";
import { NO_STORE, inboxFeed, inboxQuery } from "@/server/support-inbox";

/** The store's support inbox list (D216), polled by the open inbox: `support:read`. */
export async function GET(
  request: NextRequest,
  { params }: RouteContext<"/admin/[store]/support/feed">,
) {
  const member = await checkPermission((await params).store, "support:read");
  if (!member)
    return new NextResponse("Not found", { status: 404, headers: NO_STORE });
  return NextResponse.json(
    await inboxFeed(
      [memberDesk(member)],
      inboxQuery(request.nextUrl.searchParams),
    ),
    { headers: NO_STORE },
  );
}
