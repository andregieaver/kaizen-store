import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  CSP_ENFORCE,
  CSP_REPORT_PATH,
  PERMISSIONS_POLICY,
  PUBLIC_FILE_HEADERS,
  SITE_HEADERS,
  adminFrameHeaders,
  baseRouteHeaders,
  replayRouteHeaders,
  checkoutCsp,
  payHeaders,
  payRouteHeaders,
  reportOnlyHeaders,
  siteReportOnlyCsp,
  storageOrigin,
} from "./csp";

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

  it("is sent on every shape of address: with the market and, for a store that sells in one country, without it (D181)", () => {
    const entries = payRouteHeaders(env);
    expect(entries).toHaveLength(4);
    expect(entries[0].source.startsWith("/s/:store/:market(")).toBe(true);
    expect(entries[1].source.startsWith("/:market(")).toBe(true);
    expect(entries[2].source.startsWith("/s/:store/:route(")).toBe(true);
    expect(entries[3].source.startsWith("/:route(")).toBe(true);
    for (const entry of entries) expect(entry.headers[0].value).toBe(checkoutCsp(env));
  });
});

describe("the headers every route gets (PSI 2026-10-24, SEC-07)", () => {
  it("sends nosniff and the device policy everywhere and leaves Referrer-Policy to the routes that set a stricter one", () => {
    const [all] = baseRouteHeaders(null);
    expect(all.source).toBe("/:path*");
    expect(all.headers).toEqual([
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Permissions-Policy", value: PERMISSIONS_POLICY },
      ...reportOnlyHeaders(),
      // Who may frame the storefront and Kaizena Flow's pages (PSI SEC-07): only the site itself.
      { key: "Content-Security-Policy", value: "frame-ancestors 'self'" },
    ]);
    expect(SITE_HEADERS.some((h) => h.key === "Referrer-Policy")).toBe(false);
  });

  it("lets only Kaizena Flow frame the admin, and the theme store's own host when there is one", () => {
    const admin = baseRouteHeaders(null)[1];
    expect(admin.source).toBe("/admin/:path*");
    expect(admin.headers).toEqual([{ key: "Content-Security-Policy", value: "frame-ancestors 'self'" }]);
    expect(adminFrameHeaders("https://themes.kaizenaflow.com")).toEqual([
      { key: "Content-Security-Policy", value: "frame-ancestors 'self' https://themes.kaizenaflow.com" },
    ]);
  });

  it("keeps the microphone for the site's own voice features and never restricts payment, which Stripe's wallets need", () => {
    const features = Object.fromEntries(PERMISSIONS_POLICY.split(", ").map((d) => d.split("=") as [string, string]));
    expect(features.microphone).toBe("(self)");
    expect(features.camera).toBe("()");
    expect(features.geolocation).toBe("()");
    expect("payment" in features).toBe(false);
  });

  it("restricts nothing on the admin but who may frame it", () => {
    const policy = adminFrameHeaders(null)[0].value;
    expect(policy.split(";").map((d) => d.trim().split(" ")[0])).toEqual(["frame-ancestors"]);
  });
});

describe("the site-wide Report-Only policy (D389, SEC-05)", () => {
  const env = { supabaseUrl: "https://abc.supabase.co" };
  const directives = (policy: string) => Object.fromEntries(policy.split("; ").map((d) => [d.split(" ")[0], d.split(" ").slice(1)]));

  it("only reports, to the site's own endpoint, on every route", () => {
    const headers = reportOnlyHeaders(env);
    expect(headers.map((h) => h.key)).toEqual(["Content-Security-Policy-Report-Only", "Reporting-Endpoints"]);
    expect(headers[1].value).toBe(`csp="${CSP_REPORT_PATH}"`);
    const policy = directives(siteReportOnlyCsp(env));
    expect(policy["report-uri"]).toEqual([CSP_REPORT_PATH]);
    expect(policy["report-to"]).toEqual(["csp"]);
    expect(baseRouteHeaders(null, env)[0].headers).toEqual(expect.arrayContaining(headers));
  });

  it("names the origins the site loads, allows no eval and leaves frame-ancestors to the enforced headers", () => {
    const policy = directives(siteReportOnlyCsp(env));
    expect(policy["script-src"]).toEqual(expect.arrayContaining(["'self'", "https://js.stripe.com", "https://www.googletagmanager.com"]));
    expect(policy["script-src"]).not.toContain("'unsafe-eval'");
    expect(policy["connect-src"]).toEqual(expect.arrayContaining(["https://abc.supabase.co", "wss://abc.supabase.co"]));
    expect(policy["frame-src"]).toEqual(expect.arrayContaining(["https://www.youtube-nocookie.com", "https://player.vimeo.com"]));
    expect(policy["object-src"]).toEqual(["'none'"]);
    expect(policy["frame-ancestors"]).toBeUndefined();
  });
});

describe("public files (bloat review step 0.32)", () => {
  it("public files with a fixed address are kept a day", () => {
    expect(PUBLIC_FILE_HEADERS).toHaveLength(1);
    expect(PUBLIC_FILE_HEADERS[0].source).toBe("/:folder(flags|demo|kaizen)/:path*");
    expect(PUBLIC_FILE_HEADERS[0].headers).toEqual([{ key: "Cache-Control", value: "public, max-age=86400" }]);
    expect(readFileSync(join(process.cwd(), "next.config.ts"), "utf8")).toContain("...PUBLIC_FILE_HEADERS");
  });
});

describe("the recording player's policy (D656 8.6)", () => {
  it("keeps the admin's frame-ancestors and lets a replay load only the admin's, data, blob and storage files", () => {
    const [entry] = replayRouteHeaders("https://themes.kaizenaflow.com", { supabaseUrl: "https://abc.supabase.co" });
    expect(entry.source).toBe("/admin/:store/analytics/recordings/:id");
    const value = entry.headers[0].value;
    expect(value).toContain("frame-ancestors 'self' https://themes.kaizenaflow.com");
    expect(value).toContain("img-src 'self' data: blob: https://abc.supabase.co");
    expect(value).toContain("font-src 'self' data: https://abc.supabase.co");
    expect(value).toContain("style-src 'self' 'unsafe-inline' https://abc.supabase.co");
    expect(value).not.toMatch(/script-src/);
    expect(replayRouteHeaders(null)[0].headers[0].value).toBe(
      "frame-ancestors 'self'; img-src 'self' data: blob:; font-src 'self' data:; media-src 'self' blob:; style-src 'self' 'unsafe-inline'; frame-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'",
    );
  });
});
