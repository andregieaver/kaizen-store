import { describe, expect, it } from "vitest";

import { CSP_ENFORCE, checkoutCsp, payHeaders, payRouteHeaders, storageOrigin } from "./csp";

const directives = (policy: string) =>
  Object.fromEntries(
    policy.split("; ").map((part) => {
      const [name, ...values] = part.split(" ");
      return [name, values];
    }),
  );

const env = { supabaseUrl: "https://abc123.supabase.co", vercel: true };

describe("the pay routes' Content-Security-Policy (wave 1, 1e)", () => {
  const policy = directives(checkoutCsp(env));

  it("has no unsafe-eval, no bare wildcard and no other site's script", () => {
    expect(checkoutCsp(env)).not.toMatch(/unsafe-eval/);
    for (const [name, values] of Object.entries(policy)) {
      expect([name, values.includes("*")]).toEqual([name, false]);
      expect([name, values.includes("https:")]).toEqual([name, false]);
    }
    expect(policy["script-src"]).toEqual(["'self'", "'unsafe-inline'", "https://js.stripe.com", "https://*.js.stripe.com", "https://checkout.stripe.com", "https://maps.googleapis.com"]);
  });

  it("lets the Address Element's autocomplete load (Stripe's documented maps.googleapis.com), in script-src and connect-src only", () => {
    expect(policy["script-src"]).toContain("https://maps.googleapis.com");
    expect(policy["connect-src"]).toContain("https://maps.googleapis.com");
    for (const [name, values] of Object.entries(policy)) {
      if (name !== "script-src" && name !== "connect-src") expect([name, values.includes("https://maps.googleapis.com")]).toEqual([name, false]);
    }
  });

  it("names Stripe's documented origins exactly", () => {
    expect(policy["frame-src"]).toEqual(
      expect.arrayContaining(["https://js.stripe.com", "https://*.js.stripe.com", "https://hooks.stripe.com", "https://checkout.stripe.com", "https://link.com", "https://*.link.com"]),
    );
    expect(policy["connect-src"]).toEqual(expect.arrayContaining(["'self'", "https://api.stripe.com", "https://checkout.stripe.com", "https://link.com", "https://*.link.com"]));
    expect(policy["img-src"]).toEqual(expect.arrayContaining(["https://*.stripe.com", "https://*.link.com", "data:", "blob:"]));
  });

  it("shuts objects, framing, base and forms", () => {
    expect(policy["object-src"]).toEqual(["'none'"]);
    expect(policy["frame-ancestors"]).toEqual(["'none'"]);
    expect(policy["base-uri"]).toEqual(["'self'"]);
    expect(policy["form-action"]).toEqual(["'self'"]);
    expect(policy["default-src"]).toEqual(["'self'"]);
    expect(policy["font-src"]).toEqual(["'self'"]);
  });

  it("allows the storage host for pictures and uploaded videos, from the environment", () => {
    expect(policy["img-src"]).toContain("https://abc123.supabase.co");
    expect(policy["media-src"]).toEqual(["'self'", "https://abc123.supabase.co"]);
    const without = directives(checkoutCsp({ vercel: true }));
    expect(without["media-src"]).toEqual(["'self'"]);
    expect(without["img-src"].some((v) => v.includes("supabase"))).toBe(false);
  });

  it("upgrades insecure requests only on Vercel, so http://localhost still works", () => {
    expect(checkoutCsp({ vercel: true })).toMatch(/upgrade-insecure-requests/);
    expect(checkoutCsp({ vercel: false })).not.toMatch(/upgrade-insecure-requests/);
    expect(checkoutCsp({})).not.toMatch(/upgrade-insecure-requests/);
  });

  it("can be made stricter without inline scripts for the integrity-hash form, and only then", () => {
    expect(directives(checkoutCsp({ sri: true }))["script-src"]).not.toContain("'unsafe-inline'");
    expect(directives(checkoutCsp({}))["script-src"]).toContain("'unsafe-inline'");
  });

  it("reads the storage origin from an address, and nothing from one that is not", () => {
    expect(storageOrigin("https://abc.supabase.co/storage/v1")).toBe("https://abc.supabase.co");
    expect(storageOrigin("http://127.0.0.1:54321")).toBe("http://127.0.0.1:54321");
    expect(storageOrigin("javascript:alert(1)")).toBeNull();
    expect(storageOrigin("not a url")).toBeNull();
    expect(storageOrigin(undefined)).toBeNull();
  });
});

describe("the headers sent with it", () => {
  it("enforces the policy, with the two harmless headers", () => {
    expect(CSP_ENFORCE).toBe(true);
    const headers = payHeaders(env);
    expect(headers.map((h) => h.key)).toEqual(["Content-Security-Policy", "Referrer-Policy", "X-Content-Type-Options"]);
    expect(headers.find((h) => h.key === "Referrer-Policy")?.value).toBe("strict-origin-when-cross-origin");
    expect(headers.find((h) => h.key === "X-Content-Type-Options")?.value).toBe("nosniff");
  });

  it("sends the same policy as report-only when enforcement is switched off, the one-line fallback", () => {
    const enforced = payHeaders(env, true)[0];
    const reporting = payHeaders(env, false)[0];
    expect(reporting.key).toBe("Content-Security-Policy-Report-Only");
    expect(reporting.value).toBe(enforced.value);
    expect(payHeaders(env, false).some((h) => h.key === "Content-Security-Policy")).toBe(false);
  });

  it("is sent on both shapes of address", () => {
    const entries = payRouteHeaders(env);
    expect(entries).toHaveLength(2);
    expect(entries[0].source.startsWith("/s/:store/")).toBe(true);
    expect(entries[1].source.startsWith("/:market(")).toBe(true);
    for (const entry of entries) expect(entry.headers[0].value).toBe(checkoutCsp(env));
  });
});
