import { withSiteVersions, testToken, type TargetKind } from "./ab-site";
import { dataCookieName, decodeAssignments, OUTSIDE } from "./experiments";

/**
 * Where an enrolled visitor's request for a tested page goes (D148): the proxy asks this for requests that carry the
 * `kaizen_ab` cookie. Pure, so it is tested without a server. A visitor in the original (`a`), outside a test, or with
 * nothing for it goes where it was going. A working page (D113: the cart, the checkout, …), the front page or the All products page under test
 * is drawn by its own route, so its version travels in the market part of the address, like a header's, only on requests to that route
 * (phases 9 and 10).
 */

export type StoreRequest = {
  store: string;
  market: string;
  /** What follows the market: a page's address, `p/{handle}`, `cart`, … ; empty for the market's front page. */
  rest: string[];
  hostBased: boolean;
};

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** A market address: a country, with a language and a currency when they are not its own (`no`, `no-en`, `no-en-eur`). */
const MARKET = /^[a-z]{2}(?:-[a-z0-9]{2,8}){0,2}$/;
const SEGMENT = /^[A-Za-z0-9._~%-]{1,200}$/;

/**
 * The store, market and the rest of a request for a store's page, on the platform's address (`/s/{store}/{market}/…`) or on a
 * store's own host (`/{market}/…`, where `hostStore` says which store the host is). Anything else is not a store's page.
 */
export function parseStoreRequest(pathname: string, hostStore: string | null): StoreRequest | null {
  const parts = pathname.split("/").filter(Boolean);
  if (parts.length > 12 || !parts.every((part) => SEGMENT.test(part))) return null;
  if (parts[0] === "s" && parts.length >= 3) {
    const [, store, market, ...rest] = parts;
    return SLUG.test(store) && MARKET.test(market) ? { store, market, rest, hostBased: false } : null;
  }
  if (hostStore && parts.length >= 1 && parts[0] !== "api" && parts[0] !== "admin") {
    const [market, ...rest] = parts;
    return MARKET.test(market) ? { store: hostStore, market, rest, hostBased: true } : null;
  }
  return null;
}

/** The page address a request is for, when it is one page of the market's own (`/{slug}`); null for the front page and for deeper routes. */
export const pageSlugOf = (request: Pick<StoreRequest, "rest">): string | null => (request.rest.length === 1 && SLUG.test(request.rest[0]) ? request.rest[0] : null);

/** Whether a request is for the route a place of its own is drawn by: its first segment, or, for the front page (empty), nothing after the market. */
const atSegment = (request: Pick<StoreRequest, "rest">, segment: string | null | undefined): boolean =>
  segment === null || segment === undefined ? false : segment === "" ? request.rest.length === 0 : request.rest[0] === segment;

/** The store a host belongs to: `{store}.{domain}` on the store domain, or one of a store's own domains. */
export function storeOfHost(host: string, domain: string | null, customHosts: Record<string, { primary: string | null; hosts: string[] }>): string | null {
  const bare = host.toLowerCase().replace(/:\d+$/, "");
  for (const [slug, { primary, hosts }] of Object.entries(customHosts)) {
    if (primary === bare || hosts.includes(bare)) return slug;
  }
  if (!domain) return null;
  const root = domain.toLowerCase().replace(/:\d+$/, "");
  const match = new RegExp(`^([a-z0-9-]+)\\.${root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`).exec(bare);
  return match && match[1] !== "www" ? match[1] : null;
}

/**
 * A running test as the proxy needs it: its kind, for a test of a page the page's address, and for a page with a place of its own the first part
 * of its route (empty for the front page, which is the market's own address).
 */
export type TestOnPage = { id: string; kind?: TargetKind; slug: string | null; segment?: string | null };

/**
 * The path to rewrite to for this visitor, or null to leave the request alone. A test of a page sends its page to the
 * version's route (`{page}/ab/{version}`); a test of the header or footer changes every page's market part, and a test of the
 * product layout every product page's (see `ab-site.ts`). A visitor in the original, outside a test, or with no answer for
 * it is not moved by it.
 */
export function variantPath(request: StoreRequest, tests: TestOnPage[], dataCookie: string | undefined): string | null {
  const mine = decodeAssignments(dataCookie)?.versions;
  if (!mine) return null;
  const moved = (id: string) => {
    const version = mine[id];
    return version && version !== "a" && version !== OUTSIDE ? version : null;
  };
  const slug = pageSlugOf(request);
  const productPage = request.rest.length === 2 && request.rest[0] === "p";
  let pageVersion: string | null = null;
  const site: Record<string, string> = {};
  for (const test of tests) {
    const version = moved(test.id);
    if (!version) continue;
    const kind = test.kind ?? "page";
    if (kind === "page") {
      if (slug !== null && test.slug === slug) pageVersion = version;
    } else if (kind === "header" || kind === "footer" || (kind === "layout" && productPage) || (kind === "role" && atSegment(request, test.segment))) {
      site[testToken(test.id)] = version;
    }
  }
  if (pageVersion === null && Object.keys(site).length === 0) return null;
  const market = withSiteVersions(request.market, site);
  const base = request.hostBased ? `/${market}` : `/s/${request.store}/${market}`;
  return `${base}${request.rest.map((part) => `/${part}`).join("")}${pageVersion ? `/ab/${pageVersion}` : ""}`;
}

export { dataCookieName };
