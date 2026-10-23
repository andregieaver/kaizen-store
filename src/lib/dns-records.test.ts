import { describe, expect, it } from "vitest";

import { describeRecord, fromVercelRecord, recordKey, recordProblems, relativeName, tidyRecord, toVercelRecord } from "./dns-records";

describe("DNS records (D315 5)", () => {
  it("makes names relative to the apex however they are written", () => {
    expect(relativeName("@", "example.no")).toBe("");
    expect(relativeName("example.no.", "example.no")).toBe("");
    expect(relativeName("WWW.example.no", "example.no")).toBe("www");
    expect(relativeName("_dmarc", "example.no")).toBe("_dmarc");
  });

  it("checks each type's value", () => {
    expect(recordProblems({ type: "A", name: "", value: "76.76.21.21" })).toEqual([]);
    expect(recordProblems({ type: "A", name: "", value: "76.76.21" })).toHaveLength(1);
    expect(recordProblems({ type: "AAAA", name: "", value: "2001:db8::1" })).toEqual([]);
    expect(recordProblems({ type: "CNAME", name: "www", value: "cname.vercel-dns.com." })).toEqual([]);
    expect(recordProblems({ type: "CNAME", name: "", value: "cname.vercel-dns.com" }).join()).toMatch(/can't have a CNAME/);
    expect(recordProblems({ type: "MX", name: "", value: "aspmx.l.google.com" }).join()).toMatch(/priority/);
    expect(recordProblems({ type: "MX", name: "", value: "aspmx.l.google.com", mxPriority: 1 })).toEqual([]);
    expect(recordProblems({ type: "TXT", name: "", value: "line\nbreak" })).toHaveLength(1);
    expect(recordProblems({ type: "CAA", name: "", value: '0 issue "letsencrypt.org"' })).toEqual([]);
    expect(recordProblems({ type: "CAA", name: "", value: "letsencrypt.org" })).toHaveLength(1);
    expect(recordProblems({ type: "SRV", name: "_sip._tcp", value: "", srv: { priority: 10, weight: 5, port: 5060, target: "sip.example.no" } })).toEqual([]);
    expect(recordProblems({ type: "A", name: "bad name", value: "1.2.3.4" })).toHaveLength(1);
    expect(recordProblems({ type: "TXT", name: "", value: "x", ttl: 10 })).toHaveLength(1);
  });

  it("tidies and compares records the same however they were typed", () => {
    const a = tidyRecord({ type: "CNAME", name: "WWW.example.no", value: "Cname.Vercel-dns.com." }, "example.no");
    expect(a).toEqual({ type: "CNAME", name: "www", value: "cname.vercel-dns.com", ttl: 3600 });
    expect(recordKey(a)).toBe(recordKey({ type: "CNAME", name: "www", value: "cname.vercel-dns.com" }));
    expect(tidyRecord({ type: "TXT", name: "@", value: '"v=spf1 -all"' }, "example.no").value).toBe("v=spf1 -all");
  });

  it("reads and writes Vercel's shape", () => {
    expect(fromVercelRecord({ id: "rec_1", type: "MX", name: "", value: "mx.example.no", mxPriority: 10, ttl: 60 })).toEqual({
      id: "rec_1",
      type: "MX",
      name: "",
      value: "mx.example.no",
      mxPriority: 10,
      ttl: 60,
    });
    expect(fromVercelRecord({ id: "rec_2", type: "NS", name: "", value: "ns1" })).toBeNull();
    expect(fromVercelRecord({ id: "rec_3", type: "SRV", name: "_sip._tcp", value: "10 5 5060 sip.example.no." })?.srv).toEqual({
      priority: 10,
      weight: 5,
      port: 5060,
      target: "sip.example.no",
    });
    expect(toVercelRecord({ type: "MX", name: "", value: "mx", mxPriority: 5 })).toEqual({ type: "MX", name: "", value: "mx", ttl: 3600, mxPriority: 5 });
  });

  it("describes a record in one line", () => {
    expect(describeRecord({ type: "MX", name: "", value: "mx.example.no", mxPriority: 10 }, "example.no")).toBe("MX example.no → mx.example.no (priority 10)");
    expect(describeRecord({ type: "TXT", name: "_dmarc", value: "v=DMARC1; p=none" }, "example.no")).toBe('TXT _dmarc.example.no → "v=DMARC1; p=none"');
  });
});
