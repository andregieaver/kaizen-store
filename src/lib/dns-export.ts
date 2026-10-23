import { writeCsv, type Cell, type DialectId } from "./csv";
import { fqdn, type DnsRecordInput } from "./dns-records";

/**
 * A zone's records as a spreadsheet (D315, `docs/domains.md` 8.2), for an owner moving DNS to a provider that imports none of the zone
 * file: one row a record, the full name beside the one relative to the domain, and whether it is kept for the store.
 */
export function zoneCsv(apex: string, records: readonly DnsRecordInput[], kept: (r: DnsRecordInput) => boolean, dialect: DialectId = "standard"): string {
  const rows: Cell[][] = [["name", "host", "type", "value", "priority", "weight", "port", "ttl", "kept_for_store"]];
  for (const r of records) {
    rows.push([
      r.name || "@",
      fqdn(r.name, apex),
      r.type,
      r.type === "SRV" ? (r.srv?.target ?? "") : r.value,
      r.type === "MX" ? (r.mxPriority ?? null) : r.type === "SRV" ? (r.srv?.priority ?? null) : null,
      r.type === "SRV" ? (r.srv?.weight ?? null) : null,
      r.type === "SRV" ? (r.srv?.port ?? null) : null,
      r.ttl ?? null,
      kept(r) ? "yes" : "no",
    ]);
  }
  return writeCsv(rows, dialect);
}
