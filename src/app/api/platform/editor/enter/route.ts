import { connection, NextResponse } from "next/server";

import { backPath } from "@/lib/edit-link";
import { storeOrigins } from "@/lib/paths";
import { mintPass, passCookie, readPassToken } from "@/server/edit-pass";

/**
 * The store's host takes the admin's token (D193, `grant`) and gives the browser the pass for changing words there: an HttpOnly cookie
 * of this host, good for half an hour and sent to the editing routes only, then sends it back to the page it was on. The token must be
 * the admin's (its signature), the link kind, not over, and meant for a host of this very store; nothing is set otherwise. It is
 * a link followed from another site, so it is not held to the same-site check: the token is what it needs.
 */

const HEADERS = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" };

const text = (message: string, status: number) => new Response(message, { status, headers: { ...HEADERS, "Content-Type": "text/plain; charset=utf-8" } });

export async function GET(request: Request) {
  await connection();
  const params = new URL(request.url).searchParams;
  const link = readPassToken("enter", params.get("pass"));
  const to = backPath(params.get("to"));
  if (!link || !to) return text("This link has run out. Go back to the page and press Edit text again.", 400);
  const host = (request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "").toLowerCase();
  const own = storeOrigins(link.store).find((origin) => new URL(origin).host === host);
  if (!own) return text("This link is for another address.", 400);
  const pass = mintPass("edit", { store: { id: link.storeId, slug: link.store }, account: { id: link.account } });
  if (!pass) return text("Editing on the site is not set up on this server.", 503);

  const response = NextResponse.redirect(new URL(`${to}#kaizen-edit`, own), { status: 303, headers: HEADERS });
  response.cookies.set(passCookie(pass, own.startsWith("https:")));
  return response;
}
