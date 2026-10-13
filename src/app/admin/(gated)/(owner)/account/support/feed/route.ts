import { NextResponse, type NextRequest } from "next/server";

import { getAccount } from "@/server/auth";
import { ownerDesks } from "@/server/support-desk";
import { NO_STORE, inboxFeed, inboxQuery } from "@/server/support-inbox";

/**
 * The owner's combined support list (D216, 2.8): every store where the account may read support, narrowed to one by `?store=`. A
 * conversation itself is read through its store's own route, which checks `support:read` there again.
 */
export async function GET(request: NextRequest) {
  const account = await getAccount();
  if (!account) return new NextResponse("Not found", { status: 404, headers: NO_STORE });
  const desks = await ownerDesks(account);
  return NextResponse.json(await inboxFeed(desks, inboxQuery(request.nextUrl.searchParams)), { headers: NO_STORE });
}
