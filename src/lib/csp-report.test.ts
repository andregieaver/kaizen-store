import { describe, expect, it } from "vitest";

import { CSP_REPORTS_MAX, blockedOrigin, cspViolations } from "./csp-report";

/** A Report-Only report (D389) is kept as its directive, the blocked origin and the part of the site, never an address in full. */
describe("cspViolations", () => {
  it("reads report-uri's format and keeps no path or query", () => {
    const body = {
      "csp-report": {
        "document-uri": "https://kaizenaflow.com/admin/acme/orders?token=secret",
        "effective-directive": "script-src-elem",
        "blocked-uri": "https://evil.example/x.js?key=abc",
      },
    };
    expect(cspViolations(body)).toEqual([{ directive: "script-src-elem", blocked: "https://evil.example", area: "admin" }]);
    expect(JSON.stringify(cspViolations(body))).not.toMatch(/secret|abc|orders/);
  });

  it("reads the Reporting API's list, with keywords as they are", () => {
    const body = [
      { type: "csp-violation", url: "https://shop.example/s/acme/no", body: { effectiveDirective: "script-src", blockedURL: "inline", documentURL: "https://shop.example/s/acme/no" } },
      { type: "deprecation", body: {} },
      { type: "csp-violation", body: { effectiveDirective: "img-src", blockedURL: "data:image/png;base64,AAAA" } },
    ];
    expect(cspViolations(body)).toEqual([
      { directive: "script-src", blocked: "inline", area: "site" },
      { directive: "img-src", blocked: "data", area: "site" },
    ]);
  });

  it("drops what is not a report, and reads at most a few from one request", () => {
    expect(cspViolations(null)).toEqual([]);
    expect(cspViolations({ "csp-report": { "effective-directive": "<script>" } })).toEqual([]);
    const many = Array.from({ length: 50 }, () => ({ type: "csp-violation", body: { effectiveDirective: "img-src", blockedURL: "https://a.example/p" } }));
    expect(cspViolations(many)).toHaveLength(CSP_REPORTS_MAX);
    expect(blockedOrigin("javascript:alert(1)")).toBe("other");
  });
});
