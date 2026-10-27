import { connection, NextResponse } from "next/server";

import { isStoreSlug, storeHome, storeOrigin } from "@/lib/paths";
import { getAccount, getAssurance, heldDestination } from "@/server/auth";
import { checkPermission } from "@/server/permissions";
import { mintUnlock, unlockCookie } from "@/server/private-mode";

/**
 * *Preview the store* (D339): a member who may read the store's website is let into it while it is private, for `STAFF_HOURS` hours. Where the
 * store's pages are on the admin's host, the pass is set here at once; on the store's own host (P7), where the admin's sign-in cannot be seen,
 * the browser is handed a 90-second `enter` token for `/api/private/enter` there (the D193 pattern), always the host the server knows.
 */

const HEADERS = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" };

const text = (message: string, status: number) => new Response(message, { status, headers: { ...HEADERS, "Content-Type": "text/plain; charset=utf-8" } });

export async function GET(request: Request) {
  await connection();
  const store = new URL(request.url).searchParams.get("store") ?? "";
  if (!isStoreSlug(store)) return text("That link is not right.", 400);
  if (!(await getAccount())) {
    const held = await getAssurance();
    const destination = held ? heldDestination(held.assurance) : null;
    return NextResponse.redirect(new URL(destination ?? "/admin/sign-in", request.url), { status: 303, headers: HEADERS });
  }
  const member = await checkPermission(store, "website:read");
  if (!member) return text("You cannot see this store's pages.", 403);
  const origin = storeOrigin(store);
  if (!origin) {
    const pass = mintUnlock("staff", member.store, 0);
    if (!pass) return text("Private mode is not set up on this server.", 503);
    const response = NextResponse.redirect(new URL(storeHome(store), request.url), { status: 303, headers: HEADERS });
    response.cookies.set(unlockCookie(member.store.id, pass, "staff", new URL(request.url).protocol === "https:"));
    return response;
  }
  const enter = mintUnlock("enter", member.store, 0);
  if (!enter) return text("Private mode is not set up on this server.", 503);
  const target = new URL("/api/private/enter", origin);
  target.searchParams.set("pass", enter);
  return NextResponse.redirect(target, { status: 303, headers: HEADERS });
}
