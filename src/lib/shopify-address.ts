/**
 * Move day, part 2: the address (D445 step 7b, `docs/moving-from-shopify.md` 4.7), pure. Which of the Shopify shop's addresses come here
 * (its own domain and the other of its bare and `www.` names, never a `myshopify.com` one), where each one's DNS is kept (from its
 * nameservers), and whether it still leads to Shopify. Homer sees only the way that fits him; the records and checks are the domains
 * page's own (`addStoreDomain()`, `dnsRecords()`, `checkStoreDomain()`, D315). Nothing here looks anything up.
 */
import { apexOf, isVercelNameserver } from "./domain-health";

/** Where a domain's DNS is kept, as far as its nameservers tell; `kaizena` is ours (Vercel's DNS in Kaizena Flow's team). */
export const DNS_HOSTS = ["kaizena", "shopify", "cloudflare", "godaddy", "namecheap", "domeneshop", "one_com", "squarespace", "other", "unknown"] as const;
export type DnsHostId = (typeof DNS_HOSTS)[number];

/** Nameserver endings of the hosts Homer gets his own words for; checked in this order. */
const NAMESERVERS: readonly [DnsHostId, RegExp][] = [
  ["shopify", /(^|\.)shopify\.com$/],
  ["cloudflare", /(^|\.)ns\.cloudflare\.com$/],
  ["godaddy", /(^|\.)domaincontrol\.com$/],
  ["namecheap", /(^|\.)registrar-servers\.com$/],
  ["domeneshop", /(^|\.)hyp\.net$/],
  ["one_com", /(^|\.)one\.com$/],
  ["squarespace", /(^|\.)(squarespacedns\.com|googledomains\.com)$/],
];

/** The DNS host behind a list of nameservers: `unknown` when there were none to read. */
export function dnsHostOf(nameservers: readonly string[]): DnsHostId {
  const names = nameservers.map((n) => n.trim().toLowerCase().replace(/\.$/, "")).filter(Boolean);
  if (names.length === 0) return "unknown";
  if (names.some(isVercelNameserver)) return "kaizena";
  for (const [id, pattern] of NAMESERVERS) if (names.some((n) => pattern.test(n))) return id;
  return "other";
}

/** The addresses that come here for a Shopify shop whose primary domain is `primary`: it and its bare or `www.` pair; none for `myshopify.com`. */
export function addressesToMove(primary: string | null): string[] {
  const host = (primary ?? "").trim().toLowerCase().replace(/\.$/, "");
  if (!host || /(^|\.)myshopify\.com$/.test(host) || !host.includes(".")) return [];
  const apex = apexOf(host);
  const www = `www.${apex}`;
  // Shopify's own primary first: it becomes the store's address here.
  return host === apex ? [apex, www] : host === www ? [www, apex] : [host];
}

/** Shopify's storefront addresses (`23.227.38.0/24`, and `shops.myshopify.com` for a name pointed by CNAME). */
export function leadsToShopify(a: readonly string[], cname: string | null): boolean {
  return a.some((ip) => /^23\.227\.38\.\d{1,3}$/.test(ip.trim())) || /(^|\.)myshopify\.com\.?$/i.test(cname ?? "");
}
