import { RECORD_TYPES, TTL_DEFAULT, fqdn, relativeName, tidyRecord, type DnsRecordInput, type RecordType } from "./dns-records";

/**
 * Zone files (D315, `docs/domains.md` 8.2 and 5.4): `writeZone()` gives a zone's records as a BIND master file any DNS provider can import,
 * and `parseZone()` reads one back (the same subset: `$ORIGIN`, `$TTL`, relative and absolute names, `@`, and the record types Kaizena Flow
 * keeps). The two round-trip, which a test holds. Pure.
 *
 * `ALIAS` is no BIND type: it is written as a comment naming its target, so a provider that has ALIAS (or ANAME, or CNAME flattening) can
 * make it by hand, and read back from that comment. `$INCLUDE` and `$GENERATE` are refused, never followed.
 */

const quoteTxt = (value: string): string => {
  // DNS strings are at most 255 bytes each; a longer TXT value is several strings, which a reader joins.
  const chunks: string[] = [];
  for (let i = 0; i < value.length; i += 255) chunks.push(value.slice(i, i + 255));
  return (chunks.length ? chunks : [""]).map((c) => `"${c.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`).join(" ");
};

const abs = (host: string) => (host.endsWith(".") ? host : `${host}.`);

/** The records as a BIND zone file, with a header that says where it came from and when. */
export function writeZone(apex: string, records: readonly DnsRecordInput[], options: { at?: Date; kept?: (r: DnsRecordInput) => boolean } = {}): string {
  const at = (options.at ?? new Date()).toISOString();
  const lines = [`; ${apex} as Kaizena Flow kept it, ${at}`, `; Records marked "kept for your store" point the domain at Kaizena Flow: recreate them only if the store stays here.`, `$ORIGIN ${abs(apex)}`, `$TTL ${TTL_DEFAULT}`, ""];
  const sorted = [...records].sort((a, b) => a.name.localeCompare(b.name) || a.type.localeCompare(b.type) || a.value.localeCompare(b.value));
  for (const r of sorted) {
    const name = r.name === "" ? "@" : r.name;
    const ttl = r.ttl ?? TTL_DEFAULT;
    const note = options.kept?.(r) ? " ; kept for your store" : "";
    switch (r.type) {
      case "MX":
        lines.push(`${name}\t${ttl}\tIN\tMX\t${r.mxPriority ?? 10} ${abs(r.value)}${note}`);
        break;
      case "CNAME":
        lines.push(`${name}\t${ttl}\tIN\tCNAME\t${abs(r.value)}${note}`);
        break;
      case "ALIAS":
        lines.push(`; ALIAS ${name} ${ttl} ${abs(r.value)} (no BIND type: make it as ALIAS, ANAME or a flattened CNAME at your provider)${note}`);
        break;
      case "TXT":
        lines.push(`${name}\t${ttl}\tIN\tTXT\t${quoteTxt(r.value)}${note}`);
        break;
      case "SRV":
        if (r.srv) lines.push(`${name}\t${ttl}\tIN\tSRV\t${r.srv.priority} ${r.srv.weight} ${r.srv.port} ${abs(r.srv.target)}${note}`);
        break;
      default:
        lines.push(`${name}\t${ttl}\tIN\t${r.type}\t${r.value}${note}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

/** Splits a line into fields, keeping quoted strings whole and stopping at a comment. */
function fields(line: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < line.length) {
    const c = line[i];
    if (c === ";") break;
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === '"') {
      let s = "";
      i++;
      while (i < line.length && line[i] !== '"') {
        if (line[i] === "\\" && i + 1 < line.length) i++;
        s += line[i++];
      }
      i++;
      out.push(`"${s}`);
      continue;
    }
    let s = "";
    while (i < line.length && !/\s/.test(line[i]) && line[i] !== ";") s += line[i++];
    out.push(s);
  }
  return out;
}

export type ParsedZone = { records: DnsRecordInput[]; problems: string[]; skipped: string[] };

/**
 * Reads a zone file: the records Kaizena Flow keeps, the lines it couldn't read (`problems`), and records of types it doesn't keep, named
 * (`skipped`: NS and SOA are the provider's own and are left out without a word). Parentheses spanning lines are joined first.
 */
export function parseZone(text: string, apex: string): ParsedZone {
  const records: DnsRecordInput[] = [];
  const problems: string[] = [];
  const skipped: string[] = [];
  let origin = apex.toLowerCase();
  let ttl = TTL_DEFAULT;
  let last = "";
  // Join `( … )` over lines.
  const joined: string[] = [];
  let open = "";
  for (const raw of text.split(/\r?\n/)) {
    const alias = /^;\s*ALIAS\s+(\S+)\s+(\d+)\s+(\S+)/i.exec(raw.trim());
    if (alias) {
      records.push(tidyRecord({ type: "ALIAS", name: alias[1] === "@" ? "" : alias[1], value: alias[3], ttl: Number(alias[2]) }, apex));
      continue;
    }
    const line = open ? `${open} ${raw}` : raw;
    const depth = (line.replace(/"[^"]*"|;.*$/g, "").match(/\(/g)?.length ?? 0) - (line.replace(/"[^"]*"|;.*$/g, "").match(/\)/g)?.length ?? 0);
    if (depth > 0) {
      open = line.replace(/;.*$/, "");
      continue;
    }
    open = "";
    joined.push(line.replace(/[()]/g, " "));
  }
  for (const line of joined) {
    if (!line.trim() || line.trim().startsWith(";")) continue;
    const startsBlank = /^\s/.test(line);
    const f = fields(line);
    if (f.length === 0) continue;
    if (f[0].startsWith("$")) {
      const directive = f[0].toUpperCase();
      if (directive === "$ORIGIN" && f[1]) origin = f[1].replace(/\.$/, "").toLowerCase();
      else if (directive === "$TTL" && /^\d+$/.test(f[1] ?? "")) ttl = Number(f[1]);
      else problems.push(`${directive} isn't read here: paste the records it stands for instead.`);
      continue;
    }
    let name = startsBlank ? last : f.shift()!;
    if (!startsBlank) last = name;
    let recordTtl = ttl;
    let type = "";
    while (f.length > 0) {
      const t = f.shift()!;
      if (/^\d+$/.test(t)) recordTtl = Number(t);
      else if (/^(IN|CH|HS)$/i.test(t)) continue;
      else {
        type = t.toUpperCase();
        break;
      }
    }
    if (!type) {
      problems.push(`"${line.trim().slice(0, 60)}" has no record type.`);
      continue;
    }
    if (type === "NS" || type === "SOA") continue;
    if (!(RECORD_TYPES as readonly string[]).includes(type)) {
      skipped.push(`${type} ${name}`);
      continue;
    }
    // Names: `@` is the origin, a name without a dot at its end is relative to the origin.
    const full = name === "@" ? origin : name.endsWith(".") ? name.slice(0, -1) : `${name}.${origin}`;
    name = relativeName(full, apex);
    if (full !== apex && !full.endsWith(`.${apex}`)) {
      problems.push(`${full} isn't in ${apex}.`);
      continue;
    }
    const target = (h: string) => (h === "@" ? origin : h.endsWith(".") ? h.slice(0, -1) : `${h}.${origin}`);
    const base = { type: type as RecordType, name, ttl: recordTtl };
    if (type === "MX") {
      if (f.length < 2 || !/^\d+$/.test(f[0])) {
        problems.push(`The MX record of ${fqdn(name, apex)} needs a priority and a mail server.`);
        continue;
      }
      records.push(tidyRecord({ ...base, value: target(f[1]), mxPriority: Number(f[0]) }, apex));
    } else if (type === "SRV") {
      if (f.length < 4) {
        problems.push(`The SRV record of ${fqdn(name, apex)} needs a priority, weight, port and target.`);
        continue;
      }
      records.push(tidyRecord({ ...base, value: "", srv: { priority: Number(f[0]), weight: Number(f[1]), port: Number(f[2]), target: target(f[3]) } }, apex));
    } else if (type === "TXT") {
      records.push(tidyRecord({ ...base, value: f.map((s) => (s.startsWith('"') ? s.slice(1) : s)).join("") }, apex));
    } else if (type === "CNAME" || type === "ALIAS") {
      records.push(tidyRecord({ ...base, value: target(f[0] ?? "") }, apex));
    } else if (type === "CAA") {
      records.push(tidyRecord({ ...base, value: f.map((s) => (s.startsWith('"') ? `"${s.slice(1)}"` : s)).join(" ") }, apex));
    } else {
      records.push(tidyRecord({ ...base, value: f[0] ?? "" }, apex));
    }
  }
  return { records, problems, skipped };
}
