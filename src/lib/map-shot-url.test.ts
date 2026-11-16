import { describe, expect, it } from "vitest";

import { consentCookieName, decodeConsent } from "./cookie-consent";
import { dataCookieName, decodeAssignments, MARKER_COOKIE } from "./experiments";
import { mapCookies, mapViewport, pageOfKey, ROBOT_VISITOR } from "./map-shot-url";

/** Where and how heatmaps' pictures are taken (D656, `docs/heatmaps-and-recordings.md` 9.2). */

const STORE = "11111111-1111-4111-8111-111111111111";
const EXP = "3f2b8c1e-7a4d-4b9e-9c2a-1d5e6f7a8b9c";

describe("a page key back to its market and path", () => {
  it("reads the market as the first part, for a store in several markets and one in its home market alone (D181)", () => {
    expect(pageOfKey("/no/p/demo-mug")).toEqual({ market: "no", path: "/p/demo-mug" });
    expect(pageOfKey("/se-en/category/hjem")).toEqual({ market: "se-en", path: "/category/hjem" });
    // A marketless store's pages are kept under its home market, and `marketUrl()` leaves the market out of their address.
    expect(pageOfKey("/no")).toEqual({ market: "no", path: "" });
    expect(pageOfKey("/no/side")).toEqual({ market: "no", path: "/side" });
    expect(pageOfKey("not a key")).toBeNull();
    expect(pageOfKey("/")).toBeNull();
  });
});

describe("the screen", () => {
  it("takes a phone, a tablet and a computer at the store's breakpoints", () => {
    expect(mapViewport(null, "mobile")).toEqual({ width: 390, height: 844, mobile: true });
    expect(mapViewport(null, "tablet")).toEqual({ width: 820, height: 1180, mobile: false });
    expect(mapViewport(null, "desktop")).toEqual({ width: 1440, height: 900, mobile: false });
    // A store whose phones end at 900 px is photographed inside its own phone range.
    const wide = mapViewport({ breakpoints: { md: 900, lg: 1200, xl: 1500 } }, "tablet");
    expect(wide.width).toBeGreaterThanOrEqual(900);
    expect(wide.width).toBeLessThan(1200);
  });
});

describe("the cookies", () => {
  it("refuses every optional cookie under the site's own version, as a robot", () => {
    const [consent, ...rest] = mapCookies(STORE, "statistics+heat", "");
    expect(rest).toEqual([]);
    expect(consent.name).toBe(consentCookieName(STORE));
    expect(decodeConsent(consent.value)).toEqual({ visitor: ROBOT_VISITOR, version: "statistics+heat", choices: { preferences: false, statistics: false, marketing: false, recordings: false } });
  });

  it("adds the two cookies the proxy reads for a version other than a, and nothing for a", () => {
    expect(mapCookies(STORE, "statistics", `${EXP}:a`)).toHaveLength(1);
    const cookies = mapCookies(STORE, "statistics", `${EXP}:c`);
    expect(cookies.find((c) => c.name === MARKER_COOKIE)?.value).toBe("1");
    const data = cookies.find((c) => c.name === dataCookieName(STORE));
    expect(decodeAssignments(decodeURIComponent(data!.value))).toEqual({ visitor: ROBOT_VISITOR, versions: { [EXP]: "c" } });
  });
});
