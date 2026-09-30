import { describe, expect, it } from "vitest";

import { affiliateCookie } from "./affiliates";
import { CONSENT_CHANGED_EVENT, KNOWN_COOKIES, cookiePurpose, declaredCookies, knownCookie } from "./cookie-consent";

const STORE = "0f8fad5b-d9cb-469f-a165-70867728950e";

/** A store's referral link kept in a cookie (D131) is listed with the other things a site stores (D58), as marketing. */
describe("a store's referral cookie, on the cookie page", () => {
  it("is marketing, which the name of every store's cookie matches", () => {
    expect(knownCookie(affiliateCookie(STORE))?.category).toBe("marketing");
    expect(knownCookie(affiliateCookie(STORE))?.name).toBe("kaizen_aff_…");
    expect(knownCookie("kaizen_aff_")).toBeNull();
    expect(knownCookie("kaizen_aff_not-an-id")).toBeNull();
  });

  it("is listed only for a store whose program is on, never on Kaizen's own site", () => {
    expect(declaredCookies("store", {}).map((c) => c.name)).not.toContain("kaizen_aff_…");
    expect(declaredCookies("store", {}, { affiliate: true }).map((c) => c.name)).toContain("kaizen_aff_…");
    expect(declaredCookies("platform", {}, { affiliate: true }).map((c) => c.name)).not.toContain("kaizen_aff_…");
  });

  it("makes the store ask about marketing, like any other marketing cookie, and is the only necessary thing it is not", () => {
    const listed = declaredCookies("store", {}, { affiliate: true });
    expect(listed.filter((c) => c.category === "marketing").map((c) => c.name)).toEqual(["kaizen_aff_…"]);
    expect(declaredCookies("store", {}).filter((c) => c.category === "marketing")).toEqual([]);
  });

  it("says what it is for in every language the site's texts are written in, and how long at most", () => {
    const cookie = KNOWN_COOKIES.find((c) => c.affiliate);
    expect(cookie).toMatchObject({ provider: "Kaizen", on: "store", days: 90 });
    for (const lang of ["en", "nb", "sv", "da"]) expect(cookiePurpose(cookie!, lang).length, lang).toBeGreaterThan(30);
    expect(cookiePurpose(cookie!, "nb")).toMatch(/venn/i);
  });

  it("has an event for what waits for the visitor's choice", () => {
    expect(CONSENT_CHANGED_EVENT).toBe("kaizen:consent-changed");
  });
});
