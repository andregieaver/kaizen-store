import { describe, expect, it } from "vitest";

import { domainsEn } from "./admin-messages/domains.en";
import { domainsNb } from "./admin-messages/domains.nb";
import { effectText, isProtected, mailProvider, mergeSpf, planDns, zoneRev, type EffectCode } from "./dns-plan";
import type { DnsRecord } from "./dns-records";
import { parseRecordLines, recipeChanges } from "./dns-recipes";

const apex = "example.no";
let n = 0;
const rec = (r: Omit<DnsRecord, "id" | "ttl">): DnsRecord => ({ id: `rec_${(n += 1)}`, ttl: 3600, ...r });

const zone = (): DnsRecord[] => [
  rec({ type: "A", name: "", value: "76.76.21.21" }),
  rec({ type: "CNAME", name: "www", value: "cname.vercel-dns.com" }),
  rec({ type: "TXT", name: "_kaizen", value: "kaizen-verify=abc" }),
  rec({ type: "MX", name: "", value: "mx1.domeneshop.no", mxPriority: 10 }),
  rec({ type: "TXT", name: "", value: "v=spf1 include:_spf.domeneshop.no ~all" }),
];
const connected = ["", "www"];

describe("planning a DNS change (D315 5.1)", () => {
  it("adds, removes, and says what the change does", () => {
    const current = zone();
    const plan = planDns({ apex, current, connectedNames: connected, changes: [{ op: "add", record: { type: "CNAME", name: "blog", value: "ghost.io" } }] });
    expect(plan).toMatchObject({ ok: true, problems: [], removes: [] });
    expect(plan.adds).toEqual([{ type: "CNAME", name: "blog", value: "ghost.io", ttl: 3600 }]);
    expect(plan.effects.map((e) => e.code)).toEqual(["subdomain_points", "adds"]);
    expect(plan.touchesEmail).toBe(false);
  });

  it("never touches what the store needs, unless Kaizena Flow connects it", () => {
    const current = zone();
    const plan = planDns({ apex, current, connectedNames: connected, changes: [{ op: "remove", record: current[0] }, { op: "add", record: { type: "A", name: "www", value: "1.2.3.4" } }, { op: "remove", record: current[2] }] });
    expect(plan.ok).toBe(false);
    expect(plan.problems).toHaveLength(3);
    expect(planDns({ apex, current, connectedNames: connected, changes: [{ op: "remove", record: current[0] }], kaizena: true }).ok).toBe(true);
    expect(isProtected({ type: "MX", name: "", value: "x" }, connected)).toBe(false);
  });

  it("merges a second SPF record into the one there", () => {
    const current = zone();
    const plan = planDns({ apex, current, connectedNames: connected, changes: [{ op: "add", record: { type: "TXT", name: "", value: "v=spf1 include:_spf.google.com ~all" } }] });
    expect(plan.ok).toBe(true);
    expect(plan.removes).toEqual([current[4]]);
    expect(plan.adds).toEqual([{ type: "TXT", name: "", value: "v=spf1 include:_spf.domeneshop.no include:_spf.google.com ~all", ttl: 3600 }]);
    expect(plan.after.filter((r) => r.value.startsWith("v=spf1"))).toHaveLength(1);
  });

  it("refuses a CNAME beside other records, and an MX at a CNAME", () => {
    const current = zone();
    expect(planDns({ apex, current, connectedNames: connected, changes: [{ op: "add", record: { type: "CNAME", name: "_kaizen2", value: "x.example.com" } }, { op: "add", record: { type: "TXT", name: "_kaizen2", value: "hi" } }] }).problems).toEqual([
      "_kaizen2.example.no can't have a CNAME record beside other records.",
    ]);
    const withMail = [...current, rec({ type: "CNAME", name: "mail", value: "elsewhere.example.com" })];
    expect(planDns({ apex, current: withMail, connectedNames: connected, changes: [{ op: "add", record: { type: "MX", name: "", value: "mail.example.no", mxPriority: 20 } }] }).problems[0]).toMatch(/must point at a host/);
  });

  it("knows when email stops or moves, which asks even when changes are automatic", () => {
    const current = zone();
    const stops = planDns({ apex, current, connectedNames: connected, changes: [{ op: "remove", record: current[3] }] });
    expect(stops.touchesEmail).toBe(true);
    expect(stops.effects[0]).toEqual({ code: "email_stops", values: { domain: apex } });
    const google = recipeChanges("google_workspace", {}, current);
    if (!google.ok) throw new Error(google.problems.join());
    const moves = planDns({ apex, current, connectedNames: connected, changes: google.changes });
    expect(moves.ok).toBe(true);
    expect(moves.touchesEmail).toBe(true);
    expect(moves.effects[0]).toEqual({ code: "email_to", values: { domain: apex, provider: "Google Workspace" } });
  });

  it("says nothing changes for a record already there, and refuses removing one that isn't", () => {
    const current = zone();
    expect(planDns({ apex, current, connectedNames: connected, changes: [{ op: "add", record: { type: "MX", name: "@", value: "MX1.domeneshop.no.", mxPriority: 10 } }] }).ok).toBe(false);
    expect(planDns({ apex, current, connectedNames: connected, changes: [{ op: "remove", record: { type: "TXT", name: "", value: "nope" } }] }).problems[0]).toMatch(/no TXT record/);
  });

  it("fingerprints the records it read, in any order", () => {
    const current = zone();
    expect(zoneRev(current)).toBe(zoneRev([...current].reverse()));
    expect(zoneRev(current)).not.toBe(zoneRev(current.slice(1)));
  });

  it("has words for every effect in English and Norwegian", () => {
    const codes: EffectCode[] = ["email_to", "email_stops", "email_extra", "website_points", "subdomain_points", "verification", "spf_set", "spf_merged", "dkim_set", "dmarc_set", "removes", "adds"];
    for (const words of [domainsEn.dns.effects, domainsNb.dns.effects]) {
      for (const code of codes) expect([code, /\{\w+\}/.test(effectText({ code, values: { domain: apex, provider: "P", host: "h", target: "t", value: "v", count: 2 } }, words))]).toEqual([code, false]);
    }
  });
});

