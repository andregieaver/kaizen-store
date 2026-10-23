import { describe, expect, it } from "vitest";

import { domainsEn } from "./admin-messages/domains.en";
import { domainsNb } from "./admin-messages/domains.nb";
import { apexOf, dmarcOf, domainHealth, findingText, isVercelNameserver, spfOf, worstSeverity, type DomainFacts, type FindingCode } from "./domain-health";

const NOW = new Date("2026-10-23T12:00:00Z");

const facts = (over: Partial<DomainFacts> = {}): DomainFacts => ({
  hostname: "example.no",
  apex: "example.no",
  connection: { status: "active", isPrimary: true, txt: true, misconfigured: false },
  dnsHost: "elsewhere",
  registration: { withUs: false, registrar: "Domeneshop", expiresAt: "2027-06-01T00:00:00Z", renews: null, contactVerified: null },
  email: { mx: ["mx.example.no"], spf: ["v=spf1 include:_spf.google.com ~all"], dmarc: "v=DMARC1; p=none" },
  caa: [],
  ...over,
});

const codes = (f: DomainFacts) => domainHealth(f, NOW).map((x) => x.code);

describe("a domain's health (D315 5.3)", () => {
  it("is healthy when nothing is wrong", () => {
    expect(codes(facts())).toEqual(["healthy"]);
    expect(worstSeverity(domainHealth(facts(), NOW))).toBe("info");
  });

  it("says a waiting domain doesn't point at the store, and what proves it is missing", () => {
    const f = facts({ connection: { status: "pending", isPrimary: false, txt: false, misconfigured: true } });
    expect(codes(f)).toEqual(["not_pointed", "proof_missing"]);
    expect(worstSeverity(domainHealth(f, NOW))).toBe("error");
  });

  it("warns 30 days before an expiry that does not renew by itself, and calls 14 days an error", () => {
    const at = (days: number) => new Date(NOW.getTime() + days * 86_400_000 + 3_600_000).toISOString();
    const warn = domainHealth(facts({ registration: { withUs: false, registrar: "X", expiresAt: at(20), renews: null, contactVerified: null } }), NOW);
    expect(warn[0]).toMatchObject({ code: "expires_soon", severity: "warning", values: { days: 20 } });
    const error = domainHealth(facts({ registration: { withUs: false, registrar: "X", expiresAt: at(10), renews: null, contactVerified: null } }), NOW);
    expect(error[0]).toMatchObject({ code: "expires_soon", severity: "error" });
    // Ours and renewing: no warning.
    expect(codes(facts({ registration: { withUs: true, registrar: null, expiresAt: at(10), renews: true, contactVerified: true } }))).toEqual(["healthy"]);
    expect(codes(facts({ registration: { withUs: true, registrar: null, expiresAt: at(-1), renews: true, contactVerified: true } }))).toContain("expired");
  });

  it("asks for the registrant's email to be confirmed on a domain we registered", () => {
    const f = facts({ registration: { withUs: true, registrar: null, expiresAt: null, renews: true, contactVerified: false } });
    expect(domainHealth(f, NOW)[0]).toMatchObject({ code: "contact_unverified", severity: "error", fix: { place: "contact" } });
    // Not known yet (bought minutes ago) is not a finding.
    expect(codes(facts({ registration: { withUs: true, registrar: null, expiresAt: null, renews: true, contactVerified: null } }))).toEqual(["healthy"]);
  });

  it("finds a CAA record that stops the certificate, and lets one that names Let's Encrypt be", () => {
    expect(codes(facts({ caa: [{ tag: "issue", value: "digicert.com" }] }))).toContain("caa_blocks");
    expect(codes(facts({ caa: [{ tag: "issue", value: "letsencrypt.org" }] }))).toEqual(["healthy"]);
    expect(codes(facts({ caa: [{ tag: "iodef", value: "mailto:x@example.no" }] }))).toEqual(["healthy"]);
  });

  it("reads email: two SPF records, a missing SPF, a missing DMARC, no email at all", () => {
    expect(codes(facts({ email: { mx: ["mx"], spf: ["v=spf1 a", "v=spf1 mx"], dmarc: "v=DMARC1; p=none" } }))).toEqual(["spf_duplicate"]);
    expect(codes(facts({ email: { mx: ["mx"], spf: [], dmarc: null } }))).toEqual(["spf_missing", "dmarc_missing"]);
    expect(codes(facts({ email: { mx: [], spf: [], dmarc: null } }))).toEqual(["healthy", "no_email"]);
  });

  it("names a tool for a fix only where Kaizena Flow keeps the DNS, and the page's records otherwise", () => {
    const ours = domainHealth(facts({ dnsHost: "kaizena", email: { mx: ["mx"], spf: [], dmarc: "v=DMARC1" } }), NOW)[0];
    expect(ours.fix).toEqual({ tool: "set_up_email", place: "email" });
    const theirs = domainHealth(facts({ email: { mx: ["mx"], spf: [], dmarc: "v=DMARC1" } }), NOW)[0];
    expect(theirs.fix).toEqual({ place: "records" });
  });

  it("never reads a failed lookup as no records", () => {
    expect(codes(facts({ email: null }))).toEqual(["healthy", "lookup_failed"]);
  });

  it("has words for every finding in English and Norwegian, with every value filled", () => {
    const all: FindingCode[] = ["not_pointed", "proof_missing", "check_problem", "expired", "expires_soon", "contact_unverified", "caa_blocks", "spf_duplicate", "spf_missing", "dmarc_missing", "no_email", "lookup_failed", "healthy"];
    for (const code of all) {
      for (const words of [domainsEn.health, domainsNb.health]) {
        const text = findingText({ code, severity: "info", fix: {}, values: { domain: "x.no", date: "2027-01-01", days: 3, registrar: "R", count: 2, problem: "p" } }, words);
        expect([code, /\{\w+\}/.test(text)]).toEqual([code, false]);
      }
    }
  });
});

describe("the small readers", () => {
  it("finds the registrable domain", () => {
    expect(apexOf("butikk.example.no")).toBe("example.no");
    expect(apexOf("example.no")).toBe("example.no");
    expect(apexOf("www.shop.example.co.uk")).toBe("example.co.uk");
  });
  it("knows Vercel's nameservers, SPF and DMARC", () => {
    expect(isVercelNameserver("ns1.vercel-dns.com.")).toBe(true);
    expect(isVercelNameserver("ns1.domeneshop.no")).toBe(false);
    expect(spfOf(["v=spf1 -all", "google-site-verification=x"])).toEqual(["v=spf1 -all"]);
    expect(dmarcOf(["v=DMARC1; p=quarantine"])).toBe("v=DMARC1; p=quarantine");
    expect(dmarcOf(["nothing"])).toBeNull();
  });
});
