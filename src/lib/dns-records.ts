/**
 * DNS records as Kaizena Flow keeps and shows them (D315, `docs/domains.md` 5): one shape for Vercel DNS, the editor, the AI manager's tools,
 * recipes and zone files. A record's `name` is relative to its zone's apex: `""` is the apex itself (`@` in zone files), `www` is
 * `www.example.no`. Pure, so the planner (`dns-plan.ts`), the editor in the browser and the tests share it.
 */

export const RECORD_TYPES = ["A", "AAAA", "ALIAS", "CNAME", "MX", "TXT", "SRV", "CAA"] as const;
export type RecordType = (typeof RECORD_TYPES)[number];

export type SrvData = { priority: number; weight: number; port: number; target: string };

export type DnsRecordInput = {
  type: RecordType;
  /** Relative to the apex: `""` for the apex, `www`, `_dmarc`, `selector._domainkey`. */
  name: string;
  /** The record's value: an address, a host name, a text, or a CAA `flags tag "value"`. For an MX the mail server, for an SRV unused. */
  value: string;
  ttl?: number;
  mxPriority?: number;
  srv?: SrvData;
};

export type DnsRecord = DnsRecordInput & { id: string; ttl: number };

export const TTL_MIN = 60;
export const TTL_MAX = 86_400;
export const TTL_DEFAULT = 3_600;
/** The longest single value kept (a DKIM key is the longest real one, about 2 kB); TXT values over 255 are split into strings by DNS itself. */
export const VALUE_MAX = 4_000;

const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
const HOST = /^(?=.{1,253}\.?$)(?:(?!-)[a-z0-9_-]{1,63}(?<!-)\.)*(?!-)[a-z0-9_-]{1,63}(?<!-)\.?$/i;
const NAME = /^(?:\*\.)?(?:(?!-)[a-z0-9_-]{1,63}(?<!-))(?:\.(?!-)[a-z0-9_-]{1,63}(?<!-))*$/i;

function isIpv6(v: string): boolean {
  if (!/^[0-9a-f:.]+$/i.test(v) || !v.includes(":")) return false;
  try {
    return new URL(`http://[${v}]/`).hostname.length > 2;
  } catch {
    return false;
  }
}

/** A name as written in a form or a zone file, made relative to the apex: `@`, the apex itself and a trailing dot are understood. */
export function relativeName(name: string, apex: string): string {
  const n = name.trim().toLowerCase().replace(/\.$/, "");
  const a = apex.toLowerCase();
  if (n === "" || n === "@" || n === a) return "";
  return n.endsWith(`.${a}`) ? n.slice(0, -a.length - 1) : n;
}

/** The full host name of a record. */
export const fqdn = (name: string, apex: string): string => (name ? `${name}.${apex}` : apex);

/** A host name value without its trailing dot, in lower case. */
const host = (v: string) => v.trim().replace(/\.$/, "").toLowerCase();

/** The problems with one record, in words for the owner (empty when it is fine). */
export function recordProblems(r: DnsRecordInput): string[] {
  const problems: string[] = [];
  if (!(RECORD_TYPES as readonly string[]).includes(r.type)) return [`${r.type} records can't be kept here.`];
  if (r.name !== "" && !NAME.test(r.name)) problems.push(`"${r.name}" isn't a name a record can have.`);
  if (r.ttl !== undefined && (!Number.isInteger(r.ttl) || r.ttl < TTL_MIN || r.ttl > TTL_MAX)) problems.push(`The time to live must be ${TTL_MIN} to ${TTL_MAX} seconds.`);
  const v = r.value.trim();
  if (r.type !== "SRV" && v === "") problems.push(`A ${r.type} record needs a value.`);
  if (v.length > VALUE_MAX) problems.push("That value is too long.");
  switch (r.type) {
    case "A":
      if (v && !IPV4.test(v)) problems.push(`"${v}" isn't an IPv4 address, like 76.76.21.21.`);
      break;
    case "AAAA":
      if (v && !isIpv6(v)) problems.push(`"${v}" isn't an IPv6 address.`);
      break;
    case "ALIAS":
    case "CNAME":
      if (v && !HOST.test(host(v))) problems.push(`"${v}" isn't a host name, like cname.vercel-dns.com.`);
      if (r.type === "CNAME" && r.name === "") problems.push("The domain itself can't have a CNAME record: use an A or ALIAS record.");
      break;
    case "MX":
      if (v && !HOST.test(host(v))) problems.push(`"${v}" isn't a mail server's host name.`);
      if (r.mxPriority === undefined || !Number.isInteger(r.mxPriority) || r.mxPriority < 0 || r.mxPriority > 65_535) problems.push("An MX record needs a priority from 0 to 65535.");
      break;
    case "TXT":
      if (/[\u0000-\u001f\u007f]/.test(v)) problems.push("A text record can't hold line breaks or control characters.");
      break;
    case "SRV": {
      const s = r.srv;
      if (!s) problems.push("An SRV record needs a priority, a weight, a port and a target.");
      else {
        for (const [k, n, max] of [["priority", s.priority, 65_535], ["weight", s.weight, 65_535], ["port", s.port, 65_535]] as const) {
          if (!Number.isInteger(n) || n < 0 || n > max) problems.push(`An SRV record's ${k} must be 0 to ${max}.`);
        }
        if (!HOST.test(host(s.target))) problems.push(`"${s.target}" isn't a host name.`);
      }
      break;
    }
    case "CAA":
      if (v && !/^\d{1,3}\s+(issue|issuewild|iodef)\s+"[^"]*"$/i.test(v)) problems.push(`A CAA record is written like 0 issue "letsencrypt.org".`);
      break;
  }
  return problems;
}

