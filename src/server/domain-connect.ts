import "server-only";

import { createSign } from "node:crypto";

import { applyQuery, applyUrl, discoveryHost, DC_DEFAULT_A, DC_PROVIDER_ID, DC_SERVICES, readSettings, type DcService, type DomainConnectSettings } from "@/lib/domain-connect";
import { apexOf } from "@/lib/domain-health";
import { domainConnectKey } from "@/lib/env";

import { systemDns, type PublicDns } from "./domain-health";
import { safeFetch } from "./replicate-fetch";

/**
 * Domain Connect for a store's domain whose DNS stays at its provider (D315, `docs/domains.md` 6): discovery from public DNS and the
 * provider's own settings, whether it took our template in, and the signed address that sends the owner there. Nothing is changed here:
 * the provider asks the owner, and P8's checks decide as ever. Every request goes through `safeFetch()` (https only, no private addresses,
 * small answers, a time limit); off without the signing key.
 */

export type ConnectFetch = (url: string) => Promise<{ status: number; body: unknown } | null>;

const fetchJson: ConnectFetch = async (url) => {
  const got = await safeFetch(url, { maxBytes: 64 * 1024, timeoutMs: 4_000, accept: "application/json", maxRedirects: 2 });
  if (!got.ok) return got.status ? { status: got.status, body: null } : null;
  if (got.status === 404) return { status: 404, body: null };
  try {
    return { status: got.status, body: got.bytes.length ? JSON.parse(Buffer.from(got.bytes).toString("utf8")) : null };
  } catch {
    return { status: got.status, body: null };
  }
};

export type ConnectDeps = { dns?: PublicDns; fetch?: ConnectFetch; key?: string | null };

/** Whether the domain's DNS provider supports our template for this host, and its settings when it does. Never throws. */
export async function domainConnectFor(hostname: string, deps: ConnectDeps = {}): Promise<{ settings: DomainConnectSettings; kind: DcService } | null> {
  const key = deps.key === undefined ? domainConnectKey() : deps.key;
  if (!key) return null;
  const apex = apexOf(hostname);
  const kind: DcService = hostname === apex ? "apex" : "host";
  try {
    const txt = await (deps.dns ?? systemDns()).txt(`_domainconnect.${apex}`);
    const host = txt ? discoveryHost(txt) : null;
    if (!host) return null;
    const fetch = deps.fetch ?? fetchJson;
    const answer = await fetch(`https://${host}/v2/${encodeURIComponent(apex)}/settings`);
    const settings = answer && answer.status === 200 ? readSettings(answer.body) : null;
    if (!settings?.urlSyncUX) return null;
    const supported = await fetch(`${settings.urlAPI}/v2/domainTemplates/providers/${DC_PROVIDER_ID}/services/${DC_SERVICES[kind]}`);
    return supported?.status === 200 ? { settings, kind } : null;
  } catch {
    return null;
  }
}

/** The signed address to the provider, which asks the owner to approve the store's records for the host. */
export function signedApplyUrl(settings: DomainConnectSettings, kind: DcService, input: { hostname: string; token: string; ip?: string; redirectUri: string; state: string }, key: string): string {
  const apex = apexOf(input.hostname);
  const host = input.hostname === apex ? "" : input.hostname.slice(0, -apex.length - 1);
  const query = applyQuery({ domain: apex, host, token: input.token, ip: input.ip ?? DC_DEFAULT_A, redirectUri: input.redirectUri, state: input.state });
  const signer = createSign("RSA-SHA256");
  signer.update(query);
  return applyUrl(settings, kind, query, signer.sign(key, "base64"));
}
