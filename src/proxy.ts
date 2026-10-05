import { NextResponse, userAgent, type NextFetchEvent, type NextRequest } from "next/server";

import { ROLE_SEGMENT } from "@/lib/ab-site";
import { parseStoreRequest, storeOfHost, variantPath } from "@/lib/ab-routing";
import { dataCookieName } from "@/lib/experiments";
import { storeDomain, storeHosts } from "@/lib/paths";
import { recordNotFound } from "@/server/not-found";
import { legacyAnswer } from "@/server/redirect-resolve";
import { runningExperiments, storeIdOfSlug } from "@/server/experiments";

/**
 * Two jobs, each only for the requests its matcher lets through.
 *
 * 1. Addresses with no country (wave 2, D168, `docs/wave-2-redirects.md` 2.1.3, 5.3): an old shop's `/collections/shoes` on a store's own host, or under
 *    `/s/{store}/`, is looked up as a manual redirect source and sent, permanently (308), to its target in the store's main market; anything else is left
 *    to the routes (the 404 it was) and counted for the 404 report. The second matcher entry is `LEGACY_MATCHER` of `src/lib/legacy-path.ts` written out as a
 *    literal (a matcher cannot use a constant; a test holds the two together) and keeps the proxy off every path that has a market, the front page, the
 *    platform's routes and static files, so normal shopping never reaches it.
 * 2. A/B tests (D148, docs/ab-testing.md): sends a visitor who was given another version of a tested page to that version's page. It runs only for requests
 *    that carry the `kaizen_ab` cookie (the first matcher entry), which only a browser that accepted statistics cookies has, so everyone else, and every
 *    crawler, is served from the cache without a function call. What it does is the pure decision in `variantPath()`.
 *
 * Anything unexpected leaves the request alone.
 */
// The cookie's name and the legacy matcher are written out: a matcher is read at build time and cannot use a constant (`MARKER_COOKIE` and `LEGACY_MATCHER`, tested to agree).
export const config = {
  matcher: [
    { source: "/((?!_next/|api/|admin/|demo/|kaizen/|favicon.ico|.*\\..*).*)", has: [{ type: "cookie", key: "kaizen_ab" }] },
    {
      source:
        "/((?!_next/|api/|admin/|demo/|kaizen/|favicon\\.ico|[a-z]{2}(?:-[a-z0-9]{2,8}){0,2}(?:/|$)|s/[^/]+/?$|s/[^/]+/[a-z]{2}(?:-[a-z0-9]{2,8}){0,2}(?:/|$)|.*\\.(?:ico|png|jpg|jpeg|gif|webp|avif|svg|css|js|map|txt|xml|json|woff|woff2|ttf|pdf|csv|zip|mp4|webm)$).+)",
    },
  ],
};

export async function proxy(request: NextRequest, event: NextFetchEvent) {
  const host = request.headers.get("host") ?? "";
  const hostStore = storeOfHost(host, storeDomain(), storeHosts());
  try {
    // Only a request that asks for a page is looked up (spec 4.1 rule 8): a 308 makes a client replay a POST's body at the new address, and a POST is no
    // page request to count as missing.
    const legacy = request.method === "GET" || request.method === "HEAD" ? await legacyAnswer(request.nextUrl.pathname, request.nextUrl.search, hostStore) : null;
    if (legacy && "location" in legacy) return NextResponse.redirect(new URL(legacy.location, request.url), 308);
    if (legacy && "miss" in legacy) {
      // The 404 it was, counted after the response: the robots' flag is a boolean from the request and nothing else of it is read.
      const crawler = userAgent(request).isBot;
      event.waitUntil(recordNotFound(legacy.miss.storeId, legacy.miss.path, crawler));
    }
  } catch (error) {
    console.error("[redirects] proxy", error);
  }
  if (!request.cookies.has("kaizen_ab")) return NextResponse.next();
  try {
    const request_ = parseStoreRequest(request.nextUrl.pathname, hostStore);
    if (!request_) return NextResponse.next();
    const storeId = await storeIdOfSlug(request_.store);
    if (!storeId) return NextResponse.next();
    const tests = await runningExperiments(storeId);
    if (tests.length === 0) return NextResponse.next();
    const to = variantPath(request_, tests.map((t) => ({ id: t.id, kind: t.kind, slug: t.kind === "page" ? t.slug : null, segment: t.role ? ROLE_SEGMENT[t.role] : null })), request.cookies.get(dataCookieName(storeId))?.value);
    if (!to) return NextResponse.next();
    const url = request.nextUrl.clone();
    url.pathname = to;
    return NextResponse.rewrite(url);
  } catch (error) {
    console.error("[ab] proxy", error);
    return NextResponse.next();
  }
}
