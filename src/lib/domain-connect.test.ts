import { createSign, createVerify, generateKeyPairSync } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { applyQuery, applyUrl, discoveryHost, domainConnectTemplate, DC_SERVICES, publicKeyRecords, readSettings } from "./domain-connect";

describe("Domain Connect (D315 6)", () => {
  it("publishes the templates exactly as the code has them", () => {
    for (const kind of ["apex", "host"] as const) {
      const file = JSON.parse(readFileSync(join(process.cwd(), `docs/domain-connect/kaizenaflow.com.${DC_SERVICES[kind]}.json`), "utf8"));
      expect(file).toEqual(domainConnectTemplate(kind));
    }
    // A CNAME on the host itself only where a host is required, as the specification asks.
    expect(domainConnectTemplate("host").hostRequired).toBe(true);
    expect(domainConnectTemplate("apex").records[0]).toMatchObject({ type: "A", host: "@", pointsTo: "%ip%" });
  });

  it("reads discovery and settings defensively", () => {
    expect(discoveryHost(["domainconnect.example-dns.com"])).toBe("domainconnect.example-dns.com");
    expect(discoveryHost(["https://evil.example/x?y", "v=spf1 -all"])).toBeNull();
    expect(readSettings({ providerId: "x", providerName: "Example DNS", urlAPI: "https://api.example-dns.com/", urlSyncUX: "https://dc.example-dns.com" })).toEqual({
      providerId: "x",
      providerName: "Example DNS",
      providerDisplayName: null,
      urlAPI: "https://api.example-dns.com",
      urlSyncUX: "https://dc.example-dns.com",
    });
    expect(readSettings({ providerId: "x", providerName: "Y", urlAPI: "http://plain.example" })).toBeNull();
  });

  it("signs the query string the provider checks, with the key's records to publish", () => {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const query = applyQuery({ domain: "example.no", host: "butikk", token: "abc", ip: "76.76.21.21", redirectUri: "https://kaizenaflow.com/admin/x/settings/domains?dc=back", state: "id" });
    expect(query).toBe("domain=example.no&host=butikk&token=abc&redirect_uri=https%3A%2F%2Fkaizenaflow.com%2Fadmin%2Fx%2Fsettings%2Fdomains%3Fdc%3Dback&state=id");
    const sig = createSign("RSA-SHA256").update(query).sign(privateKey, "base64");
    const url = applyUrl({ providerId: "x", providerName: "X", providerDisplayName: null, urlAPI: "https://api.x", urlSyncUX: "https://dc.x" }, "host", query, sig);
    expect(url.startsWith("https://dc.x/v2/domainTemplates/providers/kaizenaflow.com/services/store-host/apply?domain=example.no")).toBe(true);
    const signed = new URL(url).searchParams.get("sig")!;
    expect(createVerify("RSA-SHA256").update(query).verify(publicKey, signed, "base64")).toBe(true);
    const spki = publicKey.export({ type: "spki", format: "der" }).toString("base64");
    const records = publicKeyRecords(spki);
    expect(records.map((r) => r.replace(/^p=\d+,a=RS256,d=/, "")).join("")).toBe(spki);
  });
});
