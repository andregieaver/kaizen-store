import { connection, NextResponse } from "next/server";

import { storeOrigins } from "@/lib/paths";
import { readUnlock } from "@/lib/unlock-pass";
import { mintUnlock, unlockCookie } from "@/server/private-mode";
import { unlockSecret } from "@/server/private-secret";

/**
 * The store's own host takes the admin's `enter` token (D339, `preview`) and gives the browser a staff pass there: the HttpOnly cookie
 * `kaizen_unlock_{storeId}` for `STAFF_HOURS` hours, then the store's home. The token must be the admin's (its signature), of the `enter` kind,
 * not over, and for a host of this very store; nothing is set otherwise. A link followed from another site, so it is not held to the
 * same-site check: the token is what it needs.
 */

const HEADERS = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" };

const text = (message: string, status: number) => new Response(message, { status, headers: { ...HEADERS, "Content-Type": "text/plain; charset=utf-8" } });

export async function GET(request: Request) {
  await connection();
  const secret = unlockSecret();
  const link = secret ? readUnlock(secret, new URL(request.url).searchParams.get("pass")) : null;
  if (!link || link.kind !== "enter") return text("This link has run out. Go back to the admin and press Preview the store again.", 400);
  const host = (request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "").toLowerCase();
  const own = storeOrigins(link.store).find((origin) => new URL(origin).host === host);
  if (!own) return text("This link is for another address.", 400);
  const pass = mintUnlock("staff", { id: link.storeId, slug: link.store }, 0);
  if (!pass) return text("Private mode is not set up on this server.", 503);
  const response = NextResponse.redirect(new URL("/", own), { status: 303, headers: HEADERS });
  response.cookies.set(unlockCookie(link.storeId, pass, "staff", own.startsWith("https:")));
  return response;
}
