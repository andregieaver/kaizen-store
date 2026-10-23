import { recordKey, recordProblems, tidyRecord, type DnsRecord, type DnsRecordInput } from "./dns-records";

/**
 * Every change to a zone Kaizena Flow keeps goes through `planDns()` first (D315, `docs/domains.md` 5.1), whoever makes it: the editor, a
 * recipe, the AI manager, an undo. It says what the zone becomes, what is added and removed, what the change does in words (`effects`), and
 * what it refuses: a record that isn't its type's shape, one kept for the store, a CNAME beside other records, a second SPF record (which it
 * merges instead), an MX pointing at a CNAME. `rev` is a fingerprint of the records it read, so a change approved on one zone is never applied
 * to records that changed since. Pure: the browser, the server and the tests share it.
 */

export type DnsChange = { op: "add"; record: DnsRecordInput } | { op: "remove"; record: DnsRecordInput };

export type EffectCode =
  | "email_to"
  | "email_stops"
  | "email_extra"
  | "website_points"
  | "subdomain_points"
  | "verification"
  | "spf_set"
  | "spf_merged"
  | "dkim_set"
  | "dmarc_set"
  | "removes"
  | "adds";

export type Effect = { code: EffectCode; values: Record<string, string | number> };

export type DnsPlan = {
  ok: boolean;
  problems: string[];
  /** Records to make, and current records (with their ids) to take out. */
  adds: DnsRecordInput[];
  removes: DnsRecord[];
  /** The zone after, as it would read. */
  after: DnsRecordInput[];
  effects: Effect[];
  /** Email for the domain stops, or moves to another provider: such a change asks even where DNS changes are automatic (decision 5a). */
  touchesEmail: boolean;
  /** The fingerprint of the records the plan was made on. */
  rev: string;
};

/** Mail providers known by their MX hosts, for the effects' words; anything else is named by its host. */
const PROVIDERS: { name: string; hosts: RegExp }[] = [
  { name: "Google Workspace", hosts: /(^|\.)(google\.com|googlemail\.com)$/ },
  { name: "Microsoft 365", hosts: /\.mail\.protection\.outlook\.com$/ },
  { name: "Zoho Mail", hosts: /(^|\.)zoho\.(com|eu|in|com\.au|jp)$/ },
  { name: "Proton Mail", hosts: /(^|\.)protonmail\.ch$/ },
  { name: "Fastmail", hosts: /(^|\.)messagingengine\.com$/ },
  { name: "one.com", hosts: /(^|\.)one\.com$/ },
  { name: "Domeneshop", hosts: /(^|\.)domeneshop\.no$/ },
];

export const mailProvider = (host: string): string => PROVIDERS.find((p) => p.hosts.test(host.toLowerCase()))?.name ?? host;

/** A fingerprint of a zone's records: the same records in any order give the same text. */
export function zoneRev(records: readonly DnsRecordInput[]): string {
  const text = records.map(recordKey).sort().join("\n");
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619) >>> 0;
    h2 = Math.imul(h2 ^ c, 2246822519) >>> 0;
  }
  return `${h1.toString(16).padStart(8, "0")}${h2.toString(16).padStart(8, "0")}`;
}

const isSpf = (r: DnsRecordInput) => r.type === "TXT" && /^v=spf1(\s|$)/i.test(r.value.trim());

/**
 * One SPF record from two: every mechanism of both (each once), the first record's `all` kept, so adding a provider never loosens or tightens
 * what was there. Returns null when either is not SPF.
 */
export function mergeSpf(existing: string, added: string): string | null {
  const parts = (v: string) => (/^v=spf1(\s|$)/i.test(v.trim()) ? v.trim().split(/\s+/).slice(1) : null);
  const a = parts(existing);
  const b = parts(added);
  if (!a || !b) return null;
  const isAll = (t: string) => /^[+?~-]?all$/i.test(t);
  const all = a.find(isAll) ?? b.find(isAll) ?? "~all";
  const terms: string[] = [];
  for (const t of [...a, ...b]) if (!isAll(t) && !terms.some((x) => x.toLowerCase() === t.toLowerCase())) terms.push(t);
  return ["v=spf1", ...terms, all].join(" ");
}

