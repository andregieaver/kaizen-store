import "server-only";

import { Resolver } from "node:dns/promises";

import {
  apexOf,
  dmarcOf,
  domainHealth,
  isVercelNameserver,
  spfOf,
  type DnsHost,
  type DomainFacts,
  type Finding,
} from "@/lib/domain-health";

import { listStoreDomains, type StoreDomain } from "./domains";
import { domainsConfigured } from "./vercel";
import { vercelDns, type DnsHostApi } from "./vercel-dns";

/**
 * Gathers what `domainHealth()` reads for each of a store's domains (D315, `docs/domains.md` 5.3): the connection's latest check (P8),
 * the records public DNS answers for the apex, where its DNS is kept (Vercel's nameservers in Kaizena Flow's team, or elsewhere), and its
 * registration from RDAP (the registry's own public record: registrar and expiry). Every lookup has a time limit and a failure is "not
 * known", never "none". Nothing here changes anything, so anyone who may read the Domains page may run it.
 */

export type PublicDns = {
  mx(name: string): Promise<string[] | null>;
  txt(name: string): Promise<string[] | null>;
  caa(name: string): Promise<{ tag: string; value: string }[] | null>;
  ns(name: string): Promise<string[] | null>;
};

/** Registry facts from RDAP: the registrar's name and when the registration expires. */
export type Rdap = (apex: string) => Promise<{ registrar: string | null; expiresAt: string | null } | null>;

export type HealthDeps = { dns?: PublicDns; rdap?: Rdap; host?: DnsHostApi | null; registrations?: (storeId: string) => Promise<RegistrationFacts[]>; now?: Date };

/** A registration Kaizena Flow made (D315 phase 2), as health reads it. */
export type RegistrationFacts = { apex: string; expiresAt: string | null; renews: boolean; contactVerified: boolean | null };

const LOOKUP_MS = 3_000;

/** Public DNS through the system resolver, three seconds a question. "No such record" is an empty list; a failed lookup is null. */
export function systemDns(): PublicDns {
  const resolver = new Resolver({ timeout: LOOKUP_MS, tries: 2 });
  const none = (error: unknown) => ["ENODATA", "ENOTFOUND", "ENOTIMP"].includes((error as { code?: string })?.code ?? "");
  const ask = async <T>(q: () => Promise<T>, empty: T): Promise<T | null> => {
    try {
      return await q();
    } catch (error) {
      return none(error) ? empty : null;
    }
  };
  return {
    mx: (name) => ask(async () => (await resolver.resolveMx(name)).map((r) => r.exchange.toLowerCase()), []),
    txt: (name) => ask(async () => (await resolver.resolveTxt(name)).map((parts) => parts.join("")), []),
    caa: (name) =>
      ask(
        async () =>
          (await resolver.resolveCaa(name)).flatMap((r) => {
            const rec = r as unknown as Record<string, unknown>;
            return (["issue", "issuewild", "iodef"] as const).filter((tag) => typeof rec[tag] === "string").map((tag) => ({ tag, value: String(rec[tag]) }));
          }),
        [],
      ),
    ns: (name) => ask(async () => (await resolver.resolveNs(name)).map((n) => n.toLowerCase()), []),
  };
}

const RDAP_BOOTSTRAP = "https://rdap.org/domain/";
const RDAP_MS = 5_000;
const RDAP_MAX_BYTES = 256 * 1024;

/**
 * RDAP through rdap.org, which sends the question on to the registry that keeps the TLD (IANA's bootstrap). Only https answers are read,
 * at most 256 kB, within five seconds; anything else is "not known".
 */
export const publicRdap: Rdap = async (apex) => {
  try {
    const response = await fetch(`${RDAP_BOOTSTRAP}${encodeURIComponent(apex)}`, {
      headers: { Accept: "application/rdap+json, application/json" },
      redirect: "follow",
      signal: AbortSignal.timeout(RDAP_MS),
      cache: "no-store",
    });
    if (!response.ok || !response.url.startsWith("https://")) return null;
    const text = await response.text();
    if (text.length > RDAP_MAX_BYTES) return null;
    return readRdap(JSON.parse(text));
  } catch {
    return null;
  }
};

