import { describe, expect, it } from "vitest";

import type { DnsRecord } from "./dns-records";
import { cleanDomain, cleanFromLocal, hostForForm, keptRecords, readResendDomain, recordHost, senderAddress, statusOf, zoneChanges } from "./sending-domains";

/** Resend's answer to creating `example.no`, as its API reference shows it (17 November 2026), with the tracking record it may add. */
const created = {
  id: "4dd369bc-aa82-4ff3-97de-514ae3000ee0",
  name: "example.no",
  status: "not_started",
  region: "eu-west-1",
  records: [
    { record: "DKIM", name: "resend._domainkey", value: "p=MIGfMA0GCSqGSIb3DQEB", type: "TXT", status: "not_started", ttl: "Auto" },
    { record: "SPF", name: "send", type: "MX", ttl: "Auto", status: "not_started", value: "feedback-smtp.eu-west-1.amazonses.com", priority: 10 },
    { record: "SPF", name: "send", value: '"v=spf1 include:amazonses.com ~all"', type: "TXT", ttl: "Auto", status: "not_started" },
    { record: "Tracking", name: "links.example.no", type: "CNAME", value: "links1.resend-dns.com", ttl: "Auto", status: "not_started" },
  ],
};

describe("Resend's answer", () => {
  it("reads the records with full host names, unquoted, and leaves the tracking record out", () => {
    const domain = readResendDomain(created, "example.no");
    expect(domain).toMatchObject({ id: created.id, name: "example.no", status: "pending" });
    expect(domain?.records).toEqual([
      { purpose: "DKIM", type: "TXT", host: "resend._domainkey.example.no", value: "p=MIGfMA0GCSqGSIb3DQEB", status: "not_started" },
      { purpose: "SPF", type: "MX", host: "send.example.no", value: "feedback-smtp.eu-west-1.amazonses.com", priority: 10, status: "not_started" },
      { purpose: "SPF", type: "TXT", host: "send.example.no", value: "v=spf1 include:amazonses.com ~all", status: "not_started" },
    ]);
  });

  it("is not a domain without an id", () => {
    expect(readResendDomain({ name: "example.no" }, "example.no")).toBeNull();
    expect(readResendDomain("nope", "example.no")).toBeNull();
  });

  it("sends only when verified, and asks the owner to act only when failed", () => {
    expect(statusOf("verified")).toBe("verified");
    expect(statusOf("failed")).toBe("failed");
    for (const word of ["not_started", "pending", "temporary_failure", "partially_verified", undefined]) expect(statusOf(word)).toBe("pending");
  });

  it("names a subdomain's records under the registrable domain, however Resend writes them", () => {
    expect(recordHost("send", "mail.example.no")).toBe("send.mail.example.no");
    expect(recordHost("send.mail", "mail.example.no")).toBe("send.mail.example.no");
    expect(recordHost("resend._domainkey.mail.example.no", "mail.example.no")).toBe("resend._domainkey.mail.example.no");
    expect(recordHost("@", "example.co.uk")).toBe("example.co.uk");
  });

  it("reads kept records back, skipping anything of another shape", () => {
    const kept = readResendDomain(created, "example.no")?.records ?? [];
    expect(keptRecords(JSON.parse(JSON.stringify(kept)))).toEqual(kept);
    expect(keptRecords([{ type: "A", host: "x", value: "1.2.3.4" }, null, "x"])).toEqual([]);
    expect(keptRecords(null)).toEqual([]);
  });
});

describe("what the owner types", () => {
  it("understands an address, a link and a trailing dot", () => {
    expect(cleanDomain(" Butikk@Example.NO ")).toBe("example.no");
    expect(cleanDomain("https://www.example.no/shop?x=1")).toBe("example.no");
    expect(cleanDomain("mail.example.no.")).toBe("mail.example.no");
    for (const bad of ["", "example", "exa mple.no", "-x.no", "x.1"]) expect(cleanDomain(bad)).toBeNull();
  });

  it("takes the part before the @ in lower case, and refuses what an address cannot start with", () => {
    expect(cleanFromLocal("News")).toBe("news");
    expect(cleanFromLocal("hello@example.no")).toBe("hello");
    expect(cleanFromLocal("kundeservice.no")).toBe("kundeservice.no");
    for (const bad of ["", ".news", "news.", "a..b", "nyhet er", "æøå"]) expect(cleanFromLocal(bad)).toBeNull();
    expect(senderAddress("news", "example.no")).toBe("news@example.no");
  });

  it("names a record's host as a DNS provider's form asks for it", () => {
    expect(hostForForm("send.example.no", "example.no")).toBe("send");
    expect(hostForForm("send.mail.example.no", "mail.example.no")).toBe("send.mail");
    expect(hostForForm("example.no", "example.no")).toBe("@");
  });
});

describe("writing the records into a zone we keep", () => {
  const records = readResendDomain(created, "example.no")?.records ?? [];
  const live = (r: Omit<DnsRecord, "id" | "ttl">, i: number): DnsRecord => ({ id: `r${i}`, ttl: 3600, ...r });

  it("adds each record relative to the zone, the MX with its priority", () => {
    expect(zoneChanges(records, "example.no", [])).toEqual([
      { op: "add", record: { type: "TXT", name: "resend._domainkey", value: "p=MIGfMA0GCSqGSIb3DQEB" } },
      { op: "add", record: { type: "MX", name: "send", value: "feedback-smtp.eu-west-1.amazonses.com", mxPriority: 10 } },
      { op: "add", record: { type: "TXT", name: "send", value: "v=spf1 include:amazonses.com ~all" } },
    ]);
  });

  it("changes nothing the zone already has, so writing twice is harmless", () => {
    const current = [
      live({ type: "TXT", name: "resend._domainkey", value: "p=MIGfMA0GCSqGSIb3DQEB" }, 0),
      live({ type: "MX", name: "send", value: "feedback-smtp.eu-west-1.amazonses.com.", mxPriority: 10 }, 1),
      live({ type: "TXT", name: "send", value: "v=spf1 include:amazonses.com ~all" }, 2),
      live({ type: "MX", name: "", value: "aspmx.l.google.com", mxPriority: 1 }, 3),
    ];
    expect(zoneChanges(records, "example.no", current)).toEqual([]);
  });

  it("never writes into a zone that is not the record's", () => {
    expect(zoneChanges(records, "other.no", [])).toEqual([]);
  });
});