/** A record as entered, tidied: names relative and lower case, host names without a trailing dot, the default TTL. */
export function tidyRecord(r: DnsRecordInput, apex: string): DnsRecordInput {
  const type = r.type;
  const base: DnsRecordInput = { type, name: relativeName(r.name, apex), value: r.value.trim(), ttl: r.ttl ?? TTL_DEFAULT };
  if (type === "CNAME" || type === "ALIAS" || type === "MX") base.value = host(r.value);
  if (type === "MX") base.mxPriority = r.mxPriority;
  if (type === "SRV" && r.srv) base.srv = { ...r.srv, target: host(r.srv.target) };
  if (type === "TXT") base.value = r.value.trim().replace(/^"([\s\S]*)"$/, "$1");
  return base;
}

/** What makes two records the same record (the id and TTL aside). */
export function recordKey(r: DnsRecordInput): string {
  const srv = r.srv ? `${r.srv.priority} ${r.srv.weight} ${r.srv.port} ${host(r.srv.target)}` : "";
  const value = r.type === "TXT" || r.type === "CAA" ? r.value.trim() : host(r.value);
  return [r.type, r.name.toLowerCase(), value, r.type === "MX" ? (r.mxPriority ?? "") : "", srv].join("|");
}

/** A record in one line, for history, approvals and the AI manager. */
export function describeRecord(r: DnsRecordInput, apex: string): string {
  const name = fqdn(r.name, apex);
  if (r.type === "MX") return `MX ${name} → ${r.value} (priority ${r.mxPriority ?? 0})`;
  if (r.type === "SRV" && r.srv) return `SRV ${name} → ${r.srv.target}:${r.srv.port} (priority ${r.srv.priority}, weight ${r.srv.weight})`;
  const value = r.value.length > 80 ? `${r.value.slice(0, 77)}…` : r.value;
  return `${r.type} ${name} → ${r.type === "TXT" ? `"${value}"` : value}`;
}

/** A record as Vercel's DNS API lists it, read defensively; null for a kind Kaizena Flow doesn't keep (NS, HTTPS). */
export function fromVercelRecord(r: Record<string, unknown>): DnsRecord | null {
  const type = String(r.type ?? r.recordType ?? "").toUpperCase();
  if (!(RECORD_TYPES as readonly string[]).includes(type)) return null;
  const id = String(r.id ?? r.uid ?? "");
  if (!id) return null;
  const ttl = typeof r.ttl === "number" ? r.ttl : Number(r.ttl) || TTL_DEFAULT;
  const name = String(r.name ?? "").toLowerCase();
  const record: DnsRecord = { id, type: type as RecordType, name: name === "@" ? "" : name, value: String(r.value ?? ""), ttl };
  if (type === "MX") record.mxPriority = Number(r.mxPriority ?? r.priority ?? 0);
  if (type === "SRV") {
    // Vercel lists an SRV's data in its value: `priority weight port target`.
    const [priority, weight, port, target] = String(r.value ?? "").trim().split(/\s+/);
    record.srv = { priority: Number(priority) || 0, weight: Number(weight) || 0, port: Number(port) || 0, target: host(target ?? "") };
    record.value = "";
  }
  return record;
}

/** A record as Vercel's DNS API takes it. */
export function toVercelRecord(r: DnsRecordInput): { type: RecordType; name: string; value?: string; ttl: number; mxPriority?: number; srv?: SrvData } {
  const out: { type: RecordType; name: string; value?: string; ttl: number; mxPriority?: number; srv?: SrvData } = { type: r.type, name: r.name, ttl: r.ttl ?? TTL_DEFAULT };
  if (r.type === "SRV") out.srv = r.srv;
  else out.value = r.value;
  if (r.type === "MX") out.mxPriority = r.mxPriority ?? 10;
  return out;
}