describe("SPF and mail providers", () => {
  it("merges SPF mechanisms once, keeping the first record's all", () => {
    expect(mergeSpf("v=spf1 include:a -all", "v=spf1 include:b include:a ~all")).toBe("v=spf1 include:a include:b -all");
    expect(mergeSpf("hello", "v=spf1 -all")).toBeNull();
  });
  it("names mail providers by their MX hosts", () => {
    expect(mailProvider("smtp.google.com")).toBe("Google Workspace");
    expect(mailProvider("contoso-com.mail.protection.outlook.com")).toBe("Microsoft 365");
    expect(mailProvider("mx.example.org")).toBe("mx.example.org");
  });
});

describe("recipes (D315 5.2)", () => {
  it("builds Microsoft 365 from the values the owner pastes, and refuses ones that don't look right", () => {
    const current = zone();
    const ok = recipeChanges("microsoft_365", { mx: "example-no.mail.protection.outlook.com", autodiscover: "autodiscover.outlook.com", verification: "MS=ms12345678" }, current);
    expect(ok.ok && ok.changes.map((c) => `${c.op} ${c.record.type} ${c.record.name}`)).toEqual(["remove MX ", "add MX ", "add CNAME autodiscover", "add TXT ", "add TXT "]);
    expect(recipeChanges("microsoft_365", { mx: "mx.google.com", autodiscover: "autodiscover.outlook.com" }, current)).toMatchObject({ ok: false });
    expect(recipeChanges("microsoft_365", {}, current)).toMatchObject({ ok: false });
  });

  it("reads the lines a provider shows", () => {
    expect(parseRecordLines('MX @ mail.protonmail.ch 10\n10 mailsec.protonmail.ch\nTXT @ "protonmail-verification=abc"\nCNAME protonmail._domainkey x.domains.proton.ch.')).toMatchObject({ problems: [expect.any(String)] });
    const { records, problems } = parseRecordLines('MX @ mail.protonmail.ch 10\nMX @ 20 mailsec.protonmail.ch\nTXT @ "protonmail-verification=abc"');
    expect(problems).toEqual([]);
    expect(records).toEqual([
      { type: "MX", name: "", value: "mail.protonmail.ch", mxPriority: 10 },
      { type: "MX", name: "", value: "mailsec.protonmail.ch", mxPriority: 20 },
      { type: "TXT", name: "", value: "protonmail-verification=abc" },
    ]);
  });

  it("starts DMARC at none, replacing a policy there", () => {
    const current = [...zone(), rec({ type: "TXT", name: "_dmarc", value: "v=DMARC1; p=reject" })];
    const made = recipeChanges("dmarc", {}, current);
    expect(made.ok && made.changes.map((c) => `${c.op} ${c.record.value}`)).toEqual(["remove v=DMARC1; p=reject", "add v=DMARC1; p=none"]);
  });
});
