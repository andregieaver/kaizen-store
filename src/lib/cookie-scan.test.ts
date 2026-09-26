import { describe, expect, it } from "vitest";

import { parseScannedItems, reviewFindings, sameSite, type ScannedItem } from "./cookie-scan";

const item = (over: Partial<ScannedItem>): ScannedItem => ({
  kind: "cookie",
  name: "x",
  domain: "kaizenstore.cloud",
  thirdParty: false,
  days: null,
  beforeConsent: false,
  page: "/",
  ...over,
});

describe("cookie scan findings (D58)", () => {
  it("knows Kaizen's cookies, takes the owner's word for the rest, and puts faults first", () => {
    const reviewed = reviewFindings(
      [
        item({ name: "cart_00000000-0000-0000-0000-000000000000_no", beforeConsent: true }),
        item({ name: "_ga", beforeConsent: false }),
        item({ name: "_hjSession_1", domain: "hotjar.com", thirdParty: true }),
        item({ name: "_fbp", beforeConsent: true }),
        item({ kind: "localStorage", name: "_ga" }),
        item({ kind: "localStorage", name: "widget", beforeConsent: true }),
      ],
      [
        { kind: "localStorage", name: "widget", domain: "kaizenstore.cloud", category: "marketing", provider: "Widget", purpose: "Ads." },
      ],
    );
    expect(reviewed.map((r) => [r.kind, r.name, r.category, r.problem])).toEqual([
      ["cookie", "_fbp", "marketing", "early"],
      ["localStorage", "widget", "marketing", "early"],
      ["cookie", "_hjSession_1", null, "undescribed"],
      // A storage item is never taken for a cookie of the same name.
      ["localStorage", "_ga", null, "undescribed"],
      ["cookie", "cart_00000000-0000-0000-0000-000000000000_no", "necessary", null],
      ["cookie", "_ga", "statistics", null],
    ]);
    expect(reviewed[0].known?.provider).toBe("Meta");
    expect(reviewed[1].note?.provider).toBe("Widget");
  });

  it("reads stored findings, leaving out what is damaged", () => {
    expect(parseScannedItems(null)).toEqual([]);
    expect(parseScannedItems([item({}), { kind: "cookie" }, "x"])).toEqual([item({})]);
  });

  it("counts a site's subdomains as the site itself", () => {
    expect(sameSite("kaizenstore.cloud", ".kaizenstore.cloud")).toBe(true);
    expect(sameSite("www.kaizenstore.cloud", "kaizenstore.cloud")).toBe(true);
    expect(sameSite("kaizenstore.cloud", "facebook.com")).toBe(false);
    expect(sameSite("kaizenstore.cloud", "notkaizenstore.cloud")).toBe(false);
  });
});
