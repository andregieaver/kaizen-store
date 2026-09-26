import { describe, expect, it } from "vitest";

import {
  consentIsCurrent,
  consentVersion,
  declaredCookies,
  decodeConsent,
  encodeConsent,
  knownCookie,
  parseTracking,
  toolCategories,
  trackingSchema,
} from "./cookie-consent";

const visitor = "3f2b8c1e-7a4d-4b9e-9c2a-1d5e6f7a8b9c";

describe("cookie consent (D58)", () => {
  it("takes each tool's id as its service writes it, and an empty field as the tool off", () => {
    expect(trackingSchema.parse({ ga4: " g-abc123xyz ", gtm: "", metaPixel: "1234567890" })).toEqual({
      ga4: "G-ABC123XYZ",
      metaPixel: "1234567890",
    });
    expect(trackingSchema.safeParse({ ga4: "UA-12345-1" }).success).toBe(false);
    expect(trackingSchema.safeParse({ gtm: "GTM-<script>" }).success).toBe(false);
    expect(trackingSchema.safeParse({ metaPixel: "12ab" }).success).toBe(false);
    expect(parseTracking("damaged")).toEqual({});
  });

  it("asks only about the categories the tools need", () => {
    expect(toolCategories({})).toEqual([]);
    expect(toolCategories({ ga4: "G-ABCDEF" })).toEqual(["statistics"]);
    expect(toolCategories({ metaPixel: "123456" })).toEqual(["marketing"]);
    expect(toolCategories({ gtm: "GTM-ABCDEF" })).toEqual(["statistics", "marketing"]);
    expect(consentVersion(["marketing", "statistics"])).toBe("statistics+marketing");
  });

  it("keeps a choice in a cookie the browser can read, and asks again when the categories change", () => {
    const choices = { preferences: false, statistics: true, marketing: false };
    const value = encodeConsent({ visitor, version: "statistics", choices });
    expect(value).toBe(`1.${visitor}.statistics.010`);
    const stored = decodeConsent(value);
    expect(stored).toEqual({ visitor, version: "statistics", choices });
    expect(consentIsCurrent(stored, "statistics")).toBe(true);
    // Marketing added since: the visitor is asked again.
    expect(consentIsCurrent(stored, "statistics+marketing")).toBe(false);
    for (const bad of [undefined, "", "1.nope.statistics.010", `2.${visitor}.statistics.010`, `1.${visitor}.statistics.01`]) {
      expect(decodeConsent(bad)).toBeNull();
    }
  });

  it("knows Kaizen's cookies and the tools', and lists those each kind of site uses", () => {
    expect(knownCookie("cart_3f2b8c1e-7a4d-4b9e-9c2a-1d5e6f7a8b9c_no")?.category).toBe("necessary");
    expect(knownCookie("_ga_ABC123")?.category).toBe("statistics");
    expect(knownCookie("_fbp")?.provider).toBe("Meta");
    expect(knownCookie("mystery")).toBeNull();
    const store = declaredCookies("store", {}).map((c) => c.name);
    expect(store).toEqual(["cart_…", "account_…", "wishlist_…", "consent_…"]);
    expect(declaredCookies("store", {}, { buyers: true }).map((c) => c.name)).toContain("buyer_…");
    expect(knownCookie("buyer_3f2b8c1e-7a4d-4b9e-9c2a-1d5e6f7a8b9c")?.category).toBe("necessary");
    expect(declaredCookies("store", { metaPixel: "123456" }).map((c) => c.name)).toContain("_fbp");
    expect(declaredCookies("platform", {}).map((c) => c.name)).toEqual(["consent_…", "sb-…-auth-token"]);
  });
});
