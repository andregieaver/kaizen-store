import { z } from "zod";

import { storeDomain } from "./paths";
import { siteUrl } from "./site";

/**
 * Stores' own domains (P8), such as `butikk.example.no`: what an owner may
 * add, the DNS records that prove it is theirs and point it at Kaizen, and
 * what the latest check found. Shared by the admin and the server.
 */

/** Each store can have this many, its primary among them. */
export const MAX_DOMAINS = 5;

/** The TXT record that proves a domain is the store's: its name, with the claim's token as value. */
export const verifyName = (hostname: string) => `_kaizen.${hostname}`;
export const verifyValue = (token: string) => `kaizen-verify=${token}`;

/** What the latest check found, for the admin (`store_domains.checks`). */
export type DomainChecks = {
  /** Our TXT record with the claim's token is there. */
  txt?: boolean;
  /** Vercel lets the project use the domain. */
  vercelVerified?: boolean;
  /** The domain does not point at Vercel yet, so it cannot serve the store or get a certificate. */
  misconfigured?: boolean;
  /** Records Vercel asks for when the domain is in use elsewhere on Vercel. */
  challenges?: { type: string; domain: string; value: string }[];
  /** The registrable domain, e.g. `example.no` for `butikk.example.no`, as Vercel sees it. */
  apexName?: string;
  /** Where to point the domain: A records for an apex, a CNAME otherwise, as Vercel recommends. */
  aValues?: string[];
  cname?: string;
  /** Why the check could not finish, in words for the owner. */
  problem?: string;
};

/** Vercel's general values, until a check has its recommendation. */
const DEFAULT_A = "76.76.21.21";
const DEFAULT_CNAME = "cname.vercel-dns.com";

/** A DNS record the owner creates at their DNS provider. */
export type DnsRecord = { type: "A" | "CNAME" | "TXT"; name: string; value: string; done: boolean; why: string };

/** Whether a host is its domain's apex (`example.no`), which takes A records, not a CNAME. */
export function isApex(hostname: string, checks: DomainChecks): boolean {
  return checks.apexName ? checks.apexName === hostname : hostname.split(".").length === 2;
}

/** The records a domain needs: our TXT, where it points, and Vercel's own challenges if it asks. */
export function dnsRecords(hostname: string, token: string, checks: DomainChecks): DnsRecord[] {
  const pointed = checks.misconfigured === false;
  const records: DnsRecord[] = [
    { type: "TXT", name: verifyName(hostname), value: verifyValue(token), done: checks.txt === true, why: "Shows the domain is yours." },
  ];
  if (isApex(hostname, checks)) {
    for (const value of checks.aValues?.length ? checks.aValues : [DEFAULT_A]) {
      records.push({ type: "A", name: hostname, value, done: pointed, why: "Points the domain at your store." });
    }
  } else {
    records.push({ type: "CNAME", name: hostname, value: checks.cname || DEFAULT_CNAME, done: pointed, why: "Points the domain at your store." });
  }
  for (const challenge of checks.challenges ?? []) {
    records.push({
      type: challenge.type.toUpperCase() === "TXT" ? "TXT" : "CNAME",
      name: challenge.domain,
      value: challenge.value,
      done: checks.vercelVerified === true,
      why: "The domain is used elsewhere on Vercel: this confirms it moves here.",
    });
  }
  return records;
}

/** Hosts that are Kaizen's, never a store's own. */
function reservedHost(hostname: string): boolean {
  const own = [new URL(siteUrl()).hostname, storeDomain()?.split(":")[0], "vercel.app", "localhost"].filter(Boolean) as string[];
  return own.some((host) => hostname === host || hostname.endsWith(`.${host}`));
}

const HOSTNAME = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$/;

/**
 * A domain as an owner types it: with or without `https://`, a path or a
 * trailing dot, in any case, international names as their ASCII form.
 */
export function normalizeHostname(input: string): string {
  const text = input.trim().toLowerCase().replace(/^[a-z]+:\/\//, "").split(/[/?#]/)[0].replace(/\.$/, "");
  try {
    return new URL(`http://${text}`).hostname;
  } catch {
    return text;
  }
}

export const domainInput = z.object({
  hostname: z
    .string()
    .max(300)
    .transform(normalizeHostname)
    .refine((host) => host.length <= 253 && HOSTNAME.test(host), "Write the domain as it is written in a browser, like butikk.example.no.")
    .refine((host) => !reservedHost(host), "That address is Kaizen's. Add a domain of your own."),
});
