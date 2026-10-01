import { dataCookieName, decodeAssignments, OUTSIDE } from "./experiments";

/**
 * Where an enrolled visitor's request for a tested page goes (D148): the proxy asks this for requests that carry the
 * `kaizen_ab` cookie. Pure, so it is tested without a server. A visitor in the original (`a`), outside a test, or with
 * nothing for it goes where it was going.
 */

export type StoreRequest = { store: string; market: string; slug: string; hostBased: boolean };

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * The store, market and page of a request for a store page, on the platform's address (`/s/{store}/{market}/{slug}`) or
 * on a store's own host (`{market}/{slug}`, where `hostStore` says which store the host is).
 */
export function parseStoreRequest(pathname: string, hostStore: string | null): StoreRequest | null {
  const parts = pathname.split("/").filter(Boolean);
  if (parts[0] === "s" && parts.length === 4) {
    const [, store, market, slug] = parts;
    return SLUG.test(store) && /^[a-z0-9-]{2,24}$/.test(market) && SLUG.test(slug) ? { store, market, slug, hostBased: false } : null;
  }
  if (hostStore && parts.length === 2 && parts[0] !== "api" && parts[0] !== "admin") {
    const [market, slug] = parts;
    return /^[a-z0-9-]{2,24}$/.test(market) && SLUG.test(slug) ? { store: hostStore, market, slug, hostBased: true } : null;
  }
  return null;
}

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

export type TestOnPage = { id: string; slug: string };

/** The path to rewrite to for this visitor, or null to leave the request alone. */
export function variantPath(request: StoreRequest, tests: TestOnPage[], dataCookie: string | undefined): string | null {
  const test = tests.find((t) => t.slug === request.slug);
  if (!test) return null;
  const mine = decodeAssignments(dataCookie)?.versions[test.id];
  if (!mine || mine === "a" || mine === OUTSIDE) return null;
  const base = request.hostBased ? `/${request.market}/${request.slug}` : `/s/${request.store}/${request.market}/${request.slug}`;
  return `${base}/ab/${mine}`;
}

export { dataCookieName };
