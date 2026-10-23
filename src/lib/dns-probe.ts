import { recordKey, type DnsRecordInput } from "./dns-records";
import type { Answer } from "./domain-move";

/**
 * Moving a domain's DNS here (D315, `docs/domains.md` 5.4): what the current provider holds, read without a zone file by asking its own
 * nameservers about the names a business's domain usually has, and what a zone file the owner brings says, checked against what is live.
 * DNS has no way to list a zone, so a name nobody guessed is not found: the page says so, and the owner can add it. Pure.
 */

/** Names asked about, relative to the domain: the site, mail and its proofs, the usual DKIM selectors, and Microsoft 365's. */
export const PROBE_NAMES = [
  "",
  "www",
  "mail",
  "webmail",
  "smtp",
  "imap",
  "pop",
  "autodiscover",
  "autoconfig",
  "_dmarc",
  "_domainkey",
  "default._domainkey",
  "google._domainkey",
  "selector1._domainkey",
  "selector2._domainkey",
  "k1._domainkey",
  "k2._domainkey",
  "k3._domainkey",
  "s1._domainkey",
  "s2._domainkey",
  "zmail._domainkey",
  "protonmail._domainkey",
  "protonmail2._domainkey",
  "protonmail3._domainkey",
  "fm1._domainkey",
  "fm2._domainkey",
  "fm3._domainkey",
  "mailo._domainkey",
  "resend._domainkey",
  "send",
  "em",
  "bounce",
  "lyncdiscover",
  "sip",
  "enterpriseregistration",
  "enterpriseenrollment",
  "_sip._tls",
  "_sipfederationtls._tcp",
  "_autodiscover._tcp",
  "_imaps._tcp",
  "_submission._tcp",
  "shop",
  "blog",
  "app",
  "api",
  "ftp",
] as const;

/** What to ask of each name: the domain itself has no CNAME; a service name (`_x._tcp`) holds SRV; a key's name TXT or a CNAME. */
export function typesFor(name: string): string[] {
  if (name === "") return ["A", "AAAA", "MX", "TXT", "CAA"];
  if (/^_[^.]+\._(tcp|tls|udp)$/.test(name)) return ["SRV"];
  if (name.endsWith("_domainkey") || name === "_dmarc") return ["CNAME", "TXT"];
  return ["CNAME", "A", "AAAA", "MX", "TXT"];
}

/** The first questions: a CNAME of every name that can have one, and everything about the domain itself and service names. */
export function firstQuestions(names: readonly string[] = PROBE_NAMES): { name: string; type: string }[] {
  return names.flatMap((name) => {
    const types = typesFor(name);
    return types.includes("CNAME") ? [{ name, type: "CNAME" }] : types.map((type) => ({ name, type }));
  });
}

/** The second: every other type, for the names that had no CNAME (a name with a CNAME holds nothing else). */
export function secondQuestions(first: readonly Answer[], names: readonly string[] = PROBE_NAMES): { name: string; type: string }[] {
  const aliased = new Set(first.filter((a) => a.type === "CNAME" && (a.records?.length ?? 0) > 0).map((a) => a.name));
  return names.flatMap((name) => (aliased.has(name) ? [] : typesFor(name).filter((t) => t !== "CNAME").map((type) => ({ name, type }))));
}

/** The records the current provider answered, each once. */
export function liveRecords(answers: readonly Answer[]): DnsRecordInput[] {
  const seen = new Set<string>();
  const out: DnsRecordInput[] = [];
  for (const a of answers) {
    for (const r of a.records ?? []) {
      const key = recordKey(r);
      if (!seen.has(key)) {
        seen.add(key);
        out.push(r);
      }
    }
  }
  return out;
}

export type FoundRecord = {
  record: DnsRecordInput;
  /** Where it came from: the zone file, or asking the current provider. */
  from: "file" | "probe";
  /** Whether the current provider answers it now (null: its name and type were not asked, so not known). */
  live: boolean | null;
};

/**
 * The records to copy here: every record of the zone file (marked live or not, where it was asked), then every record found by asking
 * that the file does not hold. Without a file, only what was found.
 */
export function mergeFound(fileRecords: readonly DnsRecordInput[], answers: readonly Answer[]): FoundRecord[] {
  const live = liveRecords(answers);
  const liveKeys = new Set(live.map(recordKey));
  const asked = new Set(answers.filter((a) => a.records !== null).map((a) => `${a.name}|${a.type}`));
  const askedOf = (r: DnsRecordInput) => asked.has(`${r.name}|${r.type === "ALIAS" ? "A" : r.type}`);
  const out: FoundRecord[] = fileRecords.map((record) => ({ record, from: "file", live: askedOf(record) ? liveKeys.has(recordKey(record)) : null }));
  const fileKeys = new Set(fileRecords.map(recordKey));
  for (const record of live) if (!fileKeys.has(recordKey(record))) out.push({ record, from: "probe", live: true });
  return out;
}
