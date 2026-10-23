/**
 * A domain's health (D315, `docs/domains.md` 5.3): what the server gathered about one of a store's domains (its connection to the store,
 * its registration, where its DNS is answered and the records the world sees) turned into findings in code, each with how serious it is and
 * what fixes it. Pure, so the browser-free tests hold every finding; the page and the AI manager only show and repeat these, never make one.
 */

export type Severity = "error" | "warning" | "advice" | "info";

/** Where a domain's DNS is answered: Vercel's nameservers in Kaizena Flow's team, somewhere else, or not known (the lookup failed). */
export type DnsHost = "kaizena" | "elsewhere" | "unknown";

export type DomainFacts = {
  hostname: string;
  /** The registrable domain, `example.no` for `butikk.example.no`. */
  apex: string;
  /** The connection to the store (P8), as the latest check found it; null for a registration the store holds but has not connected. */
  connection: { status: "pending" | "active"; isPrimary: boolean; txt?: boolean; misconfigured?: boolean; problem?: string } | null;
  dnsHost: DnsHost;
  /** The registration: with Kaizena Flow (D315) or elsewhere, as RDAP or the registrar says. Null fields are not known. */
  registration: {
    withUs: boolean;
    registrar: string | null;
    expiresAt: string | null;
    /** Whether it renews by itself: ours from the owner's choice, elsewhere never known. */
    renews: boolean | null;
    /** The registrant's email confirmed (ICANN), ours only. */
    contactVerified: boolean | null;
  };
  /** The apex's records as public DNS answers them; null where the lookup failed (never read as "none"). */
  email: { mx: string[]; spf: string[]; dmarc: string | null } | null;
  caa: { tag: string; value: string }[] | null;
};

export type FindingCode =
  | "not_pointed"
  | "proof_missing"
  | "check_problem"
  | "expired"
  | "expires_soon"
  | "contact_unverified"
  | "caa_blocks"
  | "spf_duplicate"
  | "spf_missing"
  | "dmarc_missing"
  | "no_email"
  | "lookup_failed"
  | "healthy";

/** What fixes a finding: an AI manager tool, a part of the Domains page, or nothing (it is information). */
export type Fix = { tool?: string; place?: "records" | "renewal" | "email" | "contact" | "move_dns_here" };

export type Finding = { code: FindingCode; severity: Severity; fix: Fix; values: Record<string, string | number> };

/** Days before expiry a domain that does not renew by itself is a warning, and an error. */
export const EXPIRY_WARNING_DAYS = 30;
export const EXPIRY_ERROR_DAYS = 14;

/** The certificate authorities Vercel issues certificates with: a CAA record that names none of them stops the certificate. */
export const VERCEL_CAS = ["letsencrypt.org", "sectigo.com", "pki.goog"] as const;

const DAY_MS = 86_400_000;

/** Whole days from `now` to `at` (negative once passed). */
export const daysUntil = (at: string, now: Date): number => Math.floor((new Date(at).getTime() - now.getTime()) / DAY_MS);

const ORDER: Record<Severity, number> = { error: 0, warning: 1, advice: 2, info: 3 };