/** The registrar and expiry out of an RDAP domain answer (RFC 9083): the `expiration` event and the entity with the `registrar` role. */
export function readRdap(body: unknown): { registrar: string | null; expiresAt: string | null } {
  const b = (body ?? {}) as { events?: { eventAction?: string; eventDate?: string }[]; entities?: { roles?: string[]; vcardArray?: unknown[] }[] };
  const expiry = b.events?.find((e) => e.eventAction === "expiration")?.eventDate ?? null;
  const entity = b.entities?.find((e) => e.roles?.includes("registrar"));
  let registrar: string | null = null;
  const cards = Array.isArray(entity?.vcardArray?.[1]) ? (entity.vcardArray[1] as unknown[]) : [];
  for (const field of cards) {
    if (Array.isArray(field) && field[0] === "fn" && typeof field[3] === "string") registrar = field[3];
  }
  return { registrar, expiresAt: expiry && !Number.isNaN(Date.parse(expiry)) ? new Date(expiry).toISOString() : null };
}

export type DomainHealth = { domain: StoreDomain | null; apex: string; facts: DomainFacts; findings: Finding[] };

/** The facts and findings for one host of a store. */
export async function hostHealth(
  hostname: string,
  connection: StoreDomain | null,
  deps: Required<Pick<HealthDeps, "dns" | "rdap">> & { host: DnsHostApi | null; registration: RegistrationFacts | null; now: Date },
): Promise<DomainHealth> {
  const apex = connection?.checks.apexName || apexOf(hostname);
  const [mx, txt, dmarcTxt, caa, ns, rdap, zone] = await Promise.all([
    deps.dns.mx(apex),
    deps.dns.txt(apex),
    deps.dns.txt(`_dmarc.${apex}`),
    deps.dns.caa(apex),
    deps.dns.ns(apex),
    deps.registration ? Promise.resolve(null) : deps.rdap(apex),
    deps.host ? deps.host.zone(apex).catch(() => null) : Promise.resolve(null),
  ]);
  const pointsAtVercel = ns ? ns.length > 0 && ns.every(isVercelNameserver) : null;
  const dnsHost: DnsHost = pointsAtVercel === null ? "unknown" : pointsAtVercel && zone ? "kaizena" : "elsewhere";
  const reg = deps.registration;
  const facts: DomainFacts = {
    hostname,
    apex,
    connection: connection
      ? {
          status: connection.status,
          isPrimary: connection.isPrimary,
          txt: connection.checks.txt,
          misconfigured: connection.checks.misconfigured,
          problem: connection.checks.problem,
        }
      : null,
    dnsHost,
    registration: reg
      ? { withUs: true, registrar: "Kaizena Flow", expiresAt: reg.expiresAt, renews: reg.renews, contactVerified: reg.contactVerified }
      : { withUs: false, registrar: rdap?.registrar ?? null, expiresAt: rdap?.expiresAt ?? null, renews: null, contactVerified: null },
    email: mx === null || txt === null || dmarcTxt === null ? null : { mx, spf: spfOf(txt), dmarc: dmarcOf(dmarcTxt) },
    caa,
  };
  return { domain: connection, apex, facts, findings: domainHealth(facts, deps.now) };
}

/**
 * Every domain of a store with its health, one row per apex's host as the store lists them. A connection that is active on a subdomain
 * and its apex share the apex's records. Never throws for a lookup: a failure is a finding (`lookup_failed`).
 */
export async function storeDomainHealth(storeId: string, deps: HealthDeps = {}): Promise<DomainHealth[]> {
  const domains = await listStoreDomains(storeId);
  const dns = deps.dns ?? systemDns();
  const rdap = deps.rdap ?? publicRdap;
  const host = deps.host === undefined ? (domainsConfigured() ? vercelDns() : null) : deps.host;
  const now = deps.now ?? new Date();
  const registrations = deps.registrations ? await deps.registrations(storeId) : [];
  const byApex = new Map(registrations.map((r) => [r.apex, r]));
  const rows = await Promise.all(
    domains.map((d) => hostHealth(d.hostname, d, { dns, rdap, host, now, registration: byApex.get(d.checks.apexName || apexOf(d.hostname)) ?? null })),
  );
  // A registration the store holds but has not connected still has its health.
  const connected = new Set(rows.map((r) => r.apex));
  for (const reg of registrations) {
    if (!connected.has(reg.apex)) rows.push(await hostHealth(reg.apex, null, { dns, rdap, host, now, registration: reg }));
  }
  return rows;
}
