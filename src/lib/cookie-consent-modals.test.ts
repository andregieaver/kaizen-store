import { describe, expect, it } from "vitest";

import { KNOWN_COOKIES, declaredCookies, knownCookie, cookiePurpose } from "./cookie-consent";
import { modalStorageName } from "./page-modal";

/** The pop-ups that remember being closed (D121) are listed with the other things a site stores (D58). */
describe("a remembered closing of a modal, on the cookie page", () => {
  it("is a preference, which the storage name of every modal matches", () => {
    for (const key of ["promo", "summer-sale-2", "a"]) {
      expect(knownCookie(modalStorageName(key))?.category, key).toBe("preferences");
    }
    expect(knownCookie("kaizen_modal_")).toBeNull();
    expect(knownCookie("kaizen_modal_Promo")).toBeNull();
  });

  it("is listed only on a site with such a modal, for a store and for Kaizen's own", () => {
    expect(declaredCookies("store", {}).map((c) => c.name)).not.toContain("kaizen_modal_…");
    expect(declaredCookies("platform", {}).map((c) => c.name)).not.toContain("kaizen_modal_…");
    expect(declaredCookies("store", {}, { modals: true }).map((c) => c.name)).toContain("kaizen_modal_…");
    expect(declaredCookies("platform", {}, { modals: true }).map((c) => c.name)).toContain("kaizen_modal_…");
  });

  it("says what it is for in every language the site's texts are written in", () => {
    const cookie = KNOWN_COOKIES.find((c) => c.modals);
    expect(cookie).toBeDefined();
    for (const lang of ["en", "nb", "sv", "da"]) expect(cookiePurpose(cookie!, lang).length, lang).toBeGreaterThan(30);
    expect(cookiePurpose(cookie!, "nb")).toMatch(/popup/i);
  });
});
