/**
 * Domain Connect (D315, `docs/domains.md` 6, S3): the one-press way to connect a domain whose DNS stays at its provider. Kaizena Flow is a
 * service provider with two templates, `kaizenaflow.com`/`store` and `store-host`, holding the records a store's connection needs (P8): the proof record
 * with the claim's token and what points the host at the store. Where the owner's DNS provider has taken the template in, *Connect
 * automatically* sends them there to sign in and approve, and the connection then completes as usual: P8's checks still decide. Pure: the
 * template files published for providers (`docs/domain-connect/kaizenaflow.com.{store,store-host}.json`) are these, which a test holds.
 *
 * Read from the specification (github.com/Domain-Connect/spec, 23 October 2026): discovery is the `_domainconnect` TXT record of the
 * domain, then `GET https://{that}/v2/{domain}/settings` (`providerId`, `providerName`, `urlAPI`, `urlSyncUX`); a template is supported
 * when `GET {urlAPI}/v2/domainTemplates/providers/{providerId}/services/{serviceId}` answers 200; the synchronous flow opens
 * `{urlSyncUX}/v2/domainTemplates/providers/{providerId}/services/{serviceId}/apply?…`, signed with RS256 over the query string without
 * `sig` and `key`, its public key in TXT records at `{key}.{syncPubKeyDomain}` (`p=1,a=RS256,d=…`).
 */

export const DC_PROVIDER_ID = "kaizenaflow.com";
/** Two templates: the domain itself (an A record) and a name under it (a CNAME, which the spec allows on `@` only where a host is required). */
export const DC_SERVICES = { apex: "store", host: "store-host" } as const;
export type DcService = keyof typeof DC_SERVICES;
/** Where the public key's TXT records live, and their host. */
export const DC_KEY_DOMAIN = "kaizenaflow.com";
export const DC_KEY_HOST = "_dcpubkeyv1";
/** Vercel's general values (P8's defaults); the A record is a variable so Vercel's own recommendation can be passed. */
export const DC_DEFAULT_A = "76.76.21.21";
export const DC_DEFAULT_CNAME = "cname.vercel-dns.com";

export type DomainConnectTemplate = {
  providerId: string;
  providerName: string;
  serviceId: string;
  serviceName: string;
  version: number;
  logoUrl: string;
  description: string;
  variableDescription: string;
  syncBlock: boolean;
  syncPubKeyDomain: string;
  syncRedirectDomain: string;
  warnPhishing: boolean;
  hostRequired: boolean;
  records: Record<string, unknown>[];
};

/**
 * A template: on the host the owner connects (`host` empty for the domain itself), an A record to the store (`apex`) or a CNAME to it
 * (`host`), and the proof record `_kaizen` with the claim's token, which replaces only TXT records of its own name.
 */
export function domainConnectTemplate(kind: DcService): DomainConnectTemplate {
  const apex = kind === "apex";
  return {
    providerId: DC_PROVIDER_ID,
    providerName: "Kaizena Flow",
    serviceId: DC_SERVICES[kind],
    serviceName: apex ? "Online store" : "Online store on a subdomain",
    version: 1,
    logoUrl: "https://kaizenaflow.com/kaizen/favicon.ico",
    description: "Connects the domain to a Kaizena Flow online store: points it at the store and adds the record that shows it is yours.",
    variableDescription: apex ? "token: the store's proof for this domain; ip: the address the domain points at." : "token: the store's proof for this name.",
    syncBlock: false,
    syncPubKeyDomain: DC_KEY_DOMAIN,
    syncRedirectDomain: "kaizenaflow.com",
    warnPhishing: true,
    hostRequired: !apex,
    records: [
      apex ? { type: "A", host: "@", pointsTo: "%ip%", ttl: 3600 } : { type: "CNAME", host: "@", pointsTo: DC_DEFAULT_CNAME, ttl: 3600 },
      { type: "TXT", host: "_kaizen", data: "kaizen-verify=%token%", ttl: 3600, txtConflictMatchingMode: "All" },
    ],
  };
}

export type DomainConnectSettings = { providerId: string; providerName: string; providerDisplayName: string | null; urlAPI: string; urlSyncUX: string | null };

/** A provider's settings answer, read defensively: null without the required fields or an https address. */
export function readSettings(body: unknown): DomainConnectSettings | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const https = (v: unknown) => (typeof v === "string" && /^https:\/\/[a-z0-9.-]+(:\d+)?(\/[^\s]*)?$/i.test(v) ? v.replace(/\/$/, "") : null);
  const urlAPI = https(b.urlAPI);
  if (typeof b.providerId !== "string" || typeof b.providerName !== "string" || !urlAPI) return null;
  return {
    providerId: b.providerId,
    providerName: b.providerName.slice(0, 80),
    providerDisplayName: typeof b.providerDisplayName === "string" ? b.providerDisplayName.slice(0, 80) : null,
    urlAPI,
    urlSyncUX: https(b.urlSyncUX),
  };
}

/** The discovery record's value as a host, or null: a provider's prefix, never a full address or anything else. */
export function discoveryHost(txt: readonly string[]): string | null {
  const value = txt.map((t) => t.trim()).find((t) => /^[a-z0-9.-]+(\/[a-z0-9._~\/-]*)?$/i.test(t));
  return value ? value.replace(/\/$/, "") : null;
}

export type ApplyInput = { domain: string; host: string; token: string; ip: string; redirectUri: string; state: string };

/** The query string of the apply address, values URL-encoded in a fixed order: the string the signature is made over. */
export function applyQuery(input: ApplyInput): string {
  const pairs: [string, string][] = [
    ["domain", input.domain],
    ...(input.host ? ([["host", input.host]] as [string, string][]) : []),
    ["token", input.token],
    ...(input.host ? [] : ([["ip", input.ip]] as [string, string][])),
    ["redirect_uri", input.redirectUri],
    ["state", input.state],
  ];
  return pairs.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");
}

/** The address to send the owner to, with the signature (base64, URL-encoded) and the key's host added after what was signed. */
export function applyUrl(settings: DomainConnectSettings, kind: DcService, query: string, signature: string): string {
  return `${settings.urlSyncUX}/v2/domainTemplates/providers/${DC_PROVIDER_ID}/services/${DC_SERVICES[kind]}/apply?${query}&sig=${encodeURIComponent(signature)}&key=${DC_KEY_HOST}`;
}

/** The public key (base64 SPKI) as the TXT records providers read at `_dcpubkeyv1.kaizenaflow.com`, 200 characters of key each. */
export function publicKeyRecords(spkiBase64: string): string[] {
  const out: string[] = [];
  for (let i = 0, n = 1; i < spkiBase64.length; i += 200, n++) out.push(`p=${n},a=RS256,d=${spkiBase64.slice(i, i + 200)}`);
  return out;
}
