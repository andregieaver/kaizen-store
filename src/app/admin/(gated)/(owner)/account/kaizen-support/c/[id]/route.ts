import { NextResponse, type NextRequest } from "next/server";

import { getAccount } from "@/server/auth";
import { requesterFeed } from "@/server/support-kaizen";

const NO_STORE = { "Cache-Control": "no-store" } as const;

/** What is new in one of the account's own conversations with Kaizen (D216, step 11); anyone else's is a 404. */
export async function GET(request: NextRequest, { params }: RouteContext<"/admin/account/kaizen-support/c/[id]">) {
  const account = await getAccount();
  if (!account) return NextResponse.json({ error: "Sign in again." }, { status: 401, headers: NO_STORE });
  const { id } = await params;
  const after = Math.max(0, Math.min(1_000_000, Number.parseInt(request.nextUrl.searchParams.get("after") ?? "0", 10) || 0));
  const answer = await requesterFeed(account, id, after);
  if ("status" in answer) return NextResponse.json({ error: answer.error }, { status: answer.status, headers: NO_STORE });
  return NextResponse.json(answer, { headers: NO_STORE });
}
