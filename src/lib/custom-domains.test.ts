import { afterEach, describe, expect, it, vi } from "vitest";

import { dnsRecords, domainInput, normalizeHostname } from "./custom-domains";

afterEach(() => vi.unstubAllEnvs());

describe("stores' own domains (P8)", () => {
  it("takes a domain as owners type it", () => {
    expect(normalizeHostname(" https://Butikk.Example.no/om-oss ")).toBe("butikk.example.no");
    expect(normalizeHostname("example.no.")).toBe("example.no");
    expect(normalizeHostname("blåbær.no")).toBe("xn--blbr-roah.no");
    expect(domainInput.parse({ hostname: "WWW.Example.no" })).toEqual({ hostname: "www.example.no" });
  });

  it("refuses what is not a domain, and Kaizen's own addresses", () => {
    vi.stubEnv("NEXT_PUBLIC_STORE_DOMAIN", "kaizenstore.site");
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "kaizenstore.cloud");
    const problem = (hostname: string) => domainInput.safeParse({ hostname }).error?.issues[0]?.message;
    expect(problem("localhost")).toMatch(/as it is written in a browser/);
    expect(problem("192.168.1.1")).toMatch(/as it is written in a browser/);
    expect(problem("-bad.example.no")).toMatch(/as it is written in a browser/);
    expect(problem("demo.kaizenstore.site")).toMatch(/Kaizen's/);
    expect(problem("kaizenstore.cloud")).toMatch(/Kaizen's/);
    expect(problem("my-app.vercel.app")).toMatch(/Kaizen's/);
    expect(problem("butikk.example.no")).toBeUndefined();
  });

  it("asks for our TXT record, then A records for an apex and a CNAME for a subdomain", () => {
    expect(dnsRecords("example.no", "abc", { apexName: "example.no" }).map((r) => [r.type, r.name, r.value, r.done])).toEqual([
      ["TXT", "_kaizen.example.no", "kaizen-verify=abc", false],
      ["A", "example.no", "76.76.21.21", false],
    ]);
    const checked = dnsRecords("butikk.example.no", "abc", {
      apexName: "example.no",
      txt: true,
      misconfigured: false,
      cname: "d1b2.vercel-dns-017.com",
      vercelVerified: false,
      challenges: [{ type: "TXT", domain: "_vercel.example.no", value: "vc-domain-verify=butikk.example.no,123" }],
    });
    expect(checked.map((r) => [r.type, r.name, r.value, r.done])).toEqual([
      ["TXT", "_kaizen.butikk.example.no", "kaizen-verify=abc", true],
      ["CNAME", "butikk.example.no", "d1b2.vercel-dns-017.com", true],
      ["TXT", "_vercel.example.no", "vc-domain-verify=butikk.example.no,123", false],
    ]);
  });
});
