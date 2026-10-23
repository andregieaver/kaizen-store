import { adminText } from "@/lib/admin-text";
import { actionAdminLang } from "@/server/admin-request-lang";
import { NextResponse } from "next/server";

import { sameSite } from "@/lib/same-site";
import { getAccount } from "@/server/auth";
import { requesterEnd } from "@/server/support-kaizen";

const NO_STORE = { "Cache-Control": "no-store" } as const;

/** The account ends one of its own conversations with Kaizen (D216, step 11). */
export async function POST(
  request: Request,
  { params }: RouteContext<"/admin/account/kaizen-support/c/[id]/end">,
) {
  const w = adminText(await actionAdminLang(), "support").problems;
  if (!sameSite(request))
    return NextResponse.json(
      { error: w.notThisSite },
      { status: 403, headers: NO_STORE },
    );
  const account = await getAccount();
  if (!account)
    return NextResponse.json(
      { error: w.signInAgain },
      { status: 401, headers: NO_STORE },
    );
  const { id } = await params;
  return (await requesterEnd(account, id))
    ? NextResponse.json({ ok: true }, { headers: NO_STORE })
    : NextResponse.json(
        { error: w.notHere },
        { status: 404, headers: NO_STORE },
      );
}