/** Whether a record is kept by Kaizena Flow for the store (D315 4.6): what points a connected host at it, and the proof records. */
export function isProtected(r: DnsRecordInput, connectedNames: readonly string[]): boolean {
  if (r.name === "_kaizen" || r.name.startsWith("_kaizen.") || r.name.startsWith("_vercel")) return true;
  return connectedNames.includes(r.name) && (r.type === "A" || r.type === "AAAA" || r.type === "ALIAS" || r.type === "CNAME");
}

export type PlanInput = {
  apex: string;
  current: readonly DnsRecord[];
  changes: readonly DnsChange[];
  /** The zone's hosts the store is served on, relative (`""` for the apex, `www`): their pointing records are the store's. */
  connectedNames: readonly string[];
  /** Kaizena Flow itself connecting or disconnecting the store may touch its own records; nobody else may. */
  kaizena?: boolean;
};

export function planDns({ apex, current, changes, connectedNames, kaizena = false }: PlanInput): DnsPlan {
  const problems: string[] = [];
  const removes: DnsRecord[] = [];
  const adds: DnsRecordInput[] = [];
  const effects: Effect[] = [];
  let state: DnsRecordInput[] = current.map((r) => ({ ...r }));
  const keyOf = recordKey;

  for (const change of changes) {
    const record = tidyRecord(change.record, apex);
    const issues = change.op === "add" ? recordProblems(record) : [];
    if (issues.length > 0) {
      problems.push(...issues);
      continue;
    }
    if (!kaizena && isProtected(record, connectedNames)) {
      problems.push(`${record.type} ${record.name ? `${record.name}.${apex}` : apex} is kept by Kaizena Flow for your store. Disconnect the domain from the store to change it.`);
      continue;
    }
    if (change.op === "remove") {
      const found = current.find((r) => keyOf(r) === keyOf(record) && !removes.includes(r));
      if (!found) {
        problems.push(`There is no ${record.type} record ${record.name ? `${record.name}.${apex}` : apex} → ${record.value || record.srv?.target || ""} to remove.`);
        continue;
      }
      removes.push(found);
      const at = state.findIndex((r) => keyOf(r) === keyOf(found));
      if (at >= 0) state.splice(at, 1);
      continue;
    }
    if (state.some((r) => keyOf(r) === keyOf(record))) continue;
    // A second SPF record at a name is merged into the one there: two make every email check fail.
    if (isSpf(record)) {
      const existing = state.find((r) => isSpf(r) && r.name === record.name);
      if (existing) {
        const merged = mergeSpf(existing.value, record.value);
        if (merged && merged !== existing.value) {
          const live = current.find((r) => keyOf(r) === keyOf(existing));
          if (live && !removes.includes(live)) removes.push(live);
          else {
            const i = adds.findIndex((a) => keyOf(a) === keyOf(existing));
            if (i >= 0) adds.splice(i, 1);
          }
          state = state.filter((r) => r !== existing);
          const next = { ...record, value: merged };
          adds.push(next);
          state.push(next);
          effects.push({ code: "spf_merged", values: { value: merged } });
        }
        continue;
      }
    }
    adds.push(record);
    state.push(record);
  }

  // The zone as it would be: no CNAME beside anything else, one SPF a name, no MX at a CNAME.
  const byName = new Map<string, DnsRecordInput[]>();
  for (const r of state) byName.set(r.name, [...(byName.get(r.name) ?? []), r]);
  for (const [name, records] of byName) {
    const where = name ? `${name}.${apex}` : apex;
    if (records.some((r) => r.type === "CNAME") && records.length > 1) problems.push(`${where} can't have a CNAME record beside other records.`);
    if (records.filter(isSpf).length > 1) problems.push(`${where} would have two SPF records; keep one.`);
  }
  for (const mx of state.filter((r) => r.type === "MX")) {
    const target = mx.value.toLowerCase();
    if (target === apex || target.endsWith(`.${apex}`)) {
      const name = target === apex ? "" : target.slice(0, -apex.length - 1);
      if (byName.get(name)?.some((r) => r.type === "CNAME")) problems.push(`The mail server ${target} is a CNAME; an MX record must point at a host with an address.`);
    }
  }

  // What the change does, in words.
  const mxBefore = current.filter((r) => r.type === "MX" && r.name === "").map((r) => r.value.toLowerCase());
  const mxAfter = state.filter((r) => r.type === "MX" && r.name === "").map((r) => r.value.toLowerCase());
  const providersBefore = [...new Set(mxBefore.map(mailProvider))];
  const providersAfter = [...new Set(mxAfter.map(mailProvider))];
  let touchesEmail = false;
  if (mxBefore.length > 0 && mxAfter.length === 0) {
    effects.push({ code: "email_stops", values: { domain: apex } });
    touchesEmail = true;
  } else if (mxAfter.length > 0 && providersAfter.join() !== providersBefore.join()) {
    const fresh = providersAfter.filter((p) => !providersBefore.includes(p));
    if (providersBefore.length > 0 && providersBefore.every((p) => !providersAfter.includes(p))) touchesEmail = true;
    effects.push({ code: providersBefore.length > 0 && providersAfter.length > providersBefore.length ? "email_extra" : "email_to", values: { domain: apex, provider: (fresh.length ? fresh : providersAfter).join(", ") } });
  }
  for (const r of adds) {
    const where = r.name ? `${r.name}.${apex}` : apex;
    if ((r.type === "A" || r.type === "AAAA" || r.type === "ALIAS" || r.type === "CNAME") && !connectedNames.includes(r.name)) {
      effects.push({ code: r.name === "" || r.name === "www" ? "website_points" : "subdomain_points", values: { host: where, target: r.value } });
    } else if (r.type === "TXT" && /^v=DMARC1/i.test(r.value)) effects.push({ code: "dmarc_set", values: { domain: apex } });
    else if (r.type === "TXT" && isSpf(r) && !effects.some((e) => e.code === "spf_merged")) effects.push({ code: "spf_set", values: { domain: apex } });
    else if ((r.type === "TXT" || r.type === "CNAME") && /\._domainkey$|^[^.]*\._domainkey$/.test(r.name)) effects.push({ code: "dkim_set", values: { domain: apex } });
    else if (r.type === "TXT" && /^[\w.-]+-(verification|verify)=|^MS=ms\d+|^[a-z-]+-site-verification=/i.test(r.value)) effects.push({ code: "verification", values: { domain: apex } });
  }
  if (adds.length > 0) effects.push({ code: "adds", values: { count: adds.length } });
  if (removes.length > 0) effects.push({ code: "removes", values: { count: removes.length } });

  // Email first, then what the site does, then the rest, the counts last.
  const ORDER: EffectCode[] = ["email_stops", "email_to", "email_extra", "website_points", "subdomain_points", "spf_merged", "spf_set", "dkim_set", "dmarc_set", "verification", "adds", "removes"];
  effects.sort((a, b) => ORDER.indexOf(a.code) - ORDER.indexOf(b.code));
  return { ok: problems.length === 0 && (adds.length > 0 || removes.length > 0), problems, adds, removes, after: state, effects, touchesEmail, rev: zoneRev(current) };
}

/** An effect in words: the catalogue's template for its code with its values filled in. */
export function effectText(effect: Effect, words: Readonly<Record<EffectCode, string>>): string {
  return words[effect.code].replace(/\{(\w+)\}/g, (all, key: string) => (key in effect.values ? String(effect.values[key]) : all));
}
