import "server-only";

import { Resolver } from "node:dns/promises";

import { dnsRecords, type DnsRecord } from "@/lib/custom-domains";
import { apexOf } from "@/lib/domain-health";
import { domainConnectKey } from "@/lib/env";
import { addressesToMove, dnsHostOf, leadsToShopify, type DnsHostId } from "@/lib/shopify-address";
import { siteUrl } from "@/lib/site";

import type { Membership } from "./auth";
import { storeZone } from "./domain-dns";
import { domainConnectFor, signedApplyUrl } from "./domain-connect";
import { systemDns } from "./domain-health";
import { storeRegistration } from "./domain-registrations";
import { addStoreDomain, checkStoreDomain, connectOwnedDomain, listStoreDomains, setPrimaryDomain, type StoreDomain } from "./domains";
import { log } from "./log";
import { memberCan } from "./permissions";
import { shopifyConnection } from "./shopify-connect";
import { copyChoice } from "./shopify-copy";
import { wooConnection } from "./woocommerce-connect";
import { domainsConfigured, vercelDomains, type DomainServices } from "./vercel";

/**
 * Move day, part 2 (D445 step 7b, `docs/moving-from-shopify.md` 4.7): the Shopify shop's own address pointed here, through the domains
 * page's own writers (`addStoreDomain()`, or `connectOwnedDomain()` where the domain or its DNS is the store's here, `checkStoreDomain()`,
 * `setPrimaryDomain()`; D315). Where the DNS is kept is read from the nameservers, so Homer sees only his own way: nothing (it is here),
 * one press (Domain Connect), or the records with steps in his provider's words. Nothing on Shopify is ever touched. The owner's.
 */

const OWNER = "owner" as const;

/** Lookups, for tests: nameservers, and where a name points now. */
export type AddressDns = {
  ns: (name: string) => Promise<string[] | null>;
  points: (name: string) => Promise<{ a: string[]; cname: string | null }>;
};

const LOOKUP_MS = 3_000;
function liveDns(): AddressDns {
  const resolver = new Resolver({ timeout: LOOKUP_MS, tries: 2 });
  return {
    ns: (name) => systemDns().ns(name),
    points: async (name) => {
      const [a, cname] = await Promise.all([resolver.resolve4(name).catch(() => [] as string[]), resolver.resolveCname(name).then((c) => c[0] ?? null).catch(() => null)]);
      return { a, cname };
    },
  };
}

export type AddressDeps = { dns?: AddressDns; services?: DomainServices; connect?: typeof domainConnectFor; configured?: boolean };

export type AddressHost = {
  hostname: string;
  /** Added here and where it stands: not yet, waiting for its records, or working. */
  status: "not_added" | "waiting" | "active";
  /** It answers with Shopify's addresses still. */
  atShopify: boolean;
  records: DnsRecord[];
  /** One press at the DNS provider (Domain Connect), when it takes our template. */
  connectUrl: string | null;
  provider: string | null;
};

export type AddressView = {
  /** The Shopify shop's own address; null when it had only its `myshopify.com` one. */
  primary: string | null;
  apex: string | null;
  dnsHost: DnsHostId;
  hosts: AddressHost[];
  /** Everything points here. */
  done: boolean;
  /** Domains can't be added on this server (Kaizena Flow's Vercel settings are missing). */
  configured: boolean;
};

/**
 * The names that move here: a Shopify shop's own domain (and its `www.`); a WooCommerce shop's site domain when everything moves, or only
 * `shop.{domain}` when WordPress stays (D446 4.6, step 4b: one new record at the owner's host, nothing on the WordPress site changes).
 */
async function namesToMove(member: Membership): Promise<string[] | null> {
  const shopify = await shopifyConnection(member);
  if (shopify) return addressesToMove(shopify.primaryDomain);
  const woo = await wooConnection(member);
  if (!woo) return null;
  const host = woo.site.split("/")[0];
  if (!host.includes(".")) return [];
  return (await copyChoice(member)) === "keep" ? [`shop.${apexOf(host)}`] : addressesToMove(host);
}

