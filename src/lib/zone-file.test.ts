import { describe, expect, it } from "vitest";

import { zoneCsv } from "./dns-export";
import { recordKey, type DnsRecordInput } from "./dns-records";
import { cleanNameservers, missingRecords, moveSteps, questionsFor, transferBlockers } from "./domain-move";
import { parseZone, writeZone } from "./zone-file";

const apex = "example.no";
const zone: DnsRecordInput[] = [
  { type: "A", name: "", value: "76.76.21.21", ttl: 3600 },
  { type: "ALIAS", name: "shop", value: "cname.vercel-dns.com", ttl: 60 },
  { type: "CNAME", name: "www", value: "cname.vercel-dns.com", ttl: 3600 },
  { type: "MX", name: "", value: "smtp.google.com", mxPriority: 1, ttl: 3600 },
  { type: "TXT", name: "", value: 'v=spf1 include:_spf.google.com ~all', ttl: 3600 },
  { type: "TXT", name: "google._domainkey", value: `v=DKIM1; k=rsa; p=${"A".repeat(400)}`, ttl: 3600 },
  { type: "TXT", name: "quoted", value: 'say "hi"', ttl: 300 },
  { type: "SRV", name: "_sip._tls", value: "", srv: { priority: 100, weight: 1, port: 443, target: "sip.example.com" }, ttl: 3600 },
  { type: "CAA", name: "", value: '0 issue "letsencrypt.org"', ttl: 3600 },
  { type: "AAAA", name: "v6", value: "2001:db8::1", ttl: 3600 },
];
const keys = (rs: readonly DnsRecordInput[]) => rs.map((r) => `${recordKey(r)}|${r.ttl}`).sort();

describe("zone files (D315 8.2)", () => {
  it("write and read back every kind of record", () => {
    const text = writeZone(apex, zone, { at: new Date("2026-10-23T12:00:00Z"), kept: (r) => r.name === "www" });
    expect(text).toContain("$ORIGIN example.no.");
    expect(text).toContain("www\t3600\tIN\tCNAME\tcname.vercel-dns.com. ; kept for your store");
    const read = parseZone(text, apex);
    expect(read.problems).toEqual([]);
    expect(keys(read.records)).toEqual(keys(zone));
  });

  it("reads a provider's file: relative names, a default TTL, parentheses, and leaves out NS and SOA", () => {
    const text = [
      "$ORIGIN example.no.",
      "$TTL 600",
      "@ IN SOA ns1.other.net. hostmaster.example.no. ( 2026102301 3600 600",
      "  1209600 600 )",
      "@ IN NS ns1.other.net.",
      "mail IN A 192.0.2.10",
      "  IN AAAA 2001:db8::10",
      "@ 300 IN MX 10 mail",
      "blog.example.no. IN CNAME ghost.io.",
      "@ IN HINFO \"x\" \"y\"",
      "$INCLUDE other.zone",
      "elsewhere.org. IN A 192.0.2.1",
    ].join("\n");
    const read = parseZone(text, apex);
    expect(read.records).toEqual([
      { type: "A", name: "mail", value: "192.0.2.10", ttl: 600 },
      { type: "AAAA", name: "mail", value: "2001:db8::10", ttl: 600 },
      { type: "MX", name: "", value: "mail.example.no", mxPriority: 10, ttl: 300 },
      { type: "CNAME", name: "blog", value: "ghost.io", ttl: 600 },
    ]);
    expect(read.skipped).toEqual(["HINFO @"]);
    expect(read.problems).toHaveLength(2);
  });

  it("writes a spreadsheet with the kept records marked", () => {
    const csv = zoneCsv(apex, zone.slice(0, 4), (r) => r.name === "www");
    expect(csv.split(/\r?\n/)[0]).toBe("name,host,type,value,priority,weight,port,ttl,kept_for_store");
    expect(csv).toContain("www,www.example.no,CNAME,cname.vercel-dns.com,,,,3600,yes");
  });
});

describe("moving away (D315 8)", () => {
  const now = new Date("2026-10-23T12:00:00Z");
  const facts = { apex: "shop-example.com", status: "active" as const, registeredAt: "2026-01-01T00:00:00Z", expiresAt: "2027-01-01T00:00:00Z", contactVerified: true, renewalUnderWay: false };

  it("blocks the transfer code while a lock, a renewal or an unconfirmed contact stands", () => {
    expect(transferBlockers(facts, now)).toEqual({ blockers: [], advice: [] });
    expect(transferBlockers({ ...facts, registeredAt: "2026-10-01T00:00:00Z" }, now).blockers).toEqual([{ code: "locked", values: { domain: facts.apex, date: "2026-11-30" } }]);
    expect(transferBlockers({ ...facts, apex: "butikk.no", registeredAt: "2026-10-01T00:00:00Z" }, now).blockers).toEqual([]);
    expect(transferBlockers({ ...facts, renewalUnderWay: true, contactVerified: false }, now).blockers.map((b) => b.code)).toEqual(["renewal_under_way", "contact_unverified"]);
    expect(transferBlockers({ ...facts, expiresAt: "2026-10-30T00:00:00Z" }, now).advice.map((a) => a.code)).toEqual(["expires_soon"]);
    expect(transferBlockers({ ...facts, status: "transferred_out" }, now).blockers.map((b) => b.code)).toEqual(["moved"]);
  });

  it("finds what the new nameservers don't answer, and tells a silent provider from a missing record", () => {
    const records = zone.slice(0, 5);
    expect(questionsFor(records)).toEqual([
      { name: "", type: "A" },
      { name: "shop", type: "A" },
      { name: "www", type: "CNAME" },
      { name: "", type: "MX" },
      { name: "", type: "TXT" },
    ]);
    const answers = [
      { name: "", type: "A", records: [{ type: "A" as const, name: "", value: "76.76.21.21" }] },
      { name: "shop", type: "A", records: [{ type: "A" as const, name: "shop", value: "203.0.113.5" }] },
      { name: "www", type: "CNAME", records: [] },
      { name: "", type: "MX", records: [{ type: "MX" as const, name: "", value: "SMTP.google.com.", mxPriority: 1 }] },
      { name: "", type: "TXT", records: null },
    ];
    expect(missingRecords(records, answers)).toEqual({ missing: [records[2]], unanswered: ["TXT @"] });
  });

  it("reads pasted nameservers", () => {
    expect(cleanNameservers("NS1.other-dns.net.\nns2.other-dns.net, ns2.other-dns.net")).toEqual({ nameservers: ["ns1.other-dns.net", "ns2.other-dns.net"], problem: null });
    expect(cleanNameservers("ns1.other.net").problem).toMatch(/at least two/);
    expect(cleanNameservers("ns1.vercel-dns.com ns2.vercel-dns.com").problem).toMatch(/already/);
  });

  it("lists the steps of each move, DNS before the registration when leaving", () => {
    const f = { registeredHere: true, registrationStatus: "active" as const, zoneStatus: "active" as const, connected: true, blockers: 0 };
    expect(moveSteps("leave", f).map((s) => `${s.key}:${s.state}`)).toEqual([
      "disconnect:ready",
      "download:ready",
      "check_new_dns:ready",
      "switch_dns:waiting",
      "transfer_code:ready",
      "transfer_done:waiting",
    ]);
    expect(moveSteps("registrar", { ...f, blockers: 1 })[0].state).toBe("blocked");
    expect(moveSteps("dns", { ...f, zoneStatus: "leaving" }).map((s) => s.state)).toEqual(["ready", "done", "done"]);
  });
});
