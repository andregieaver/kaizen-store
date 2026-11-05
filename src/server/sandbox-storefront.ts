import "server-only";

import { NextResponse } from "next/server";

import { storeHome } from "@/lib/paths";
import { sandboxHome } from "@/lib/sandbox";

import { mintUnlock, unlockCookie } from "./private-mode";
import { sandboxFor } from "./sandbox";

/**
 * *See your store* (D457 S4, `docs/builder-sandbox.md` 4.4): the sandbox's own storefront, private like every sandbox's, opened for this
 * browser alone with the pass a member's *Preview the store* gets (`staff`, D339, `STAFF_HOURS` hours), once the sandbox's own pass has
 * opened the sandbox. Nobody else gets in: the pass is an HttpOnly cookie for that one store, never a link. What the storefront could send
 * stays in: `sendEmail()` refuses every email of a sandbox store, broadcasts need an active store and a sandbox never is one, and the
 * database refuses its orders. A sandbox that has ended goes to its page, which says so.
 */

const HEADERS = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" };

export async function sandboxStorefrontRequest(request: Request, sandboxId: string): Promise<Response> {
  const sandbox = await sandboxFor(sandboxId);
  if (!sandbox) return NextResponse.redirect(new URL(sandboxHome(sandboxId), request.url), { status: 303, headers: HEADERS });
  const pass = mintUnlock("staff", sandbox.store, 0);
  if (!pass) return new Response("Private mode is not set up on this server.", { status: 503, headers: { ...HEADERS, "Content-Type": "text/plain; charset=utf-8" } });
  const response = NextResponse.redirect(new URL(storeHome(sandbox.store.slug), request.url), { status: 303, headers: HEADERS });
  response.cookies.set(unlockCookie(sandbox.store.id, pass, "staff", new URL(request.url).protocol === "https:"));
  return response;
}
