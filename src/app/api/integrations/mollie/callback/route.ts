import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { MOLLIE_COOKIE, MOLLIE_COOKIE_PATH } from "@/lib/mollie";
import { requireAccount } from "@/server/auth";
import { connectMollie, MollieError, mollieStarted } from "@/server/mollie";
import { checkOwnerRole } from "@/server/permissions";

/** Back from Mollie with the owner's approval of Kaizena Flow's app (D292): the connection is kept and the owner lands on the Payments page. */
export async function GET(request: Request) {
  const account = await requireAccount();
  const jar = await cookies();
  const cookie = jar.get(MOLLIE_COOKIE)?.value;
  jar.delete({ name: MOLLIE_COOKIE, path: MOLLIE_COOKIE_PATH });
  const params = new URL(request.url).searchParams;
  let started: { storeSlug: string; accountId: string };
  try {
    started = mollieStarted(cookie, params);
  } catch {
    return NextResponse.redirect(new URL("/admin", request.url));
  }
  const back = (status: string) => NextResponse.redirect(new URL(`/admin/${started.storeSlug}/settings/payments?mollie=${status}`, request.url));
  const owner = started.accountId === account.id ? await checkOwnerRole(started.storeSlug) : null;
  if (!owner) return back("failed");
  try {
    await connectMollie(owner.store.id, account.id, params);
  } catch (error) {
    if (!(error instanceof MollieError)) console.error("[mollie]", error);
    return back(params.get("error") ? "cancelled" : "failed");
  }
  return back("connected");
}
