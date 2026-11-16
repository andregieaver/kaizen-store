import { describe, expect, it } from "vitest";

import { consentIsCurrent, consentVersion, decodeConsent, encodeConsent, toolCategories, versionHas } from "./cookie-consent";
import { declaredCookies, knownCookie } from "./known-cookies";
import { parseTracking, trackingSchema } from "./cookie-consent-schema";

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
    const choices = { preferences: false, statistics: true, marketing: false, recordings: false };
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

  it("knows Kaizena Flow's cookies and the tools', and lists those each kind of site uses", () => {
    expect(knownCookie("cart_3f2b8c1e-7a4d-4b9e-9c2a-1d5e6f7a8b9c_no")?.category).toBe("necessary");
    expect(knownCookie("_ga_ABC123")?.category).toBe("statistics");
    expect(knownCookie("_fbp")?.provider).toBe("Meta");
    expect(knownCookie("mystery")).toBeNull();
    const store = declaredCookies("store", {}).map((c) => c.name);
    expect(store).toEqual(["cart_…", "account_…", "wishlist_…", "kaizen_mine_…", "consent_…"]);
    expect(declaredCookies("store", {}, { buyers: true }).map((c) => c.name)).toContain("buyer_…");
    // A store in several languages keeps the language a visitor chose, for its front door (D479).
    expect(declaredCookies("store", {}, { languages: true }).map((c) => c.name)).toContain("kaizen_lang_…");
    expect(knownCookie("kaizen_lang_3f2b8c1e-7a4d-4b9e-9c2a-1d5e6f7a8b9c")?.category).toBe("necessary");
    expect(knownCookie("buyer_3f2b8c1e-7a4d-4b9e-9c2a-1d5e6f7a8b9c")?.category).toBe("necessary");
    expect(declaredCookies("store", { metaPixel: "123456" }).map((c) => c.name)).toContain("_fbp");
    expect(declaredCookies("platform", {}).map((c) => c.name)).toEqual([
      "kaizen_admin_color_mode",
      "kaizen_admin_scheme",
      "consent_…",
      "sb-…-auth-token",
      "kaizen_life_link",
      "kaizen_slack_connect",
      "kaizen_google",
      "kaizen_mollie_connect",
      "kaizen_sandbox",
    ]);
    // The pass staff are given to change words on a store's own domain (D193) is known and necessary, and not declared to visitors, who are never given it.
    expect(knownCookie("kaizen_edit")).toMatchObject({ category: "necessary", staff: true });
    expect(declaredCookies("store", {}, { buyers: true, chat: true, colorMode: true, modals: true, affiliate: true, recommendations: true, experiments: true }).map((c) => c.name)).not.toContain("kaizen_edit");
    expect(declaredCookies("platform", {}).map((c) => c.name)).not.toContain("kaizen_edit");
    // A visitor's light or dark only in stores that let them choose (D99).
    expect(declaredCookies("store", {}, { colorMode: true }).map((c) => c.name)).toContain("color_mode_…");
    expect(knownCookie("color_mode_3f2b8c1e-7a4d-4b9e-9c2a-1d5e6f7a8b9c")?.category).toBe("necessary");
  });
});

describe("recordings and heatmaps in the consent (D656)", () => {
  const none = { preferences: false, statistics: false, marketing: false, recordings: false };

  it("keeps three bits for a site that does not ask about recordings, and four for one that does", () => {
    expect(encodeConsent({ visitor, version: "statistics+marketing", choices: { ...none, statistics: true, recordings: true } })).toBe(
      `1.${visitor}.statistics+marketing.010`,
    );
    const four = encodeConsent({ visitor, version: "statistics+recordings", choices: { ...none, statistics: true, recordings: true } });
    expect(four).toBe(`1.${visitor}.statistics+recordings.0101`);
    expect(decodeConsent(four)?.choices).toEqual({ ...none, statistics: true, recordings: true });
    // A cookie written before recordings existed reads as not allowing them.
    expect(decodeConsent(`1.${visitor}.statistics.010`)?.choices.recordings).toBe(false);
    expect(decodeConsent(`1.${visitor}.statistics.01011`)).toBeNull();
  });

  it("names heatmaps in the version only while they run, so visitors are asked again", () => {
    expect(consentVersion(["statistics"])).toBe("statistics");
    expect(consentVersion(["statistics"], ["heat"])).toBe("statistics+heat");
    expect(consentVersion(["recordings", "statistics", "marketing", "preferences"], ["heat"])).toBe("preferences+statistics+marketing+recordings+heat");
    expect(versionHas("statistics+heat", "heat")).toBe(true);
    expect(versionHas("statistics", "heat")).toBe(false);
    expect(versionHas("statistics+marketing", "recordings")).toBe(false);
    const longest = consentVersion(["preferences", "statistics", "marketing", "recordings"], ["heat"]);
    expect(decodeConsent(`1.${visitor}.${longest}.11111`)).toBeNull();
    expect(decodeConsent(`1.${visitor}.${longest}.1111`)?.version).toBe(longest);
  });

  it("declares the recorder's storage only in a store that records, and knows its items in a scan", () => {
    expect(declaredCookies("store", {}).map((c) => c.name)).not.toContain("kaizen_replay_…");
    const recording = declaredCookies("store", {}, { recordings: true });
    expect(recording.map((c) => c.name)).toEqual(expect.arrayContaining(["kaizen_replay_…", "kaizen_replay_ids_…"]));
    expect(knownCookie(`kaizen_replay_${visitor}`)).toMatchObject({ category: "recordings", storage: "session" });
    expect(knownCookie(`kaizen_replay_ids_${visitor}`)).toMatchObject({ category: "recordings", storage: "local" });
    // The recommendations' tab memory keeps its own name and category.
    expect(knownCookie("kaizen_rec")?.category).toBe("necessary");
  });
});
