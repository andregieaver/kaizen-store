import { NextResponse, type NextRequest } from "next/server";

import { checkKaizenDesk } from "@/server/support-desk";
import { NO_STORE, inboxFeed, inboxQuery } from "@/server/support-inbox";

/** Kaizen's own support list (D216, 2.8), for platform admins: Kaizen's desk only, never a store's. */
export async function GET(request: NextRequest) {
  const desk = await checkKaizenDesk();
  if (!desk)
    return new NextResponse("Not found", { status: 404, headers: NO_STORE });
  return NextResponse.json(
    await inboxFeed([desk], inboxQuery(request.nextUrl.searchParams)),
    { headers: NO_STORE },
  );
}
