import { NextResponse, type NextRequest } from "next/server";

import { ROLE_SEGMENT } from "@/lib/ab-site";
import { parseStoreRequest, storeOfHost, variantPath } from "@/lib/ab-routing";
import { dataCookieName } from "@/lib/experiments";
import { storeDomain, storeHosts } from "@/lib/paths";
import { runningExperiments, storeIdOfSlug } from "@/server/experiments";

/**
 * A/B tests (D148, docs/ab-testing.md): sends a visitor who was given another version of a tested page to that version's
 * page. It runs only for requests that carry the `kaizen_ab` cookie (the matcher), which only a browser that accepted
 * statistics cookies has, so everyone else, and every crawler, is served from the cache without a function call. What it
 * does is the pure decision in `variantPath()`; anything unexpected leaves the request alone.
 */
// The cookie's name is written out: the matcher is read at build time and cannot use a constant (`MARKER_COOKIE`, tested to agree).
export const config = {
  matcher: [{ source: "/((?!_next/|api/|admin/|demo/|kaizen/|favicon.ico|.*\\..*).*)", has: [{ type: "cookie", key: "kaizen_ab" }] }],
};

export async function proxy(request: NextRequest) {
  try {
    const host = request.headers.get("host") ?? "";
    const request_ = parseStoreRequest(request.nextUrl.pathname, storeOfHost(host, storeDomain(), storeHosts()));
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