/** The address as it stands (owner only), with each host's records and whether it still leads to Shopify. Null when no shop is connected. */
export async function addressView(member: Membership, deps: AddressDeps = {}): Promise<AddressView | null> {
  if (!memberCan(member, OWNER)) return null;
  const names = await namesToMove(member);
  if (!names) return null;
  const configured = deps.configured ?? domainsConfigured();
  if (names.length === 0) return { primary: null, apex: null, dnsHost: "unknown", hosts: [], done: true, configured };
  const dns = deps.dns ?? liveDns();
  const apex = apexOf(names[0]);
  const [nameservers, domains] = await Promise.all([dns.ns(apex).catch(() => null), listStoreDomains(member.store.id)]);
  const key = domainConnectKey();
  const back = `${siteUrl()}/admin/${member.store.slug}/settings/moving?address=back`;
  const hosts = await Promise.all(
    names.map(async (hostname): Promise<AddressHost> => {
      const domain = domains.find((d) => d.hostname === hostname) ?? null;
      const now = await dns.points(hostname).catch(() => ({ a: [], cname: null }));
      const waiting = domain && domain.status !== "active";
      const offer = waiting && key ? await (deps.connect ?? domainConnectFor)(hostname, { key }).catch(() => null) : null;
      return {
        hostname,
        status: !domain ? "not_added" : domain.status === "active" ? "active" : "waiting",
        atShopify: leadsToShopify(now.a, now.cname),
        records: waiting ? dnsRecords(domain.hostname, domain.token, domain.checks) : [],
        connectUrl: offer && domain && key ? signedApplyUrl(offer.settings, offer.kind, { hostname, token: domain.token, ip: domain.checks.aValues?.[0], redirectUri: back, state: domain.id }, key) : null,
        provider: offer ? (offer.settings.providerDisplayName ?? offer.settings.providerName) : null,
      };
    }),
  );
  return { primary: names[0], apex, dnsHost: dnsHostOf(nameservers ?? []), hosts, done: hosts.every((h) => h.status === "active"), configured };
}

export type AddressStart = { ok: true } | { ok: false; problems: string[] };

/**
 * *Point it here*: each of the shop's addresses added to the store, at once where the domain or its DNS is the store's here, else waiting
 * for the records the page shows. Safe to press again: an address already added is left as it is.
 */
export async function startAddress(member: Membership, deps: AddressDeps = {}): Promise<AddressStart> {
  if (!memberCan(member, OWNER)) return { ok: false, problems: ["Only the owner can do this."] };
  const names = (await namesToMove(member)) ?? [];
  if (names.length === 0) return { ok: false, problems: [] };
  const services = deps.services ?? vercelDomains;
  const apex = apexOf(names[0]);
  const [registration, zone, domains] = await Promise.all([storeRegistration(member.store.id, apex), storeZone(member.store.id, apex), listStoreDomains(member.store.id)]);
  const ours = Boolean((registration && registration.status !== "transferred_out") || (zone && zone.arrivedAt));
  const problems: string[] = [];
  for (const hostname of names) {
    const have = domains.find((d) => d.hostname === hostname);
    if (have && (have.status === "active" || !ours)) continue;
    const made = ours ? await connectOwnedDomain(member.account, member.store.id, hostname, services) : await addStoreDomain(member.account, member.store.id, { hostname }, services, deps.configured);
    if (!made.ok) problems.push(...made.problems);
  }
  await makePrimary(member, names[0], services);
  log("info", "shopify.address_started", { storeId: member.store.id, ours, problems: problems.length });
  return problems.length > 0 ? { ok: false, problems: [...new Set(problems)] } : { ok: true };
}

/** Shopify's own primary address becomes the store's once it works (the domains page's rule makes the first one so; this one, rather). */
async function makePrimary(member: Membership, hostname: string, services: DomainServices): Promise<void> {
  const domain = (await listStoreDomains(member.store.id)).find((d: StoreDomain) => d.hostname === hostname);
  if (domain && domain.status === "active" && !domain.isPrimary && domain.language === null && domain.market === null) {
    await setPrimaryDomain(member.account, member.store.id, domain.id, services);
  }
}

/** The page's check every 30 seconds: each waiting address looked at again, and Shopify's primary made the store's address once it works. */
export async function checkAddress(member: Membership, deps: AddressDeps = {}): Promise<{ done: boolean }> {
  if (!memberCan(member, OWNER)) return { done: false };
  const names = (await namesToMove(member)) ?? [];
  const services = deps.services ?? vercelDomains;
  const domains = (await listStoreDomains(member.store.id)).filter((d) => names.includes(d.hostname));
  for (const d of domains) if (d.status !== "active") await checkStoreDomain(member.store.id, d.id, services);
  if (names[0]) await makePrimary(member, names[0], services);
  const after = (await listStoreDomains(member.store.id)).filter((d) => names.includes(d.hostname));
  return { done: names.length > 0 && after.length === names.length && after.every((d) => d.status === "active") };
}
