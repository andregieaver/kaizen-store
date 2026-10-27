import { createHash } from "node:crypto";
import { connection, NextResponse } from "next/server";

import { privatePath, safeBack } from "@/lib/private-mode";
import { sameSite } from "@/lib/same-site";
import { storeHome } from "@/lib/paths";
import { mintUnlock, privatePasswordMatches, privateState, unlockCookie } from "@/server/private-mode";
import { takeBudget } from "@/server/request-budget";
import { getStore } from "@/server/stores";

/**
 * A private store's password (D339, `docs/wave-7-storefront.md` E): the landing page's form posts here, on the store's own host. The right
 * password gives the visitor the pass (the HttpOnly cookie `kaizen_unlock_{storeId}`, `PASSWORD_DAYS` days, tied to the store's version) and
 * sends them where they asked; a wrong one goes back to the landing page saying so, the same for every wrong word. Tries are counted per
 * visitor (a hash of the address that changes daily, never the address) and per store (`takeBudget()`, `unlock`).
 */

const HEADERS = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" };
const MARKET = /^[a-z0-9-]{2,24}$/;

const visitorOf = (request: Request) => {
  const address = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
  return createHash("sha256").update(`${address}|${new Date().toISOString().slice(0, 10)}|kaizen-unlock`).digest("hex").slice(0, 32);
};

export async function POST(request: Request) {
  await connection();
  if (!sameSite(request)) return new Response("Not allowed.", { status: 403, headers: HEADERS });
  const form = await request.formData().catch(() => null);
  const slug = String(form?.get("store") ?? "");
  const market = String(form?.get("market") ?? "");
  const password = String(form?.get("password") ?? "");
  const store = /^[a-z0-9-]{1,64}$/.test(slug) ? await getStore(slug) : null;
  if (!store || !MARKET.test(market)) return new Response("Not found.", { status: 404, headers: HEADERS });
  const to = safeBack(String(form?.get("to") ?? ""), storeHome(store.slug));
  // The landing page as this host serves it: under `/s/{store}` on Kaizena Flow's address, at the root on the store's own.
  const hostBased = !to.startsWith(`/s/${store.slug}/`) && to !== `/s/${store.slug}`;
  const back = (flag: "wrong" | "wait") =>
    NextResponse.redirect(new URL(`${privatePath(store.slug, hostBased, market)}?to=${encodeURIComponent(to)}&${flag}=1`, request.url), { status: 303, headers: HEADERS });

  const state = await privateState(store.id);
  // Not private (any more): nothing to unlock, so on to where they were going.
  if (!state?.private) return NextResponse.redirect(new URL(to, request.url), { status: 303, headers: HEADERS });
  if (!(await takeBudget(store.id, "unlock", visitorOf(request)))) return back("wait");
  if (!password || !(await privatePasswordMatches(state.password, password))) return back("wrong");
  const pass = mintUnlock("password", store, state.version);
  if (!pass) return new Response("Private mode is not set up on this server.", { status: 503, headers: HEADERS });
  const response = NextResponse.redirect(new URL(to, request.url), { status: 303, headers: HEADERS });
  response.cookies.set(unlockCookie(store.id, pass, "password", new URL(request.url).protocol === "https:"));
  return response;
}
