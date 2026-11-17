import type { DnsChange } from "./dns-plan";
import { relativeName, type DnsRecord, type DnsRecordInput } from "./dns-records";
import { apexOf } from "./domain-health";

/**
 * A store's own sending domain (D727, step M1.1 of `docs/audits/email-marketing-2026-11.md`), pure: what Resend answers about a domain read
 * into our shape, the records turned into changes of a zone Kaizena Flow keeps, and the address the store's emails go from. The server
 * (`src/server/sending-domains.ts`) only asks Resend, writes and shows what these work out.
 */

export const SENDING_STATUSES = ["pending", "verified", "failed"] as const;
export type SendingStatus = (typeof SENDING_STATUSES)[number];

/** The region Resend sends from (Ireland), as Kaizena Flow's own domain does (D26): mail is made and sent inside the EU. */
export const SENDING_REGION = "eu-west-1";

/** The part before the @ a new sending domain starts with. */
export const FROM_LOCAL_DEFAULT = "news";

/** One record Resend asks for, as kept in `sending_domains.records`: `host` is the full host name, `value` without quotes. */
export type SendingRecord = {
  /** What it is for: `DKIM` (signing), `SPF` (the return path's MX and TXT). */
  purpose: string;
  type: "TXT" | "MX" | "CNAME";
  host: string;
  value: string;
  priority?: number;
  /** Resend's own word for the record (`not_started`, `pending`, `verified`, `failed`, …). */
  status: string;
};

export type ResendDomain = { id: string; name: string; status: SendingStatus; records: SendingRecord[] };

/** Resend's domain states read as ours: only `verified` sends and only `failed` asks the owner to act; every other word is still waiting. */
export function statusOf(resend: unknown): SendingStatus {
  if (resend === "verified") return "verified";
  if (resend === "failed") return "failed";
  return "pending";
}

const text = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/**
 * A record's full host name. Resend names a record relative to the domain added (`send`, `resend._domainkey`) or in full
 * (`links.example.com`); for a subdomain it may also name it relative to the registrable domain (`send.mail` for `mail.example.com`).
 */
export function recordHost(name: string, domain: string): string {
  const n = name.trim().toLowerCase().replace(/\.$/, "");
  const d = domain.toLowerCase();
  if (n === "" || n === "@" || n === d) return d;
  if (n.endsWith(`.${d}`)) return n;
  const apex = apexOf(d);
  if (n.endsWith(`.${apex}`)) return n;
  const sub = d === apex ? "" : d.slice(0, -apex.length - 1);
  if (sub && (n === sub || n.endsWith(`.${sub}`))) return `${n}.${apex}`;
  return `${n}.${d}`;
}

/** A TXT value as written in a zone: Resend sometimes gives it inside quotes. */
const unquote = (v: string): string => (v.length >= 2 && v.startsWith('"') && v.endsWith('"') ? v.slice(1, -1) : v);

/** Resend's answer about one domain (create, get or verify), or null when it is not one. Tracking records are left out: we count clicks ourselves. */
export function readResendDomain(body: unknown, domain: string): ResendDomain | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const id = text(b.id);
  if (!id) return null;
  const records: SendingRecord[] = [];
  for (const raw of Array.isArray(b.records) ? b.records : []) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const type = text(r.type).toUpperCase();
    const purpose = text(r.record) || type;
    if (purpose.toLowerCase() === "tracking") continue;
    if (type !== "TXT" && type !== "MX" && type !== "CNAME") continue;
    const value = type === "TXT" ? unquote(text(r.value)) : text(r.value).replace(/\.$/, "").toLowerCase();
    if (!value) continue;
    const priority = Number(r.priority);
    records.push({
      purpose,
      type,
      host: recordHost(text(r.name), domain),
      value,
      ...(type === "MX" && { priority: Number.isFinite(priority) ? priority : 10 }),
      status: text(r.status) || "not_started",
    });
  }
  return { id, name: text(b.name).toLowerCase() || domain, status: statusOf(b.status), records: records.slice(0, 10) };
}

/** Kept records read back from the database (`sending_domains.records`), skipping anything not of their shape. */
export function keptRecords(value: unknown): SendingRecord[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw) => {
    if (!raw || typeof raw !== "object") return [];
    const r = raw as Record<string, unknown>;
    const type = text(r.type);
    if (type !== "TXT" && type !== "MX" && type !== "CNAME") return [];
    const host = text(r.host);
    const v = text(r.value);
    if (!host || !v) return [];
    return [{ purpose: text(r.purpose) || type, type, host, value: v, ...(typeof r.priority === "number" && { priority: r.priority }), status: text(r.status) || "not_started" }];
  });
}

const DOMAIN = /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{1,62}$/;
const LOCAL = /^[a-z0-9]([a-z0-9._-]{0,38}[a-z0-9])?$/;

/** A domain as the owner typed it (an address, `https://`, a path or a trailing dot are understood), or null when it is not one. */
export function cleanDomain(input: string): string | null {
  let d = input.trim().toLowerCase();
  if (d.includes("@")) d = d.slice(d.lastIndexOf("@") + 1);
  d = d.replace(/^[a-z]+:\/\//, "").replace(/[/?#].*$/, "").replace(/\.$/, "");
  if (d.startsWith("www.")) d = d.slice(4);
  return d.length <= 253 && DOMAIN.test(d) ? d : null;
}

/** The part before the @ as the owner typed it, or null when an address could not start with it. */
export function cleanFromLocal(input: string): string | null {
  const l = input.trim().toLowerCase().replace(/@.*$/, "");
  return LOCAL.test(l) && !l.includes("..") ? l : null;
}

/** The address a store's emails go from while its domain is verified. */
export const senderAddress = (local: string, domain: string): string => `${local}@${domain}`;

/**
 * The changes that put Resend's records into a zone Kaizena Flow keeps (`apex`), leaving out what the zone already has, so writing twice
 * changes nothing. A record outside the zone (another domain's) is not written.
 */
export function zoneChanges(records: readonly SendingRecord[], apex: string, current: readonly DnsRecord[]): DnsChange[] {
  const a = apex.toLowerCase();
  const same = (x: DnsRecordInput, y: DnsRecordInput) =>
    x.type === y.type && x.name === y.name && x.value.replace(/\.$/, "").toLowerCase() === y.value.replace(/\.$/, "").toLowerCase();
  const changes: DnsChange[] = [];
  for (const r of records) {
    if (r.host !== a && !r.host.endsWith(`.${a}`)) continue;
    const record: DnsRecordInput = { type: r.type, name: relativeName(r.host, a), value: r.value, ...(r.type === "MX" && { mxPriority: r.priority ?? 10 }) };
    if (current.some((c) => same(c, record)) || changes.some((c) => same(c.record, record))) continue;
    changes.push({ op: "add", record });
  }
  return changes;
}

/** A record's host as the owner's DNS provider asks for it: relative to the registrable domain, `@` for the domain itself. */
export function hostForForm(host: string, domain: string): string {
  const apex = apexOf(domain);
  return relativeName(host, apex) || "@";
}
