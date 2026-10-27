import { NextResponse, userAgent, type NextFetchEvent, type NextRequest } from "next/server";

import { ROLE_SEGMENT } from "@/lib/ab-site";
import { parseStoreRequest, storeOfHost, variantPath } from "@/lib/ab-routing";
import { dataCookieName } from "@/lib/experiments";
import { mayBeHeld } from "@/lib/holding";
import { storeDomain, storeHosts } from "@/lib/paths";
import { siteUrl } from "@/lib/site";
import { holdingFor } from "@/server/holding";
import { recordNotFound } from "@/server/not-found";
import { unlockCookieName, unlocks } from "@/lib/unlock-pass";
import { unlockSecret } from "@/server/private-secret";
import { privateGate, storeRequestAnswer } from "@/server/redirect-resolve";
import { runningExperiments, storeIdOfSlug } from "@/server/experiments";

/**
 * Three jobs, each only for the requests its matcher lets through.
 *
 * 1. The shape of a store's addresses (D181, `docs/marketless-addresses.md`): a store that sells in one country has no country in its addresses,
 *    so `/home` (on its own host, or `/s/{store}/home`) is served from `/no/home`, `/en/home` from `/no-en/home`, and its old addresses with the
 *    country move there for good (308); a store that sells in several moves a short address back to the long one. The second matcher entry is
 *    `STORE_MATCHER` of `src/lib/store-address.ts` written out as a literal (a matcher cannot use a constant; a test holds the two together): every
 *    page, so the decision (`addressDecision()`) sees each request for a store's page. It reads the store's facts from the database at most once per
 *    store and instance every few seconds (`storeRequestAnswer()`), never per request.
 * 2. Addresses with no country (wave 2, D168, `docs/wave-2-redirects.md` 2.1.3, 5.3) of a store that sells in several: an old shop's
 *    `/collections/shoes` is looked up as a manual redirect source and sent, permanently (308), to its target in the store's main market; an address
 *    live in its own country (from when it sold in one) goes there; anything else is left to the routes (the 404 it was) and counted for the 404 report.
 * 3. A/B tests (D148, docs/ab-testing.md): sends a visitor who was given another version of a tested page to that version's page. It runs only for
 *    requests that carry the `kaizen_ab` cookie, which only a browser that accepted statistics cookies has; the tests are read only then. What it does
 *    is the pure decision in `variantPath()`, on the address as served (after job 1's rewrite).
 *
 * 5. Private stores (D339, `docs/wave-7-storefront.md` E): a page request of a private store from a visitor without the unlock pass (the cookie
 *    `kaizen_unlock_{storeId}`, checked by its signature, `unlocks()`) is served the store's landing page instead (`privateGate()`, read from the
 *    same few-second facts), marked `noindex` and never cached; the landing page itself and the pages of what was already sold stay open.
 *
 * 4. Held domains (D317 8): a host that is no store's and not Kaizena Flow's own may be a domain someone holds here with no store using it; it
 *    answers with its holding page or the holder's redirect (`holdingFor()`, read at most every 30 seconds a host), never a deployment.
 *
 * Anything unexpected leaves the request alone.
 */
// The cookie's name and the store matcher are written out: a matcher is read at build time and cannot use a constant (`MARKER_COOKIE` and `STORE_MATCHER`, tested to agree).
export const config = {
  matcher: [
    { source: "/((?!_next/|api/|admin/|demo/|kaizen/|favicon.ico|.*\\..*).*)", has: [{ type: "cookie", key: "kaizen_ab" }] },
    {
      source:
        "/((?!_next/|api/|admin/|demo/|kaizen/|favicon\\.ico|.*\\.(?:ico|png|jpg|jpeg|gif|webp|avif|svg|css|js|map|txt|xml|json|woff|woff2|ttf|pdf|csv|zip|mp4|webm)$).*)",
    },
  ],
};

export async function proxy(request: NextRequest, event: NextFetchEvent) {
  const host = request.headers.get("host") ?? "";
  const hostStore = storeOfHost(host, storeDomain(), storeHosts());
  if (!hostStore && mayBeHeld(host, { site: new URL(siteUrl()).hostname, storeDomain: storeDomain() })) {
    try {
      const held = await holdingFor(host);
      if (held?.kind === "redirect") return NextResponse.redirect(held.to, 308);
      if (held?.kind === "page") {
        const url = request.nextUrl.clone();
        url.pathname = `/holding/${held.apex}`;
        url.search = `?lang=${held.lang}`;
        return NextResponse.rewrite(url);
      }
    } catch (error) {
      console.error("[holding] proxy", error);
    }
  }
  // The path the request is served from: as asked, or the long form of a short address (D181).
  let served = request.nextUrl.pathname;
  try {
    // Only a request that asks for a page is moved (spec 4.1 rule 8): a 308 makes a client replay a POST's body at the new address, and a POST is no
    // page request to count as missing. A server action's POST to a short address is still served from the long one.
    const page = request.method === "GET" || request.method === "HEAD";
    const answer = await storeRequestAnswer(request.nextUrl.pathname, request.nextUrl.search, hostStore, page, host);
    if (answer && "location" in answer) return NextResponse.redirect(new URL(answer.location, request.url), 308);
    if (answer && "rewrite" in answer) served = answer.rewrite;
    if (answer && "miss" in answer) {
      // The 404 it was, counted after the response: the robots' flag is a boolean from the request and nothing else of it is read.
      const crawler = userAgent(request).isBot;
      event.waitUntil(recordNotFound(answer.miss.storeId, answer.miss.path, crawler));
    }
  } catch (error) {
    console.error("[addresses] proxy", error);
  }
  const rewrite = (pathname: string) => {
    const url = request.nextUrl.clone();
    url.pathname = pathname;
    return NextResponse.rewrite(url);
  };
  const plain = () => (served === request.nextUrl.pathname ? NextResponse.next() : rewrite(served));
  // A private store (D339): a request without a good pass is shown the landing page, never the page asked (job 5).
  try {
    const gate = await privateGate(served, hostStore);
    if (gate && !unlocks(unlockSecret(), request.cookies.get(unlockCookieName(gate.storeId))?.value, { id: gate.storeId, version: gate.version })) {
      const url = request.nextUrl.clone();
      url.pathname = gate.landing;
      url.search = `?to=${encodeURIComponent(`${request.nextUrl.pathname}${request.nextUrl.search}`)}`;
      const response = NextResponse.rewrite(url);
      response.headers.set("X-Robots-Tag", "noindex, nofollow");
      response.headers.set("Cache-Control", "private, no-store");
      return response;
    }
  } catch (error) {
    // As the address's decisions do, a store's facts that cannot be read leave the request alone: every store's pages stay up.
    console.error("[private] proxy", error);
  }
  if (!request.cookies.has("kaizen_ab")) return plain();
  try {
    const request_ = parseStoreRequest(served, hostStore);
    if (!request_) return plain();
    const storeId = await storeIdOfSlug(request_.store);
    if (!storeId) return plain();
    const tests = await runningExperiments(storeId);
    if (tests.length === 0) return plain();
    const to = variantPath(request_, tests.map((t) => ({ id: t.id, kind: t.kind, slug: t.kind === "page" ? t.slug : null, segment: t.role ? ROLE_SEGMENT[t.role] : null })), request.cookies.get(dataCookieName(storeId))?.value);
    return to ? rewrite(to) : plain();
  } catch (error) {
    console.error("[ab] proxy", error);
    return plain();
  }
}