/** The findings for one domain, most serious first; `healthy` alone when nothing is wrong. */
export function domainHealth(facts: DomainFacts, now: Date): Finding[] {
  const found: Finding[] = [];
  const add = (code: FindingCode, severity: Severity, fix: Fix = {}, values: Record<string, string | number> = {}) =>
    found.push({ code, severity, fix, values: { domain: facts.hostname, ...values } });
  const ours = facts.dnsHost === "kaizena";

  const c = facts.connection;
  if (c && c.status === "pending") {
    if (c.misconfigured !== false) add("not_pointed", "error", ours ? { tool: "check_domain" } : { place: "records" });
    if (c.txt === false) add("proof_missing", "warning", { place: "records" });
    if (c.problem) add("check_problem", "warning", {}, { problem: c.problem });
  }

  const reg = facts.registration;
  if (reg.expiresAt) {
    const days = daysUntil(reg.expiresAt, now);
    if (days < 0) add("expired", "error", reg.withUs ? { tool: "renew_domain", place: "renewal" } : {}, { date: reg.expiresAt.slice(0, 10) });
    else if (reg.renews !== true && days <= EXPIRY_WARNING_DAYS) {
      add("expires_soon", days <= EXPIRY_ERROR_DAYS ? "error" : "warning", reg.withUs ? { tool: "renew_domain", place: "renewal" } : {}, {
        date: reg.expiresAt.slice(0, 10),
        days,
        registrar: reg.registrar ?? "",
      });
    }
  }
  if (reg.withUs && reg.contactVerified === false) add("contact_unverified", "error", { place: "contact" });

  if (facts.caa && facts.caa.length > 0) {
    const issuers = facts.caa.filter((r) => r.tag === "issue" || r.tag === "issuewild").map((r) => r.value.split(";")[0].trim().toLowerCase());
    if (issuers.length > 0 && !issuers.some((v) => (VERCEL_CAS as readonly string[]).includes(v))) add("caa_blocks", "error", ours ? { tool: "change_dns" } : { place: "records" });
  }

  if (facts.email === null || facts.caa === null) add("lookup_failed", "info");
  else {
    const { mx, spf, dmarc } = facts.email;
    if (spf.length > 1) add("spf_duplicate", "error", ours ? { tool: "change_dns" } : { place: "records" }, { count: spf.length });
    if (mx.length === 0) add("no_email", "info", ours ? { tool: "set_up_email", place: "email" } : {});
    else {
      if (spf.length === 0) add("spf_missing", "warning", ours ? { tool: "set_up_email", place: "email" } : { place: "records" });
      if (!dmarc) add("dmarc_missing", "advice", ours ? { tool: "set_up_email", place: "email" } : { place: "records" });
    }
  }

  const real = found.filter((f) => f.code !== "no_email" && f.code !== "lookup_failed");
  if (real.length === 0) found.unshift({ code: "healthy", severity: "info", fix: {}, values: { domain: facts.hostname } });
  return found.sort((a, b) => ORDER[a.severity] - ORDER[b.severity]);
}

/** The worst severity among findings; `info` when none is worse. */
export function worstSeverity(findings: readonly Finding[]): Severity {
  return findings.reduce<Severity>((worst, f) => (ORDER[f.severity] < ORDER[worst] ? f.severity : worst), "info");
}

/** A finding in words: the catalogue's template for its code with its values filled in (`{domain}`, `{date}`, `{days}`, …). */
export function findingText(finding: Finding, words: Readonly<Record<FindingCode, string>>): string {
  return words[finding.code].replace(/\{(\w+)\}/g, (all, key: string) => (key in finding.values ? String(finding.values[key]) : all));
}

/**
 * The registrable domain of a host when the check has not said (`checks.apexName`): the last two labels, or three under the second-level
 * suffixes stores in Kaizena Flow's markets meet (`co.uk`, `com.au`, …). The registrar's or Vercel's answer always wins over this.
 */
const TWO_LEVEL = new Set(["co.uk", "org.uk", "me.uk", "com.au", "net.au", "co.nz", "com.br", "co.za", "com.mx", "co.jp", "priv.no", "com.tr", "co.il"]);
export function apexOf(hostname: string): string {
  const labels = hostname.toLowerCase().replace(/\.$/, "").split(".");
  if (labels.length <= 2) return labels.join(".");
  const lastTwo = labels.slice(-2).join(".");
  return TWO_LEVEL.has(lastTwo) ? labels.slice(-3).join(".") : lastTwo;
}

/** Whether nameservers are Vercel's (so the DNS is answered in Kaizena Flow's team when the domain is there). */
export const isVercelNameserver = (ns: string): boolean => /(^|\.)vercel-dns\.com\.?$/i.test(ns.trim());

/** The SPF records among TXT values, and the DMARC policy among `_dmarc` TXT values. */
export const spfOf = (txt: readonly string[]): string[] => txt.filter((v) => /^v=spf1(\s|$)/i.test(v.trim()));
export const dmarcOf = (txt: readonly string[]): string | null => txt.find((v) => /^v=DMARC1(;|\s|$)/i.test(v.trim())) ?? null;
